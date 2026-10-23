-- Parking Ops — part 105: board collections is a saved access permission.
-- Defaults: owner, manager and office. Owners/managers may grant or remove it
-- through Staff → PIN and access, using the existing staff.extra mechanism.
-- Apply before the frontend. Without the permission key the new UI stays hidden.
-- This does not change existing permissions to record payments or booking reads.
-- Review current live definitions before applying; safe to run twice.
begin;

-- Part 3's rules, plus one restricted action. Explicit removal still wins.
create or replace function can(p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  s staff := me();
  roles text[];
begin
  if s.id is null then return false; end if;
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

create or replace function my_permissions() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(a, can(a)) from unnest(array['sent','called','clear','yard','summary','log','flights','rtc','picksinfo','import','staff','note','intake','settings','collections']) a
$$;

-- Keep part 17's existing company/manager/self/owner checks in staff_target.
create or replace function set_staff_access(p_staff uuid, p_extra text[])
returns staff language plpgsql security definer set search_path = public as $$
declare
  t staff := staff_target(p_staff);
  x text;
  allowed text[] := array['sent','called','clear','yard','note','flights','intake','rtc','picksinfo','summary','log','import','staff','settings','collections'];
begin
  foreach x in array coalesce(p_extra, '{}') loop
    if not (ltrim(x, '-') = any(allowed)) then raise exception 'Unknown permission: %', x; end if;
  end loop;
  update staff set extra = coalesce(p_extra, '{}') where id = t.id returning * into t;
  insert into activity(company_id, staff_id, staff_name, action, value)
  select t.company_id, s.id, s.name, 'STAFF', 'Changed access for ' || t.name from me() s;
  return t;
end;
$$;

revoke execute on function can(text), my_permissions(), set_staff_access(uuid, text[]) from public, anon;
grant execute on function can(text), my_permissions(), set_staff_access(uuid, text[]) to authenticated;

commit;
