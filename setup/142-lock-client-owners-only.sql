-- Parking Ops — database part 142: the clock-in lock belongs to the client, not the platform.
--
-- 30 Oct, rakesh: he owns Parking Ops (the platform); TAKEOFF and Airport Parking Bay are
-- its clients, so who has Attendance and who is locked is each client's own decision. The
-- platform keeps only the Attendance add-on tick (Clients → Edit).
--   • clock_gate_set(staff, on): now ONLY an owner of the client, for another person at
--     that same company. A platform admin signed in as the platform no longer can
--     (they use the client owner's own login if they must).
--   • Never yourself, never another company, never a shared desk login: as in part 139.
-- Nothing else changes. Safe to run twice.
begin;

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
  insert into private.clock_gate(staff_id, company_id, active) values (s.id, s.company_id, p_on)
  on conflict (staff_id) do update set active = excluded.active, changed_at = now();
  insert into public.activity(company_id, staff_id, staff_name, action, value)
  values (s.company_id, m.id, m.name, 'STAFF',
          case when p_on then 'Clock in to see the board: on for ' else 'Clock in to see the board: off for ' end || s.name);
end $$;
revoke all on function public.clock_gate_set(uuid, boolean) from public, anon;
grant execute on function public.clock_gate_set(uuid, boolean) to authenticated;

commit;
