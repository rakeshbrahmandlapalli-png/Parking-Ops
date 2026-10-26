-- Parking Ops — database part 124: the customer's phone number, added or changed in the app.
--
-- 26 Oct: rakesh asked for a phone number box on the booking ("need to have an
-- option to add phone number and edit them as well that field is missing").
-- Bookings already carry the number from the booking file (bookings.phone, about
-- 95% of cars); the car panel showed it as a Call link only.
--   • set_phone(booking, phone): the office (import) adds, changes or clears it;
--     anyone who takes cars in can fill in a missing one (as with a reg). The
--     booking's other row (PICKS / DROPS share the ref) takes it too. Each row
--     logs PHONE "old > new" in the activity log.
--   • bookings.phone_set_at: set by set_phone. A number changed in the app is kept:
--     a later import (any path) no longer puts the file's old number back, and a
--     row imported later for the same ref starts with it (trigger bookings_keep_phone).
--     The 90-day personal-data wipe still empties it.
--   • Call and text matching (private.phone_booking) reads bookings.phone, so a
--     number typed here is matched from the next call.
-- Safe to run twice.

alter table bookings add column if not exists phone_set_at timestamptz;
create index if not exists bookings_phone_set on bookings(company_id, ref) where phone_set_at is not null;

create or replace function set_phone(p_booking uuid, p_phone text)
returns bookings language plpgsql security definer set search_path = public as $$
declare
  b bookings := booking_for_update(p_booking);
  o bookings;
  old_phone text := coalesce(b.phone, '');
  v text := regexp_replace(trim(coalesce(p_phone, '')), '\s+', ' ', 'g');
  digits int := length(regexp_replace(v, '\D', '', 'g'));
begin
  if not (can('import') or (can('intake') and old_phone = '')) then raise exception 'Only the office can change a phone number.'; end if;
  if b.removed_at is not null then raise exception 'This car was removed.'; end if;
  if length(v) > 30 or v !~ '^\+?[0-9 ()-]*$' or (v <> '' and (digits < 7 or digits > 15)) then raise exception 'Check the phone number: digits only, like 07700 900123.'; end if;
  if v = old_phone and b.phone_set_at is not null then return b; end if;
  perform set_config('app.phone_set', '1', true);
  update bookings set phone = v, phone_set_at = now(), updated_at = now() where id = b.id returning * into b;
  if v <> old_phone then
    perform log_activity(b, 'PHONE', case when old_phone <> '' and v <> '' then old_phone || ' > ' || v when v <> '' then v else old_phone || ' > (cleared)' end);
  end if;
  -- The same booking's other row (PICKS / DROPS share the ref).
  if b.ref <> '' then
    for o in select * from bookings x
      where x.company_id = b.company_id and x.ref = b.ref and x.id <> b.id and x.removed_at is null
      for update
    loop
      if coalesce(o.phone, '') <> v then
        perform log_activity(o, 'PHONE', case when coalesce(o.phone, '') <> '' and v <> '' then o.phone || ' > ' || v when v <> '' then v else o.phone || ' > (cleared)' end || ' · from ' || upper(b.kind));
      end if;
      update bookings set phone = v, phone_set_at = now(), updated_at = now() where id = o.id;
    end loop;
  end if;
  perform set_config('app.phone_set', '', true);
  return b;
end;
$$;
revoke execute on function set_phone(uuid, text) from public, anon;
grant execute on function set_phone(uuid, text) to authenticated;

-- A number typed in the app outlives the booking file: imports keep it, and a row
-- imported later for the same booking starts with it.
create or replace function private.bookings_keep_phone()
returns trigger language plpgsql security definer set search_path = public as $$
declare k bookings;
begin
  if tg_op = 'INSERT' then
    if new.phone_set_at is null and coalesce(new.ref, '') <> '' then
      select * into k from bookings x where x.company_id = new.company_id and x.ref = new.ref and x.phone_set_at is not null
        order by x.phone_set_at desc limit 1;
      if found then new.phone := k.phone; new.phone_set_at := k.phone_set_at; end if;
    end if;
    return new;
  end if;
  if old.phone_set_at is not null and new.phone is distinct from old.phone
     and coalesce(current_setting('app.phone_set', true), '') <> '1' and new.personal_wiped_at is null then
    new.phone := old.phone;
  end if;
  return new;
end;
$$;
revoke all on function private.bookings_keep_phone() from public, anon, authenticated;
create or replace trigger bookings_keep_phone before insert or update of phone on bookings
  for each row execute function private.bookings_keep_phone();
