-- Part 93: shared, shift-scoped key checks. Apply before deploying the frontend.
-- No phone-local ticks are imported: every shared confirmation is a physical check.
begin;

create table if not exists key_check_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  sheet_id uuid not null references sheets(id) on delete cascade,
  status text not null default 'active' check (status in ('active','completed','superseded')),
  started_at timestamptz not null default clock_timestamp(),
  started_by uuid references staff(id) on delete set null,
  started_by_name text not null,
  finished_at timestamptz,
  finished_by uuid references staff(id) on delete set null,
  finished_by_name text,
  expected_count integer,
  found_count integer,
  unique (id, company_id, sheet_id)
);
create unique index if not exists key_check_one_active on key_check_sessions(sheet_id) where status = 'active';
create index if not exists key_check_sessions_company_sheet on key_check_sessions(company_id, sheet_id, started_at desc);

create table if not exists key_check_entries (
  session_id uuid not null,
  company_id uuid not null,
  sheet_id uuid not null,
  booking_id uuid not null references bookings(id) on delete cascade,
  state text not null default 'unchecked' check (state in ('unchecked','found','missing')),
  revision integer not null default 0,
  checked_at timestamptz,
  checked_by uuid references staff(id) on delete set null,
  checked_by_name text,
  primary key (session_id, booking_id),
  foreign key (session_id, company_id, sheet_id) references key_check_sessions(id, company_id, sheet_id) on delete cascade
);
create index if not exists key_check_entries_company_sheet on key_check_entries(company_id, sheet_id);

-- A returned-to-yard key must be checked again, even if it was found before SENT.
-- Keep completed checks immutable; normal booking history records the movement.
create or replace function key_check_invalidate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.sent_at is distinct from new.sent_at or old.cleared_at is distinct from new.cleared_at
    or old.sheet_id is distinct from new.sheet_id or old.removed_at is distinct from new.removed_at
    or old.reg is distinct from new.reg then
    update key_check_entries e set state='unchecked', revision=revision+1, checked_at=null, checked_by=null, checked_by_name=null
      from key_check_sessions k where e.session_id=k.id and k.status='active' and e.booking_id=old.id and e.company_id=old.company_id;
  end if;
  return new;
end $$;
revoke all on function key_check_invalidate() from public, anon, authenticated;
create or replace trigger key_check_booking_moved after update of sent_at,cleared_at,sheet_id,removed_at,reg on bookings
  for each row execute function key_check_invalidate();

alter table key_check_sessions enable row level security;
alter table key_check_entries enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='key_check_sessions' and policyname='company_read') then
    create policy company_read on key_check_sessions for select to authenticated using (company_id = (select my_company()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='key_check_entries' and policyname='company_read') then
    create policy company_read on key_check_entries for select to authenticated using (company_id = (select my_company()));
  end if;
end $$;
revoke all on key_check_sessions, key_check_entries from anon, authenticated;
grant select on key_check_sessions, key_check_entries to authenticated;

create or replace function key_check_get(p_sheet uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s staff := me(); k key_check_sessions;
begin
  if auth.uid() is null or s.id is null or not exists (select 1 from sheets where id=p_sheet and company_id=s.company_id and kind='drops') then
    raise exception 'That shift is not on your board.';
  end if;
  select * into k from key_check_sessions where sheet_id=p_sheet and company_id=s.company_id order by started_at desc, id desc limit 1;
  return jsonb_build_object('session', case when k.id is null then null else to_jsonb(k) end,
    'entries', coalesce((select jsonb_agg(to_jsonb(e)) from key_check_entries e where session_id=k.id and company_id=s.company_id), '[]'::jsonb));
end $$;

create or replace function key_check_start(p_sheet uuid, p_restart boolean default false, p_previous uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s staff := me(); sh sheets; k key_check_sessions; n integer; f integer;
begin
  if auth.uid() is null or s.id is null or s.role='view' or not can('keycheck') then raise exception 'You cannot check keys.'; end if;
  -- All session lifecycle operations lock the sheet first, so concurrent starts join one check.
  select * into sh from sheets where id=p_sheet and company_id=s.company_id and kind='drops' for update;
  if sh.id is null or sh.archived_at is not null then raise exception 'Choose an open DROPS shift.'; end if;
  select * into k from key_check_sessions where sheet_id=p_sheet order by started_at desc, id desc limit 1 for update;
  if p_restart then
    if k.id is distinct from p_previous then raise exception 'The key check changed. Refresh and try again.'; end if;
    if k.status='active' then
      select count(*), count(*) filter (where e.state='found') into n,f
      from bookings b left join key_check_entries e on e.booking_id=b.id and e.session_id=k.id
      where b.sheet_id=p_sheet and b.company_id=s.company_id and b.kind='drops' and b.removed_at is null and b.cleared_at is null and b.sent_at is null;
      update key_check_sessions set status='superseded', finished_at=clock_timestamp(), finished_by=s.id, finished_by_name=s.name, expected_count=n, found_count=f where id=k.id;
    end if;
  elsif k.id is not null then
    -- Completed checks require an explicit new check; a stale second phone cannot silently reset one.
    return key_check_get(p_sheet);
  end if;
  insert into key_check_sessions(company_id,sheet_id,started_by,started_by_name)
    values(s.company_id,p_sheet,s.id,s.name) returning * into k;
  insert into key_check_entries(session_id,company_id,sheet_id,booking_id)
    select k.id,s.company_id,p_sheet,id from bookings where sheet_id=p_sheet and company_id=s.company_id and kind='drops' and removed_at is null and cleared_at is null and sent_at is null;
  insert into activity(company_id,staff_id,staff_name,sheet_id,action,value)
    values(s.company_id,s.id,s.name,p_sheet,'KEY CHECK START',k.id::text);
  return key_check_get(p_sheet);
end $$;

create or replace function key_check_set(p_session uuid, p_booking uuid, p_state text, p_revision integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s staff := me(); k key_check_sessions; b bookings; e key_check_entries; sid uuid;
begin
  if auth.uid() is null or s.id is null or s.role='view' or not can('keycheck') then raise exception 'You cannot check keys.'; end if;
  if p_state is null or p_state not in ('unchecked','found','missing') then raise exception 'Choose a valid key status.'; end if;
  select sheet_id into sid from key_check_sessions where id=p_session and company_id=s.company_id;
  if sid is null then raise exception 'That check is not on your board.'; end if;
  perform 1 from sheets where id=sid and company_id=s.company_id and archived_at is null for update;
  if not found then raise exception 'Choose an open DROPS shift.'; end if;
  select * into k from key_check_sessions where id=p_session and company_id=s.company_id for update;
  if k.status <> 'active' then raise exception 'This check has ended. Refresh to see the current check.'; end if;
  select * into b from bookings where id=p_booking and sheet_id=k.sheet_id and company_id=s.company_id and kind='drops' and removed_at is null and cleared_at is null for update;
  if b.id is null then raise exception 'That car is no longer on this shift.'; end if;
  if b.sent_at is not null then raise exception 'That key is with a driver. Refresh the board.'; end if;
  -- A booking imported during an active check starts unchecked, never confirmed by default.
  insert into key_check_entries(session_id,company_id,sheet_id,booking_id) values(k.id,s.company_id,k.sheet_id,b.id) on conflict do nothing;
  select * into e from key_check_entries where session_id=k.id and booking_id=b.id for update;
  -- Compare before treating a repeat as idempotent: a stale phone must not undo a teammate's change.
  if e.revision is distinct from p_revision then raise exception 'Someone updated this key. Refresh and check its current status.'; end if;
  if e.state = p_state then return to_jsonb(e); end if;
  update key_check_entries set state=p_state, revision=revision+1, checked_at=clock_timestamp(), checked_by=s.id, checked_by_name=s.name
    where session_id=k.id and booking_id=b.id returning * into e;
  perform log_activity(b,'KEY CHECK',p_state || ' · ' || k.id::text);
  return to_jsonb(e);
end $$;

create or replace function key_check_finish(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s staff := me(); k key_check_sessions; sid uuid; n integer; f integer;
begin
  if auth.uid() is null or s.id is null or s.role='view' or not can('keycheck') then raise exception 'You cannot check keys.'; end if;
  select sheet_id into sid from key_check_sessions where id=p_session and company_id=s.company_id;
  if sid is null then raise exception 'That check is not on your board.'; end if;
  perform 1 from sheets where id=sid and company_id=s.company_id and archived_at is null for update;
  if not found then raise exception 'Choose an open DROPS shift.'; end if;
  select * into k from key_check_sessions where id=p_session and company_id=s.company_id for update;
  if k.status='completed' then return to_jsonb(k); end if;
  if k.status <> 'active' then raise exception 'This check has ended. Refresh to see the current check.'; end if;
  -- A simultaneous SENT/CLEAR cannot change the counted set halfway through completion.
  perform 1 from bookings where sheet_id=sid and company_id=s.company_id order by id for update;
  select count(*), count(*) filter (where e.state='found') into n,f
    from bookings b left join key_check_entries e on e.booking_id=b.id and e.session_id=k.id
    where b.sheet_id=sid and b.company_id=s.company_id and b.kind='drops' and b.removed_at is null and b.cleared_at is null and b.sent_at is null;
  if n=0 then raise exception 'No keys to check on this shift.'; end if;
  if n<>f then raise exception '% keys still need attention.', n-f; end if;
  update key_check_sessions set status='completed', finished_at=clock_timestamp(), finished_by=s.id, finished_by_name=s.name, expected_count=n, found_count=f where id=k.id returning * into k;
  insert into activity(company_id,staff_id,staff_name,sheet_id,action,value)
    values(s.company_id,s.id,s.name,sid,'KEY CHECK FINISH',n::text || ' keys · ' || k.id::text);
  return to_jsonb(k);
end $$;

revoke all on function key_check_get(uuid), key_check_start(uuid,boolean,uuid), key_check_set(uuid,uuid,text,integer), key_check_finish(uuid) from public, anon;
grant execute on function key_check_get(uuid), key_check_start(uuid,boolean,uuid), key_check_set(uuid,uuid,text,integer), key_check_finish(uuid) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='key_check_sessions') then
      alter publication supabase_realtime add table key_check_sessions;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='key_check_entries') then
      alter publication supabase_realtime add table key_check_entries;
    end if;
  end if;
end $$;
commit;
