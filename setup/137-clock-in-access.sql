-- Part 137: clock in to see Parking Ops (user, 29 Oct 2026: "once clocked out the staff
-- should not be able to see the customer data too, nothing should be visible").
-- Only people listed in private.clock_gate are affected; everyone else is unchanged.
-- Needs the Attendance parts (aero_shifts) first. Safe to run again.
--
-- How it works: me() and my_company() are what every read rule and RPC asks
-- ("who is this, which company"). For a listed person who has no open
-- Attendance shift they now answer nothing, so every board, booking, phone
-- number and photo link goes dark at once, exactly like a switched-off login.
-- Pushes are dropped at the queue. clock_gate_status() is the one thing such a
-- person can still read: their own name and whether they are clocked in.
begin;

create table if not exists private.clock_gate (
  staff_id uuid primary key references public.staff(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  active boolean not null default true,
  changed_at timestamptz not null default now()
);
alter table private.clock_gate enable row level security;
revoke all on private.clock_gate from public, anon, authenticated;

-- True when this person must be clocked in and is not.
create or replace function private.clock_gate_closed(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.clock_gate g join public.staff s on s.id = g.staff_id and s.company_id = g.company_id
    where g.staff_id = p_staff and g.active
      and not exists (select 1 from public.aero_shifts a
                      where a.user_id = s.user_id and a.company_id = s.company_id and a.clock_out_at is null))
$$;
revoke all on function private.clock_gate_closed(uuid) from public, anon, authenticated;

create or replace function public.me() returns public.staff
language sql stable security definer set search_path = public as $$
  select s.* from staff s join companies c on c.id = s.company_id
  where s.user_id = auth.uid() and s.active and c.suspended_at is null
    and not private.clock_gate_closed(s.id) limit 1
$$;

create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select s.company_id from staff s join companies c on c.id = s.company_id
  where s.user_id = auth.uid() and s.active and c.suspended_at is null
    and not private.clock_gate_closed(s.id) limit 1
$$;

create or replace function public.staff_admin_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('staff_id', s.id, 'company_id', s.company_id, 'role', s.role, 'name', s.name, 'can_staff', can('staff'))
  from staff s join companies c on c.id = s.company_id
  where s.user_id = auth.uid() and s.active and c.suspended_at is null
    and not private.clock_gate_closed(s.id) limit 1
$$;

-- What the app may know about a signed-in person while the gate is shut:
-- their own name and company name, nothing about bookings.
create or replace function public.clock_gate_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'gated', exists (select 1 from private.clock_gate g where g.staff_id = s.id and g.active),
      'closed', private.clock_gate_closed(s.id),
      'name', s.name, 'company', c.name,
      'attendance', coalesce(c.brand->'attendance' = 'true'::jsonb, false))
    from public.staff s join public.companies c on c.id = s.company_id
    where auth.uid() is not null and s.user_id = auth.uid() and s.active and c.suspended_at is null
    limit 1), jsonb_build_object('gated', false, 'closed', false))
$$;
revoke all on function public.clock_gate_status() from public, anon;
grant execute on function public.clock_gate_status() to authenticated;

-- Parking Ops (platform owners) put a person on or off the trial. Never from a
-- client login: a gated owner could otherwise lock or unlock themselves.
create or replace function public.clock_gate_set(p_staff uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.staff;
begin
  if auth.uid() is null or not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_on is null then raise exception 'Choose on or off.'; end if;
  select * into s from public.staff where id = p_staff;
  if s.id is null or not s.active or s.removed_at is not null then raise exception 'Choose an active staff login.'; end if;
  if p_on and coalesce(cardinality(s.desk_names), 0) > 0 then raise exception 'A shared login cannot clock in. Use the person''s own login.'; end if;
  if p_on and not exists (select 1 from public.aero_profiles p where p.id = s.user_id and p.company_id = s.company_id and p.active) then
    raise exception 'Give this person Attendance first, or they could never clock in.'; end if;
  insert into private.clock_gate(staff_id, company_id, active) values (s.id, s.company_id, p_on)
  on conflict (staff_id) do update set active = excluded.active, changed_at = now();
  insert into public.activity(company_id, staff_name, action, value)
  values (s.company_id, coalesce((select name from public.staff where user_id = auth.uid() and active limit 1), 'Parking Ops') || ' (Parking Ops)', 'STAFF',
          case when p_on then 'Clock in to see the board: on for ' else 'Clock in to see the board: off for ' end || s.name);
end $$;
revoke all on function public.clock_gate_set(uuid, boolean) from public, anon;
grant execute on function public.clock_gate_set(uuid, boolean) to authenticated;

-- No push with customer details reaches a phone whose owner is clocked out,
-- including retries queued while they were still on shift.
create or replace function public.ops_push_enqueue(p_staff uuid[], p_key text, p_kind text, p_payload jsonb, p_ttl integer, p_urgency text, p_endpoint text default null::text)
returns boolean language plpgsql security definer set search_path = '' as $function$
begin
 if coalesce(p_key,'')='' or length(p_key)>500 or p_ttl not between 1 and 7200 or p_urgency not in ('normal','high') or pg_column_size(p_payload)>4000 then raise exception 'Invalid push request.'; end if;
 insert into private.ops_push_outbox(subscription_id,staff_id,company_id,delivery_key,kind,payload,urgency,expires_at)
 select p.id,s.id,s.company_id,p_key,p_kind,p_payload,p_urgency,now()+make_interval(secs=>p_ttl)
 from public.push_subscriptions p join public.staff s on s.id=p.staff_id and s.company_id=p.company_id and s.active
 where s.id=any(p_staff) and (p_endpoint is null or p.endpoint=p_endpoint) and not private.clock_gate_closed(s.id)
 on conflict(subscription_id,delivery_key) do nothing;
 return true;
end $function$;

create or replace function public.ops_push_claim(p_key text default null::text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare q private.ops_push_outbox; p public.push_subscriptions; result jsonb:='[]'; token uuid;
begin
 update private.ops_push_outbox o set state='expired',lease_id=null,lease_until=null
 where o.state in ('pending','sending') and (o.expires_at<=now() or o.attempts>=5 and coalesce(o.lease_until,o.due_at)<=now() or not private.ops_push_valid(o) or private.clock_gate_closed(o.staff_id));
 for q in select * from private.ops_push_outbox o where (p_key is null or o.delivery_key=p_key) and o.expires_at>now() and o.attempts<5 and
  (o.state='pending' and o.due_at<=now() or o.state='sending' and o.lease_until<=now()) and
  (o.kind in ('test','health','usage') or not exists(select 1 from private.ops_note_options x where x.staff_id=o.staff_id and x.paused_until>now()))
  and not private.clock_gate_closed(o.staff_id)
  order by o.due_at,o.id limit 100 for update skip locked loop
  token:=gen_random_uuid();
  update private.ops_push_outbox set state='sending',attempts=attempts+1,lease_id=token,lease_until=now()+interval '3 minutes' where id=q.id;
  select * into p from public.push_subscriptions where id=q.subscription_id;
  result:=result||jsonb_build_array(jsonb_build_object('id',q.id,'lease',token,'subscription_id',p.id,'company_id',q.company_id,
  'endpoint',p.endpoint,'p256dh',p.p256dh,'auth',p.auth,'payload',q.payload||jsonb_build_object('silent',q.urgency='normal' and coalesce((select x.routine_silent from private.ops_note_options x where x.staff_id=q.staff_id),false)),'urgency',q.urgency,
  'ttl',greatest(1,floor(extract(epoch from q.expires_at-now()))::integer)));
 end loop;
 return result;
end $function$;

commit;
