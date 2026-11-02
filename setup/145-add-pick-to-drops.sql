-- Parking Ops — database part 145: ADD TO DROPS from a PICKS car, on a night picked
-- (put_pick_on_drops; part 50's add_pick_to_drops is the import's same-day prompt).
--
-- 2 Nov 2026, Airport Parking Bay: LK06LFN (VIP APB-2308) was taken in on
-- 14 Oct, due back 21 Oct, but the 21 Oct DROPS file didn't list it, so it
-- had no DROPS car and nobody could SEND it. The office now adds it from the
-- PICKS car, on a night they pick:
--   • the car must be taken in, not removed, with a return date, and have no
--     DROPS car yet (same ref; with no ref, the same reg returning after it
--     came in, as part 74);
--   • the night is its return day or later, and that night's DROPS sheet
--     must be in (a later return day is EARLY RETURN's job, parts 74/75);
--   • a night after its return day makes it an OVERSTAY, as carry_overstays
--     would; on its return day it's an ordinary car;
--   • name, phone, car, drop-off, return and the PICKS return flight are
--     copied; yard, note and £ follow from PICKS by part 68's trigger.
-- Office only (can('import'), as adding a car by hand). Logged ADDED.
-- Safe to run twice.

create or replace function put_pick_on_drops(p_picks uuid, p_day date)
returns bookings language plpgsql security definer set search_path = public as $$
declare
  s staff := me();
  c companies;
  p bookings;
  d bookings;
  t sheets;
  back_day date;
  n int;
begin
  if not can('import') then raise exception 'Only the office can add cars to DROPS.'; end if;
  select * into c from companies where id = s.company_id;
  select * into p from bookings where id = p_picks and company_id = c.id and kind = 'picks' and removed_at is null;
  if p.id is null then raise exception 'That car is not on your PICKS board.'; end if;
  if p.intake is distinct from 'Collected' then raise exception 'This car hasn''t been taken in.'; end if;
  if p.return_at is null then raise exception 'This car has no return date.'; end if;
  if p_day is null then raise exception 'Pick a night.'; end if;
  select b.* into d from bookings b
  where b.company_id = c.id and b.kind = 'drops' and b.removed_at is null
    and (case when p.ref <> '' then b.ref = p.ref
              else p.reg <> '' and upper(regexp_replace(b.reg, '\s', '', 'g')) = upper(regexp_replace(p.reg, '\s', '', 'g'))
                   and b.return_at >= coalesce(p.drop_at, p.return_at) end)
  order by b.return_at desc nulls last limit 1;
  if d.id is not null then
    select * into t from sheets where id = d.sheet_id;
    raise exception 'Already on DROPS % (#%).', to_char(t.day, 'DD Mon'), d.num;
  end if;
  back_day := drops_day_of(p.return_at, c);
  if p_day < back_day then raise exception 'Pick % or a later night (use EARLY RETURN for an earlier one).', to_char(back_day, 'DD Mon'); end if;
  select * into t from sheets where company_id = c.id and kind = 'drops' and day = p_day;
  if t.id is null then raise exception 'The DROPS sheet for % isn''t in yet.', to_char(p_day, 'DD Mon'); end if;
  perform pg_advisory_xact_lock(hashtext('add_pick_to_drops:' || t.id::text));
  select coalesce(max(num), 0) + 1 into n from bookings where sheet_id = t.id;
  insert into bookings(company_id, sheet_id, kind, ref, reg, name, phone, make, drop_at, return_at, flight, num, overstay)
  values (c.id, t.id, 'drops', p.ref, p.reg, p.name, p.phone, p.make, p.drop_at, p.return_at, p.flight, n, p_day > back_day)
  returning * into d;
  select * into d from bookings where id = d.id;
  perform log_activity(d, 'ADDED', 'from PICKS, booked back ' || to_char(d.return_at at time zone c.time_zone, 'DD Mon HH24:MI')
    || case when p_day > back_day then ' (overstay)' else '' end);
  return d;
end;
$$;
revoke execute on function put_pick_on_drops(uuid, date) from public, anon;
grant execute on function put_pick_on_drops(uuid, date) to authenticated;
