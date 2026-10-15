-- Part 94: taking OVERSTAY off a car undoes the overstay (15 Oct).
-- Pressing OVERSTAY by mistake and pressing it again cleared the button but
-- left bookings.overstay on, so the car stayed in OVERSTAYS. Now turning it off
-- clears the overstay too, unless the car was carried from an earlier day
-- (its return day is before its sheet's day), which stays an overstay.
-- Only tap_drop changes; the rest is exactly part 1's.

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
  if p_action not in ('sent','called','clear') then raise exception 'Unknown action: %', p_action; end if;
  if not can(p_action) then raise exception 'Not allowed for your role (%): %', s.role, p_action; end if;

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
    else
      -- Taking OVERSTAY off a car due back on this sheet undoes it: it was a
      -- mis-tap, not a car carried from an earlier day (those stay overstays).
      if b.called_word = 'Overstay' and b.overstay and not b.early and b.return_at is not null then
        select * into c from companies where id = b.company_id;
        select day into sheet_day from sheets where id = b.sheet_id;
        if drops_day_of(b.return_at, c) >= sheet_day then b.overstay := false; end if;
      end if;
      b.called_word := ''; b.called_at := null; b.called_by := null;
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
    clear_word = b.clear_word, cleared_at = b.cleared_at, cleared_by = b.cleared_by, updated_at = b.updated_at
  where id = b.id;
  perform log_activity(b, upper(p_action), case when p_on then coalesce(nullif(w, ''), upper(p_action)) else '(cleared)' end);
  return b;
end;
$$;
