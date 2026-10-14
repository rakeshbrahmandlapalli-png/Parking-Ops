-- Parking Ops — database part 91: the clock for scheduled booking import. APPLIED by Claude on 14 Oct at the user's request.
-- Every 10 minutes it asks the function whether a saved time has come;
-- the function does nothing for a company whose schedule is off or has no times, and attempts each time once.
-- To stop it: select cron.unschedule('takeoff-bookings-schedule');
select cron.schedule('takeoff-bookings-schedule', '*/10 * * * *', $job$
  select net.http_post(
    url := 'https://oioqjfrlwrjovnouhusp.supabase.co/functions/v1/takeoff-bookings',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-timer', (select value from private.settings where name = 'timer_secret')),
    body := '{"action":"timer"}'::jsonb,
    timeout_milliseconds := 150000)
$job$);
