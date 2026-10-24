-- Parking Ops — database part 114: a PICKS car on the wrong day's sheet can be moved
-- with its drop-off unchanged (24 Oct).
--
-- AF14BDU was added at the desk on Sat 24 Oct 11:28 while the Sun 25 Oct PICKS
-- board was open, so it landed on the 25th's sheet with a drop-off of 24 Oct.
-- move_pick (part 102) did nothing when the drop-off typed was the one already
-- saved, so Save in the car panel couldn't move it. Now an unchanged drop-off
-- still moves the car when its day isn't its sheet's day. Only that line changes.
-- Every client. No DELETE or DROP here. Safe to run twice.
-- Rollback: run move_pick from setup/102-move-pick-day.sql again.

create or replace function move_pick(p_booking uuid, p_drop_local text)
returns bookings language plpgsql security definer set search_path = public as $$
declare
  b bookings := booking_for_update(p_booking);
  c companies;
  new_drop timestamptz;
  old_drop timestamptz;
  old_day date;
  new_day date;
  target sheets;
begin
  if not can('import') then raise exception 'Only the office can change the drop-off date.'; end if;
  if b.kind <> 'picks' then raise exception 'This is for PICKS cars.'; end if;
  if b.removed_at is not null then raise exception 'This car was removed.'; end if;
  if coalesce(p_drop_local, '') !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' then raise exception 'Enter the date and the time.'; end if;
  select * into c from companies where id = b.company_id;
  new_drop := p_drop_local::timestamp at time zone c.time_zone;
  if new_drop < now() - interval '60 days' or new_drop > now() + interval '400 days' then raise exception 'Check the date.'; end if;
  if b.return_at is not null and new_drop >= b.return_at then raise exception 'The drop-off must be before the return.'; end if;
  old_drop := b.drop_at;
  select day into old_day from sheets where id = b.sheet_id;
  new_day := (new_drop at time zone c.time_zone)::date;
  if old_drop is not distinct from new_drop and new_day is not distinct from old_day then return b; end if;
  if new_day is distinct from old_day then
    select * into target from sheets where company_id = b.company_id and kind = 'picks' and day = new_day;
    if not found then raise exception 'The PICKS sheet for % is not in yet. Import it first.', to_char(new_day, 'DD Mon'); end if;
    update bookings set sheet_id = target.id, drop_at = new_drop,
      num = (select coalesce(max(num), 0) + 1 from bookings where sheet_id = target.id), updated_at = now()
    where id = b.id returning * into b;
  else
    update bookings set drop_at = new_drop, updated_at = now() where id = b.id returning * into b;
  end if;
  perform log_activity(b, 'DROP-OFF CHANGED',
    'was ' || coalesce(to_char(old_drop at time zone c.time_zone, 'DD Mon HH24:MI'), '—') || ', now ' ||
    to_char(new_drop at time zone c.time_zone, 'DD Mon HH24:MI') ||
    case when new_day is distinct from old_day then ' (moved from ' || coalesce(to_char(old_day, 'DD Mon'), '—') || ')' else '' end);
  return b;
end;
$$;
revoke execute on function move_pick(uuid, text) from public, anon;
grant execute on function move_pick(uuid, text) to authenticated;

-- Check
select 'ready' as part114, (select count(*) from pg_proc where proname = 'move_pick' and prosrc like '%new_day is not distinct from old_day then return b%') as functions;
