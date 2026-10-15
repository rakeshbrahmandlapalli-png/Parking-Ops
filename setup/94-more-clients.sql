-- Part 94: ready for more clients.
-- 1. Read rules work out "which company is this person in" once per query, not
--    once per row (the live stats showed staff/companies read ~2 million times
--    for 6,750 bookings). Same rules, same result; key_check_* already do this.
-- 2. The flights timer wakes every minute with { slot: true }: each client gets
--    one minute in ten, so clients no longer queue behind each other in one run.
--    Deploy the flights function with slot support BEFORE applying this part
--    (an old function would check every client every minute).
-- No DROP statements: ALTER POLICY changes a rule in place.
begin;

alter policy activity_read on activity using (company_id = (select my_company()) and (select can('log')));
alter policy alert_prefs_own on alert_prefs using (staff_id = (select (me()).id));
alter policy bookings_read on bookings using (company_id = (select my_company()));
alter policy companies_read on companies using (id = (select my_company()));
alter policy flight_runs_read on flight_runs using (company_id = (select my_company()));
alter policy push_subscriptions_own on push_subscriptions using (staff_id = (select (me()).id));
alter policy sheets_read on sheets using (company_id = (select my_company()));
alter policy staff_read on staff using (company_id = (select my_company()));
alter policy timetable_read on timetable using (company_id = (select my_company()));

-- Scheduling a job under a name that already exists replaces it.
select cron.schedule('takeoff-flights', '* * * * *', $job$
  select net.http_post(
    url := 'https://oioqjfrlwrjovnouhusp.supabase.co/functions/v1/flights',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-timer', (select value from private.settings where name = 'timer_secret')),
    body := '{"action":"timer","slot":true}'::jsonb,
    timeout_milliseconds := 120000)
$job$);

commit;

-- Check: each policy now reads "( SELECT my_company() ...)", and the job runs every minute.
-- select polname, pg_get_expr(polqual, polrelid) from pg_policy where polrelid in
--   ('activity'::regclass, 'bookings'::regclass, 'sheets'::regclass, 'staff'::regclass);
-- select schedule, command from cron.job where jobname = 'takeoff-flights';
