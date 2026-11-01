-- Rollback of part 144: back to the private trial (part 135), part 139's switch and part 142's lock.
-- Links switched off by part 144's Off stay off (that person had Attendance switched off).
begin;
create or replace function private.attendance_pilot_allowed(p_company uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select p_user is not null and (
 exists(select 1 from private.attendance_release where company_id=p_company and not pilot)
 or exists(select 1 from private.attendance_testers where company_id=p_company and user_id=p_user and active))
$$;
revoke all on function private.attendance_pilot_allowed(uuid, uuid) from public, anon, authenticated;
commit;
-- Then run setup/139-attendance-switches.sql's attendance_person_set and
-- setup/142-lock-client-owners-only.sql again (in that order).
