-- Parking Ops — part 108: every action goes in the activity log.
-- 24 Oct: nobody could see who switched a person off, because switching on/off,
-- new people and new links went through manage-staff and left no line. That
-- function now writes its own lines; this part adds the ones the database owns:
--   SIGN IN  signed in, wrong PIN, locked, tried while switched off
--   STAFF    changed their own PIN, switched name on a shared login,
--            what changed in a person's access (was … → now …)
--   SETTINGS their own alerts, a Yard planner area added,
--            Parking Ops changing or pausing the client
--   IMPORT   a booking review marked done
-- Each function is the live definition (checked 24 Oct) plus its log line;
-- grants stay as they are (create or replace keeps them). Safe to run twice.
begin;

-- Part 2's PIN check (called by staff-login with the service role), logged.
create or replace function staff_login_check(p_link_hash text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  sec staff_secrets;
  st staff;
  why text;
begin
  select * into sec from staff_secrets where link_hash = p_link_hash for update;
  if not found then return jsonb_build_object('status', 'bad_link'); end if;
  select * into st from staff where id = sec.staff_id;
  if not found then return jsonb_build_object('status', 'inactive'); end if;
  if not st.active or st.user_id is null then
    insert into activity(company_id, staff_id, staff_name, action, value)
    values (st.company_id, st.id, st.name, 'SIGN IN', 'Tried to sign in, access is off');
    return jsonb_build_object('status', 'inactive');
  end if;
  if sec.locked_until is not null and sec.locked_until > now() then
    insert into activity(company_id, staff_id, staff_name, action, value)
    values (st.company_id, st.id, st.name, 'SIGN IN', 'Tried to sign in while locked');
    return jsonb_build_object('status', 'locked', 'until', sec.locked_until);
  end if;
  if p_pin is null or p_pin !~ '^\d{4}$' or crypt(p_pin, sec.pin_hash) <> sec.pin_hash then
    update staff_secrets set failed_pins = failed_pins + 1,
      locked_until = case when failed_pins + 1 >= 5 then now() + interval '15 minutes' else null end,
      updated_at = now()
    where staff_id = sec.staff_id;
    why := case when sec.failed_pins + 1 >= 5 then 'Wrong PIN, locked for 15 minutes' else 'Wrong PIN' end;
    insert into activity(company_id, staff_id, staff_name, action, value)
    values (st.company_id, st.id, st.name, 'SIGN IN', why);
    return jsonb_build_object('status', 'bad_pin', 'left', greatest(0, 4 - sec.failed_pins));
  end if;
  update staff_secrets set failed_pins = 0, locked_until = null, updated_at = now() where staff_id = sec.staff_id;
  insert into activity(company_id, staff_id, staff_name, action, value)
  values (st.company_id, st.id, st.name, 'SIGN IN', 'Signed in');
  return jsonb_build_object('status', 'ok', 'user_id', st.user_id, 'name', st.name);
end;
$$;

-- Part 16, logged when the PIN is changed.
create or replace function change_my_pin(p_current text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s staff := me();
  sec staff_secrets;
begin
  if s.id is null then raise exception 'Sign in again.'; end if;
  if p_new is null or p_new !~ '^\d{4}$' then raise exception 'The new PIN must be 4 numbers.'; end if;
  select * into sec from staff_secrets where staff_id = s.id for update;
  if not found then raise exception 'No PIN is set for you. Ask the office to reset your link.'; end if;
  if sec.locked_until is not null and sec.locked_until > now() then
    return jsonb_build_object('status', 'locked', 'until', sec.locked_until);
  end if;
  if p_current is null or crypt(p_current, sec.pin_hash) <> sec.pin_hash then
    update staff_secrets set failed_pins = failed_pins + 1,
      locked_until = case when failed_pins + 1 >= 5 then now() + interval '15 minutes' else null end,
      updated_at = now()
    where staff_id = s.id;
    return jsonb_build_object('status', 'bad_pin', 'left', greatest(0, 4 - sec.failed_pins));
  end if;
  update staff_secrets set pin_hash = crypt(p_new, gen_salt('bf', 10)), failed_pins = 0, locked_until = null, updated_at = now()
  where staff_id = s.id;
  insert into activity(company_id, staff_id, staff_name, action, value)
  values (s.company_id, s.id, s.name, 'STAFF', 'Changed their own PIN');
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Part 97, logged. The line carries the new name (the acting trigger).
create or replace function set_acting(p_name text) returns staff
language plpgsql security definer set search_path = public as $$
declare
  s staff := me();
  n text := btrim(coalesce(p_name, ''));
  was text;
begin
  if s.id is null then raise exception 'Sign in again.'; end if;
  if n <> '' and not (n = any(s.desk_names)) then raise exception 'That name isn''t on this login.'; end if;
  was := s.acting;
  update staff set acting = n where id = s.id returning * into s;
  if coalesce(was, '') <> n then
    insert into activity(company_id, staff_id, staff_name, action, value)
    values (s.company_id, s.id, s.name, 'STAFF',
      case when n = '' then 'No name picked on ' || s.name else 'Switched to ' || n || ' on ' || s.name end);
  end if;
  return s;
end;
$$;

-- Part 4, logged when something changed.
create or replace function set_alert_prefs(p_drops boolean, p_picks boolean, p_flights boolean) returns alert_prefs
language plpgsql security definer set search_path = public as $$
declare s staff := me(); r alert_prefs; old alert_prefs;
begin
  if s.id is null then raise exception 'Sign in again.'; end if;
  select * into old from alert_prefs where staff_id = s.id;
  insert into alert_prefs (staff_id, company_id, drops, picks, flights)
  values (s.id, s.company_id, coalesce(p_drops, true), coalesce(p_picks, true), coalesce(p_flights, true))
  on conflict (staff_id) do update set drops = excluded.drops, picks = excluded.picks, flights = excluded.flights, updated_at = now()
  returning * into r;
  if old.staff_id is null or (old.drops, old.picks, old.flights) is distinct from (r.drops, r.picks, r.flights) then
    insert into activity(company_id, staff_id, staff_name, action, value)
    values (s.company_id, s.id, s.name, 'SETTINGS', 'Their own alerts: DROPS ' || case when r.drops then 'on' else 'off' end ||
      ', PICKS ' || case when r.picks then 'on' else 'off' end || ', flights ' || case when r.flights then 'on' else 'off' end);
  end if;
  return r;
end;
$$;

-- Part 105's access change, now saying what changed. "-clear" is a removal.
create or replace function private.access_words(p text[]) returns text
language sql immutable set search_path = public as $$
  select coalesce(nullif(string_agg(case when x like '-%' then 'no ' || ltrim(x, '-') else x end, ', ' order by ltrim(x, '-')), ''), 'role defaults')
  from unnest(coalesce(p, '{}')) x
$$;

create or replace function set_staff_access(p_staff uuid, p_extra text[]) returns staff
language plpgsql security definer set search_path = public as $$
declare
  t staff := staff_target(p_staff);
  was text[] := t.extra;
  x text;
  allowed text[] := array['sent','called','clear','yard','note','flights','intake','rtc','picksinfo','summary','log','import','staff','settings','collections'];
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

-- Part 107's Yard planner area, logged.
create or replace function lane_save(p_yard text, p_name text, p_capacity integer, p_access text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s staff:=me(); l parking_lanes;
begin
 if auth.uid() is null or s.id is null or s.role not in ('owner','manager') or not can('settings') then raise exception 'Only a yard manager can add lanes.'; end if;
 if not private.lane_planner_on(s.company_id) then raise exception 'The yard planner is not switched on for your company.'; end if;
 if p_yard is null or not exists(select 1 from companies where id=s.company_id and p_yard=any(yards)) or p_yard='T' then raise exception 'Choose a parking yard.'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 40 or p_capacity is null or p_capacity not between 1 and 100
  or p_kind is null or p_kind not in ('lane','holding','temporary') or p_access is null
  or not ((p_kind='lane' and p_access in ('front','both')) or (p_kind<>'lane' and p_access='open')) then raise exception 'Check the lane details.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.company_id::text,104));
 insert into parking_lanes(company_id,yard,name,capacity,access,kind)
 values(s.company_id,p_yard,trim(p_name),p_capacity,p_access,p_kind) returning * into l;
 insert into activity(company_id, staff_id, staff_name, action, value)
 values (s.company_id, s.id, s.name, 'SETTINGS', 'Yard planner: added ' || l.kind || ' ' || l.name || ' in ' || l.yard || ' (' || l.capacity || ' spaces)');
 return to_jsonb(l);
end $$;

-- Part 86's review Done, logged with the reference.
create or replace function swift_review_resolve(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s staff := me(); r text;
begin
  if not can('import') then raise exception 'Not allowed for your role: import'; end if;
  update private.swift_reviews set status = 'resolved', resolved_at = now(), resolved_by = s.name
   where id = p_id and company_id = s.company_id and status is distinct from 'resolved' returning ref into r;
  if found then
    insert into activity(company_id, staff_id, staff_name, action, value)
    values (s.company_id, s.id, s.name, 'IMPORT', 'Booking review marked done: ' || coalesce(r, ''));
  end if;
end $$;

-- The product owner's changes reach the client's own log, named "(Parking Ops)".
-- No staff_id: the person belongs to the platform, not the client.
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
    'lane_planner', case when coalesce(b->>'lane_planner', '') = 'true' then true end));

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
      brand = (case when set_look then brand - 'theme' else brand end) - (case when set_py then 'picks_yard' else '' end) - (case when set_lp then 'lane_planner' else '' end) || b
    where id = (p->>'id')::uuid and slug <> 'platform' returning * into c;
    if not found then raise exception 'Client not found.'; end if;
  end if;
  insert into activity(company_id, staff_name, action, value)
  select c.id, s.name || ' (Parking Ops)', 'SETTINGS',
    case when made then 'Client set up' else 'Client details saved: look ' || coalesce(c.brand->>'theme', 'standard') ||
      ', yards ' || array_to_string(c.yards, ' ') ||
      ', PICKS location ' || case when (c.brand->>'picks_yard')::boolean then 'on' else 'off' end ||
      ', Yard planner ' || case when (c.brand->>'lane_planner')::boolean then 'on' else 'off' end end
  from me() s;
  return to_jsonb(c);
end;
$$;

create or replace function admin_suspend_client(p_id uuid, p_suspend boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c companies; was timestamptz;
begin
  if not is_platform_admin() then raise exception 'Not allowed.'; end if;
  select suspended_at into was from companies where id = p_id;
  update companies set suspended_at = case when p_suspend then coalesce(suspended_at, now()) else null end
  where id = p_id and slug <> 'platform' returning * into c;
  if not found then raise exception 'Client not found.'; end if;
  if (was is null) = p_suspend then
    insert into activity(company_id, staff_name, action, value)
    select c.id, s.name || ' (Parking Ops)', 'SETTINGS', case when p_suspend then 'App paused for everyone' else 'App resumed' end
    from me() s;
  end if;
  return to_jsonb(c);
end;
$$;

revoke execute on function private.access_words(text[]) from public, anon, authenticated;

commit;
