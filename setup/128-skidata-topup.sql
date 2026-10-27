-- Parking Ops — database part 128: SKIDATA card top-up (an add-on per client).
--
-- 27 Oct: terminal staff top up the terminal car park's SKIDATA card (Apcoa pay
-- machine, £10 steps) for each shift. Every terminal ticket costs £3.50: one per
-- DROPS car taken to the terminal, one per PICKS car brought back, and one per bongo
-- round (drivers ÷ cars, rounded up). They worked it out by hand and posted the
-- machine photo in WhatsApp; the app now works it out and keeps the record.
--   • Add-on: Parking Ops → Clients → Edit → "SKIDATA card top-up" (brand.topup),
--     private.topup_on; admin_save_client is part 121's (live, checked 27 Oct 2026)
--     plus the switch, named in the client's activity line.
--   • can('topup'): owners, managers, office and terminal by default; grantable or
--     refusable in Staff → PIN and access ("SKIDATA card top-up"); false without the
--     add-on. can / my_permissions / set_staff_access are part 123's plus 'topup'.
--   • companies.topup: ticket price, top-up step and the client's shifts (name,
--     start, end in London time; an end at or before the start finishes next day).
--     set_topup_settings: owners only, logged SETTINGS.
--   • topup_counts(day, shift): DROPS cars due back in the shift not SENT, CLEAR,
--     overstay or removed; PICKS cars dropping off in the shift not marked yet.
--   • record_topup: saves the top-up with the sums used and the machine photo
--     (pt-photos <company>/docs/topup/t<time>.jpg, kept 90 days like other docs),
--     logged TOP UP. topup_list: the last 14 days.
-- Nothing here deletes. Safe to run twice. Rollback: setup/rollback/128-*.
-- Applied by Claude on 27 Oct 2026 at the user's request, as two migrations: skidata_topup_128a
-- (the column, table and policy) and skidata_topup_128b (the functions).
begin;

alter table companies add column if not exists topup jsonb not null default '{}';

create table if not exists card_topups (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  at          timestamptz not null default now(),
  staff_id    uuid references staff(id) on delete set null,
  staff_name  text not null default '',
  shift_day   date not null,
  shift_name  text not null default '',
  drivers     integer,
  drops_left  integer,
  picks_left  integer,
  rounds      integer,
  tickets     integer,
  ticket      numeric(8,2),
  need        numeric(8,2),
  card_before numeric(8,2),
  amount      numeric(8,2) not null,
  photo       text not null default ''
);
create index if not exists card_topups_company_idx on card_topups(company_id, at desc);
alter table card_topups enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'card_topups' and policyname = 'card_topups_read') then
    create policy card_topups_read on card_topups for select to authenticated
      using (company_id = my_company() and can('topup'));
  end if;
end $p$;

create or replace function private.topup_on(p_company uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select (c.brand->>'topup')::boolean from public.companies c where c.id = p_company), false)
$$;
revoke all on function private.topup_on(uuid) from public, anon, authenticated;

-- The client's settings with the defaults filled in.
create or replace function private.topup_conf(p_company uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'ticket', coalesce((t->>'ticket')::numeric, 3.50),
    'step', coalesce((t->>'step')::numeric, 10),
    'shifts', coalesce(t->'shifts', '[{"name":"Morning","start":"04:00","end":"17:00"},{"name":"Night","start":"17:00","end":"04:00"}]'))
  from (select coalesce(c.topup, '{}') t from public.companies c where c.id = p_company) x
$$;
revoke all on function private.topup_conf(uuid) from public, anon, authenticated;

-- Part 123's rules plus 'topup'.
create or replace function can(p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  s staff := me();
  roles text[];
begin
  if s.id is null then return false; end if;
  if p_action = 'collections' and not private.collections_on(s.company_id) then return false; end if;
  if p_action = 'topup' and not private.topup_on(s.company_id) then return false; end if;
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
    when 'callpop'     then array['office','manager']
    when 'topup'       then array['office','manager','terminal']
    else null end;
  if roles is null then return s.role <> 'view'; end if;
  return s.role = any(roles);
end;
$$;

create or replace function my_permissions() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(a, can(a)) from unnest(array['sent','called','desk','clear','yard','summary','log','flights','rtc','picksinfo','import','staff','note','intake','settings','collections','callpop','topup']) a
$$;

create or replace function set_staff_access(p_staff uuid, p_extra text[])
returns staff language plpgsql security definer set search_path = public as $$
declare
  t staff := staff_target(p_staff);
  was text[] := t.extra;
  x text;
  allowed text[] := array['sent','called','desk','clear','yard','note','flights','intake','rtc','picksinfo','summary','log','import','staff','settings','collections','callpop','topup'];
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

-- Part 121's, plus the SKIDATA card top-up add-on switch.
create or replace function admin_save_client(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c companies;
  y text;
  ys text[] := coalesce((select array_agg(upper(trim(v))) from jsonb_array_elements_text(coalesce(p->'yards', '[]')) v where trim(v) <> ''), '{}');
  b jsonb := coalesce(p->'brand', '{}');
  k text;
  set_look boolean := coalesce(p->'brand', '{}') ? 'theme';
  set_py boolean := coalesce(p->'brand', '{}') ? 'picks_yard';
  set_lp boolean := coalesce(p->'brand', '{}') ? 'lane_planner';
  set_co boolean := coalesce(p->'brand', '{}') ? 'collections';
  set_tx boolean := coalesce(p->'brand', '{}') ? 'texts';
  set_cl boolean := coalesce(p->'brand', '{}') ? 'calls';
  set_vc boolean := coalesce(p->'brand', '{}') ? 'voice';
  set_tu boolean := coalesce(p->'brand', '{}') ? 'topup';
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
    'calls', case when set_cl then coalesce(b->>'calls', '') = 'true' end,
    'voice', case when set_vc then coalesce(b->>'voice', '') = 'true' end,
    'topup', case when set_tu then coalesce(b->>'topup', '') = 'true' end));

  if made then
    if coalesce(p->>'slug', '') !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'The short code is lower-case letters, numbers and dashes, like airport-parking-bay.'; end if;
    if p->>'slug' = 'platform' then raise exception 'That short code is taken.'; end if;
    if exists (select 1 from companies where slug = p->>'slug') then raise exception 'That short code is taken.'; end if;
    insert into companies (name, slug, yards, drops_day_end, time_zone, brand)
    values (trim(p->>'name'), p->>'slug', ys, coalesce(nullif(p->>'drops_day_end', '')::time, '06:00'), 'Europe/London', b)
    returning * into c;
  else
    update companies set name = trim(p->>'name'), yards = ys,
      drops_day_end = coalesce(nullif(p->>'drops_day_end', '')::time, drops_day_end),
      brand = (case when set_look then brand - 'theme' else brand end) - (case when set_py then 'picks_yard' else '' end) - (case when set_lp then 'lane_planner' else '' end) - (case when set_co then 'collections' else '' end) - (case when set_tx then 'texts' else '' end) - (case when set_cl then 'calls' else '' end) - (case when set_vc then 'voice' else '' end) - (case when set_tu then 'topup' else '' end) || b
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
      ', Calls ' || case when (c.brand->>'calls')::boolean then 'on' else 'off' end ||
      ', Voice calls ' || case when (c.brand->>'voice')::boolean then 'on' else 'off' end ||
      ', SKIDATA top-up ' || case when (c.brand->>'topup')::boolean then 'on' else 'off' end end
  from me() s;
  return to_jsonb(c);
end;
$$;

-- Owners: ticket price, top-up step and the shifts.
create or replace function set_topup_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s staff := me();
  ticket numeric := round(coalesce((p->>'ticket')::numeric, -1), 2);
  step numeric := round(coalesce((p->>'step')::numeric, -1), 2);
  shifts jsonb := coalesce(p->'shifts', '[]');
  x jsonb;
  t jsonb;
begin
  if s.role <> 'owner' or not private.topup_on(s.company_id) then raise exception 'Only an owner can change the card top-up.'; end if;
  if ticket <= 0 or ticket > 100 then raise exception 'A ticket is £0.01 to £100.'; end if;
  if step <= 0 or step > 500 then raise exception 'The top-up step is £0.01 to £500.'; end if;
  if jsonb_typeof(shifts) <> 'array' or jsonb_array_length(shifts) not between 1 and 4 then raise exception 'Enter 1 to 4 shifts.'; end if;
  for x in select * from jsonb_array_elements(shifts) loop
    if coalesce(trim(x->>'name'), '') = '' or length(trim(x->>'name')) > 20 then raise exception 'Each shift needs a name (20 letters at most).'; end if;
    if coalesce(x->>'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(x->>'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Shift times look like 04:00 (%).', trim(x->>'name'); end if;
  end loop;
  t := jsonb_build_object('ticket', ticket, 'step', step, 'shifts',
    (select jsonb_agg(jsonb_build_object('name', trim(e->>'name'), 'start', e->>'start', 'end', e->>'end') order by n) from jsonb_array_elements(shifts) with ordinality as a(e, n)));
  update companies set topup = t where id = s.company_id;
  insert into activity(company_id, staff_id, staff_name, action, value)
  values (s.company_id, s.id, s.name, 'SETTINGS', 'Card top-up: ticket £' || ticket || ', top up in £' || step || ' steps, shifts ' ||
    (select string_agg(e->>'name' || ' ' || (e->>'start') || '–' || (e->>'end'), ', ') from jsonb_array_elements(t->'shifts') e));
  return t;
end;
$$;

-- A shift's start and end on a day, in London time.
create or replace function private.topup_window(p_company uuid, p_day date, p_shift int, out f timestamptz, out t timestamptz, out name text)
language plpgsql stable set search_path = '' as $$
declare
  x jsonb := private.topup_conf(p_company)->'shifts'->p_shift;
begin
  if x is null then raise exception 'No such shift.'; end if;
  name := x->>'name';
  f := (p_day + (x->>'start')::time) at time zone 'Europe/London';
  t := ((p_day + case when (x->>'end')::time <= (x->>'start')::time then 1 else 0 end) + (x->>'end')::time) at time zone 'Europe/London';
end;
$$;
revoke all on function private.topup_window(uuid, date, int) from public, anon, authenticated;

-- Cars still to move in a shift.
create or replace function topup_counts(p_day date, p_shift int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s staff := me();
  w record;
begin
  if not can('topup') then raise exception 'Not allowed for your role: %', s.role; end if;
  select * into w from private.topup_window(s.company_id, p_day, p_shift);
  return jsonb_build_object('day', p_day, 'shift', p_shift, 'name', w.name, 'from', w.f, 'to', w.t,
    'drops', (select count(*) from bookings b where b.company_id = s.company_id and b.kind = 'drops' and b.removed_at is null
      and b.return_at >= w.f and b.return_at < w.t and b.sent_at is null and b.cleared_at is null and not b.overstay),
    'picks', (select count(*) from bookings b where b.company_id = s.company_id and b.kind = 'picks' and b.removed_at is null
      and b.drop_at >= w.f and b.drop_at < w.t and b.intake = ''));
end;
$$;

create or replace function record_topup(p jsonb) returns card_topups
language plpgsql security definer set search_path = public as $$
declare
  s staff := me();
  r card_topups;
  amount numeric := round(coalesce((p->>'amount')::numeric, 0), 2);
  photo text := coalesce(p->>'photo', '');
  w record;
  who text;
begin
  if not can('topup') then raise exception 'Not allowed for your role: %', s.role; end if;
  if amount <= 0 or amount > 2000 then raise exception 'A top-up is £0.01 to £2000.'; end if;
  if photo <> '' and photo !~ ('^' || s.company_id::text || '/docs/topup/t[0-9]+\.jpg$') then raise exception 'That photo is not a top-up photo.'; end if;
  select * into w from private.topup_window(s.company_id, (p->>'day')::date, (p->>'shift')::int);
  who := coalesce(nullif(s.acting, ''), s.name);
  insert into card_topups (company_id, staff_id, staff_name, shift_day, shift_name, drivers, drops_left, picks_left, rounds, tickets, ticket, need, card_before, amount, photo)
  values (s.company_id, s.id, who, (p->>'day')::date, w.name, nullif(p->>'drivers', '')::int, nullif(p->>'drops', '')::int, nullif(p->>'picks', '')::int,
    nullif(p->>'rounds', '')::int, nullif(p->>'tickets', '')::int, (private.topup_conf(s.company_id)->>'ticket')::numeric,
    nullif(p->>'need', '')::numeric, nullif(p->>'card', '')::numeric, amount, photo)
  returning * into r;
  insert into activity(company_id, staff_id, staff_name, action, value)
  values (s.company_id, s.id, s.name, 'TOP UP', '£' || amount || ' on the SKIDATA card · ' || w.name || ' ' || to_char((p->>'day')::date, 'DD Mon') ||
    coalesce(' · card £' || r.card_before || ' → £' || (r.card_before + amount), '') ||
    coalesce(' · ' || r.tickets || ' tickets (' || r.drops_left || ' drops, ' || r.picks_left || ' picks, ' || r.rounds || ' rounds, ' || r.drivers || ' drivers)', '') ||
    case when photo <> '' then ' (photo)' else '' end);
  return r;
end;
$$;

create or replace function topup_list() returns setof card_topups
language sql stable security definer set search_path = public as $$
  select t.* from card_topups t where can('topup') and t.company_id = my_company() and t.at > now() - interval '14 days' order by t.at desc limit 100
$$;

revoke execute on function can(text), my_permissions(), set_staff_access(uuid, text[]), admin_save_client(jsonb),
  set_topup_settings(jsonb), topup_counts(date, int), record_topup(jsonb), topup_list() from public, anon;
grant execute on function can(text), my_permissions(), set_staff_access(uuid, text[]), admin_save_client(jsonb),
  set_topup_settings(jsonb), topup_counts(date, int), record_topup(jsonb), topup_list() to authenticated;
grant select on card_topups to authenticated;

commit;
