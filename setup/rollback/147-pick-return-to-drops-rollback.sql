-- Rollback of part 147: part 78's set_pick_return again (a PICKS return change only follows a DROPS car already in).

create or replace function set_pick_return(p_booking uuid, p_return_local text)
returns bookings language plpgsql security definer set search_path = public as $$
declare
  b bookings := booking_for_update(p_booking);
  c companies;
  new_ret timestamptz;
  old_ret timestamptz;
  d record;
begin
  if not can('import') then raise exception 'Only the office can change the return date.'; end if;
  if b.kind <> 'picks' then raise exception 'This is for PICKS cars.'; end if;
  if coalesce(p_return_local, '') !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' then raise exception 'Enter the date and the time.'; end if;
  select * into c from companies where id = b.company_id;
  new_ret := p_return_local::timestamp at time zone c.time_zone;
  if new_ret < now() - interval '60 days' or new_ret > now() + interval '400 days' then raise exception 'Check the date.'; end if;
  if b.drop_at is not null and new_ret <= b.drop_at then raise exception 'The return must be after the drop-off.'; end if;
  old_ret := b.return_at;
  if old_ret is not distinct from new_ret then return b; end if;
  update bookings set return_at = new_ret, updated_at = now() where id = b.id returning * into b;
  perform log_activity(b, 'RETURN CHANGED', 'was ' || coalesce(to_char(old_ret at time zone c.time_zone, 'DD Mon HH24:MI'), '(none)') ||
    ', now ' || to_char(new_ret at time zone c.time_zone, 'DD Mon HH24:MI') || ' (changed by hand)');
  -- Its DROPS car, when it's already in: the same change.
  for d in select x.id from bookings x
    where x.company_id = b.company_id and x.kind = 'drops' and x.removed_at is null and x.cleared_at is null and not x.early
      and (case when b.ref <> '' then x.ref = b.ref else x.reg = b.reg and b.reg <> '' end)
      and (x.return_at is null or b.drop_at is null or x.return_at >= b.drop_at - interval '1 day')
  loop
    perform set_return(d.id, p_return_local);
  end loop;
  return b;
end;
$$;
revoke execute on function set_pick_return(uuid, text) from public, anon;
grant execute on function set_pick_return(uuid, text) to authenticated;
