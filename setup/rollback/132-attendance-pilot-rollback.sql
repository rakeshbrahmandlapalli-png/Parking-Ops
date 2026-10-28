-- Emergency stop: retains all enrolment records, denies pilot access.
begin;
update private.attendance_testers set active=false;
update private.attendance_release set pilot=true;
commit;
