-- Rollback for part 129 (SQL editor). Restore the frontend before part 129 first.
-- Puts back part 125's resolver and feed; keeps the cleared_at column (harmless, unused).
begin;
drop function if exists public.ops_notification_clear(uuid[]);
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
commit;
