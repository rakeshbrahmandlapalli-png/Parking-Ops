-- Rollback for part 139: back to part 137's rule (the lock is switched by platform admins only).
begin;
create or replace function public.clock_gate_set(p_staff uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.staff;
begin
  if auth.uid() is null or not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_on is null then raise exception 'Choose on or off.'; end if;
  select * into s from public.staff where id = p_staff;
  if s.id is null or not s.active or s.removed_at is not null then raise exception 'Choose an active staff login.'; end if;
  if p_on and coalesce(cardinality(s.desk_names), 0) > 0 then raise exception 'A shared login cannot clock in. Use the person''s own login.'; end if;
  if p_on and not exists (select 1 from public.aero_profiles p where p.id = s.user_id and p.company_id = s.company_id and p.active) then
    raise exception 'Give this person Attendance first, or they could never clock in.'; end if;
  insert into private.clock_gate(staff_id, company_id, active) values (s.id, s.company_id, p_on)
  on conflict (staff_id) do update set active = excluded.active, changed_at = now();
  insert into public.activity(company_id, staff_name, action, value)
  values (s.company_id, coalesce((select name from public.staff where user_id = auth.uid() and active limit 1), 'Parking Ops') || ' (Parking Ops)', 'STAFF',
          case when p_on then 'Clock in to see the board: on for ' else 'Clock in to see the board: off for ' end || s.name);
end $$;
revoke all on function public.clock_gate_set(uuid, boolean) from public, anon;
grant execute on function public.clock_gate_set(uuid, boolean) to authenticated;
commit;
-- The two other functions in 139 are new; removing them is optional and is done in the SQL editor:
--   attendance_people() and attendance_person_set(uuid, boolean).
