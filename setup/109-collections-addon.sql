-- Parking Ops — part 109: Collections on the board is an add-on per client.
--
-- 24 Oct: only some clients take an exit fee, so the Collections strip (totals,
-- filters, the Exit / Overstay line under each DROPS car and Collection details)
-- is given per client in Parking Ops → Clients → Edit → "Collections (add-on)"
-- (brand.collections).
--   • can('collections'): as part 105 (checked against the live definition on
--     24 Oct 2026), plus false for everyone when their client doesn't have the
--     add-on. "View board collections" in Staff → PIN and access still decides
--     who sees it inside a client that has it.
--   • admin_save_client: as part 108 (live, 24 Oct 2026), plus the switch, saved
--     as true or false, and named in the client's activity line.
--   • TakeOff and Airport Parking Bay see Collections today, so they get it on.
--     A client already switched (on or off) is left alone: safe to run twice.
-- Exit fees, overstays and charges themselves are not changed: recording them,
-- the car panel and the dashboard work as before for every client.
begin;

create or replace function private.collections_on(p_company uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select (c.brand->>'collections')::boolean from public.companies c where c.id = p_company), false)
$$;
revoke all on function private.collections_on(uuid) from public, anon, authenticated;

-- Part 105's rules; the add-on check comes first, so no grant can get round it.
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
  roles := case p_action
    when 'sent'        then array['office','manager','bongo']
    when 'called'      then array['office','manager']
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
    else null end;
  if roles is null then return s.role <> 'view'; end if;
  return s.role = any(roles);
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
  -- The form always sends the look; an older app that doesn't leaves it alone.
  set_look boolean := coalesce(p->'brand', '{}') ? 'theme';
  -- Same for the PICKS location switch: an older form leaves it alone.
  set_py boolean := coalesce(p->'brand', '{}') ? 'picks_yard';
  -- Part 107: the Yard planner add-on switch, the same way.
  set_lp boolean := coalesce(p->'brand', '{}') ? 'lane_planner';
  -- Part 109: the Collections add-on, kept as true or false so part 109's
  -- one-time switch-on never comes back after it has been switched off.
  set_co boolean := coalesce(p->'brand', '{}') ? 'collections';
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
    'collections', case when set_co then coalesce(b->>'collections', '') = 'true' end));

  if made then
    if coalesce(p->>'slug', '') !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'The short code is lower-case letters, numbers and dashes, like airport-parking-bay.'; end if;
    if p->>'slug' = 'platform' then raise exception 'That short code is taken.'; end if;
    if exists (select 1 from companies where slug = p->>'slug') then raise exception 'That short code is taken.'; end if;
    insert into companies (name, slug, yards, drops_day_end, time_zone, brand)
    values (trim(p->>'name'), p->>'slug', ys, coalesce(nullif(p->>'drops_day_end', '')::time, '06:00'), 'Europe/London', b)
    returning * into c;
  else
    -- Standard drops the theme key: merging alone could never take it away.
    update companies set name = trim(p->>'name'), yards = ys,
      drops_day_end = coalesce(nullif(p->>'drops_day_end', '')::time, drops_day_end),
      brand = (case when set_look then brand - 'theme' else brand end) - (case when set_py then 'picks_yard' else '' end) - (case when set_lp then 'lane_planner' else '' end) - (case when set_co then 'collections' else '' end) || b
    where id = (p->>'id')::uuid and slug <> 'platform' returning * into c;
    if not found then raise exception 'Client not found.'; end if;
  end if;
  insert into activity(company_id, staff_name, action, value)
  select c.id, s.name || ' (Parking Ops)', 'SETTINGS',
    case when made then 'Client set up' else 'Client details saved: look ' || coalesce(c.brand->>'theme', 'standard') ||
      ', yards ' || array_to_string(c.yards, ' ') ||
      ', PICKS location ' || case when (c.brand->>'picks_yard')::boolean then 'on' else 'off' end ||
      ', Yard planner ' || case when (c.brand->>'lane_planner')::boolean then 'on' else 'off' end ||
      ', Collections ' || case when (c.brand->>'collections')::boolean then 'on' else 'off' end end
  from me() s;
  return to_jsonb(c);
end;
$$;

-- The two clients who see Collections today keep it.
update companies set brand = brand || '{"collections": true}'
where slug in ('takeoff', 'airport-parking-bay') and not (brand ? 'collections');

revoke execute on function can(text), admin_save_client(jsonb) from public, anon;
grant execute on function can(text), admin_save_client(jsonb) to authenticated;

commit;
