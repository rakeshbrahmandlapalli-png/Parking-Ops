-- Parking Ops — database part 139: Attendance and the clock-in lock, per person, by the owner.
--
-- 29 Oct: rakesh asked how to turn Attendance on for more staff. Until now only a
-- platform admin could (aero_prepare_pilot, clock_gate_set). Now an OWNER of a
-- client that has the Attendance add-on can do it for the other people at their
-- own company from Staff access:
--   • attendance_people(): per person — has Attendance, locked, on shift now.
--     Owners and managers of the company read it; nobody else.
--   • attendance_person_set(staff, on): owner only, never themselves, never
--     a shared desk login, never another company's person. On = link, Attendance
--     profile and the pilot list (the same rows aero_prepare_pilot writes). Off =
--     out of the pilot list; the link and their shifts stay for payroll.
--     Refused while their lock is on (they could never see Parking Ops again).
--   • clock_gate_set(staff, on) now also lets an owner switch the lock for
--     someone else at their own company (never themselves, never another company).
--     Platform admins keep every right they had.
-- Nothing else changes. Safe to run twice.
begin;

create or replace function public.attendance_people()
returns table(staff_id uuid, attendance boolean, locked boolean, on_shift boolean)
language sql stable security definer set search_path = '' as $$
  select s.id,
    exists (select 1 from public.attendance_staff_links l
            join public.aero_profiles p on p.id = l.attendance_user_id and p.company_id = l.company_id and p.active
            where l.staff_id = s.id and l.active and private.attendance_pilot_allowed(s.company_id, s.user_id)),
    exists (select 1 from private.clock_gate g where g.staff_id = s.id and g.active),
    exists (select 1 from public.aero_shifts a where a.user_id = s.user_id and a.company_id = s.company_id and a.clock_out_at is null)
  from public.staff s
  where (public.me()).role in ('owner', 'manager')
    and s.company_id = (public.me()).company_id and s.active and s.removed_at is null
$$;
revoke all on function public.attendance_people() from public, anon;
grant execute on function public.attendance_people() to authenticated;

create or replace function public.attendance_person_set(p_staff uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.staff := public.me(); s public.staff; arole text;
begin
  if auth.uid() is null or m.id is null or m.role <> 'owner' then raise exception 'Only an owner can do this.'; end if;
  if p_on is null then raise exception 'Choose on or off.'; end if;
  select * into s from public.staff where id = p_staff;
  if s.id is null or s.company_id <> m.company_id or not s.active or s.removed_at is not null then raise exception 'Choose an active person at your company.'; end if;
  if s.id = m.id then raise exception 'You cannot change your own Attendance here.'; end if;
  if not exists (select 1 from public.companies c where c.id = m.company_id and c.suspended_at is null and c.brand->'attendance' = 'true'::jsonb) then raise exception 'Attendance is not switched on for your company.'; end if;
  if p_on then
    if s.user_id is null or coalesce(cardinality(s.desk_names), 0) > 0 then raise exception 'A shared login cannot use Attendance. Use the person''s own login.'; end if;
    if exists (select 1 from private.attendance_release where company_id = s.company_id and not pilot) then raise exception 'This company has left the private trial; ask Parking Ops.'; end if;
    if exists (select 1 from public.aero_profiles where id = s.user_id and company_id <> s.company_id) then raise exception 'This account already belongs to another company in Attendance.'; end if;
    if exists (select 1 from public.attendance_staff_links where staff_id = s.id and attendance_user_id is not null and attendance_user_id <> s.user_id) then raise exception 'This person already has another Attendance account.'; end if;
    arole := case s.role when 'owner' then 'owner' when 'manager' then 'admin' else 'staff' end;
    insert into public.aero_companies(id, name, time_zone) select c.id, c.name, c.time_zone from public.companies c where c.id = s.company_id on conflict (id) do nothing;
    insert into public.attendance_staff_links(company_id, staff_id, attendance_user_id, active) values (s.company_id, s.id, s.user_id, true)
      on conflict (staff_id) do update set active = true, attendance_user_id = excluded.attendance_user_id;
    insert into public.aero_profiles(id, company_id, full_name, role) values (s.user_id, s.company_id, s.name, arole)
      on conflict (id) do update set active = true;
    insert into private.attendance_release(company_id, pilot) values (s.company_id, true) on conflict (company_id) do nothing;
    insert into private.attendance_testers(company_id, user_id, active) values (s.company_id, s.user_id, true)
      on conflict (company_id, user_id) do update set active = true;
  else
    if exists (select 1 from private.clock_gate where staff_id = s.id and active) then raise exception 'Switch their lock off first, or they could never see Parking Ops again.'; end if;
    update private.attendance_testers set active = false where company_id = s.company_id and user_id = s.user_id;
  end if;
  insert into public.activity(company_id, staff_id, staff_name, action, value)
  values (m.company_id, m.id, m.name, 'STAFF', case when p_on then 'Attendance: on for ' else 'Attendance: off for ' end || s.name);
end $$;
revoke all on function public.attendance_person_set(uuid, boolean) from public, anon;
grant execute on function public.attendance_person_set(uuid, boolean) to authenticated;

-- The lock: platform admins as before, and now an owner for someone else at their own company.
create or replace function public.clock_gate_set(p_staff uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.staff; m public.staff := public.me(); adm boolean := public.is_platform_admin();
begin
  if auth.uid() is null or not (adm or (m.id is not null and m.role = 'owner')) then raise exception 'Not allowed.'; end if;
  if p_on is null then raise exception 'Choose on or off.'; end if;
  select * into s from public.staff where id = p_staff;
  if s.id is null or not s.active or s.removed_at is not null then raise exception 'Choose an active staff login.'; end if;
  if not adm and (s.company_id <> m.company_id or s.id = m.id) then raise exception 'Not allowed.'; end if;
  if p_on and coalesce(cardinality(s.desk_names), 0) > 0 then raise exception 'A shared login cannot clock in. Use the person''s own login.'; end if;
  if p_on and not exists (select 1 from public.aero_profiles p where p.id = s.user_id and p.company_id = s.company_id and p.active) then
    raise exception 'Give this person Attendance first, or they could never clock in.'; end if;
  insert into private.clock_gate(staff_id, company_id, active) values (s.id, s.company_id, p_on)
  on conflict (staff_id) do update set active = excluded.active, changed_at = now();
  insert into public.activity(company_id, staff_name, action, value)
  values (s.company_id,
          case when adm then coalesce((select name from public.staff where user_id = auth.uid() and active limit 1), 'Parking Ops') || ' (Parking Ops)' else m.name end,
          'STAFF', case when p_on then 'Clock in to see the board: on for ' else 'Clock in to see the board: off for ' end || s.name);
end $$;
revoke all on function public.clock_gate_set(uuid, boolean) from public, anon;
grant execute on function public.clock_gate_set(uuid, boolean) to authenticated;

commit;
