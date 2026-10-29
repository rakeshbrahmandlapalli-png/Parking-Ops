-- Rollback for 137-clock-in-access.sql: the live definitions as they were on 29 Oct 2026 before 137.
-- Run in the SQL editor. Everyone sees the board again whatever their clocking.
begin;
create or replace function public.me() returns public.staff language sql stable security definer set search_path to 'public' as $function$
  select s.* from staff s join companies c on c.id = s.company_id
  where s.user_id = auth.uid() and s.active and c.suspended_at is null limit 1
$function$;
create or replace function public.my_company() returns uuid language sql stable security definer set search_path to 'public' as $function$
  select s.company_id from staff s join companies c on c.id = s.company_id
  where s.user_id = auth.uid() and s.active and c.suspended_at is null limit 1
$function$;
create or replace function public.staff_admin_context() returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object('staff_id', s.id, 'company_id', s.company_id, 'role', s.role, 'name', s.name, 'can_staff', can('staff'))
  from staff s join companies c on c.id = s.company_id
  where s.user_id = auth.uid() and s.active and c.suspended_at is null limit 1
$function$;
create or replace function public.ops_push_enqueue(p_staff uuid[], p_key text, p_kind text, p_payload jsonb, p_ttl integer, p_urgency text, p_endpoint text default null::text)
 returns boolean language plpgsql security definer set search_path to '' as $function$
begin
 if coalesce(p_key,'')='' or length(p_key)>500 or p_ttl not between 1 and 7200 or p_urgency not in ('normal','high') or pg_column_size(p_payload)>4000 then raise exception 'Invalid push request.'; end if;
 insert into private.ops_push_outbox(subscription_id,staff_id,company_id,delivery_key,kind,payload,urgency,expires_at)
 select p.id,s.id,s.company_id,p_key,p_kind,p_payload,p_urgency,now()+make_interval(secs=>p_ttl)
 from public.push_subscriptions p join public.staff s on s.id=p.staff_id and s.company_id=p.company_id and s.active
 where s.id=any(p_staff) and (p_endpoint is null or p.endpoint=p_endpoint)
 on conflict(subscription_id,delivery_key) do nothing;
 return true;
end $function$;
create or replace function public.ops_push_claim(p_key text default null::text)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare q private.ops_push_outbox; p public.push_subscriptions; result jsonb:='[]'; token uuid;
begin
 update private.ops_push_outbox o set state='expired',lease_id=null,lease_until=null
 where o.state in ('pending','sending') and (o.expires_at<=now() or o.attempts>=5 and coalesce(o.lease_until,o.due_at)<=now() or not private.ops_push_valid(o));
 for q in select * from private.ops_push_outbox o where (p_key is null or o.delivery_key=p_key) and o.expires_at>now() and o.attempts<5 and
 (o.state='pending' and o.due_at<=now() or o.state='sending' and o.lease_until<=now()) and
 (o.kind in ('test','health','usage') or not exists(select 1 from private.ops_note_options x where x.staff_id=o.staff_id and x.paused_until>now()))
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
drop function if exists public.clock_gate_set(uuid, boolean);
drop function if exists public.clock_gate_status();
drop function if exists private.clock_gate_closed(uuid);
drop table if exists private.clock_gate;
commit;
