-- 146: a diverted flight pushes to the office, like a cancelled one.
-- The flights function (4 Nov 2026) sets flight_status = 'diverted' when
-- AeroDataBox says the flight is diverted; send-alerts sends
-- "FLIGHT DIVERTED" once per car, flight and sheet (alert_log divert:...).
-- Only the one condition line is new; the rest is the live bookings_alert()
-- as it stood on 4 Nov 2026 (checked against the database first).
-- Safe to run again. Rollback: setup/rollback/146-diverted-flight-alert-rollback.sql
create or replace function public.bookings_alert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare url text; actor uuid;
begin
  if not (
       (new.kind = 'drops' and new.called_at is not null and old.called_at is null)
    or (new.kind = 'drops' and new.desk_at is not null and old.desk_at is null)
    or (new.kind = 'drops' and new.clear_word = 'COMPLAINT' and old.clear_word is distinct from 'COMPLAINT')
    or (new.kind = 'picks' and new.intake = 'RTC' and old.intake is distinct from 'RTC')
    or (new.kind = 'drops' and new.flight_status = 'cancelled' and old.flight_status is distinct from 'cancelled')
    or (new.kind = 'drops' and new.flight_status = 'diverted' and old.flight_status is distinct from 'diverted')
  ) then return null; end if;
  select function_url into url from private.alert_config;
  if url is null then return null; end if;
  select id into actor from staff where user_id = auth.uid() limit 1;
  perform net.http_post(url := url,
    body := jsonb_build_object('type', 'booking', 'id', new.id, 'actor', actor),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000);
  return null;
exception when others then
  raise warning 'alert skipped: %', sqlerrm;   -- an alert must never block a tap
  return null;
end;
$function$;
