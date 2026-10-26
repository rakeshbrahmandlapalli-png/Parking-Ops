-- Part 126: call queue workflow (callback claim, outcomes, shared history). Apply after part 125.
-- From the 26 Oct call queue handoff. Safe to apply with the Supabase MCP.
-- Rollback: setup/rollback/126-call-queue-rollback.sql (SQL editor).
begin;
alter table public.customer_calls
 add column if not exists callback_state text not null default '',
 add column if not exists callback_claimed_at timestamptz,
 add column if not exists callback_attempt_at timestamptz,
 add column if not exists callback_due_at timestamptz,
 add column if not exists callback_resolved_at timestamptz,
 add column if not exists callback_resolved_name text not null default '';
-- Old clients conflated 'claim' and 'called back'. Retain that history without
-- inventing a successful outcome or re-queuing every old handled call.
update public.customer_calls set callback_state='legacy'
 where status='missed' and handled_by is not null and callback_state='';
-- Missed calls more than 12 hours old when this part goes live start in history
-- ("Before the call queue"), not as a pile of overdue callbacks (16 on 26 Oct).
update public.customer_calls set callback_state='legacy'
 where status='missed' and handled_by is null and callback_state='' and at<now()-interval '12 hours';
create index if not exists customer_calls_callback_idx on public.customer_calls(company_id,at)
 where status='missed' and callback_resolved_at is null and callback_state<>'legacy';

create or replace function public.call_queue_feed() returns setof public.customer_calls
language plpgsql security definer set search_path='' as $$
declare s public.staff:=public.me();
begin
 if s.id is null or not public.can('callpop') then raise exception 'Not allowed for your role.'; end if;
 if not private.call_workflow_on(s.company_id) then return; end if;
 -- All outstanding calls, even across midnight. Recent history is separate and bounded.
 return query select k.* from public.customer_calls k where k.company_id=s.company_id and
 ((k.status='missed' and k.callback_resolved_at is null and k.callback_state<>'legacy') or
 -- A call still 'ringing' after 10 minutes never got its end from the phone: history, not live.
 (k.status='ringing' and k.at>now()-interval '10 minutes')) order by k.at desc;
 return query select k.* from public.customer_calls k where k.company_id=s.company_id and (k.at>now()-interval '24 hours' or k.callback_resolved_at>now()-interval '24 hours') and
 not ((k.status='missed' and k.callback_resolved_at is null and k.callback_state<>'legacy') or (k.status='ringing' and k.at>now()-interval '10 minutes'))
 order by k.at desc limit 100;
end $$;

-- Internal helper is exposed only to the functions below, never app logins.
create or replace function private.call_workflow_on(p_company uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((c.brand->>'calls')::boolean,false) and coalesce((c.calls->>'on')::boolean,false)
 from public.companies c where c.id=p_company
$$;
revoke all on function private.call_workflow_on(uuid) from public,anon,authenticated;

create or replace function public.call_claim(p_call bigint) returns public.customer_calls
language plpgsql security definer set search_path='' as $$
declare s public.staff:=public.me(); k public.customer_calls; who text;
begin
 if s.id is null or not public.can('callpop') or not private.call_workflow_on(s.company_id) then raise exception 'Not allowed for your role.'; end if;
 select * into k from public.customer_calls where id=p_call and company_id=s.company_id for update;
 if k.id is null then raise exception 'Call not found.'; end if;
 if k.callback_resolved_at is not null or k.callback_state='legacy' or k.status not in ('ringing','missed') then raise exception 'This call no longer needs a claim.'; end if;
 if k.handled_by is not null and k.handled_by<>s.id then raise exception 'Already claimed by %. Refresh the queue.',k.handled_name; end if;
 if k.handled_by=s.id then return k; end if;
 who:=coalesce(nullif(s.acting,''),s.name);
 update public.customer_calls set handled_by=s.id,handled_name=who,callback_state='claimed',callback_claimed_at=now() where id=k.id returning * into k;
 insert into public.activity(company_id,booking_id,reg,customer,staff_id,staff_name,action,value)
 values(k.company_id,k.booking_id,k.reg,k.name,s.id,who,'CALL','Claimed call '||k.id);
 return k;
end $$;

create or replace function public.call_callback(p_call bigint,p_outcome text) returns public.customer_calls
language plpgsql security definer set search_path='' as $$
declare s public.staff:=public.me(); k public.customer_calls; who text;
begin
 if s.id is null or not public.can('callpop') or not private.call_workflow_on(s.company_id) then raise exception 'Not allowed for your role.'; end if;
 if p_outcome is null or p_outcome not in ('attempt','no_answer','retry','resolved','release') then raise exception 'Choose a valid callback outcome.'; end if;
 select * into k from public.customer_calls where id=p_call and company_id=s.company_id for update;
 if k.id is null then raise exception 'Call not found.'; end if;
 if k.handled_by is null then raise exception 'Claim this call first.'; end if;
 if k.handled_by<>s.id and not(p_outcome='release' and s.role in ('owner','manager')) then raise exception 'This call belongs to %. Ask them to release it.',k.handled_name; end if;
 if k.callback_resolved_at is not null or k.callback_state='legacy' then raise exception 'This call is already closed.'; end if;
 if p_outcome<>'release' and k.status<>'missed' then raise exception 'Only missed calls need a callback outcome.'; end if;
 who:=coalesce(nullif(s.acting,''),s.name);
 update public.customer_calls set
 callback_state=case when p_outcome='release' then '' when p_outcome='attempt' then 'claimed' else p_outcome end,
 handled_by=case when p_outcome='release' then null else handled_by end,
 handled_name=case when p_outcome='release' then '' else handled_name end,
 callback_claimed_at=case when p_outcome='release' then null else callback_claimed_at end,
 callback_attempt_at=case when p_outcome in ('attempt','no_answer') then now() else callback_attempt_at end,
 callback_due_at=case when p_outcome='retry' then now()+interval '15 minutes' else null end,
 callback_resolved_at=case when p_outcome='resolved' then now() else null end,
 callback_resolved_name=case when p_outcome='resolved' then who else '' end
 where id=k.id returning * into k;
 insert into public.activity(company_id,booking_id,reg,customer,staff_id,staff_name,action,value)
 values(k.company_id,k.booking_id,k.reg,k.name,s.id,who,'CALL',case p_outcome when 'attempt' then 'Opened dialler for call ' when 'no_answer' then 'No answer on callback ' when 'retry' then 'Retry callback in 15 minutes: ' when 'resolved' then 'Resolved callback ' else 'Released call ' end||k.id);
 -- Reuse existing inbox records; do not create another push channel or touch
 -- the notification resolver, delivery queue or worker from Claude's release.
 if p_outcome='resolved' then
  update private.ops_notifications set resolved_at=now() where company_id=s.company_id and kind='calls' and event_key='call:'||k.id;
 end if;
 return k;
end $$;
-- Compatibility: older frontends can still claim, but no longer steal claims
-- or write a false 'called back' activity entry.
create or replace function public.call_take(p_call bigint) returns public.customer_calls
language sql security definer set search_path='' as $$ select public.call_claim(p_call) $$;
revoke all on function public.call_queue_feed(),public.call_claim(bigint),public.call_callback(bigint,text),public.call_take(bigint) from public,anon;
grant execute on function public.call_queue_feed(),public.call_claim(bigint),public.call_callback(bigint,text),public.call_take(bigint) to authenticated;
commit;
