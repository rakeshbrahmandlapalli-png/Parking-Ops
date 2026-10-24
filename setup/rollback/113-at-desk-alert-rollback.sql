-- Rollback for part 113: bookings_alert and its trigger back to part 4's (no AT DESK push).

create or replace function bookings_alert()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare url text; actor uuid;
begin
  if not (
       (new.kind = 'drops' and new.called_at is not null and old.called_at is null)
    or (new.kind = 'drops' and new.clear_word = 'COMPLAINT' and old.clear_word is distinct from 'COMPLAINT')
    or (new.kind = 'picks' and new.intake = 'RTC' and old.intake is distinct from 'RTC')
    or (new.kind = 'drops' and new.flight_status = 'cancelled' and old.flight_status is distinct from 'cancelled')
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
$$;
create or replace trigger bookings_alert after update of called_at, clear_word, intake, flight_status on bookings
  for each row execute function bookings_alert();
