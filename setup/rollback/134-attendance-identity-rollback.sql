-- Removes only the new identity API. Retains links and all parking data.
begin;
drop function if exists public.attendance_context();
drop function if exists public.attendance_link_staff(uuid,uuid);
drop function if exists private.attendance_identity();
commit;
