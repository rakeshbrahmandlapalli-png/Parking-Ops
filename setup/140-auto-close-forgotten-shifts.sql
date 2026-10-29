-- Parking Ops — database part 140: a forgotten clock-out closes itself.
--
-- 29 Oct: with the clock-in lock (part 137) a person who forgets to clock out
-- would keep seeing Parking Ops, customer data included, until a manager closes
-- the shift. Now a shift still open after 14 hours is closed by the database.
--   • The shift ends exactly 14 hours after the clock-in, not "now", so the paid
--     time is never longer than the cap. An open break is closed at that moment
--     and its minutes come off, as a manager closing the shift does.
--   • The shift is marked: where they were at clock-out is unknown (clock_out_ok
--     null), the note says it was closed automatically and to check the hours,
--     an Attendance audit line is written, and Parking Ops' activity log gets a
--     line "<name> was clocked out automatically after 14 hours".
--   • Runs every 10 minutes (pg_cron). Safe to run twice; the manager's own
--     "clock out" still works first, and 13 hours is when managers are told.
-- Nothing else changes. Needs the Attendance parts (133–136).
begin;

create or replace function private.aero_auto_close_stale(p_hours integer default 14)
returns integer language plpgsql security definer set search_path = '' as $$
declare r public.aero_shifts; cap timestamptz; mins integer; who text; n integer := 0;
begin
  if p_hours is null or p_hours < 12 then raise exception 'Choose 12 hours or more.'; end if;
  for r in select * from public.aero_shifts where clock_out_at is null and clock_in_at < now() - make_interval(hours => p_hours) order by clock_in_at limit 200 for update skip locked loop
    cap := r.clock_in_at + make_interval(hours => p_hours);
    mins := case when r.break_started_at is null then 0 else greatest(0, round(extract(epoch from (cap - r.break_started_at)) / 60)::int) end;
    update public.aero_shifts set
      clock_out_at = cap, clock_out_ok = null,
      break_minutes = break_minutes + mins, break_started_at = null,
      note = btrim(note || case when note = '' then '' else ' ' end || 'Closed automatically after ' || p_hours || ' hours (forgot to clock out). Check the hours.')
    where id = r.id and clock_out_at is null;
    select coalesce((select full_name from public.aero_profiles where id = r.user_id), 'A member of staff') into who;
    perform public.aero_write_audit_event(r.company_id, null, 'clocked_out', 'shift', r.id,
      'Closed automatically after ' || p_hours || ' hours: ' || who || '.', jsonb_build_object('automatic', true, 'hours', p_hours, 'break_minutes_added', mins));
    insert into public.activity(company_id, staff_name, action, value)
    values (r.company_id, 'Attendance', 'STAFF', who || ' was clocked out automatically after ' || p_hours || ' hours');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.aero_auto_close_stale(integer) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'aero-auto-close-stale') then perform cron.unschedule('aero-auto-close-stale'); end if;
    perform cron.schedule('aero-auto-close-stale', '*/10 * * * *', 'select private.aero_auto_close_stale()');
  end if;
end $$;

commit;
