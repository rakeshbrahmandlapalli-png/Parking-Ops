-- Parking Ops — database part 116: customer texts (24 Oct, NOT applied until the user says so).
--
-- The user asked for a "call system" and chose automatic texts to customers:
--   landed    DROPS: the customer's flight has landed (flight_status becomes 'landed')
--   sent      DROPS: a driver is SENT with the car
--   reminder  PICKS: the day before drop-off, at the owner's chosen time
-- An add-on: Parking Ops → Clients → Edit → "Customer texts
-- (add-on)" saves brand.texts (admin_save_client, part 109's with one more key).
-- Owners set it in Settings → Customer texts (set_texts): on, demo or off (demo:
-- every text is written on its car as it would go, none is sent), the company
-- name/signature, the office number, the meeting point, and each text's on/off
-- and words. The send-texts function queues them for the company Android app,
-- once per car and kind (alert_log 'text:<rule>:<booking>'), writes each one to
-- customer_texts (the car's Texts list) and to the activity log (TEXT).
-- The Android app sends queued texts from the company SIM; the carrier plan may
-- charge. Safe to run twice.
-- The Supabase MCP hangs on SQL containing the word for removing rows: the
-- foreign key below is in 116b, applied separately.
-- Rollback: setup/rollback/116-*.
begin;

alter table companies add column if not exists texts jsonb not null default '{}';

create table if not exists customer_texts (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references companies(id),
  booking_id  uuid,
  at          timestamptz not null default now(),
  rule        text not null check (rule in ('landed', 'sent', 'reminder', 'manual', 'test')),
  to_number   text not null default '',
  body        text not null default '',
  status      text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'skipped', 'demo', 'uncertain', 'expired')),
  error       text not null default '',
  provider_id text,
  parts       int not null default 1,
  staff_id    uuid,
  staff_name  text not null default ''
);
create index if not exists customer_texts_booking_idx on customer_texts (booking_id, at desc);
create index if not exists customer_texts_company_idx on customer_texts (company_id, at desc);
create unique index if not exists customer_texts_provider_idx on customer_texts (provider_id) where provider_id is not null;
alter table customer_texts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_texts' and policyname = 'company_read') then
    create policy company_read on customer_texts for select to authenticated using (company_id = (select my_company()));
  end if;
end $$;
revoke insert, update on customer_texts from anon, authenticated;

-- Is the add-on on for this client?
create or replace function private.texts_on(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (c.brand->>'texts')::boolean from public.companies c where c.id = p_company), false)
$$;
revoke all on function private.texts_on(uuid) from public, anon, authenticated;

-- Settings → Customer texts: owners only.
create or replace function set_texts(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s staff := me();
  k text;
  out jsonb;
begin
  if s.role <> 'owner' then raise exception 'Only an owner can change customer texts.'; end if;
  if not private.texts_on(s.company_id) then raise exception 'Customer texts aren''t switched on for this company.'; end if;
  if length(coalesce(p->>'sender', '')) > 40 then raise exception 'The message name is 40 characters at most.'; end if;
  if length(coalesce(p->>'office', '')) > 30 or length(coalesce(p->>'meet', '')) > 80 then raise exception 'The office number or meeting point is too long.'; end if;
  if coalesce(p->>'at', '18:00') !~ '^(0[89]|1[0-9]|2[01]):00$' then raise exception 'Send the reminder between 08:00 and 21:00.'; end if;
  if (p->>'on')::boolean is true and coalesce(trim(p->>'office'), '') = '' then
    raise exception 'Add the office number customers call.';
  end if;
  out := jsonb_build_object('on', coalesce((p->>'on')::boolean, false),
    'demo', coalesce((p->>'on')::boolean, false) and coalesce((p->>'demo')::boolean, false), 'sender', trim(coalesce(p->>'sender', '')),
    'office', trim(coalesce(p->>'office', '')), 'meet', trim(coalesce(p->>'meet', '')), 'at', coalesce(p->>'at', '18:00'));
  foreach k in array array['landed', 'sent', 'reminder'] loop
    if length(coalesce(p->k->>'text', '')) > 459 then raise exception 'A text is 459 letters at most (3 texts).'; end if;
    out := out || jsonb_build_object(k, jsonb_build_object('on', coalesce((p->k->>'on')::boolean, true), 'text', trim(coalesce(p->k->>'text', ''))));
  end loop;
  update companies set texts = out where id = s.company_id;
  insert into activity(company_id, staff_id, staff_name, action, value)
  values (s.company_id, s.id, s.name, 'SETTINGS', case when (out->>'on')::boolean then 'Customer texts ' || case when (out->>'demo')::boolean then 'demo (not sent)' else 'on from company SIM' end || ': ' ||
    concat_ws(', ', case when (out->'landed'->>'on')::boolean then 'flight landed' end, case when (out->'sent'->>'on')::boolean then 'car on its way' end,
      case when (out->'reminder'->>'on')::boolean then 'reminder at ' || (out->>'at') end) || ', from ' || (out->>'sender')
    else 'Customer texts off' end);
  return out;
end;
$$;
revoke execute on function set_texts(jsonb) from public, anon;
grant execute on function set_texts(jsonb) to authenticated;

-- Where the database calls send-texts (the same project as send-alerts).
create table if not exists private.text_config (one boolean primary key default true check (one), function_url text);
insert into private.text_config (function_url) values ('https://oioqjfrlwrjovnouhusp.supabase.co/functions/v1/send-texts') on conflict (one) do nothing;

-- The flight landed or a driver was SENT: ask send-texts. Nothing here is trusted
-- by the function but which booking; it re-reads the car and the company's settings.
create or replace function bookings_text()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare url text; r text;
begin
  if new.kind <> 'drops' or new.cleared_at is not null or new.removed_at is not null then return null; end if;
  r := case when new.flight_status = 'landed' and old.flight_status is distinct from 'landed' then 'landed'
            when new.sent_at is not null and old.sent_at is null then 'sent' end;
  if r is null or coalesce(new.phone, '') = '' then return null; end if;
  if not coalesce((select (c.texts->>'on')::boolean and (c.texts->r->>'on')::boolean is not false and private.texts_on(c.id)
                   from companies c where c.id = new.company_id), false) then return null; end if;
  select function_url into url from private.text_config;
  if url is null then return null; end if;
  perform net.http_post(url := url,
    body := jsonb_build_object('type', 'booking', 'id', new.id, 'rule', r),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-timer', (select value from private.settings where name = 'timer_secret')),
    timeout_milliseconds := 10000);
  return null;
exception when others then
  raise warning 'text skipped: %', sqlerrm;   -- a text must never block a tap
  return null;
end;
$$;
create or replace trigger bookings_text after update of flight_status, sent_at on bookings
  for each row execute function bookings_text();

-- The day-before reminders: every 10 minutes send-texts looks for companies whose time has come.
select cron.unschedule('customer-text-reminders') where exists (select 1 from cron.job where jobname = 'customer-text-reminders');
select cron.schedule('customer-text-reminders', '*/10 * * * *', $job$
  select net.http_post(
    url := (select function_url from private.text_config),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-timer', (select value from private.settings where name = 'timer_secret')),
    body := '{"type":"reminders"}'::jsonb,
    timeout_milliseconds := 30000)
$job$);

-- Platform page: the add-on switch. Part 109's admin_save_client with brand.texts
-- kept as true/false the same way as collections.
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
  -- Part 116: the Customer texts add-on, the same way.
  set_tx boolean := coalesce(p->'brand', '{}') ? 'texts';
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
    'texts', case when set_tx then coalesce(b->>'texts', '') = 'true' end));

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
      brand = (case when set_look then brand - 'theme' else brand end) - (case when set_py then 'picks_yard' else '' end) - (case when set_lp then 'lane_planner' else '' end) - (case when set_co then 'collections' else '' end) - (case when set_tx then 'texts' else '' end) || b
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
      ', Customer texts ' || case when (c.brand->>'texts')::boolean then 'on' else 'off' end end
  from me() s;
  return to_jsonb(c);
end;
$$;
revoke execute on function admin_save_client(jsonb) from public, anon;
grant execute on function admin_save_client(jsonb) to authenticated;

commit;
