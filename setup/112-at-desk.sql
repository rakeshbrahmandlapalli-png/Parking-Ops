-- Parking Ops — database part 112: AT DESK on a DROPS car (24 Oct).
--
-- The user asked for a way to show the customer is waiting at the desk, without
-- a fourth button on the row (preview agreed 24 Oct): the CALLED button turns
-- into AT DESK on a second tap, and back to CALLED on the next.
--   • bookings.desk_at / desk_by: when and by whom.
--   • tap_drop(p_booking, 'desk', on): anyone who can press CALLED. On a car not
--     called yet it calls it too; refused on OVERSTAY. Taking CALLED off, or
--     switching it to OVERSTAY, takes AT DESK off. Logged as DESK on the activity.
--   • bookings_by_name: desk_by carries the name picked on a shared login (part 98).
-- tap_drop is part 95's with only these changes; bookings_by_name is part 98's
-- with desk_by added. Safe to run twice. Rollback: setup/rollback/112-*.

alter table bookings add column if not exists desk_at timestamptz;
alter table bookings add column if not exists desk_by uuid references staff(id) on delete set null;

create or replace function tap_drop(p_booking uuid, p_action text, p_on boolean, p_word text default '')
returns bookings language plpgsql security definer set search_path = public as $$
declare
  b bookings := booking_for_update(p_booking);
  s staff := me();
  w text := coalesce(nullif(trim(p_word), ''), '');
  c companies;
  sheet_day date;
begin
  if b.kind <> 'drops' then raise exception 'That is a PICKS car.'; end if;
  if p_action not in ('sent','called','clear','desk') then raise exception 'Unknown action: %', p_action; end if;
  if not can(case when p_action = 'desk' then 'called' else p_action end) then raise exception 'Not allowed for your role (%): %', s.role, p_action; end if;

  if p_action = 'sent' then
    if p_on and b.sent_at is null then
      b.yard_before_t := b.yard; b.yard := 'T'; b.sent_at := now(); b.sent_by := s.id;
    elsif not p_on then
      if b.yard = 'T' and b.yard_before_t <> '' then b.yard := b.yard_before_t; end if;
      b.yard_before_t := ''; b.sent_at := null; b.sent_by := null;
    end if;
  elsif p_action = 'called' then
    if p_on then
      if w = '' then w := 'Called'; end if;
      if w not in ('Called','Overstay') then raise exception 'Not a valid option: %', w; end if;
      b.called_word := w; b.called_at := now(); b.called_by := s.id;
      b.overstay := b.overstay or w = 'Overstay';
      if w = 'Overstay' then b.desk_at := null; b.desk_by := null; end if;
    else
      -- Taking OVERSTAY off a car due back on this sheet undoes it: it was a
      -- mis-tap, not a car carried from an earlier day (those stay overstays).
      if b.called_word = 'Overstay' and b.overstay and not b.early and b.return_at is not null then
        select * into c from companies where id = b.company_id;
        select day into sheet_day from sheets where id = b.sheet_id;
        if drops_day_of(b.return_at, c) >= sheet_day then b.overstay := false; end if;
      end if;
      b.called_word := ''; b.called_at := null; b.called_by := null;
      b.desk_at := null; b.desk_by := null;
    end if;
  elsif p_action = 'desk' then
    -- AT DESK (part 112): the customer is at the desk. Only on a CALLED car
    -- (a car not called yet is called now too); never on OVERSTAY.
    if p_on then
      if b.called_word = 'Overstay' then raise exception 'Take OVERSTAY off first.'; end if;
      if b.called_at is null then b.called_word := 'Called'; b.called_at := now(); b.called_by := s.id; end if;
      if b.desk_at is null then b.desk_at := now(); b.desk_by := s.id; end if;
    else
      b.desk_at := null; b.desk_by := null;
    end if;
  else
    if p_on then
      if w = '' then w := 'Collected'; end if;
      if w not in ('Collected','COMPLAINT') then raise exception 'Not a valid option: %', w; end if;
      b.clear_word := w; b.cleared_at := now(); b.cleared_by := s.id;
    else
      b.clear_word := ''; b.cleared_at := null; b.cleared_by := null;
    end if;
  end if;

  b.updated_at := now();
  update bookings set yard = b.yard, yard_before_t = b.yard_before_t, sent_at = b.sent_at, sent_by = b.sent_by,
    called_word = b.called_word, called_at = b.called_at, called_by = b.called_by, overstay = b.overstay,
    desk_at = b.desk_at, desk_by = b.desk_by,
    clear_word = b.clear_word, cleared_at = b.cleared_at, cleared_by = b.cleared_by, updated_at = b.updated_at
  where id = b.id;
  if p_action = 'desk' then
    perform log_activity(b, 'DESK', case when p_on then 'At desk' else '(cleared)' end);
  else
    perform log_activity(b, upper(p_action), case when p_on then coalesce(nullif(w, ''), upper(p_action)) else '(cleared)' end);
  end if;
  return b;
end;
$$;

create or replace function bookings_by_name() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c text;
  n jsonb := coalesce(new.by_name, '{}');
  nv uuid; ov uuid; a text;
begin
  foreach c in array array['sent_by','called_by','cleared_by','intake_by','pt_by','exit_by','charge_by','removed_by','desk_by'] loop
    nv := (to_jsonb(new) ->> c)::uuid;
    ov := case when tg_op = 'UPDATE' then (to_jsonb(old) ->> c)::uuid end;
    if tg_op = 'INSERT' or nv is distinct from ov then
      a := '';
      if nv is not null then select acting into a from staff where id = nv; end if;
      if coalesce(a, '') <> '' then n := n || jsonb_build_object(c, a); else n := n - c; end if;
    end if;
  end loop;
  new.by_name := n;
  return new;
end;
$$;
revoke execute on function bookings_by_name() from public, anon, authenticated;
