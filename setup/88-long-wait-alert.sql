-- Parking Ops — database part 88: long-wait alert.
--
-- Every 5 minutes the send-alerts function looks for DROPS cars CALLED 20 or
-- more minutes ago (up to an hour) with no driver SENT and not cleared, and
-- pushes each one once ("⏱ WAITING 20 MIN") to everyone in that company who
-- has DROPS alerts on, plus the DROPS Discord channel. alert_log keys
-- 'wait:<booking>:<called_at>' keep it to one push per call.
-- Needs send-alerts with the "longwait" message deployed first. Safe to run twice.

create index if not exists bookings_called_unsent_idx on bookings (called_at)
  where kind = 'drops' and sent_at is null and cleared_at is null and called_at is not null;

select cron.unschedule('long-wait-alert') where exists (select 1 from cron.job where jobname = 'long-wait-alert');
select cron.schedule('long-wait-alert', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://oioqjfrlwrjovnouhusp.supabase.co/functions/v1/send-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-timer', (select value from private.settings where name = 'timer_secret')),
    body := '{"type":"longwait"}'::jsonb,
    timeout_milliseconds := 30000)
$job$);
