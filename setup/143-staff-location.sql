-- Part 143: where people are while they are clocked in (user, 1 Nov 2026:
-- "How to add tracking to see were they are when signed in").
-- * Off until a client owner switches it on (Settings -> Attendance). Needs the Attendance add-on.
-- * A phone sends its position only while that person has an open Attendance shift and
--   Parking Ops is open on screen (a web app cannot track in the background).
-- * The person is shown what is shared before the first send (notice_at); the app shows
--   "Sharing your location" on their shift box the whole time.
-- * Only the latest position is kept: one row per person, overwritten. Clocking out (by hand,
--   by a manager or the 14-hour auto close) and switching the setting off blank it.
-- * Owners and managers of the same company read it, and only for people on shift now.
-- No DELETE or DROP statement in this file (the foreign keys say "on delete cascade"). Needs parts 136 and 141. Safe to run twice.
begin;

create table if not exists private.location_share (
  company_id uuid primary key references public.companies(id) on delete cascade,
  on_ boolean not null default false,
  changed_at timestamptz not null default now(),
  changed_by text
);
alter table private.location_share enable row level security;
revoke all on private.location_share from public, anon, authenticated;

create table if not exists private.staff_location (
  staff_id uuid primary key references public.staff(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  lat double precision,
  lng double precision,
  acc_m integer,
  at timestamptz,
  notice_at timestamptz
);
alter table private.staff_location enable row level security;
revoke all on private.staff_location from public, anon, authenticated;

-- Is sharing on for the caller's company, have they seen the notice, are they on shift.
create or replace function public.location_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.staff := public.me(); c public.companies;
begin
  if s.id is null then return jsonb_build_object('on', false); end if;
  select * into c from public.companies where id = s.company_id;
  return jsonb_build_object(
    'on', coalesce((c.brand->>'attendance')::boolean, false)
          and exists (select 1 from private.location_share z where z.company_id = s.company_id and z.on_),
    'by', (select z.changed_by from private.location_share z where z.company_id = s.company_id),
    'since', (select z.changed_at from private.location_share z where z.company_id = s.company_id),
    'shared_login', coalesce(cardinality(s.desk_names), 0) > 0,
    'notice_at', (select l.notice_at from private.staff_location l where l.staff_id = s.id),
    'on_shift', exists (select 1 from public.aero_shifts a where a.user_id = s.user_id and a.company_id = s.company_id and a.clock_out_at is null));
end $$;

-- The person has been shown what is shared. Logged once.
create or replace function public.location_notice_ok() returns void
language plpgsql security definer set search_path = '' as $$
declare s public.staff := public.me();
begin
  if s.id is null then raise exception 'Not allowed.'; end if;
  if exists (select 1 from private.staff_location where staff_id = s.id and notice_at is not null) then return; end if;
  insert into private.staff_location(staff_id, company_id, notice_at) values (s.id, s.company_id, now())
  on conflict (staff_id) do update set notice_at = now(), company_id = excluded.company_id;
  insert into public.activity(company_id, staff_id, staff_name, action, value)
  values (s.company_id, s.id, s.name, 'STAFF', 'Was told their location is shared while on shift');
end $$;

-- The phone's position. Kept only when everything above holds; otherwise ignored (returns false).
create or replace function public.i_am_at(p_lat double precision, p_lng double precision, p_acc double precision default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare s public.staff := public.me();
begin
  if s.id is null or p_lat is null or p_lng is null or not (p_lat between -90 and 90) or not (p_lng between -180 and 180) then return false; end if;
  if coalesce(cardinality(s.desk_names), 0) > 0 then return false; end if;
  if not exists (select 1 from public.companies c join private.location_share z on z.company_id = c.id
                 where c.id = s.company_id and z.on_ and coalesce((c.brand->>'attendance')::boolean, false)) then return false; end if;
  if not exists (select 1 from public.aero_shifts a where a.user_id = s.user_id and a.company_id = s.company_id and a.clock_out_at is null) then return false; end if;
  update private.staff_location set lat = p_lat, lng = p_lng, acc_m = least(greatest(round(coalesce(p_acc, 0)), 0), 100000)::int, at = now()
   where staff_id = s.id and notice_at is not null;
  return found;
end $$;

-- Owners and managers: the latest position of everyone at their company who is on shift now,
-- sent since that shift began.
create or replace function public.staff_locations() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.staff := public.me();
begin
  if s.id is null or s.role not in ('owner', 'manager') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('staff_id', t.id, 'lat', l.lat, 'lng', l.lng, 'acc', l.acc_m, 'at', l.at))
    from private.staff_location l
    join public.staff t on t.id = l.staff_id and t.company_id = s.company_id and t.removed_at is null
    join public.aero_shifts a on a.user_id = t.user_id and a.company_id = t.company_id and a.clock_out_at is null
    where l.company_id = s.company_id and l.lat is not null and l.at >= a.clock_in_at), '[]'::jsonb);
end $$;

-- Owner only, own company, logged. Switching off blanks every position at once.
create or replace function public.location_share_set(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.staff := public.me();
begin
  if s.id is null or p_on is null then raise exception 'Not allowed.'; end if;
  if s.role <> 'owner' or coalesce(cardinality(s.desk_names), 0) > 0 then raise exception 'Only an owner can do this.'; end if;
  insert into private.location_share(company_id, on_, changed_at, changed_by) values (s.company_id, p_on, now(), s.name)
  on conflict (company_id) do update set on_ = excluded.on_, changed_at = now(), changed_by = excluded.changed_by;
  if not p_on then
    update private.staff_location set lat = null, lng = null, acc_m = null, at = null where company_id = s.company_id;
  end if;
  insert into public.activity(company_id, staff_id, staff_name, action, value)
  values (s.company_id, s.id, s.name, 'STAFF', case when p_on then 'Staff location while on shift switched on' else 'Staff location while on shift switched off' end);
end $$;

-- A shift that closes (any way) blanks that person's position.
create or replace function private.location_on_clock_out() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.clock_out_at is not null and old.clock_out_at is null then
    update private.staff_location l set lat = null, lng = null, acc_m = null, at = null
      from public.staff t where t.id = l.staff_id and t.user_id = new.user_id and t.company_id = new.company_id;
  end if;
  return new;
end $$;
revoke all on function private.location_on_clock_out() from public, anon, authenticated;
create or replace trigger aero_shifts_location_off after update of clock_out_at on public.aero_shifts
  for each row execute function private.location_on_clock_out();

revoke all on function public.location_status() from public, anon;
revoke all on function public.location_notice_ok() from public, anon;
revoke all on function public.i_am_at(double precision, double precision, double precision) from public, anon;
revoke all on function public.staff_locations() from public, anon;
revoke all on function public.location_share_set(boolean) from public, anon;
grant execute on function public.location_status() to authenticated;
grant execute on function public.location_notice_ok() to authenticated;
grant execute on function public.i_am_at(double precision, double precision, double precision) to authenticated;
grant execute on function public.staff_locations() to authenticated;
grant execute on function public.location_share_set(boolean) to authenticated;

commit;
