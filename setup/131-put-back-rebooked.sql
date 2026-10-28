-- Parking Ops — database part 131: put a rebooked no-show back on DROPS.
--
-- 28 Oct: YD56VWO (L4PUK-1265111) was booked 16–29 Sep, removed from DROPS 29 Sep as
-- a No show, then rebooked on the booking site for 16–29 Oct under the same reference.
-- The import matches by reference, finds the removed car and never puts it back, so
-- it only held a review ("already handed back or removed, but the booking site now
-- shows different details"); Done closed it and the car never reached DROPS 29 Oct.
--   • put_back_rebooked(booking, drop, return): the office puts a DROPS car removed as
--     No show or Cancelled back, with the booking site's new drop-off and return, onto
--     the DROPS sheet of the new return night (tonight or later; that sheet must be in).
--     One step: no moment where the car is back on its old night.
--   • Its old night's flight times are cleared; the next import fills flight and note
--     as normal changes (logged PUT BACK, not RETURN CHANGED, so the import doesn't
--     treat the dates as typed by the office).
-- Nothing else changes. Safe to run twice. Rollback: setup/rollback/131-put-back-rebooked-rollback.sql.

create or replace function put_back_rebooked(p_booking uuid, p_drop_local text, p_return_local text)
returns bookings language plpgsql security definer set search_path = public as $$
declare
  b bookings := booking_for_update(p_booking);
  c companies;
  new_ret timestamptz;
  new_drop timestamptz;
  new_day date;
  old_day date;
  shift_day date;
  target sheets;
  was text;
begin
  if not can('import') then raise exception 'Only the office can put cars back.'; end if;
  if b.id is null then raise exception 'That car is not on your boards.'; end if;
  if b.kind <> 'drops' then raise exception 'Only DROPS cars can be put back this way.'; end if;
  if b.removed_at is null then raise exception 'This car is not removed.'; end if;
  if b.removed_reason not in ('No show', 'Cancelled') then raise exception 'Only a car removed as No show or Cancelled can be put back this way.'; end if;
  if b.cleared_at is not null then raise exception 'This car is already cleared.'; end if;
  if coalesce(p_return_local, '') !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' then raise exception 'Enter the return date and time.'; end if;
  if coalesce(p_drop_local, '') <> '' and p_drop_local !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' then raise exception 'Check the drop-off date.'; end if;
  select * into c from companies where id = b.company_id;
  new_ret := p_return_local::timestamp at time zone c.time_zone;
  new_drop := case when coalesce(p_drop_local, '') = '' then b.drop_at else p_drop_local::timestamp at time zone c.time_zone end;
  if new_ret > now() + interval '400 days' then raise exception 'Check the date.'; end if;
  if new_drop is not null and new_drop > new_ret then raise exception 'The drop-off is after the return.'; end if;
  new_day := drops_day_of(new_ret, c);
  select day into old_day from sheets where id = b.sheet_id;
  shift_day := case when (now() at time zone c.time_zone)::time <= c.drops_day_end
                    then (now() at time zone c.time_zone)::date - 1 else (now() at time zone c.time_zone)::date end;
  if new_day < shift_day then raise exception 'That return has passed.'; end if;
  if new_day <= old_day then raise exception 'The new return is not after the night it was removed from.'; end if;
  select * into target from sheets where company_id = c.id and kind = 'drops' and day = new_day;
  if target.id is null then raise exception 'Import DROPS % first.', to_char(new_day, 'DD Mon'); end if;
  was := b.removed_reason;
  update bookings set
    sheet_id = target.id,
    num = (select coalesce(max(num), 0) + 1 from bookings where sheet_id = target.id),
    removed_at = null, removed_by = null, removed_reason = '',
    drop_at = new_drop,
    return_at = new_ret,
    orig_return_at = null,
    overstay = false,
    called_word = case when called_word = 'Overstay' then '' else called_word end,
    called_at = case when called_word = 'Overstay' then null else called_at end,
    called_by = case when called_word = 'Overstay' then null else called_by end,
    -- another night: the old night's landing times don't apply
    sched_at = null, sched_time = '', est_at = null, est_time = '', flight_status = '', flight_note = '',
    updated_at = now()
  where id = b.id returning * into b;
  perform log_activity(b, 'PUT BACK', 'rebooked: back ' || to_char(new_ret at time zone c.time_zone, 'DD Mon HH24:MI') ||
    ', was removed (' || was || ') from DROPS ' || to_char(old_day, 'DD Mon') || '; moved to DROPS ' || to_char(target.day, 'DD Mon'));
  return b;
end;
$$;
revoke execute on function put_back_rebooked(uuid, text, text) from public, anon;
grant execute on function put_back_rebooked(uuid, text, text) to authenticated;
