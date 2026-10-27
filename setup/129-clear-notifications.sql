-- Part 129: Clear all notifications, and incoming-call alerts that finish themselves.
-- User, 27 Oct: 74 notifications on the phone, "how to clear them all at once,
-- they keep on building up". 73 of them were "Incoming call" alerts for calls that
-- were answered: the resolver only looked at bookings, and call alerts carry none.
-- Apply after part 126. No DELETE or DROP, so the Supabase MCP can apply it.
-- Rollback: setup/rollback/129-clear-notifications-rollback.sql.
begin;

-- Clearing is per person: it takes the alert off my list, never anyone else's,
-- and never changes a booking, a call or a shared task.
alter table private.ops_note_receipts add column if not exists cleared_at timestamptz;

-- As part 125, plus calls: an incoming-call alert is done once the call is answered,
-- its missed-call callback is Resolved (or it went to history with part 126), or it
-- rang for 10 minutes with no end from the phone (the call queue's own rule).
create or replace function private.ops_note_resolved(n private.ops_notifications) returns boolean
language sql stable set search_path='' as $$
 select n.resolved_at is not null or n.expires_at<=now() or
 case when n.kind='calls' then n.event_key ~ '^call:[0-9]{1,18}$' and not exists (
 select 1 from public.customer_calls k where k.id=substr(n.event_key,6)::bigint and k.company_id=n.company_id and
 ((k.status='ringing' and k.at>now()-interval '10 minutes') or
 (k.status='missed' and k.callback_resolved_at is null and k.callback_state<>'legacy')))
 when n.booking_id is null then false else not exists (
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

-- As part 125, plus 'cleared_at' (this person's own clear); cleared alerts sort with the resolved ones.
create or replace function public.ops_notification_feed() returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.staff:=public.me(); result jsonb;
begin
 if s.id is null then raise exception 'Sign in again.'; end if;
 select coalesce(jsonb_agg(x.obj order by x.created_at desc),'[]'::jsonb) into result from (
 select n.created_at,to_jsonb(n)-'company_id'||jsonb_build_object(
 'read_at',r.read_at,'cleared_at',r.cleared_at,'resolved',private.ops_note_resolved(n),'claimed_name',coalesce(st.name,''),
 'reg',coalesce(b.reg,''),'yard',coalesce(b.yard,''),'key_tag',b.num,
 'can_accept',not private.ops_note_resolved(n) and n.booking_id is not null and n.kind not in ('calls','complaint') and
 case when n.kind in ('drops','escalation') then public.can('sent') when n.kind='picks' then public.can('rtc') when n.kind in ('keys','lanes') then public.can('yard') else public.can('called') end,
 'activity',coalesce((select jsonb_agg(z.obj order by z.at) from (select a.at,jsonb_build_object('at',a.at,'action',a.action,'staff_name',a.staff_name) obj from private.ops_note_activity a where a.notification_id=n.id order by a.at desc limit 20) z),'[]'::jsonb)) obj
 from private.ops_notifications n join private.ops_note_receipts r on r.notification_id=n.id and r.staff_id=s.id
 left join public.staff st on st.id=n.claimed_by left join public.bookings b on b.id=n.booking_id
 where private.ops_note_visible(n,s) and n.created_at>now()-interval '7 days'
 order by private.ops_note_resolved(n) or r.cleared_at is not null, (n.urgency='urgent') desc,n.created_at desc,n.id desc limit 200) x;
 return jsonb_build_object('items',result,'limit',200,'window_days',7,'options',coalesce((select to_jsonb(o)-'staff_id' from private.ops_note_options o where o.staff_id=s.id),jsonb_build_object('routine_silent',false,'paused_until',null)));
end $$;

-- Clear the listed alerts from my own list. A task I have accepted and is still
-- open stays (release it first), so a claim is never left behind out of sight.
-- Returns how many were cleared; one activity line for the whole clear.
create or replace function public.ops_notification_clear(p_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare s public.staff:=public.me(); done integer;
begin
 if s.id is null then raise exception 'Sign in again.'; end if;
 if coalesce(array_length(p_ids,1),0)=0 then return 0; end if;
 if array_length(p_ids,1)>200 then raise exception 'Clear at most 200 at a time.'; end if;
 update private.ops_note_receipts r set cleared_at=now()
 from private.ops_notifications n
 where n.id=r.notification_id and r.staff_id=s.id and n.id=any(p_ids) and r.cleared_at is null
 and private.ops_note_visible(n,s)
 and (n.claimed_by is distinct from s.id or private.ops_note_resolved(n));
 get diagnostics done=row_count;
 if done>0 then
  insert into public.activity(company_id,staff_id,staff_name,action,value)
  values(s.company_id,s.id,coalesce(nullif(s.acting,''),s.name),'NOTIFICATION','Cleared '||done||' notification'||case when done=1 then '' else 's' end||' from their list');
 end if;
 return done;
end $$;
revoke all on function public.ops_notification_clear(uuid[]) from public,anon;
grant execute on function public.ops_notification_clear(uuid[]) to authenticated;
revoke all on function private.ops_note_resolved(private.ops_notifications) from public,anon,authenticated;
commit;
