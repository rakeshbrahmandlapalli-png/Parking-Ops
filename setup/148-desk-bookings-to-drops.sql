-- Parking Ops — database part 148: a desk booking reaches its night's DROPS.
--
-- 15 Nov: MM69HSK was taken at the desk on 12 Nov (PICKS "+ New booking"), booked back
-- 15 Nov 17:00, and never showed on the 15th's DROPS. A desk booking only reached DROPS
-- when that night's sheet was already in when the car was added (the app asks, part 50);
-- the 15th's import came later and the booking site's file didn't have it. Live on
-- 16 Nov there were 8 more such cars (7 Airport Parking Bay, 1 TAKEOFF), 1 of them
-- already added by hand under another ref ("VIP APB-2623" for APB-2623).
--   • desk_to_drops(sheet): for a DROPS sheet from tonight on, every PICKS car added at
--     the desk or by hand (its ADDED line says so), not removed, booked back that night,
--     with no DROPS car for the stay (same ref, or the same reg with a return from its
--     drop-off on; removed and cleared ones count, so a car removed on purpose never comes
--     back) is put on it, as add_pick_to_drops does. Logged ADDED "from PICKS: desk
--     booking, back …" as the person whose action made the sheet (System when none).
--   • It runs when a DROPS sheet is made or imported again, at the END of that
--     transaction (a deferred constraint trigger), so the import's own cars are already
--     there and a car the file has under another ref is matched by its reg.
-- Nothing else changes. Safe to run twice. Rollback: setup/rollback/148-*.

create or replace function desk_to_drops(p_sheet uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  sh sheets;
  c companies;
  s staff;
  p bookings;
  nb bookings;
  shift_day date;
  added int := 0;
begin
  select * into sh from sheets where id = p_sheet;
  if sh.id is null or sh.kind <> 'drops' then return 0; end if;
  select * into c from companies where id = sh.company_id;
  shift_day := case when (now() at time zone c.time_zone)::time <= c.drops_day_end
                    then (now() at time zone c.time_zone)::date - 1 else (now() at time zone c.time_zone)::date end;
  if sh.day < shift_day then return 0; end if;
  begin s := me(); exception when others then s := null; end;
  for p in select b.* from bookings b
    where b.company_id = c.id and b.kind = 'picks' and b.removed_at is null and b.return_at is not null
      and b.return_at >= (sh.day::timestamp at time zone c.time_zone) and b.return_at < ((sh.day + 2)::timestamp at time zone c.time_zone)
      and drops_day_of(b.return_at, c) = sh.day
      and (b.ref <> '' or b.reg <> '')
      and exists (select 1 from activity a where a.booking_id = b.id and a.action = 'ADDED'
                  and a.value in ('new booking at the desk', 'added by hand'))
      and not exists (select 1 from bookings x
        where x.company_id = c.id and x.kind = 'drops'
          and ((b.ref <> '' and x.ref = b.ref)
            or (b.reg <> '' and upper(regexp_replace(x.reg, '\s', '', 'g')) = upper(regexp_replace(b.reg, '\s', '', 'g'))))
          and (x.return_at is null or b.drop_at is null or x.return_at >= b.drop_at - interval '1 day'))
    order by b.return_at
  loop
    insert into bookings(company_id, sheet_id, kind, ref, reg, name, phone, make, drop_at, return_at, num)
    values (c.id, sh.id, 'drops', p.ref, p.reg, p.name, p.phone, p.make, p.drop_at, p.return_at,
      (select coalesce(max(num), 0) + 1 from bookings where sheet_id = sh.id))
    returning * into nb;
    -- The yard, note, £ and flight came over from the PICKS car on insert (parts 68 and 78).
    insert into activity(company_id, staff_id, staff_name, sheet_id, booking_id, reg, customer, action, value)
    values (c.id, s.id, coalesce(s.name, 'System'), sh.id, nb.id, nb.reg, nb.name, 'ADDED',
      'from PICKS: desk booking, back ' || to_char(p.return_at at time zone c.time_zone, 'DD Mon HH24:MI'));
    added := added + 1;
  end loop;
  return added;
end;
$$;
revoke execute on function desk_to_drops(uuid) from public, anon, authenticated;

create or replace function sheets_desk_to_drops()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Never stops the import or the sheet: a problem here only means no car is added.
  begin
    perform desk_to_drops(new.id);
  exception when others then
    raise warning 'desk_to_drops(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function sheets_desk_to_drops() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sheets_desk_to_drops' and tgrelid = 'public.sheets'::regclass) then
    create constraint trigger sheets_desk_to_drops after insert or update of imported_at on sheets
      deferrable initially deferred
      for each row when (new.kind = 'drops') execute function sheets_desk_to_drops();
  end if;
end $$;
