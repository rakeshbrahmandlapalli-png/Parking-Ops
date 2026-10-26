-- Part 125d: the two notification functions that contain DELETE (the Supabase MCP cannot apply them).
-- Run in the Supabase SQL editor after parts 125a-c (applied 26 Oct). send-alerts with the queue is deployed only after this.
begin;
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

create or replace function public.ops_notification_trim() returns void
language sql security definer set search_path='' as $$
 delete from private.ops_notifications where created_at<now()-interval '30 days';
 delete from private.ops_push_outbox where created_at<now()-interval '7 days'
$$;
revoke all on function public.ops_notification_trim() from public,anon,authenticated;
grant execute on function public.ops_notification_trim() to service_role;
revoke all on function public.ops_push_enqueue(uuid[],text,text,jsonb,integer,text,text),public.ops_push_claim(text),public.ops_push_result(uuid,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.ops_push_enqueue(uuid[],text,text,jsonb,integer,text,text),public.ops_push_claim(text),public.ops_push_result(uuid,uuid,boolean,integer) to service_role;
commit;
