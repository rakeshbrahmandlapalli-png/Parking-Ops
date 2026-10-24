-- Legacy call-schema prerequisite for the Android SIM bridge in part 117.
-- Apply part 117 afterwards; it replaces the settings RPC and adds the phone RPCs.
-- The original Twilio endpoint is not included in this branch.
-- Parking Ops — database part 116: incoming calls (24 Oct, NOT applied until the user says so).
--
-- Customers ring the office when they land (DROPS) and when they're on their way
-- to drop the car off (PICKS). The user chose "Both": a caller pop-up with a call
-- log, and an auto-answer that can be switched on at busy times.
-- The office number is forwarded to the client's Twilio number; Twilio asks the
-- calls function, which asks this part:
--   call_in      a call comes in: which client (by the number called), which car
--                (the caller's number on tonight's DROPS or today's PICKS), what to do
--   call_digit   auto-answer: 1 = landed (DROPS car CALLED), 2 = on the way to drop
--                off (PICKS car CALLED), anything else = just put through
--   call_end     how it ended: answered (and how long) or missed
-- Every phone hears customer_calls (Realtime) and shows who's calling with their
-- car; the car's panel lists its calls; Menu → Calls lists today's, missed first.
-- An add-on (brand.calls, Clients → Edit); owners set it in Settings → Calls
-- (set_calls): the Twilio number, up to 3 numbers to ring, auto-answer Off / On /
-- between two times, and its words.
-- Needs part 115 first (admin_save_client below is part 115's plus brand.calls).
-- Safe to run twice. Rollback: setup/rollback/116-*.
begin;

alter table companies add column if not exists calls jsonb not null default '{}';

create table if not exists customer_calls (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references companies(id),
  at           timestamptz not null default now(),
  sid          text unique,
  from_number  text not null default '',
  booking_id   uuid,
  kind         text not null default '',
  reg          text not null default '',
  name         text not null default '',
  status       text not null default 'ringing' check (status in ('ringing', 'answered', 'missed', 'auto')),
  digit        text not null default '',
  marked       text not null default '',
  seconds      int,
  handled_by   uuid,
  handled_name text not null default ''
);
create index if not exists customer_calls_company_idx on customer_calls (company_id, at desc);
create index if not exists customer_calls_booking_idx on customer_calls (booking_id, at desc);
alter table customer_calls enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_calls' and policyname = 'company_read') then
    create policy company_read on customer_calls for select to authenticated using (company_id = (select my_company()));
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customer_calls') then
    alter publication supabase_realtime add table customer_calls;
  end if;
end $$;
revoke insert, update on customer_calls from anon, authenticated;

create or replace function private.calls_on(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (c.brand->>'calls')::boolean from public.companies c where c.id = p_company), false)
$$;
revoke all on function private.calls_on(uuid) from public, anon, authenticated;

-- A number as its last 10 digits: 07868 615571, +44 7868 615571 and 7868615571 all match.
create or replace function private.phone10(p text) returns text language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
$$;

-- Settings → Calls: owners only.
create or replace function set_calls(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s staff := me();
  ring text[] := coalesce((select array_agg(trim(v)) from jsonb_array_elements_text(coalesce(p->'ring', '[]')) v where trim(v) <> ''), '{}');
  mode text := coalesce(p->>'auto', 'off');
  out jsonb;
begin
  if s.role <> 'owner' then raise exception 'Only an owner can change calls.'; end if;
  if not private.calls_on(s.company_id) then raise exception 'Calls aren''t switched on for this company.'; end if;
  if coalesce(p->>'number', '') <> '' and length(private.phone10(p->>'number')) <> 10 then raise exception 'Check the Twilio number.'; end if;
  if coalesce(array_length(ring, 1), 0) > 3 then raise exception 'Up to 3 numbers to ring.'; end if;
  if exists (select 1 from unnest(ring) r where length(private.phone10(r)) <> 10) then raise exception 'Check the numbers to ring.'; end if;
  if (p->>'on')::boolean is true and (coalesce(p->>'number', '') = '' or coalesce(array_length(ring, 1), 0) = 0) then
    raise exception 'Add the Twilio number and at least one number to ring first.';
  end if;
  if mode not in ('off', 'on', 'times') then raise exception 'Auto-answer is Off, On or between two times.'; end if;
  if mode = 'times' and (coalesce(p->>'from', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' or coalesce(p->>'to', '') !~ '^([01]\d|2[0-3]):[0-5]\d$') then
    raise exception 'Pick when auto-answer starts and stops.';
  end if;
  if length(coalesce(p->>'words', '')) > 400 then raise exception 'The auto-answer words are 400 letters at most.'; end if;
  out := jsonb_build_object('on', coalesce((p->>'on')::boolean, false), 'number', trim(coalesce(p->>'number', '')), 'ring', to_jsonb(ring),
    'auto', mode, 'from', coalesce(p->>'from', '20:00'), 'to', coalesce(p->>'to', '02:00'), 'words', trim(coalesce(p->>'words', '')));
  update companies set calls = out where id = s.company_id;
  insert into activity(company_id, staff_id, staff_name, action, value)
  values (s.company_id, s.id, s.name, 'SETTINGS', case when (out->>'on')::boolean then 'Calls on: ring ' || array_to_string(ring, ', ') ||
    ', auto-answer ' || case mode when 'on' then 'on' when 'times' then (out->>'from') || '–' || (out->>'to') else 'off' end else 'Calls off' end);
  return out;
end;
$$;
revoke execute on function set_calls(jsonb) from public, anon;
grant execute on function set_calls(jsonb) to authenticated;

-- A call comes in (the calls function, service role). The car: the caller's number
-- on tonight's DROPS (not cleared) first, then today's PICKS (not taken in).
create or replace function call_in(p_to text, p_from text, p_sid text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c companies;
  b bookings;
  f text := private.phone10(p_from);
  lt time;
  auto boolean;
  v_call bigint;
begin
  select * into c from companies co where private.phone10(co.calls->>'number') = private.phone10(p_to) and private.calls_on(co.id) and (co.calls->>'on')::boolean limit 1;
  if c.id is null then return jsonb_build_object('company', null); end if;
  if length(f) = 10 then
    select bk.* into b from bookings bk join sheets sh on sh.id = bk.sheet_id
    where bk.company_id = c.id and bk.removed_at is null and regexp_replace(bk.phone, '\D', '', 'g') like '%' || f || '%'
      and ((bk.kind = 'drops' and bk.cleared_at is null and sh.day = drops_day_of(now(), c))
        or (bk.kind = 'picks' and bk.intake = '' and sh.day = (now() at time zone c.time_zone)::date))
    order by (bk.kind = 'drops') desc, abs(extract(epoch from (coalesce(case when bk.kind = 'drops' then bk.return_at else bk.drop_at end, now()) - now()))) limit 1;
  end if;
  lt := (now() at time zone c.time_zone)::time;
  auto := case c.calls->>'auto' when 'on' then true
    when 'times' then case when (c.calls->>'from')::time <= (c.calls->>'to')::time then lt >= (c.calls->>'from')::time and lt < (c.calls->>'to')::time
                           else lt >= (c.calls->>'from')::time or lt < (c.calls->>'to')::time end
    else false end;
  insert into customer_calls (company_id, sid, from_number, booking_id, kind, reg, name)
  values (c.id, p_sid, coalesce(p_from, ''), b.id, coalesce(b.kind, ''), coalesce(b.reg, ''), coalesce(b.name, ''))
  on conflict (sid) do update set at = customer_calls.at returning customer_calls.id into v_call;
  return jsonb_build_object('company', c.id, 'name', coalesce(c.brand->>'short', c.name), 'call', v_call, 'auto', auto, 'words', c.calls->>'words', 'ring', c.calls->'ring',
    'booking', case when b.id is null then null else jsonb_build_object('id', b.id, 'kind', b.kind, 'reg', b.reg) end);
end;
$$;

-- Auto-answer: 1 landed (DROPS CALLED), 2 on the way to drop off (PICKS CALLED).
-- The car the caller matched, or their other car of that kind on the same day.
create or replace function call_digit(p_sid text, p_digit text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k customer_calls;
  c companies;
  b bookings;
  want text := case p_digit when '1' then 'drops' when '2' then 'picks' end;
  done text := '';
begin
  select * into k from customer_calls where sid = p_sid;
  if k.id is null or want is null then
    if k.id is not null then update customer_calls set digit = coalesce(p_digit, '') where id = k.id; end if;
    return jsonb_build_object('marked', '');
  end if;
  select * into c from companies where id = k.company_id;
  select bk.* into b from bookings bk join sheets sh on sh.id = bk.sheet_id
  where bk.company_id = c.id and bk.kind = want and bk.removed_at is null
    and (bk.id = k.booking_id or (length(private.phone10(k.from_number)) = 10 and regexp_replace(bk.phone, '\D', '', 'g') like '%' || private.phone10(k.from_number) || '%'))
    and ((want = 'drops' and bk.cleared_at is null and sh.day = drops_day_of(now(), c)) or (want = 'picks' and bk.intake = '' and sh.day = (now() at time zone c.time_zone)::date))
  order by (bk.id = k.booking_id) desc limit 1;
  if b.id is not null then
    if want = 'drops' and b.called_at is null then
      update bookings set called_word = 'Called', called_at = now(), called_by = null where id = b.id;
      done := 'CALLED';
    elsif want = 'picks' and b.pick_called = '' then
      update bookings set pick_called = 'Called', pick_called_at = now() where id = b.id;
      done := 'CALLED';
    else done := 'already';
    end if;
    if done = 'CALLED' then
      insert into activity(company_id, sheet_id, booking_id, reg, customer, staff_name, action, value)
      values (c.id, b.sheet_id, b.id, b.reg, b.name, 'Phone', 'CALLED', case want when 'drops' then 'Customer pressed 1: landed' else 'Customer pressed 2: on the way to drop off' end);
    end if;
  end if;
  update customer_calls set digit = p_digit, marked = done, booking_id = coalesce(b.id, booking_id), kind = coalesce(b.kind, kind),
    reg = coalesce(b.reg, reg), name = coalesce(b.name, name) where id = k.id;
  return jsonb_build_object('marked', done, 'kind', want, 'reg', b.reg);
end;
$$;

-- How it ended. Twilio says answered with how long, or no-answer / busy / failed (missed).
-- Not answered but the customer marked their car on auto-answer: "auto", not missed.
create or replace function call_end(p_sid text, p_status text, p_seconds int)
returns void language sql security definer set search_path = public as $$
  update customer_calls set status = case when p_status = 'completed' and coalesce(p_seconds, 0) > 0 then 'answered'
      when marked <> '' then 'auto' else 'missed' end,
    seconds = p_seconds where sid = p_sid and status = 'ringing';
$$;

-- Staff: "I've got it" on the pop-up, or Called back from Menu → Calls.
create or replace function call_take(p_call bigint)
returns customer_calls language plpgsql security definer set search_path = public as $$
declare s staff := me(); k customer_calls;
begin
  if s.id is null or not can('called') then raise exception 'Not allowed for your role.'; end if;
  update customer_calls set handled_by = s.id, handled_name = coalesce(nullif(s.acting, ''), s.name)
  where id = p_call and company_id = s.company_id returning * into k;
  if k.id is null then raise exception 'Call not found.'; end if;
  insert into activity(company_id, booking_id, reg, customer, staff_id, staff_name, action, value)
  values (k.company_id, k.booking_id, k.reg, k.name, s.id, coalesce(nullif(s.acting, ''), s.name), 'CALL',
    case when k.status = 'missed' then 'Called back ' else 'Took the call from ' end || k.from_number);
  return k;
end;
$$;
revoke execute on function call_in(text, text, text), call_digit(text, text), call_end(text, text, int) from public, anon, authenticated;
revoke execute on function call_take(bigint) from public, anon;
grant execute on function call_take(bigint) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function call_in(text, text, text), call_digit(text, text), call_end(text, text, int) to service_role;
  end if;
end $$;

-- Platform page: the add-on switch. Part 115's admin_save_client with brand.calls.
create or replace function admin_save_client(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c companies;
  y text;
  ys text[] := coalesce((select array_agg(upper(trim(v))) from jsonb_array_elements_text(coalesce(p->'yards', '[]')) v where trim(v) <> ''), '{}');
  b jsonb := coalesce(p->'brand', '{}');
  k text;
  -- The form always sends the look; an older app that doesn't leaves it alone.
  set_look boolean := coalesce(p->'brand', '{}') ? 'theme';
  -- Same for the PICKS location switch: an older form leaves it alone.
  set_py boolean := coalesce(p->'brand', '{}') ? 'picks_yard';
  -- Part 107: the Yard planner add-on switch, the same way.
  set_lp boolean := coalesce(p->'brand', '{}') ? 'lane_planner';
  -- Part 109: the Collections add-on, kept as true or false so part 109's
  -- one-time switch-on never comes back after it has been switched off.
  set_co boolean := coalesce(p->'brand', '{}') ? 'collections';
  -- Part 115: the Customer texts add-on, the same way.
  set_tx boolean := coalesce(p->'brand', '{}') ? 'texts';
  -- Part 116: the Calls add-on, the same way.
  set_cl boolean := coalesce(p->'brand', '{}') ? 'calls';
  made boolean := coalesce(p->>'id', '') = '';
begin
  if not is_platform_admin() then raise exception 'Not allowed.'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter the client''s name.'; end if;
  if array_length(ys, 1) is null then raise exception 'Enter at least one yard.'; end if;
  foreach y in array ys loop
    if y !~ '^[A-Z0-9]{1,4}$' then raise exception 'Yard codes are 1 to 4 letters or numbers: %', y; end if;
  end loop;
  foreach k in array array['colour', 'ink', 'soft', 'text'] loop
    if coalesce(b->>k, '') <> '' and b->>k !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Colours look like #1560BD (%).', k; end if;
  end loop;
  if coalesce(b->>'host', '') <> '' and b->>'host' !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then raise exception 'The address looks like clientname-ops.vercel.app'; end if;
  if coalesce(b->>'theme', '') not in ('', 'pro', 'cards', 'premium', 'board', 'stdplus', 'ops', 'ops-refined') then raise exception 'Unknown look: %', b->>'theme'; end if;
  b := jsonb_strip_nulls(jsonb_build_object('name', trim(p->>'name'), 'short', nullif(trim(b->>'short'), ''),
    'colour', nullif(b->>'colour', ''), 'ink', nullif(b->>'ink', ''), 'soft', nullif(b->>'soft', ''), 'text', nullif(b->>'text', ''),
    'host', nullif(lower(b->>'host'), ''), 'logo', nullif(b->>'logo', ''), 'theme', nullif(b->>'theme', ''),
    'picks_yard', case when coalesce(b->>'picks_yard', '') = 'true' then true end,
    'lane_planner', case when coalesce(b->>'lane_planner', '') = 'true' then true end,
    'collections', case when set_co then coalesce(b->>'collections', '') = 'true' end,
    'texts', case when set_tx then coalesce(b->>'texts', '') = 'true' end,
    'calls', case when set_cl then coalesce(b->>'calls', '') = 'true' end));

  if made then
    if coalesce(p->>'slug', '') !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'The short code is lower-case letters, numbers and dashes, like airport-parking-bay.'; end if;
    if p->>'slug' = 'platform' then raise exception 'That short code is taken.'; end if;
    if exists (select 1 from companies where slug = p->>'slug') then raise exception 'That short code is taken.'; end if;
    insert into companies (name, slug, yards, drops_day_end, time_zone, brand)
    values (trim(p->>'name'), p->>'slug', ys, coalesce(nullif(p->>'drops_day_end', '')::time, '06:00'), 'Europe/London', b)
    returning * into c;
  else
    -- Standard drops the theme key: merging alone could never take it away.
    update companies set name = trim(p->>'name'), yards = ys,
      drops_day_end = coalesce(nullif(p->>'drops_day_end', '')::time, drops_day_end),
      brand = (case when set_look then brand - 'theme' else brand end) - (case when set_py then 'picks_yard' else '' end) - (case when set_lp then 'lane_planner' else '' end) - (case when set_co then 'collections' else '' end) - (case when set_tx then 'texts' else '' end) - (case when set_cl then 'calls' else '' end) || b
    where id = (p->>'id')::uuid and slug <> 'platform' returning * into c;
    if not found then raise exception 'Client not found.'; end if;
  end if;
  insert into activity(company_id, staff_name, action, value)
  select c.id, s.name || ' (Parking Ops)', 'SETTINGS',
    case when made then 'Client set up' else 'Client details saved: look ' || coalesce(c.brand->>'theme', 'standard') ||
      ', yards ' || array_to_string(c.yards, ' ') ||
      ', PICKS location ' || case when (c.brand->>'picks_yard')::boolean then 'on' else 'off' end ||
      ', Yard planner ' || case when (c.brand->>'lane_planner')::boolean then 'on' else 'off' end ||
      ', Collections ' || case when (c.brand->>'collections')::boolean then 'on' else 'off' end ||
      ', Customer texts ' || case when (c.brand->>'texts')::boolean then 'on' else 'off' end ||
      ', Calls ' || case when (c.brand->>'calls')::boolean then 'on' else 'off' end end
  from me() s;
  return to_jsonb(c);
end;
$$;
revoke execute on function admin_save_client(jsonb) from public, anon;
grant execute on function admin_save_client(jsonb) to authenticated;

commit;
