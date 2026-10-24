-- Rollback of 109: back to the three reasons of part 15. Cars already removed as RTC or
-- Early return keep that reason and can still be put back.
create or replace function remove_booking(p_booking uuid, p_reason text)
returns bookings language plpgsql security definer set search_path = public as $$
declare
  b bookings := booking_for_update(p_booking);
  s staff := me();
begin
  if not can('import') then raise exception 'Only the office can remove cars.'; end if;
  if p_reason not in ('No show', 'Cancelled', 'Duplicate') then raise exception 'Not a valid reason: %', p_reason; end if;
  update bookings set removed_at = now(), removed_by = s.id, removed_reason = p_reason, updated_at = now()
  where id = b.id returning * into b;
  perform log_activity(b, 'REMOVED', p_reason);
  return b;
end;
$$;
