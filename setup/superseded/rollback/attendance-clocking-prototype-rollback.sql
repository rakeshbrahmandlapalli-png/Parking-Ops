-- Stop new clock-ins while preserving records and finish-only operations.
begin;
revoke execute on function public.attendance_clock_in(uuid,double precision,double precision,double precision) from authenticated;
commit;
