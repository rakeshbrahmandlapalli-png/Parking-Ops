-- Parking Ops — database part 86: read-only Swift booking sync (manual, preview first).
--
-- WRITTEN and APPLIED by Claude on 14 Oct, at the owner's request.
-- Safe to run twice.
--
-- Part 61 made private.auto_import without a `config` column and without
-- auto_import_row(); the live database has both (added by hand, no setup file).
-- This part records them, so a rebuilt database matches the live one, and adds:
--   * a real sync lock per company (swift_lock / swift_unlock; a lock expires on its own)
--   * a pause after a failed sign-in (no repeated login attempts)
--   * swift_reviews: cancellations and conflicting amendments for the office
--   * swift_existing(): read-only view of what the app already holds, for the preview
--   * swift_apply(): ALL days of one sync in ONE transaction (all or nothing), through
--     the same import_sheet_system -> import_sheet used today, so the activity log and
--     Undo (one per sheet, 24 h) behave as before
--   * auto_import_status(): no longer returns the config row, only what the screen needs
-- Nothing here switches the schedule on: auto_import.enabled is left as it is and the
-- edge function ignores the timer.

alter table private.auto_import add column if not exists config jsonb;
alter table private.auto_import add column if not exists lock_token uuid;
alter table private.auto_import add column if not exists lock_until timestamptz;
alter table private.auto_import add column if not exists blocked_until timestamptz;

create or replace function auto_import_row(p_company uuid) returns jsonb
language sql security definer set search_path = public as $$
  select to_jsonb(a) from private.auto_import a where a.company_id = p_company
$$;
revoke all on function auto_import_row(uuid) from public, anon, authenticated;
grant execute on function auto_import_row(uuid) to service_role;

-- One run at a time per company. Returns the token, or raises when a run is
-- under way or sign-in is paused. The lock lapses after p_seconds if a run dies.
create or replace function swift_lock(p_company uuid, p_seconds int default 300) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; b timestamptz;
begin
  insert into private.auto_import(company_id) values (p_company) on conflict do nothing;
  select blocked_until into b from private.auto_import where company_id = p_company;
  if b is not null and b > now() then
    raise exception 'Sync is paused after a failed sign-in until %. Check the saved login first.', to_char(b at time zone 'Europe/London', 'HH24:MI');
  end if;
  update private.auto_import set lock_token = gen_random_uuid(), lock_until = now() + make_interval(secs => p_seconds)
   where company_id = p_company and (lock_until is null or lock_until < now())
  returning lock_token into t;
  if t is null then raise exception 'A sync is already running for this company.'; end if;
  return t;
end $$;
revoke all on function swift_lock(uuid,int) from public, anon, authenticated;
grant execute on function swift_lock(uuid,int) to service_role;

create or replace function swift_unlock(p_company uuid, p_token uuid, p_block_minutes int default 0) returns void
language plpgsql security definer set search_path = public as $$
begin
  update private.auto_import set lock_token = null, lock_until = null,
         blocked_until = case when p_block_minutes > 0 then now() + make_interval(mins => p_block_minutes) else blocked_until end
   where company_id = p_company and lock_token = p_token;
end $$;
revoke all on function swift_unlock(uuid,uuid,int) from public, anon, authenticated;
grant execute on function swift_unlock(uuid,uuid,int) to service_role;

-- Cancellations and conflicting amendments, waiting for the office.
create table if not exists private.swift_reviews (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  provider text not null default 'swift',
  ref text not null,
  kind text not null check (kind in ('cancelled','conflict')),
  detail jsonb not null default '{}',
  status text not null default 'open' check (status in ('open','resolved')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz, resolved_by text,
  unique (company_id, provider, ref, kind)
);

create or replace function swift_review_upsert(p_company uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare i jsonb; n int := 0;
begin
  for i in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    insert into private.swift_reviews(company_id, ref, kind, detail)
    values (p_company, i->>'ref', i->>'kind', coalesce(i->'detail', '{}'))
    on conflict (company_id, provider, ref, kind) do update set
      last_seen = now(),
      status = case when private.swift_reviews.status = 'resolved' and private.swift_reviews.detail is distinct from excluded.detail then 'open' else private.swift_reviews.status end,
      detail = excluded.detail;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function swift_review_upsert(uuid,jsonb) from public, anon, authenticated;
grant execute on function swift_review_upsert(uuid,jsonb) to service_role;

create or replace function swift_reviews_open() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s staff := me();
begin
  if not can('import') then raise exception 'Not allowed for your role: import'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'ref', ref, 'kind', kind, 'detail', detail, 'last_seen', last_seen) order by id)
                     from private.swift_reviews where company_id = s.company_id and status = 'open'), '[]');
end $$;
revoke all on function swift_reviews_open() from public, anon;
grant execute on function swift_reviews_open() to authenticated;

create or replace function swift_review_resolve(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s staff := me();
begin
  if not can('import') then raise exception 'Not allowed for your role: import'; end if;
  update private.swift_reviews set status = 'resolved', resolved_at = now(), resolved_by = s.name
   where id = p_id and company_id = s.company_id;
end $$;
revoke all on function swift_review_resolve(bigint) from public, anon;
grant execute on function swift_review_resolve(bigint) to authenticated;

-- What the app already holds for these references (read only; the preview compares
-- against it). Times come back as London local text, the same shape the import sends.
create or replace function swift_existing(p_company uuid, p_refs text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', b.kind, 'ref', b.ref, 'reg', b.reg, 'name', b.name, 'phone', b.phone, 'make', b.make,
    'drop_local', coalesce(to_char(b.drop_at at time zone c.time_zone, 'YYYY-MM-DD HH24:MI'), ''),
    'return_local', coalesce(to_char(b.return_at at time zone c.time_zone, 'YYYY-MM-DD HH24:MI'), ''),
    'flight', b.flight, 'note', b.note, 'sheet_day', s.day,
    'flight_typed', exists (select 1 from activity a where a.booking_id = b.id and a.action = 'FLIGHT'),
    'sent', b.sent_at is not null, 'cleared', b.cleared_at is not null,
    'removed', b.removed_at is not null, 'early', coalesce(b.early, false))), '[]')
  from bookings b join sheets s on s.id = b.sheet_id join companies c on c.id = b.company_id
  where b.company_id = p_company and b.ref = any(p_refs)
$$;
revoke all on function swift_existing(uuid,text[]) from public, anon, authenticated;
grant execute on function swift_existing(uuid,text[]) to service_role;

-- Every day of one sync in ONE transaction: if any day fails, none is kept.
create or replace function swift_apply(p_company uuid, p_batches jsonb, p_source jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare b jsonb; res jsonb; out jsonb := '[]';
begin
  if jsonb_typeof(p_batches) <> 'array' then raise exception 'Nothing to import.'; end if;
  for b in select * from jsonb_array_elements(p_batches) loop
    res := import_sheet_system(p_company, b->>'kind', (b->>'day')::date, b->'rows', coalesce(p_source, '{}') || jsonb_build_object('bookings', jsonb_array_length(b->'rows')));
    out := out || jsonb_build_array(jsonb_build_object('kind', b->>'kind', 'day', b->>'day') || (res - 'added_ids'));
  end loop;
  return out;
end $$;
revoke all on function swift_apply(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function swift_apply(uuid,jsonb,jsonb) to service_role;

-- The screen's view of the connection (no config, no secrets).
create or replace function auto_import_status() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'available', coalesce(a.config->>'base', '') <> '' and coalesce((a.config->>'manual_enabled')::boolean, false),
      'running', a.lock_until is not null and a.lock_until > now(),
      'blocked_until', case when a.blocked_until > now() then a.blocked_until end,
      'last_run', a.last_run, 'last_ok', a.last_ok, 'last_error', a.last_error, 'last_summary', a.last_summary,
      'open_reviews', (select count(*) from private.swift_reviews r where r.company_id = a.company_id and r.status = 'open'))
    from private.auto_import a where a.company_id = (select company_id from me())),
    '{"available":false}'::jsonb)
$$;
revoke all on function auto_import_status() from public, anon;
grant execute on function auto_import_status() to authenticated;

-- Check
select 'ready' as part86,
  (select count(*) from pg_proc where proname in ('swift_lock','swift_unlock','swift_review_upsert','swift_reviews_open','swift_review_resolve','swift_existing','swift_apply','auto_import_row')) as functions;
