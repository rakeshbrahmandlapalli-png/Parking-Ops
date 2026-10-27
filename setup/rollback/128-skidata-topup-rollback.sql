-- Rollback for part 128 (SKIDATA card top-up): can, my_permissions and set_staff_access
-- as part 123, admin_save_client as part 121 (the live definitions on 27 Oct 2026,
-- before part 128). The card_topups table, companies.topup, brand.topup and the
-- top-up functions stay (history kept); with can('topup') gone nobody can call them.
-- Restore the app without the top-up first. A saved 'topup' / '-topup' in someone's
-- access must be taken off before set_staff_access will save their access again.
begin;

create or replace function can(p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  s staff := me();
  roles text[];
begin
  if s.id is null then return false; end if;
  if p_action = 'collections' and not private.collections_on(s.company_id) then return false; end if;
  if ('-' || p_action) = any(s.extra) then return false; end if;
  if p_action = any(s.extra) then return true; end if;
  if s.role = 'owner' then return true; end if;
  -- AT DESK: whoever can press CALLED can also press AT DESK (part 115).
  if p_action = 'desk' and s.role <> 'view' and can('called') then return true; end if;
  roles := case p_action
    when 'sent'        then array['office','manager','bongo']
    when 'called'      then array['office','manager']
    when 'desk'        then array['office','manager','terminal']
    when 'clear'       then array['office','manager','terminal']
    when 'yard'        then array['office','manager']
    when 'summary'     then array['office','manager']
    when 'log'         then array['office','manager']
    when 'flights'     then array['office']
    when 'rtc'         then array['office','manager','bongo']
    when 'picksinfo'   then array['office','manager','terminal']
    when 'import'      then array['office','manager']
    when 'staff'       then array['office','manager']
    when 'settings'    then array['manager']
    when 'collections' then array['office','manager']
    when 'callpop'     then array['office','manager']
    else null end;
  if roles is null then return s.role <> 'view'; end if;
  return s.role = any(roles);
end;
$$;

create or replace function my_permissions() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(a, can(a)) from unnest(array['sent','called','desk','clear','yard','summary','log','flights','rtc','picksinfo','import','staff','note','intake','settings','collections','callpop']) a
$$;

create or replace function set_staff_access(p_staff uuid, p_extra text[])
returns staff language plpgsql security definer set search_path = public as $$
declare
  t staff := staff_target(p_staff);
  was text[] := t.extra;
  x text;
  allowed text[] := array['sent','called','desk','clear','yard','note','flights','intake','rtc','picksinfo','summary','log','import','staff','settings','collections','callpop'];
begin
  foreach x in array coalesce(p_extra, '{}') loop
    if not (ltrim(x, '-') = any(allowed)) then raise exception 'Unknown permission: %', x; end if;
  end loop;
  update staff set extra = coalesce(p_extra, '{}') where id = t.id returning * into t;
  insert into activity(company_id, staff_id, staff_name, action, value)
  select t.company_id, s.id, s.name, 'STAFF', 'Changed access for ' || t.name || ': was ' || private.access_words(was) || ', now ' || private.access_words(t.extra) from me() s;
  return t;
end;
$$;

create or replace function admin_save_client(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c companies;
  y text;
  ys text[] := coalesce((select array_agg(upper(trim(v))) from jsonb_array_elements_text(coalesce(p->'yards', '[]')) v where trim(v) <> ''), '{}');
  b jsonb := coalesce(p->'brand', '{}');
  k text;
  set_look boolean := coalesce(p->'brand', '{}') ? 'theme';
  set_py boolean := coalesce(p->'brand', '{}') ? 'picks_yard';
  set_lp boolean := coalesce(p->'brand', '{}') ? 'lane_planner';
  set_co boolean := coalesce(p->'brand', '{}') ? 'collections';
  set_tx boolean := coalesce(p->'brand', '{}') ? 'texts';
  set_cl boolean := coalesce(p->'brand', '{}') ? 'calls';
  set_vc boolean := coalesce(p->'brand', '{}') ? 'voice';
  made boolean := coalesce(p->>'id', '') = '';
begin
  if not is_platform_admin() then raise exception 'Not allowed.'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter the client''s name.'; end if;
  if array_length(ys, 1) is null then raise exception 'Enter at least one yard.'; end if;
  foreach y in array ys loop
    if y !~ '^[A-Z0-9]{1,4}$' then raise exception 'Yard codes are 1 to 4 letters or numbers: %', y; end if;
  end loop;
  foreach k in array array['colour', 'ink', 'soft', 'text'] loop
    if coalesce(b->>k, '') <> '' and b->>k !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Colours look like #1560BD (%).', k; end if;
  end loop;
  if coalesce(b->>'host', '') <> '' and b->>'host' !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then raise exception 'The address looks like clientname-ops.vercel.app'; end if;
  if coalesce(b->>'theme', '') not in ('', 'pro', 'cards', 'premium', 'board', 'stdplus', 'ops', 'ops-refined') then raise exception 'Unknown look: %', b->>'theme'; end if;
  b := jsonb_strip_nulls(jsonb_build_object('name', trim(p->>'name'), 'short', nullif(trim(b->>'short'), ''),
    'colour', nullif(b->>'colour', ''), 'ink', nullif(b->>'ink', ''), 'soft', nullif(b->>'soft', ''), 'text', nullif(b->>'text', ''),
    'host', nullif(lower(b->>'host'), ''), 'logo', nullif(b->>'logo', ''), 'theme', nullif(b->>'theme', ''),
    'picks_yard', case when coalesce(b->>'picks_yard', '') = 'true' then true end,
    'lane_planner', case when coalesce(b->>'lane_planner', '') = 'true' then true end,
    'collections', case when set_co then coalesce(b->>'collections', '') = 'true' end,
    'texts', case when set_tx then coalesce(b->>'texts', '') = 'true' end,
    'calls', case when set_cl then coalesce(b->>'calls', '') = 'true' end,
    'voice', case when set_vc then coalesce(b->>'voice', '') = 'true' end));

  if made then
    if coalesce(p->>'slug', '') !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'The short code is lower-case letters, numbers and dashes, like airport-parking-bay.'; end if;
    if p->>'slug' = 'platform' then raise exception 'That short code is taken.'; end if;
    if exists (select 1 from companies where slug = p->>'slug') then raise exception 'That short code is taken.'; end if;
    insert into companies (name, slug, yards, drops_day_end, time_zone, brand)
    values (trim(p->>'name'), p->>'slug', ys, coalesce(nullif(p->>'drops_day_end', '')::time, '06:00'), 'Europe/London', b)
    returning * into c;
  else
    update companies set name = trim(p->>'name'), yards = ys,
      drops_day_end = coalesce(nullif(p->>'drops_day_end', '')::time, drops_day_end),
      brand = (case when set_look then brand - 'theme' else brand end) - (case when set_py then 'picks_yard' else '' end) - (case when set_lp then 'lane_planner' else '' end) - (case when set_co then 'collections' else '' end) - (case when set_tx then 'texts' else '' end) - (case when set_cl then 'calls' else '' end) - (case when set_vc then 'voice' else '' end) || b
    where id = (p->>'id')::uuid and slug <> 'platform' returning * into c;
    if not found then raise exception 'Client not found.'; end if;
  end if;
  insert into activity(company_id, staff_name, action, value)
  select c.id, s.name || ' (Parking Ops)', 'SETTINGS',
    case when made then 'Client set up' else 'Client details saved: look ' || coalesce(c.brand->>'theme', 'standard') ||
      ', yards ' || array_to_string(c.yards, ' ') ||
      ', PICKS location ' || case when (c.brand->>'picks_yard')::boolean then 'on' else 'off' end ||
      ', Yard planner ' || case when (c.brand->>'lane_planner')::boolean then 'on' else 'off' end ||
      ', Collections ' || case when (c.brand->>'collections')::boolean then 'on' else 'off' end ||
      ', Customer texts ' || case when (c.brand->>'texts')::boolean then 'on' else 'off' end ||
      ', Calls ' || case when (c.brand->>'calls')::boolean then 'on' else 'off' end ||
      ', Voice calls ' || case when (c.brand->>'voice')::boolean then 'on' else 'off' end end
  from me() s;
  return to_jsonb(c);
end;
$$;

revoke execute on function set_topup_settings(jsonb), topup_counts(date, int), record_topup(jsonb), topup_list() from authenticated;
commit;
