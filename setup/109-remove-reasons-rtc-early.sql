-- 109: two more reasons for removing a car: RTC and Early return (user, 24 Oct).
-- Only the list of allowed reasons changes; the rest is remove_booking from part 15,
-- which matched the live definition on 24 Oct. Removed cars still leave the board and
-- the counts, are never carried over as an overstay, and can be put back (restore_booking).
-- The REMOVED activity line carries the reason, as before.

create or replace function remove_booking(p_booking uuid, p_reason text)
returns bookings language plpgsql security definer set search_path = public as $$
declare
  b bookings := booking_for_update(p_booking);
  s staff := me();
begin
  if not can('import') then raise exception 'Only the office can remove cars.'; end if;
  if p_reason not in ('No show', 'Cancelled', 'Duplicate', 'RTC', 'Early return') then raise exception 'Not a valid reason: %', p_reason; end if;
  update bookings set removed_at = now(), removed_by = s.id, removed_reason = p_reason, updated_at = now()
  where id = b.id returning * into b;
  perform log_activity(b, 'REMOVED', p_reason);
  return b;
end;
$$;
