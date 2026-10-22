-- Rollback for part 105: the live definitions of can, my_permissions and
-- set_staff_access as they were on 22 Oct 2026 before part 105 (same as parts 3/17).
-- A person's saved 'collections' / '-collections' entries in staff.extra are harmless
-- afterwards (can() ignores them) but set_staff_access will refuse to save them again.
begin;

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
    when 'sent'      then array['office','manager','bongo']
    when 'called'    then array['office','manager']
    when 'clear'     then array['office','manager','terminal']
    when 'yard'      then array['office','manager']
    when 'summary'   then array['office','manager']
    when 'log'       then array['office','manager']
    when 'flights'   then array['office']
    when 'rtc'       then array['office','manager','bongo']
    when 'picksinfo' then array['office','manager','terminal']
    when 'import'    then array['office','manager']
    when 'staff'     then array['office','manager']
    when 'settings'  then array['manager']
    else null end;
  if roles is null then return s.role <> 'view'; end if;
  return s.role = any(roles);
end;
$$;

create or replace function my_permissions() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(a, can(a)) from unnest(array['sent','called','clear','yard','summary','log','flights','rtc','picksinfo','import','staff','note','intake','settings']) a
$$;

create or replace function set_staff_access(p_staff uuid, p_extra text[])
returns staff language plpgsql security definer set search_path = public as $$
declare
  t staff := staff_target(p_staff);
  x text;
  allowed text[] := array['sent','called','clear','yard','note','flights','intake','rtc','picksinfo','summary','log','import','staff','settings'];
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
