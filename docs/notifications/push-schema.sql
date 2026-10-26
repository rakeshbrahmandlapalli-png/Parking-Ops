-- Apply after schema.sql, in the same reviewed migration if preferred.
begin;
create table if not exists private.ops_push_outbox (
 id uuid primary key default gen_random_uuid(), subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 staff_id uuid not null references public.staff(id) on delete cascade, company_id uuid not null references public.companies(id) on delete cascade,
 delivery_key text not null, kind text not null, payload jsonb not null,
 urgency text not null check(urgency in ('normal','high')), expires_at timestamptz not null,
 state text not null default 'pending' check(state in ('pending','sending','accepted','failed','expired')),
 attempts integer not null default 0, due_at timestamptz not null default now(),
 lease_id uuid, lease_until timestamptz, last_code integer, accepted_at timestamptz,
 created_at timestamptz not null default now(), unique(subscription_id,delivery_key)
);
create index if not exists ops_push_due on private.ops_push_outbox(due_at) where state in ('pending','sending');
create index if not exists ops_push_staff_recent on private.ops_push_outbox(staff_id,created_at desc);
alter table private.ops_push_outbox enable row level security;
revoke all on private.ops_push_outbox from public,anon,authenticated;

-- Re-check ownership and access on EVERY retry, especially shared phones.
create or replace function private.ops_push_valid(q private.ops_push_outbox) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.staff s join public.push_subscriptions p on p.id=q.subscription_id
 left join public.alert_prefs a on a.staff_id=s.id
 where s.id=q.staff_id and s.active and s.company_id=q.company_id and p.staff_id=s.id and p.company_id=s.company_id and
 case q.kind when 'drops' then coalesce(a.drops,true) when 'picks' then coalesce(a.picks,true) when 'flights' then coalesce(a.flights,true)
 when 'calls' then coalesce(a.calls,true) and private.ops_staff_can(s,'callpop') and exists(select 1 from public.companies c where c.id=s.company_id and c.brand->>'calls'='true')
 when 'escalation' then s.role in ('owner','manager') and private.ops_staff_can(s,'called')
 when 'import' then s.role in ('owner','manager','office')
 when 'usage' then s.role in ('owner','manager')
 when 'keys' then private.ops_staff_can(s,'yard') when 'lanes' then private.ops_staff_can(s,'yard') else true end)
 and not exists(select 1 from private.ops_notifications n where n.company_id=q.company_id and n.event_key=q.payload->>'eventKey' and private.ops_note_resolved(n))
 and (q.kind<>'calls' or exists(select 1 from public.customer_calls k where k.company_id=q.company_id and 'call:'||k.id=q.payload->>'eventKey' and k.status='ringing' and k.handled_by is null))
$$;

create or replace function public.ops_push_enqueue(p_staff uuid[],p_key text,p_kind text,p_payload jsonb,p_ttl integer,p_urgency text,p_endpoint text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if coalesce(p_key,'')='' or length(p_key)>500 or p_ttl not between 1 and 7200 or p_urgency not in ('normal','high') or pg_column_size(p_payload)>4000 then raise exception 'Invalid push request.'; end if;
 insert into private.ops_push_outbox(subscription_id,staff_id,company_id,delivery_key,kind,payload,urgency,expires_at)
 select p.id,s.id,s.company_id,p_key,p_kind,p_payload,p_urgency,now()+make_interval(secs=>p_ttl)
 from public.push_subscriptions p join public.staff s on s.id=p.staff_id and s.company_id=p.company_id and s.active
 where s.id=any(p_staff) and (p_endpoint is null or p.endpoint=p_endpoint)
 on conflict(subscription_id,delivery_key) do nothing;
 return true;
end $$;

create or replace function public.ops_push_claim(p_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
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
end $$;

create or replace function public.ops_push_result(p_id uuid,p_lease uuid,p_success boolean,p_code integer default null) returns void
language plpgsql security definer set search_path='' as $$
declare q private.ops_push_outbox;
begin
 select * into q from private.ops_push_outbox where id=p_id and lease_id=p_lease and state='sending' for update;
 if q.id is null then return; end if;
 if p_success then
  update private.ops_push_outbox set state='accepted',accepted_at=now(),lease_id=null,lease_until=null,last_code=null where id=q.id;
 elsif p_code in (404,410) then
  -- FK cascade also removes queued messages to an expired subscription.
  delete from public.push_subscriptions where id=q.subscription_id;
 else
  update private.ops_push_outbox set state=case when q.attempts>=5 or (p_code between 400 and 499 and p_code not in (408,429)) then 'failed' else 'pending' end,
   due_at=now()+make_interval(secs=>least(1800,60*power(2,q.attempts-1)::integer)),lease_id=null,lease_until=null,last_code=p_code where id=q.id;
 end if;
end $$;

create or replace function public.ops_push_device_status(p_endpoint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.staff:=public.me(); p public.push_subscriptions;
begin
 if s.id is null then raise exception 'Sign in again.'; end if;
 select * into p from public.push_subscriptions where staff_id=s.id and company_id=s.company_id and endpoint=p_endpoint;
 if p.id is null then return jsonb_build_object('registered',false); end if;
 return jsonb_build_object('registered',true,'queued',(select count(*) from private.ops_push_outbox o where o.subscription_id=p.id and o.state in ('pending','sending') and o.expires_at>now()),
 'failed_24h',(select count(*) from private.ops_push_outbox o where o.subscription_id=p.id and o.state='failed' and o.created_at>now()-interval '24 hours'),
 'last_accepted',(select max(accepted_at) from private.ops_push_outbox where subscription_id=p.id));
end $$;

create or replace function public.ops_notification_trim() returns void
language sql security definer set search_path='' as $$
 delete from private.ops_notifications where created_at<now()-interval '30 days';
 delete from private.ops_push_outbox where created_at<now()-interval '7 days'
$$;
revoke all on function private.ops_push_valid(private.ops_push_outbox) from public,anon,authenticated;
revoke all on function public.ops_push_enqueue(uuid[],text,text,jsonb,integer,text,text),public.ops_push_claim(text),public.ops_push_result(uuid,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.ops_push_enqueue(uuid[],text,text,jsonb,integer,text,text),public.ops_push_claim(text),public.ops_push_result(uuid,uuid,boolean,integer) to service_role;
revoke all on function public.ops_push_device_status(text) from public,anon;
grant execute on function public.ops_push_device_status(text) to authenticated;
commit;
