-- Parking Ops — database part 144: Attendance full version (no more private trial).
--
-- 1 Nov: rakesh ticked the Attendance add-on for Airport Parking Bay, but it was
-- still the private trial: only people on the trial list (private.attendance_testers)
-- could use it, nobody at the company could be an Attendance manager (an owner could
-- not switch themselves on), so no clock-in site could be added, and RAIHAN was
-- locked out of Parking Ops with no site to clock in at.
--
-- Now:
--   • The add-on is the full version: anyone at a company with the add-on whose own
--     login is linked (attendance_staff_links.active) may use Attendance. The trial
--     list no longer decides (private.attendance_pilot_allowed). Live check on 1 Nov:
--     every link's active matches its trial row, so nobody gains or loses access.
--   • attendance_person_set: an owner may switch their own Attendance on or off
--     (they become the Attendance owner and can add clock-in sites). Off now switches
--     the link off as well (shifts stay for payroll). "Left the private trial" is gone.
--   • clock_gate_set: the lock can't be switched on while the company has no
--     clock-in site, or that person could never clock in.
-- Nothing else changes. No DELETE or DROP. Safe to run twice.
begin;

create or replace function private.attendance_pilot_allowed(p_company uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null
     and exists (select 1 from public.companies c where c.id = p_company and c.brand->'attendance' = 'true'::jsonb)
$$;
revoke all on function private.attendance_pilot_allowed(uuid, uuid) from public, anon, authenticated;

create or replace function public.attendance_person_set(p_staff uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.staff := public.me(); s public.staff; arole text;
begin
  if auth.uid() is null or m.id is null or m.role <> 'owner' then raise exception 'Only an owner can do this.'; end if;
  if p_on is null then raise exception 'Choose on or off.'; end if;
  select * into s from public.staff where id = p_staff;
  if s.id is null or s.company_id <> m.company_id or not s.active or s.removed_at is not null then raise exception 'Choose an active person at your company.'; end if;
  if not exists (select 1 from public.companies c where c.id = m.company_id and c.suspended_at is null and c.brand->'attendance' = 'true'::jsonb) then raise exception 'Attendance is not switched on for your company.'; end if;
  if p_on then
    if s.user_id is null or coalesce(cardinality(s.desk_names), 0) > 0 then raise exception 'A shared login cannot use Attendance. Use the person''s own login.'; end if;
    if exists (select 1 from public.aero_profiles where id = s.user_id and company_id <> s.company_id) then raise exception 'This account already belongs to another company in Attendance.'; end if;
    if exists (select 1 from public.attendance_staff_links where staff_id = s.id and attendance_user_id is not null and attendance_user_id <> s.user_id) then raise exception 'This person already has another Attendance account.'; end if;
    arole := case s.role when 'owner' then 'owner' when 'manager' then 'admin' else 'staff' end;
    insert into public.aero_companies(id, name, time_zone) select c.id, c.name, c.time_zone from public.companies c where c.id = s.company_id on conflict (id) do nothing;
    insert into public.attendance_staff_links(company_id, staff_id, attendance_user_id, active) values (s.company_id, s.id, s.user_id, true)
      on conflict (staff_id) do update set active = true, attendance_user_id = excluded.attendance_user_id;
    insert into public.aero_profiles(id, company_id, full_name, role) values (s.user_id, s.company_id, s.name, arole)
      on conflict (id) do update set active = true;
    insert into private.attendance_testers(company_id, user_id, active) values (s.company_id, s.user_id, true)
      on conflict (company_id, user_id) do update set active = true;
  else
    if exists (select 1 from private.clock_gate where staff_id = s.id and active) then raise exception 'Switch their lock off first, or they could never see Parking Ops again.'; end if;
    update public.attendance_staff_links set active = false where staff_id = s.id;
    update private.attendance_testers set active = false where company_id = s.company_id and user_id = s.user_id;
  end if;
  insert into public.activity(company_id, staff_id, staff_name, action, value)
  values (m.company_id, m.id, m.name, 'STAFF', case when p_on then 'Attendance: on for ' else 'Attendance: off for ' end || s.name);
end $$;
revoke all on function public.attendance_person_set(uuid, boolean) from public, anon;
grant execute on function public.attendance_person_set(uuid, boolean) to authenticated;

-- The lock (as part 142: the client owner's only), plus: never with no clock-in site.
create or replace function public.clock_gate_set(p_staff uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.staff; m public.staff := public.me();
begin
  if auth.uid() is null or m.id is null or m.role <> 'owner' then raise exception 'Not allowed.'; end if;
  if p_on is null then raise exception 'Choose on or off.'; end if;
  select * into s from public.staff where id = p_staff;
  if s.id is null or not s.active or s.removed_at is not null then raise exception 'Choose an active staff login.'; end if;
  if s.company_id <> m.company_id or s.id = m.id then raise exception 'Not allowed.'; end if;
  if p_on and coalesce(cardinality(s.desk_names), 0) > 0 then raise exception 'A shared login cannot clock in. Use the person''s own login.'; end if;
  if p_on and not exists (select 1 from public.aero_profiles p where p.id = s.user_id and p.company_id = s.company_id and p.active) then
    raise exception 'Give this person Attendance first, or they could never clock in.'; end if;
  if p_on and not exists (select 1 from public.aero_worksites w where w.company_id = s.company_id) then
    raise exception 'Add a clock-in site first (Settings, Attendance), or they could never clock in.'; end if;
  insert into private.clock_gate(staff_id, company_id, active) values (s.id, s.company_id, p_on)
  on conflict (staff_id) do update set active = excluded.active, changed_at = now();
  insert into public.activity(company_id, staff_id, staff_name, action, value)
  values (s.company_id, m.id, m.name, 'STAFF',
          case when p_on then 'Clock in to see the board: on for ' else 'Clock in to see the board: off for ' end || s.name);
end $$;
revoke all on function public.clock_gate_set(uuid, boolean) from public, anon;
grant execute on function public.clock_gate_set(uuid, boolean) to authenticated;

commit;
