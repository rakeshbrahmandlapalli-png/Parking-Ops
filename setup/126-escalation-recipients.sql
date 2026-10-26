-- 126: "Needs acceptance" escalations go to the same people as call alerts
-- (rakesh, 26 Oct: "no one need to get those except me and office").
-- call_alert_staff (part 123) = owner, manager, office by default; Staff access
-- "Call pop-ups and call alerts" adds or removes a person. A client without
-- Calls keeps the old rule (owners and managers who can press CALLED).
-- Applied by Claude on 26 Oct at the user's request.

create or replace function public.ops_notification_escalations() returns jsonb
language plpgsql security definer set search_path='' as $$
declare n private.ops_notifications; ids uuid[]; result jsonb:='[]';
begin
 for n in select * from private.ops_notifications where urgency='urgent' and kind in ('drops','picks','keys','lanes') and claimed_by is null and escalated_at is null and created_at<now()-interval '5 minutes' and expires_at>now() order by created_at limit 100 for update skip locked loop
  if private.ops_note_resolved(n) then continue; end if;
  if private.calls_on(n.company_id) then
   ids:=nullif(public.call_alert_staff(n.company_id),'{}');
  else
   select array_agg(s.id) into ids from public.staff s where s.company_id=n.company_id and s.active and s.role in ('owner','manager') and private.ops_staff_can(s,'called');
  end if;
  if coalesce(array_length(ids,1),0)=0 then continue; end if;
  update private.ops_notifications set escalated_at=now() where id=n.id;
  insert into private.ops_note_receipts select n.id,unnest(ids),null on conflict do nothing;
  insert into private.ops_note_activity(notification_id,action) values(n.id,'Escalated to supervisors');
  result:=result||jsonb_build_array(jsonb_build_object('id',n.id,'staff',ids,'key','escalate:'||n.id,'title','Needs acceptance: '||n.title,'body',n.body,'booking_id',n.booking_id));
 end loop;
 return result;
end $$;

revoke execute on function public.ops_notification_escalations() from public, anon, authenticated;
grant execute on function public.ops_notification_escalations() to service_role;
