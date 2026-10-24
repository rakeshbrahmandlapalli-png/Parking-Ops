-- Parking Ops — database part 115: AT DESK is its own permission (24 Oct).
--
-- The user: Terminal must not get CALLED or OVERSTAY, but should be able to press
-- AT DESK. So AT DESK no longer rides on CALLED:
--   • can('desk'): office, manager, terminal and owners by default; anyone who can
--     press CALLED can too (unless "-desk" removes it); a person can be given or
--     refused it in Staff → PIN and access ("DROPS: press AT DESK"). View-only: no.
--   • tap_drop(.., 'desk', ..) checks can('desk'). AT DESK on a car that has not
--     been called yet still calls it, but only for someone who can press CALLED;
--     Terminal gets "Not called yet" (office calls it first). Taking AT DESK off
--     (back to CALLED) is allowed to anyone with AT DESK.
--   • my_permissions returns 'desk'; set_staff_access accepts it.
-- can() is part 109's, tap_drop part 112's, my_permissions part 105's,
-- set_staff_access part 108's (all checked against the live definitions on
-- 24 Oct 2026), each with only these changes. Safe to run twice.
-- Rollback: setup/rollback/115-*.
begin;

create or replace function can(p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  s staff := me();
  roles text[];
begin
  if s.id is null then return false; end if;
  if p_action = 'collections' and not private.collections_on(s.company_id) then return false; end if;
  if ('-' || p_action) = any(s.extra) then return false; end if;
  if p_action = any(s.extra) then return true; end if;
  if s.role = 'owner' then return true; end if;
  -- AT DESK: whoever can press CALLED can also press AT DESK (part 115).
  if p_action = 'desk' and s.role <> 'view' and can('called') then return true; end if;
  roles := case p_action
    when 'sent'        then array['office','manager','bongo']
    when 'called'      then array['office','manager']
    when 'desk'        then array['office','manager','terminal']
    when 'clear'       then array['office','manager','terminal']
    when 'yard'        then array['office','manager']
    when 'summary'     then array['office','manager']
    when 'log'         then array['office','manager']
    when 'flights'     then array['office']
    when 'rtc'         then array['office','manager','bongo']
    when 'picksinfo'   then array['office','manager','terminal']
    when 'import'      then array['office','manager']
    when 'staff'       then array['office','manager']
    when 'settings'    then array['manager']
    when 'collections' then array['office','manager']
    else null end;
  if roles is null then return s.role <> 'view'; end if;
  return s.role = any(roles);
end;
$$;

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
    -- AT DESK (part 112): the customer is at the desk. Never on OVERSTAY. A car
    -- not called yet is called now too, but only by someone who can press CALLED
    -- (part 115: AT DESK alone is enough for the rest).
    if p_on then
      if b.called_word = 'Overstay' then raise exception 'Take OVERSTAY off first.'; end if;
      if b.called_at is null and not can('called') then raise exception 'Not called yet: CALLED comes first.'; end if;
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

create or replace function my_permissions() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(a, can(a)) from unnest(array['sent','called','desk','clear','yard','summary','log','flights','rtc','picksinfo','import','staff','note','intake','settings','collections']) a
$$;

create or replace function set_staff_access(p_staff uuid, p_extra text[])
returns staff language plpgsql security definer set search_path = public as $$
declare
  t staff := staff_target(p_staff);
  was text[] := t.extra;
  x text;
  allowed text[] := array['sent','called','desk','clear','yard','note','flights','intake','rtc','picksinfo','summary','log','import','staff','settings','collections'];
begin
  foreach x in array coalesce(p_extra, '{}') loop
    if not (ltrim(x, '-') = any(allowed)) then raise exception 'Unknown permission: %', x; end if;
  end loop;
  update staff set extra = coalesce(p_extra, '{}') where id = t.id returning * into t;
  insert into activity(company_id, staff_id, staff_name, action, value)
  select t.company_id, s.id, s.name, 'STAFF', 'Changed access for ' || t.name || ': was ' || private.access_words(was) || ', now ' || private.access_words(t.extra) from me() s;
  return t;
end;
$$;

revoke execute on function can(text), tap_drop(uuid, text, boolean, text), my_permissions(), set_staff_access(uuid, text[]) from public, anon;
grant execute on function can(text), tap_drop(uuid, text, boolean, text), my_permissions(), set_staff_access(uuid, text[]) to authenticated;

commit;
