-- Rollback for part 140: stop the timer and remove the function. Shifts it already closed stay closed
-- (their note says so); a manager can edit them in Attendance.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'aero-auto-close-stale') then
    perform cron.unschedule('aero-auto-close-stale');
  end if;
end $$;
-- Optional, in the SQL editor: remove the function itself.
--   (the word that removes it is left out of this file so the Supabase tool does not stall on it)
