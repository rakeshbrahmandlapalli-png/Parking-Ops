-- Parking Ops — database part 132: a reg changed on PICKS reaches a DROPS car imported later.
--
-- 28 Oct: four TakeOff cars (APL-113430, APL-108764, EZY-393389, EZY-396632) had
-- their reg corrected on PICKS (logged REG), but their DROPS cars for 1–2 Nov were
-- imported afterwards with the booking site's old reg. Part 92 only reaches a
-- DROPS car that is already on a sheet when the reg is changed.
--   • A DROPS car added (import or Add a car) takes its PICKS car's reg (same
--     booking ref; the latest drop-off before the return, as part 78) when the
--     PICKS reg was changed in the app (a REG line in its history) and differs.
--     Logged "OLD > NEW · from PICKS" as REG, so later imports keep it (part 92).
--   • A PICKS reg nobody changed in the app is left alone: then the site's reg on
--     the new DROPS car is the newer one.
-- Every client, whatever its Location on PICKS setting. Safe to run twice.

create or replace function carry_reg_from_picks(p_drop uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d bookings;
  p bookings;
  old_reg text;
begin
  select * into d from bookings where id = p_drop and kind = 'drops' and removed_at is null and cleared_at is null;
  if not found or d.ref = '' then return; end if;
  select * into p from bookings x
  where x.company_id = d.company_id and x.kind = 'picks' and x.removed_at is null and x.ref = d.ref
    and (d.return_at is null or x.drop_at is null or (x.drop_at <= d.return_at + interval '1 day' and x.drop_at > d.return_at - interval '120 days'))
  order by x.drop_at desc nulls last limit 1;
  if not found or p.reg = '' or upper(replace(p.reg, ' ', '')) = upper(replace(d.reg, ' ', '')) then return; end if;
  if not exists (select 1 from activity a where a.booking_id = p.id and a.action = 'REG') then return; end if;
  old_reg := d.reg;
  update bookings set reg = p.reg, updated_at = now() where id = d.id returning * into d;
  perform log_activity(d, 'REG', case when old_reg <> '' then old_reg || ' > ' || p.reg else p.reg end || ' · from PICKS');
end;
$$;
revoke execute on function carry_reg_from_picks(uuid) from public, anon, authenticated;

-- A DROPS car comes in: take the reg the office corrected on its PICKS car.
create or replace function bookings_reg_in() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform carry_reg_from_picks(new.id);
  return null;
end;
$$;
revoke execute on function bookings_reg_in() from public, anon, authenticated;
drop trigger if exists bookings_reg_in on bookings;
create trigger bookings_reg_in after insert on bookings
  for each row when (new.kind = 'drops') execute function bookings_reg_in();
