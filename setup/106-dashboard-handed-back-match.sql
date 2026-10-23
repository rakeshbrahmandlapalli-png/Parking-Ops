-- Parking Ops — database part 106: the dashboard knows a car is handed back when the references are typed differently.
--
-- "Parked now" and "past their return" counted a PICKS car as handed back only when a CLEAR DROPS car had
-- exactly the same reference. On Airport Parking Bay the PICKS reference is often typed by hand
-- ("Apb2381" for "VIP APB-2381", "Cpd 19660209" for "CPD-19-660209"), so cars long gone stayed
-- "past their return" (33 on 23 Oct, 5 real). Now a PICKS car is handed back when a CLEAR DROPS car has
-- the same reference in letters and numbers only (any case), or the same reg (letters and numbers only)
-- cleared at or after the car was taken in (so a repeat customer's earlier trip doesn't count).
-- Upcoming workload's cars on site match PICKS and DROPS cars the same way. Otherwise as part 85.
-- Reads only. Safe to run twice. Needs part 85.

create or replace function owner_dashboard(p_since timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  co uuid := my_company();
  since timestamptz := greatest(coalesce(p_since, now() - interval '7 days'), now() - interval '400 days');
  tz text := coalesce((select time_zone from companies where id = co), 'Europe/London');
  parked jsonb;
  onsite jsonb;
  today0 date := ((now() at time zone coalesce((select time_zone from companies where id = my_company()), 'Europe/London')) - (coalesce((select drops_day_end from companies where id = my_company()), '06:00'))::interval)::date;
  dend time := coalesce((select drops_day_end from companies where id = co), '06:00');
  exitj jsonb;
  tot jsonb;
begin
  if not can('settings') then raise exception 'Only the owner and managers can see the dashboard.'; end if;
  with cl as (
    -- Part 106: the client's DROPS cars handed back, keyed by reference and reg in letters and numbers only.
    select upper(regexp_replace(d.ref, '[^A-Za-z0-9]', '', 'g')) as rk, upper(regexp_replace(d.reg, '[^A-Za-z0-9]', '', 'g')) as gk, d.cleared_at from bookings d
    where d.company_id = co and d.kind = 'drops' and d.removed_at is null and d.cleared_at is not null
  ), p as (
    -- Part 73: no location on PICKS → the yard the office set on its DROPS car.
    select b.return_at, b.reg, b.name, coalesce(nullif(b.yard, ''), (select d.yard from bookings d
        where d.company_id = co and d.kind = 'drops' and d.removed_at is null and d.cleared_at is null and d.yard <> ''
          and (case when b.ref <> '' then d.ref = b.ref else d.reg = b.reg and b.reg <> '' end)
        order by d.return_at nulls last limit 1), '') as yard
    from bookings b
    where b.company_id = co and b.kind = 'picks' and b.intake = 'Collected' and b.removed_at is null
      and b.return_at > now() - interval '14 days'
      and not exists (select 1 from cl where cl.rk <> '' and cl.rk = upper(regexp_replace(b.ref, '[^A-Za-z0-9]', '', 'g')))
      and not exists (select 1 from cl where cl.gk <> '' and cl.gk = upper(regexp_replace(b.reg, '[^A-Za-z0-9]', '', 'g')) and cl.cleared_at >= coalesce(b.intake_at, b.drop_at, '-infinity'))
  )
  select jsonb_build_object('total', (select count(*) from p), 'late', (select count(*) from p where return_at <= now()),
    'late_cars', coalesce((select jsonb_agg(jsonb_build_object('reg', reg, 'name', name, 'return_at', return_at, 'yard', yard) order by return_at) from
      (select * from p where return_at <= now() order by return_at limit 200) l), '[]'),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d) from
      (select (return_at at time zone tz)::date - case when (return_at at time zone tz)::time <= dend then 1 else 0 end as d, count(*) as n from p where return_at > now() group by 1) z), '[]'),
    -- Part 70: the same cars by yard ('' = no yard yet), each split by return day ('late' = past its return).
    'yards', coalesce((select jsonb_agg(jsonb_build_object('yard', y, 'n', n, 'days', days) order by n desc) from
      (select yard as y, count(*) as n,
              (select jsonb_agg(jsonb_build_object('day', d, 'n', m) order by d nulls first) from
                 (select case when q.return_at <= now() then null else (q.return_at at time zone tz)::date - case when (q.return_at at time zone tz)::time <= dend then 1 else 0 end end as d, count(*) as m
                  from p q where q.yard = p0.yard group by 1) dz) as days
       from p p0 group by yard) yz), '[]'))
  into parked;
  -- Part 82: cars on site at the end of each DROPS day (its dend, the next morning), for 14 days from
  -- today's DROPS day, from the app's own cars: every PICKS car not handed back, plus DROPS cars with no
  -- PICKS car yet. A car counts when it arrived by then and isn't back by then. 'in' = arriving that
  -- DROPS day, 'out' = returning. Only bookings the app holds count, so later days read low until
  -- their bookings are imported.
  with cl as (
    -- Part 106: the client's DROPS cars handed back, keyed by reference and reg in letters and numbers only.
    select upper(regexp_replace(d.ref, '[^A-Za-z0-9]', '', 'g')) as rk, upper(regexp_replace(d.reg, '[^A-Za-z0-9]', '', 'g')) as gk, d.cleared_at from bookings d
    where d.company_id = co and d.kind = 'drops' and d.removed_at is null and d.cleared_at is not null
  ), pk as (
    select upper(regexp_replace(b.ref, '[^A-Za-z0-9]', '', 'g')) as rk, upper(regexp_replace(b.reg, '[^A-Za-z0-9]', '', 'g')) as gk, b.drop_at, b.return_at from bookings b
    where b.company_id = co and b.kind = 'picks' and b.removed_at is null and b.return_at is not null
      and not exists (select 1 from cl where cl.rk <> '' and cl.rk = upper(regexp_replace(b.ref, '[^A-Za-z0-9]', '', 'g')))
      and not exists (select 1 from cl where cl.gk <> '' and cl.gk = upper(regexp_replace(b.reg, '[^A-Za-z0-9]', '', 'g')) and cl.cleared_at >= coalesce(b.intake_at, b.drop_at, '-infinity'))
  ), dr as (
    select upper(regexp_replace(d.ref, '[^A-Za-z0-9]', '', 'g')) as rk, upper(regexp_replace(d.reg, '[^A-Za-z0-9]', '', 'g')) as gk, d.drop_at, d.return_at from bookings d
    where d.company_id = co and d.kind = 'drops' and d.removed_at is null and d.cleared_at is null and d.return_at is not null
      and not exists (select 1 from pk where pk.rk <> '' and pk.rk = upper(regexp_replace(d.ref, '[^A-Za-z0-9]', '', 'g')))
      and not exists (select 1 from pk where pk.gk <> '' and pk.gk = upper(regexp_replace(d.reg, '[^A-Za-z0-9]', '', 'g')))
  ), u as (select * from pk union all select * from dr)
  select coalesce(jsonb_agg(jsonb_build_object('day', g.d, 'here', x.here, 'in', x.n_in, 'out', x.n_out) order by g.d), '[]') into onsite
  from generate_series(today0, today0 + 13, interval '1 day') gs(d0), lateral (select gs.d0::date as d) g,
    lateral (select
      count(*) filter (where coalesce(u.drop_at, '-infinity') <= ((g.d + 1) + dend) at time zone tz and u.return_at > ((g.d + 1) + dend) at time zone tz) as here,
      count(*) filter (where u.drop_at > (g.d + dend) at time zone tz and u.drop_at <= ((g.d + 1) + dend) at time zone tz) as n_in,
      count(*) filter (where u.return_at > (g.d + dend) at time zone tz and u.return_at <= ((g.d + 1) + dend) at time zone tz) as n_out
      from u) x;
  -- Part 84: exit fees in the period. Cars handed back count from the first exit fee ever recorded.
  with c as (select exit_fee, exit_free from companies where id = co),
  e as (
    select b.id, b.reg, b.name, b.ref, b.cleared_at, b.exit_method, b.exit_amount, b.exit_at, b.exit_photo, st.name as by_name,
      exists (select 1 from c, unnest(c.exit_free) f where f <> '' and starts_with(upper(regexp_replace(b.ref, '[^A-Za-z0-9]', '', 'g')), f)) as free
    from bookings b left join staff st on st.id = b.exit_by
    where b.company_id = co and b.kind = 'drops' and b.removed_at is null
      and (b.exit_at >= since or b.cleared_at >= since)
  ), f0 as (select min(a.at) as at from activity a where a.company_id = co and a.action = 'EXIT FEE')
  select jsonb_build_object(
    'fee', (select exit_fee from c),
    'paid', count(*) filter (where exit_method <> '' and exit_at >= since),
    'cash', coalesce(sum(exit_amount) filter (where exit_method = 'cash' and exit_at >= since), 0),
    'card', coalesce(sum(exit_amount) filter (where exit_method = 'card' and exit_at >= since), 0),
    'cash_n', count(*) filter (where exit_method = 'cash' and exit_at >= since),
    'card_n', count(*) filter (where exit_method = 'card' and exit_at >= since),
    'no_photo', count(*) filter (where exit_method <> '' and exit_at >= since and exit_photo = ''),
    'exempt', count(*) filter (where free and cleared_at >= since),
    'unpaid', count(*) filter (where not free and exit_method = '' and cleared_at >= since and cleared_at >= (select at from f0)),
    'paid_cars', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'reg', p.reg, 'name', p.name, 'ref', p.ref, 'exit_method', p.exit_method,
        'exit_amount', p.exit_amount, 'exit_at', p.exit_at, 'photo', p.exit_photo <> '', 'by_name', p.by_name) order by p.exit_at desc) from
      (select * from e where exit_method <> '' and exit_at >= since order by exit_at desc limit 300) p), '[]'),
    'cars', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'reg', z.reg, 'name', z.name, 'ref', z.ref, 'cleared_at', z.cleared_at,
        'exit_method', z.exit_method, 'exit_at', z.exit_at, 'by_name', z.by_name) order by coalesce(z.exit_at, z.cleared_at) desc) from
      (select * from e where (exit_method <> '' and exit_at >= since and exit_photo = '')
          or (not free and exit_method = '' and cleared_at >= since and cleared_at >= (select at from f0))
        order by coalesce(exit_at, cleared_at) desc limit 300) z), '[]'))
  into exitj from e;
  -- Part 85: true totals for the period.
  select jsonb_build_object(
    'added', (select count(*) from activity a where a.company_id = co and a.at >= since and (a.action = 'ADDED' or (a.action = 'CALLED' and a.value = 'New Booking'))),
    'added_desk', (select count(*) from activity a where a.company_id = co and a.at >= since and a.action = 'ADDED'),
    'taken_n', (select count(*) from bookings b where b.company_id = co and b.charge_at >= since and b.charge_method <> 'waived'),
    'cash', (select coalesce(sum(b.charge_amount), 0) from bookings b where b.company_id = co and b.charge_at >= since and b.charge_method = 'cash'),
    'card', (select coalesce(sum(b.charge_amount), 0) from bookings b where b.company_id = co and b.charge_at >= since and b.charge_method = 'card'),
    'waived_n', (select count(*) from bookings b where b.company_id = co and b.charge_at >= since and b.charge_method = 'waived'),
    'waived', (select coalesce(sum(b.charge_amount), 0) from bookings b where b.company_id = co and b.charge_at >= since and b.charge_method = 'waived'),
    'removed', (select count(*) from bookings b where b.company_id = co and b.removed_at >= since),
    'no_show', (select count(*) from bookings b where b.company_id = co and b.removed_at >= since and b.removed_reason = 'No show'),
    'cancelled', (select count(*) from bookings b where b.company_id = co and b.removed_at >= since and b.removed_reason = 'Cancelled'),
    'duplicate', (select count(*) from bookings b where b.company_id = co and b.removed_at >= since and b.removed_reason = 'Duplicate'),
    'complaints', (select count(*) from activity a where a.company_id = co and a.at >= since and a.action = 'CLEAR' and a.value = 'COMPLAINT'),
    'owed_n', (select count(*) from bookings b where b.company_id = co and b.kind = 'drops' and b.removed_at is null and b.charge_at is null
        and (b.overstay or b.charge_agreed is not null) and (b.cleared_at is null or b.cleared_at >= since)))
  into tot;
  return jsonb_build_object(
    'exit', exitj,
    'totals', tot,
    'handover', (select jsonb_build_object('note', handover_note, 'at', handover_at, 'by', handover_by) from companies where id = co),
    'parked', parked,
    'onsite', onsite,
    'added', coalesce((select jsonb_agg(x order by x.at desc) from (
        select a.at, a.reg, a.customer, a.staff_name, a.action, a.value, a.booking_id, s.kind, s.day
        from activity a left join sheets s on s.id = a.sheet_id
        where a.company_id = co and a.at >= since
          and (a.action = 'ADDED' or (a.action = 'CALLED' and a.value = 'New Booking'))
        order by a.at desc limit 300) x), '[]'),
    'paid', coalesce((select jsonb_agg(x order by x.charge_at desc) from (
        select b.id, b.reg, b.name, b.charge_amount, b.charge_method, b.charge_at, b.charge_reason, b.charge_agreed, st.name as by_name
        from bookings b left join staff st on st.id = b.charge_by
        where b.company_id = co and b.charge_at >= since
        order by b.charge_at desc limit 300) x), '[]'),
    'owed', coalesce((select jsonb_agg(x order by x.return_at) from (
        select b.id, b.kind, b.reg, b.name, b.return_at, b.orig_return_at, b.cleared_at, b.overstay, b.charge_agreed, b.charge_reason, s.day
        from bookings b left join sheets s on s.id = b.sheet_id
        where b.company_id = co and b.kind = 'drops' and b.removed_at is null and b.charge_at is null
          and (b.overstay or b.charge_agreed is not null)
          and (b.cleared_at is null or b.cleared_at >= since)
        order by b.return_at limit 1000) x), '[]'),
    'removed', coalesce((select jsonb_agg(x order by x.removed_at desc) from (
        select b.id, b.kind, b.reg, b.name, b.removed_reason, b.removed_at, st.name as by_name
        from bookings b left join staff st on st.id = b.removed_by
        where b.company_id = co and b.removed_at >= since
        order by b.removed_at desc limit 300) x), '[]'),
    'complaints', coalesce((select jsonb_agg(x order by x.at desc) from (
        select a.at, a.reg, a.customer, a.staff_name, a.booking_id
        from activity a
        where a.company_id = co and a.at >= since and a.action = 'CLEAR' and a.value = 'COMPLAINT'
        order by a.at desc limit 300) x), '[]'),
    -- One per car; a car whose latest early-return line is 'undone' is not an early return now.
    'early', (select count(*) from (select distinct on (a.booking_id) a.value from activity a
        where a.company_id = co and a.at >= since and a.action = 'EARLY RETURN' and a.booking_id is not null
        order by a.booking_id, a.at desc) l where l.value not like 'undone%'),
    'changed', (select count(*) from activity a where a.company_id = co and a.at >= since and a.action = 'RETURN CHANGED')
  );
end;
$$;
revoke execute on function owner_dashboard(timestamptz) from public, anon;
grant execute on function owner_dashboard(timestamptz) to authenticated;
