-- Emergency stop for the shared Attendance release. Preserve all records and
-- the finish-only endpoints; do not change any parking login or workflow.
begin;
update private.attendance_testers set active=false
where company_id in(select id from public.aero_companies);
update private.attendance_release set pilot=true
where company_id in(select id from public.aero_companies);
revoke execute on function public.aero_prepare_pilot(uuid,text) from authenticated;
commit;
