-- Parking Ops — database part 127: Save on a car staying longer moves it to its night.
--
-- 26 Oct: JLZ646 was booked back on the 31st (changed by hand on the 23rd) and sat in
-- OVERSTAYS as "staying longer" while the 31st's sheet wasn't in. Once the 31st was
-- imported, the office opened it and pressed Save with the same return, and nothing
-- happened: set_return returned at once when the time hadn't changed.
--   • set_return: saved with the same return, a car on an earlier night than its
--     return goes to that night's sheet (out of OVERSTAYS) when the sheet is in;
--     otherwise nothing changes, as before. Logged RETURN CHANGED "unchanged, …".
-- Otherwise set_return is exactly part 96's. Safe to run twice. Rollback: run
-- part 96's set_return again (setup/rollback/127-save-moves-staying-longer-rollback.sql).

create or replace function set_return(p_booking uuid, p_return_local text)
returns bookings language plpgsql security definer set search_path = public as $$
declare
  b bookings := booking_for_update(p_booking);
  s staff := me();
  c companies;
  new_ret timestamptz;
  old_ret timestamptz;
  new_day date;
  old_day date;
  first_day date;
  sheet_day date;
  target sheets;
begin
  if not can('import') then raise exception 'Only the office can change the return date.'; end if;
  if b.kind <> 'drops' then raise exception 'The return date can be changed on DROPS cars.'; end if;
  if b.early then raise exception 'This car is an early return: undo that first.'; end if;
  if b.cleared_at is not null then raise exception 'This car is already cleared.'; end if;
  if coalesce(p_return_local, '') !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' then raise exception 'Enter the date and the time.'; end if;
  select * into c from companies where id = b.company_id;
  new_ret := p_return_local::timestamp at time zone c.time_zone;
  if new_ret < now() - interval '60 days' or new_ret > now() + interval '400 days' then raise exception 'Check the date.'; end if;
  old_ret := b.return_at;
  if old_ret is not distinct from new_ret then
    -- Saved unchanged: a car staying longer goes to its night once that sheet is in.
    new_day := drops_day_of(new_ret, c);
    select day into sheet_day from sheets where id = b.sheet_id;
    if new_ret is not null and new_day > sheet_day then
      select * into target from sheets where company_id = c.id and kind = 'drops' and day = new_day;
    end if;
    if target.id is null then return b; end if;
    update bookings set
      sheet_id = target.id,
      num = (select coalesce(max(num), 0) + 1 from bookings where sheet_id = target.id),
      overstay = false,
      called_word = case when called_word = 'Overstay' then '' else called_word end,
      called_at = case when called_word = 'Overstay' then null else called_at end,
      called_by = case when called_word = 'Overstay' then null else called_by end,
      updated_at = now()
    where id = b.id returning * into b;
    perform log_activity(b, 'RETURN CHANGED', 'unchanged, ' || to_char(new_ret at time zone c.time_zone, 'DD Mon HH24:MI') ||
      ' (saved by hand; moved to DROPS ' || to_char(target.day, 'DD Mon') || ')');
    return b;
  end if;
  new_day := drops_day_of(new_ret, c);
  old_day := case when old_ret is null then null else drops_day_of(old_ret, c) end;
  first_day := case when coalesce(b.orig_return_at, old_ret) is null then null else drops_day_of(coalesce(b.orig_return_at, old_ret), c) end;
  select day into sheet_day from sheets where id = b.sheet_id;
  -- A later day whose sheet is already in: the car goes there.
  if new_day > sheet_day then
    select * into target from sheets where company_id = c.id and kind = 'drops' and day = new_day;
  end if;
  update bookings set
    sheet_id = coalesce(target.id, sheet_id),
    num = case when target.id is not null then (select coalesce(max(num), 0) + 1 from bookings where sheet_id = target.id) else num end,
    orig_return_at = case
      when old_ret is null then orig_return_at
      when new_day <= first_day then null
      when new_day > old_day then coalesce(orig_return_at, old_ret)
      else orig_return_at end,
    return_at = new_ret,
    -- booked for the day of the sheet it's on now: out of the overstay block
    overstay = case when new_day = coalesce(target.day, sheet_day) then false
                    -- a later day whose sheet isn't in yet: it stays here, staying longer
                    when target.id is null and new_day > sheet_day then true
                    else overstay end,
    called_word = case when new_day = coalesce(target.day, sheet_day) and called_word = 'Overstay' then '' else called_word end,
    called_at = case when new_day = coalesce(target.day, sheet_day) and called_word = 'Overstay' then null else called_at end,
    called_by = case when new_day = coalesce(target.day, sheet_day) and called_word = 'Overstay' then null else called_by end,
    -- another day: the old day's landing times don't apply
    sched_at = case when new_day is distinct from old_day then null else sched_at end,
    sched_time = case when new_day is distinct from old_day then '' else sched_time end,
    est_at = case when new_day is distinct from old_day then null else est_at end,
    est_time = case when new_day is distinct from old_day then '' else est_time end,
    flight_status = case when new_day is distinct from old_day then '' else flight_status end,
    flight_note = case when new_day is distinct from old_day then '' else flight_note end,
    updated_at = now()
  where id = b.id returning * into b;
  perform log_activity(b, 'RETURN CHANGED', 'was ' || coalesce(to_char(old_ret at time zone c.time_zone, 'DD Mon HH24:MI'), '(none)') ||
    ', now ' || to_char(new_ret at time zone c.time_zone, 'DD Mon HH24:MI') || ' (changed by hand' ||
    case when target.id is not null then '; moved to DROPS ' || to_char(target.day, 'DD Mon') else '' end || ')');
  return b;
end;
$$;
revoke execute on function set_return(uuid, text) from public, anon;
grant execute on function set_return(uuid, text) to authenticated;
