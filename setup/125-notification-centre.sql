-- Part 125: notification centre and push queue (from the 26 Oct handoff).
-- Exactly docs/notifications/schema.sql then push-schema.sql. Applied 26 Oct as migrations
-- notification_centre_125a_tables, 125b_inbox, 125c_push_queue (all but ops_push_result and
-- ops_notification_trim); those two contain DELETE and are in 125d-notification-result-trim.sql for the SQL editor.
-- Notification centre candidate. Apply after existing parts 93, 104, 123.
-- Claude: inspect hosted schema, create the next migration with the CLI, then
-- copy this SQL into it. This file is deliberately not an applied migration.
begin;
create table if not exists private.ops_notifications (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 event_key text not null, kind text not null, title text not null, body text not null,
 booking_id uuid references public.bookings(id) on delete cascade,
 urgency text not null default 'routine' check(urgency in ('routine','urgent')),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
 claimed_by uuid references public.staff(id) on delete set null, claimed_at timestamptz,
 resolved_at timestamptz, escalated_at timestamptz,
 unique(company_id,event_key)
);
create table if not exists private.ops_note_receipts (
 notification_id uuid not null references private.ops_notifications(id) on delete cascade,
 staff_id uuid not null references public.staff(id) on delete cascade, read_at timestamptz,
 primary key(notification_id,staff_id)
);
create table if not exists private.ops_note_activity (
 id bigint generated always as identity primary key,
 notification_id uuid not null references private.ops_notifications(id) on delete cascade,
 at timestamptz not null default now(), action text not null, staff_name text not null default ''
);
create table if not exists private.ops_note_options (
 staff_id uuid primary key references public.staff(id) on delete cascade,
 paused_until timestamptz, routine_silent boolean not null default false
);
create index if not exists ops_notes_company_recent on private.ops_notifications(company_id,created_at desc);
create index if not exists ops_notes_created on private.ops_notifications(created_at);
create index if not exists ops_note_receipts_staff on private.ops_note_receipts(staff_id,notification_id);
alter table private.ops_notifications enable row level security;
alter table private.ops_note_receipts enable row level security;
alter table private.ops_note_activity enable row level security;
alter table private.ops_note_options enable row level security;
revoke all on private.ops_notifications,private.ops_note_receipts,private.ops_note_activity,private.ops_note_options from public,anon,authenticated;

-- Limited to the permissions needed here; preserve deny-before-grant semantics.
create or replace function private.ops_staff_can(s public.staff,a text) returns boolean
language sql stable set search_path='' as $$
 select coalesce(s.active,false) and not ('-'||a=any(s.extra)) and
 (a=any(s.extra) or s.role='owner' or case a
 when 'sent' then s.role in ('office','manager','bongo')
 when 'rtc' then s.role in ('office','manager','bongo')
 when 'called' then s.role in ('office','manager')
 when 'yard' then s.role in ('office','manager')
 when 'callpop' then s.role in ('office','manager') else false end)
$$;
create or replace function private.ops_note_visible(n private.ops_notifications,s public.staff) returns boolean
language sql stable set search_path='' as $$
 select s.id is not null and s.active and n.company_id=s.company_id and
 exists(select 1 from private.ops_note_receipts r where r.notification_id=n.id and r.staff_id=s.id) and
 case when n.kind='calls' then private.ops_staff_can(s,'callpop') and coalesce((select (c.brand->>'calls')::boolean from public.companies c where c.id=s.company_id),false)
 when n.kind in ('keys','lanes') then private.ops_staff_can(s,'yard')
 when n.kind in ('import','usage') then s.role in ('owner','manager','office')
 else true end
$$;

-- Called only by the existing send-alerts service. No browser can invent alerts.
create or replace function public.record_ops_notification(p_staff uuid[],p_key text,p_kind text,p_title text,p_body text,p_booking uuid default null,p_urgency text default 'routine')
returns void language plpgsql security definer set search_path='' as $$
declare c uuid; nid uuid; bid uuid;
begin
 if length(p_key)>500 or coalesce(p_key,'')='' or p_kind not in ('drops','picks','flights','calls','import','usage','health','keys','lanes','escalation','complaint') then raise exception 'Invalid notification.'; end if;
 for c in select distinct s.company_id from public.staff s where s.id=any(p_staff) and s.active loop
  bid:=null;
  if p_booking is not null then
   select b.id into bid from public.bookings b where b.id=p_booking and b.company_id=c;
   if bid is null then continue; end if;
  end if;
  insert into private.ops_notifications(company_id,event_key,kind,title,body,booking_id,urgency)
  values(c,p_key,p_kind,left(p_title,240),left(p_body,1000),bid,p_urgency)
  on conflict(company_id,event_key) do update set title=excluded.title,body=excluded.body,urgency=excluded.urgency returning id into nid;
  insert into private.ops_note_receipts(notification_id,staff_id)
  select nid,s.id from public.staff s where s.id=any(p_staff) and s.active and s.company_id=c on conflict do nothing;
 end loop;
end $$;

-- Resolve using current operational truth, never a client-side optimistic tick.
create or replace function private.ops_note_resolved(n private.ops_notifications) returns boolean
language sql stable set search_path='' as $$
 select n.resolved_at is not null or n.expires_at<=now() or
 case when n.booking_id is null then false else not exists (
 select 1 from public.bookings b where b.id=n.booking_id and b.company_id=n.company_id and b.removed_at is null and
 case
 when n.kind in ('drops','escalation') then b.sent_at is null and b.cleared_at is null and b.called_at is not null and b.called_at<=n.created_at+interval '5 seconds'
 when n.kind='picks' then b.intake='RTC'
 when n.kind='flights' then b.flight_status='cancelled' and b.cleared_at is null
 when n.kind='keys' then b.sent_at is null and b.cleared_at is null and exists(select 1 from public.key_check_entries e join public.key_check_sessions k on k.id=e.session_id where e.booking_id=b.id and k.status='active' and e.state='missing')
 when n.kind='lanes' then b.sent_at is null and b.cleared_at is null and exists(
 select 1 from public.parking_positions p join public.parking_lanes l on l.id=p.lane_id
 join public.bookings x on private.lane_same_stay(x,b)
 where p.booking_id=x.id and l.kind='lane' and
 exists(select 1 from public.parking_positions q where q.lane_id=l.id and q.position<p.position) and
 (l.access='front' or exists(select 1 from public.parking_positions q where q.lane_id=l.id and q.position>p.position)))
 else true end) end
$$;

create or replace function public.ops_notification_feed() returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.staff:=public.me(); result jsonb;
begin
 if s.id is null then raise exception 'Sign in again.'; end if;
 select coalesce(jsonb_agg(x.obj order by x.created_at desc),'[]'::jsonb) into result from (
 select n.created_at,to_jsonb(n)-'company_id'||jsonb_build_object(
 'read_at',r.read_at,'resolved',private.ops_note_resolved(n),'claimed_name',coalesce(st.name,''),
 'reg',coalesce(b.reg,''),'yard',coalesce(b.yard,''),'key_tag',b.num,
 'can_accept',not private.ops_note_resolved(n) and n.booking_id is not null and n.kind not in ('calls','complaint') and
 case when n.kind in ('drops','escalation') then public.can('sent') when n.kind='picks' then public.can('rtc') when n.kind in ('keys','lanes') then public.can('yard') else public.can('called') end,
 'activity',coalesce((select jsonb_agg(z.obj order by z.at) from (select a.at,jsonb_build_object('at',a.at,'action',a.action,'staff_name',a.staff_name) obj from private.ops_note_activity a where a.notification_id=n.id order by a.at desc limit 20) z),'[]'::jsonb)) obj
 from private.ops_notifications n join private.ops_note_receipts r on r.notification_id=n.id and r.staff_id=s.id
 left join public.staff st on st.id=n.claimed_by left join public.bookings b on b.id=n.booking_id
 where private.ops_note_visible(n,s) and n.created_at>now()-interval '7 days'
 order by private.ops_note_resolved(n), (n.urgency='urgent') desc,n.created_at desc,n.id desc limit 200) x;
 return jsonb_build_object('items',result,'limit',200,'window_days',7,'options',coalesce((select to_jsonb(o)-'staff_id' from private.ops_note_options o where o.staff_id=s.id),jsonb_build_object('routine_silent',false,'paused_until',null)));
end $$;

create or replace function public.ops_notification_action(p_id uuid,p_action text,p_staff uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare s public.staff:=public.me(); n private.ops_notifications; target public.staff; needed text;
begin
 if s.id is null then raise exception 'Sign in again.'; end if;
 select * into n from private.ops_notifications where id=p_id for update;
 if n.id is null or not private.ops_note_visible(n,s) then raise exception 'Notification not available.'; end if;
 if p_action='read' then
  update private.ops_note_receipts set read_at=coalesce(read_at,now()) where notification_id=n.id and staff_id=s.id; return;
 end if;
 if private.ops_note_resolved(n) or n.booking_id is null or n.kind='calls' then raise exception 'This alert no longer needs acceptance.'; end if;
 needed:=case when n.kind in ('drops','escalation') then 'sent' when n.kind='picks' then 'rtc' when n.kind in ('keys','lanes') then 'yard' else 'called' end;
 if not public.can(needed) then raise exception 'Not allowed to accept this task.'; end if;
 if p_action='accept' then
  if n.claimed_by is not null and n.claimed_by<>s.id then raise exception 'Already accepted by another person. Refresh the list.'; end if;
  if n.claimed_by=s.id then return; end if;
  update private.ops_notifications set claimed_by=s.id,claimed_at=now() where id=n.id;
 elsif p_action='assign' then
  if not public.can('called') then raise exception 'Only dispatch staff can assign this task.'; end if;
  select * into target from public.staff where id=p_staff and company_id=s.company_id and active;
  if target.id is null or not private.ops_staff_can(target,needed) then raise exception 'Choose an active staff member with access to this task.'; end if;
  update private.ops_notifications set claimed_by=target.id,claimed_at=now() where id=n.id;
  insert into private.ops_note_receipts values(n.id,target.id,null) on conflict do nothing;
 elsif p_action='release' then
  if n.claimed_by is distinct from s.id and not public.can('called') then raise exception 'Only the accepting person or dispatch can release this task.'; end if;
  update private.ops_notifications set claimed_by=null,claimed_at=null where id=n.id;
 else raise exception 'Unknown notification action.'; end if;
 insert into private.ops_note_activity(notification_id,action,staff_name) values(n.id,p_action,coalesce(nullif(s.acting,''),s.name)||case when p_action='assign' then ' → '||target.name else '' end);
 insert into public.activity(company_id,staff_id,staff_name,booking_id,action,value) values(s.company_id,s.id,coalesce(nullif(s.acting,''),s.name),n.booking_id,'NOTIFICATION',p_action||': '||n.title);
end $$;

create or replace function public.set_ops_notification_options(p_pause_hours integer,p_routine_silent boolean) returns void
language plpgsql security definer set search_path='' as $$
declare s public.staff:=public.me();
begin
 if s.id is null then raise exception 'Sign in again.'; end if;
 if p_pause_hours is null or p_pause_hours not in (-1,0,1,8) then raise exception 'Choose 0, 1 or 8 hours.'; end if;
 insert into private.ops_note_options values(s.id,case when p_pause_hours=0 then null else now()+make_interval(hours=>p_pause_hours) end,coalesce(p_routine_silent,false))
 on conflict(staff_id) do update set paused_until=case when p_pause_hours=-1 then private.ops_note_options.paused_until else excluded.paused_until end,routine_silent=excluded.routine_silent;
end $$;

-- Service returns delivery choices; this affects push, never inbox visibility.
create or replace function public.ops_notification_delivery(p_staff uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('staff_id',s.id,'paused',coalesce(o.paused_until>now(),false),'routine_silent',coalesce(o.routine_silent,false))),'[]'::jsonb)
 from public.staff s left join private.ops_note_options o on o.staff_id=s.id where s.id=any(p_staff) and s.active
$$;

-- The existing 5-minute long-wait timer also requests unaccepted urgent alerts.
-- Row locks + one persistent timestamp stop two timer calls escalating twice.
create or replace function public.ops_notification_escalations() returns jsonb
language plpgsql security definer set search_path='' as $$
declare n private.ops_notifications; ids uuid[]; result jsonb:='[]';
begin
 for n in select * from private.ops_notifications where urgency='urgent' and kind in ('drops','picks','keys','lanes') and claimed_by is null and escalated_at is null and created_at<now()-interval '5 minutes' and expires_at>now() order by created_at limit 100 for update skip locked loop
  if private.ops_note_resolved(n) then continue; end if;
  select array_agg(s.id) into ids from public.staff s where s.company_id=n.company_id and s.active and s.role in ('owner','manager') and private.ops_staff_can(s,'called');
  if coalesce(array_length(ids,1),0)=0 then continue; end if;
  update private.ops_notifications set escalated_at=now() where id=n.id;
  insert into private.ops_note_receipts select n.id,unnest(ids),null on conflict do nothing;
  insert into private.ops_note_activity(notification_id,action) values(n.id,'Escalated to supervisors');
  result:=result||jsonb_build_array(jsonb_build_object('id',n.id,'staff',ids,'key','escalate:'||n.id,'title','Needs acceptance: '||n.title,'body',n.body,'booking_id',n.booking_id));
 end loop;
 return result;
end $$;

-- Read-only candidates from physical confirmations. Unchecked != missing.
create or replace function public.ops_notification_candidates() returns jsonb
language sql stable security definer set search_path='' as $$
 with due as (select b.* from public.bookings b where b.kind='drops' and b.sent_at is null and b.cleared_at is null and b.removed_at is null and b.return_at between now()-interval '30 minutes' and now()+interval '30 minutes'),
 candidates as (
 select b.company_id,b.id booking_id,'keys' kind,'key:'||b.id||':'||k.id event_key,'Key marked missing: '||b.reg title,'Physical key check marked this key missing. Open the booking and confirm the key before collection.' body
 from due b join public.key_check_entries e on e.booking_id=b.id and e.company_id=b.company_id and e.state='missing' join public.key_check_sessions k on k.id=e.session_id and k.status='active'
 union all
 select distinct b.company_id,b.id,'lanes','lane:'||b.id||':'||l.id||':'||sh.day,'Return vehicle blocked: '||b.reg,
 l.name||' · position '||p.position||'. Cars are recorded ahead of the exit. Open the yard planner to arrange confirmed moves.'
 from due b join public.sheets sh on sh.id=b.sheet_id join public.companies c on c.id=b.company_id and c.brand->>'lane_planner'='true'
 join public.bookings x on private.lane_same_stay(x,b) join public.parking_positions p on p.booking_id=x.id join public.parking_lanes l on l.id=p.lane_id and l.kind='lane'
 where exists(select 1 from public.parking_positions q where q.lane_id=l.id and q.position<p.position) and (l.access='front' or exists(select 1 from public.parking_positions q where q.lane_id=l.id and q.position>p.position)))
 select coalesce(jsonb_agg(to_jsonb(z)),'[]'::jsonb) from (select d.*,
 (select array_agg(s.id) from public.staff s where s.company_id=d.company_id and private.ops_staff_can(s,'yard')) staff
 from candidates d where not exists(select 1 from private.ops_notifications n where n.company_id=d.company_id and n.event_key=d.event_key) order by d.company_id,d.booking_id limit 100) z
$$;

-- Keep 30 days for incident review; the user-facing window is seven days.
create or replace function public.ops_notification_trim() returns void
language sql security definer set search_path='' as $$
 delete from private.ops_notifications where created_at<now()-interval '30 days'
$$;
revoke all on function public.ops_notification_trim() from public,anon,authenticated;
grant execute on function public.ops_notification_trim() to service_role;

-- Explicit privileges: these definers implement the app's existing me()/can()
-- identity model. Private helpers and service writers cannot be called by users.
revoke all on function private.ops_staff_can(public.staff,text),private.ops_note_visible(private.ops_notifications,public.staff),private.ops_note_resolved(private.ops_notifications) from public,anon,authenticated;
revoke all on function public.record_ops_notification(uuid[],text,text,text,text,uuid,text),public.ops_notification_delivery(uuid[]),public.ops_notification_escalations(),public.ops_notification_candidates() from public,anon,authenticated;
grant execute on function public.record_ops_notification(uuid[],text,text,text,text,uuid,text),public.ops_notification_delivery(uuid[]),public.ops_notification_escalations(),public.ops_notification_candidates() to service_role;
revoke all on function public.ops_notification_feed(),public.ops_notification_action(uuid,text,uuid),public.set_ops_notification_options(integer,boolean) from public,anon;
grant execute on function public.ops_notification_feed(),public.ops_notification_action(uuid,text,uuid),public.set_ops_notification_options(integer,boolean) to authenticated;
commit;
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
