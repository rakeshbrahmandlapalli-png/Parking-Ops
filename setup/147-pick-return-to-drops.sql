-- Parking Ops — database part 147: a return changed on a PICKS car reaches DROPS.
--
-- 15 Nov: LS54FAA (PICKS, dropped off 13 Nov) had its return changed by the office
-- to 16 Nov 15:30 and saved, but it never showed on the 16th's DROPS. Part 78's
-- set_pick_return only passed the change on to a DROPS car that was already in,
-- and set_return only ever moves a car to a LATER night. So:
--   • no DROPS car yet (a desk booking, or its booked night isn't imported): nothing
--     was added;
--   • a DROPS car on a later night (coming back earlier): its return changed but it
--     stayed on that later sheet.
-- Now, after the change (only for a return night from tonight on):
--   • a DROPS car on a later night than the new return moves to the new night as an
--     early return (as EARLY RETURN does: moved_from = the night it was on, so that
--     night's import leaves it where it is). Logged EARLY RETURN.
--   • no DROPS car at all for the stay (none on any sheet, removed or cleared ones
--     included, so a car removed on purpose never comes back): it is added to the new
--     night's sheet, as an early return when the old return was a later night, else
--     as a plain car, but only when the old return night's sheet is already in (or
--     there was no return): otherwise that night's import brings the site's car and
--     a second one would be added. Logged ADDED "from PICKS: return changed …".
--   • the new night's sheet: tonight's must be imported (nothing is added before it
--     is); a later night's is made empty if it isn't in yet, as EARLY RETURN does,
--     and that night's import adds the other cars and matches this one by ref/reg.
-- A later night with a DROPS car already in is still part 127's set_return (moved
-- there, or OVERSTAYS until that night's sheet is in). The PICKS car itself is
-- changed as before. Safe to run twice. Rollback: run part 78's set_pick_return
-- again (setup/rollback/147-pick-return-to-drops-rollback.sql).

create or replace function set_pick_return(p_booking uuid, p_return_local text)
returns bookings language plpgsql security definer set search_path = public as $$
declare
  b bookings := booking_for_update(p_booking);
  s staff := me();
  c companies;
  new_ret timestamptz;
  old_ret timestamptz;
  new_day date;
  old_day date;
  shift_day date;
  target sheets;
  booked sheets;
  d record;
  nb bookings;
  src_day date;
  n int;
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
  -- Its DROPS car, when it's already in: the same change (part 78).
  for d in select x.id from bookings x
    where x.company_id = b.company_id and x.kind = 'drops' and x.removed_at is null and x.cleared_at is null and not x.early
      and (case when b.ref <> '' then x.ref = b.ref else x.reg = b.reg and b.reg <> '' end)
      and (x.return_at is null or b.drop_at is null or x.return_at >= b.drop_at - interval '1 day')
  loop
    perform set_return(d.id, p_return_local);
  end loop;

  if b.removed_at is not null then return b; end if;
  new_day := drops_day_of(new_ret, c);
  old_day := case when old_ret is null then null else drops_day_of(old_ret, c) end;
  shift_day := case when (now() at time zone c.time_zone)::time <= c.drops_day_end
                    then (now() at time zone c.time_zone)::date - 1 else (now() at time zone c.time_zone)::date end;
  if new_day < shift_day then return b; end if;

  -- The new night's DROPS sheet: tonight's only when imported, a later night's made if needed.
  select * into target from sheets where company_id = c.id and kind = 'drops' and day = new_day;
  if target.id is null and new_day > shift_day then
    insert into sheets(company_id, kind, day, imported_by, source) values (c.id, 'drops', new_day, s.id, '{}')
    on conflict (company_id, kind, day) do nothing;
    select * into target from sheets where company_id = c.id and kind = 'drops' and day = new_day;
  end if;
  if target.id is null then return b; end if;

  -- Coming back earlier: a DROPS car on a later night moves to the new night as an early return.
  for d in select x.id, o.day, o.id sheet from bookings x join sheets o on o.id = x.sheet_id
    where x.company_id = b.company_id and x.kind = 'drops' and x.removed_at is null and x.cleared_at is null and not x.early
      and (case when b.ref <> '' then x.ref = b.ref else x.reg = b.reg and b.reg <> '' end)
      and (x.return_at is null or b.drop_at is null or x.return_at >= b.drop_at - interval '1 day')
      and o.day > new_day
  loop
    select coalesce(max(num), 0) + 1 into n from bookings where sheet_id = target.id;
    update bookings set sheet_id = target.id, moved_from = d.sheet, early = true, early_at = early_at_for(c, target), num = n,
      overstay = false,
      called_word = case when called_word = 'Overstay' then '' else called_word end,
      called_at = case when called_word = 'Overstay' then null else called_at end,
      called_by = case when called_word = 'Overstay' then null else called_by end,
      updated_at = now()
    where id = d.id returning * into nb;
    perform log_activity(nb, 'EARLY RETURN', 'return changed on PICKS to ' || to_char(new_ret at time zone c.time_zone, 'DD Mon HH24:MI') ||
      ', moved from ' || to_char(d.day, 'DD Mon') || ' to ' || to_char(target.day, 'DD Mon'));
  end loop;

  -- No DROPS car at all for this stay (none removed or cleared either): add it.
  if exists (select 1 from bookings x
      where x.company_id = b.company_id and x.kind = 'drops'
        and (case when b.ref <> '' then x.ref = b.ref
                  else b.reg <> '' and upper(regexp_replace(x.reg, '\s', '', 'g')) = upper(regexp_replace(b.reg, '\s', '', 'g')) end)
        and (x.return_at is null or b.drop_at is null or x.return_at >= b.drop_at - interval '1 day')) then
    return b;
  end if;
  if b.ref = '' and b.reg = '' then return b; end if;
  if old_day is not null and old_day > new_day then
    -- Booked back on a later night: an early return, so that night's import leaves it here.
    insert into sheets(company_id, kind, day, imported_by, source) values (c.id, 'drops', old_day, s.id, '{}')
    on conflict (company_id, kind, day) do nothing;
    select * into booked from sheets where company_id = c.id and kind = 'drops' and day = old_day;
  elsif old_day is not null and old_day <> new_day
        and not exists (select 1 from sheets where company_id = c.id and kind = 'drops' and day = old_day) then
    -- Its booked night isn't in yet: that night's import brings it (a car here too would be a second one).
    return b;
  end if;
  select coalesce(max(num), 0) + 1 into n from bookings where sheet_id = target.id;
  insert into bookings(company_id, sheet_id, kind, ref, reg, name, phone, make, drop_at, return_at, num, early, early_at, moved_from)
  values (c.id, target.id, 'drops', b.ref, b.reg, b.name, b.phone, b.make, b.drop_at, b.return_at, n,
          booked.id is not null, case when booked.id is not null then early_at_for(c, target) end, booked.id)
  returning * into nb;
  -- The yard, note, £ and flight came over from the PICKS car on insert (parts 68 and 78).
  select * into nb from bookings where id = nb.id;
  perform log_activity(nb, 'ADDED', 'from PICKS: return changed to ' || to_char(new_ret at time zone c.time_zone, 'DD Mon HH24:MI') ||
    ', added to DROPS ' || to_char(target.day, 'DD Mon'));
  return b;
end;
$$;
revoke execute on function set_pick_return(uuid, text) from public, anon;
grant execute on function set_pick_return(uuid, text) to authenticated;
