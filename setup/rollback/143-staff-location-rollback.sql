-- Rollback for part 143: stop keeping positions and blank what was kept. Nothing else changes.
begin;
update private.location_share set on_ = false, changed_at = now(), changed_by = 'rollback';
update private.staff_location set lat = null, lng = null, acc_m = null, at = null;
revoke execute on function public.i_am_at(double precision, double precision, double precision) from authenticated;
revoke execute on function public.staff_locations() from authenticated;
commit;
-- Optional, in the SQL editor (they hold a DROP):
--   drop trigger aero_shifts_location_off on public.aero_shifts; drop function private.location_on_clock_out();
--   drop function public.i_am_at(double precision, double precision, double precision); drop function public.staff_locations();
--   drop function public.location_share_set(boolean); drop function public.location_notice_ok(); drop function public.location_status();
--   drop table private.staff_location; drop table private.location_share;
