-- Part 141: pause the clock-in lock for everyone at a company (user, 30 Oct 2026:
-- "things like lock off ... I should do by myself").
-- One owner switch per client. While it is paused, the lock lets everyone at that
-- company in as if the trial were off; nobody's lock setting is changed, so
-- resuming puts everyone back exactly as they were. Other companies are untouched.
-- A clocked-out owner can still use it (that is the point: clocking in is broken).
-- Needs part 137 and 139 first. Safe to run twice.
begin;

create table if not exists private.clock_gate_pause (
  company_id uuid primary key references public.companies(id) on delete cascade,
  paused boolean not null default false,
  changed_at timestamptz not null default now(),
  changed_by text
);
alter table private.clock_gate_pause enable row level security;
revoke all on private.clock_gate_pause from public, anon, authenticated;

-- 137's rule, plus: a paused company is never closed.
create or replace function private.clock_gate_closed(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.clock_gate g join public.staff s on s.id = g.staff_id and s.company_id = g.company_id
    where g.staff_id = p_staff and g.active
      and not exists (select 1 from private.clock_gate_pause z where z.company_id = s.company_id and z.paused)
      and not exists (select 1 from public.aero_shifts a
                      where a.user_id = s.user_id and a.company_id = s.company_id and a.clock_out_at is null))
$$;
revoke all on function private.clock_gate_closed(uuid) from public, anon, authenticated;

-- Owners and managers read it. Looks the person up directly, not through me(),
-- so it answers even while their own lock is shut.
create or replace function public.clock_gate_pause_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('paused', coalesce(z.paused, false), 'since', z.changed_at, 'by', z.changed_by,
      'locked', (select count(*) from private.clock_gate g where g.company_id = s.company_id and g.active))
    from public.staff s join public.companies c on c.id = s.company_id
    left join private.clock_gate_pause z on z.company_id = s.company_id
    where auth.uid() is not null and s.user_id = auth.uid() and s.active and s.removed_at is null
      and c.suspended_at is null and s.role in ('owner', 'manager')
    limit 1), jsonb_build_object('paused', false, 'locked', 0))
$$;
revoke all on function public.clock_gate_pause_status() from public, anon;
grant execute on function public.clock_gate_pause_status() to authenticated;

-- Owner only, own company only, logged under their own name.
create or replace function public.clock_gate_pause_set(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.staff;
begin
  if auth.uid() is null or p_on is null then raise exception 'Not allowed.'; end if;
  select st.* into s from public.staff st join public.companies c on c.id = st.company_id
   where st.user_id = auth.uid() and st.active and st.removed_at is null and c.suspended_at is null limit 1;
  if s.id is null or s.role <> 'owner' or coalesce(cardinality(s.desk_names), 0) > 0 then raise exception 'Only an owner can do this.'; end if;
  insert into private.clock_gate_pause(company_id, paused, changed_at, changed_by) values (s.company_id, p_on, now(), s.name)
  on conflict (company_id) do update set paused = excluded.paused, changed_at = now(), changed_by = excluded.changed_by;
  insert into public.activity(company_id, staff_id, staff_name, action, value)
  values (s.company_id, s.id, s.name, 'STAFF', case when p_on then 'Clock-in lock paused for everyone' else 'Clock-in lock resumed for everyone' end);
end $$;
revoke all on function public.clock_gate_pause_set(boolean) from public, anon;
grant execute on function public.clock_gate_pause_set(boolean) to authenticated;

commit;
