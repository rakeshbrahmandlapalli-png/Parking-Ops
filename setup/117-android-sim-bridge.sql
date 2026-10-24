-- Parking Ops — part 117: use the company's Android phone and SIM for calls/texts.
-- Apply after 115, 115b and 116. This part is prepared for review; do not apply
-- until the companion APK and its Supabase function changes are ready.
begin;

-- Android pulls queued texts from the company phone. A text marked sending is
-- never sent twice automatically; an interrupted send needs office review.
alter table customer_texts add column if not exists claimed_at timestamptz;
alter table customer_texts add column if not exists claim_token uuid;
alter table customer_texts add column if not exists reviewed_at timestamptz;
alter table customer_texts add column if not exists dedupe_key text;
create unique index if not exists customer_texts_dedupe_idx on customer_texts(company_id,dedupe_key);
alter table customer_texts add column if not exists claimed_device uuid;
alter table customer_texts add column if not exists expires_at timestamptz not null default (now()+interval '10 minutes');
create index if not exists customer_texts_queue_idx on customer_texts(company_id,at,id) where status='queued';

-- Queue insertion and its audit record commit together. A failed insert never
-- consumes an external alert-log marker that would prevent a safe retry.
create or replace function private.phone_text_queued_activity()
returns trigger language plpgsql security definer set search_path=public as $$
declare b bookings;
begin
  select * into b from bookings where id=new.booking_id;
  insert into activity(company_id,booking_id,reg,customer,staff_id,staff_name,action,value)
    values(new.company_id,new.booking_id,coalesce(b.reg,''),coalesce(b.name,''),new.staff_id,coalesce(nullif(new.staff_name,''),'Phone'),'TEXT',
      case new.rule when 'landed' then 'Flight landed' when 'sent' then 'Car on its way' when 'reminder' then 'Reminder' when 'test' then 'Test text' else 'Text' end||' to '||new.to_number||': '||
      case new.status when 'queued' then 'queued on company phone' when 'demo' then 'demo, not sent' else 'not sent, '||new.error end);
  return new;
end $$;
revoke all on function private.phone_text_queued_activity() from public,anon,authenticated;
drop trigger if exists phone_text_queued_activity on customer_texts;
create trigger phone_text_queued_activity after insert on customer_texts for each row execute function private.phone_text_queued_activity();

create table if not exists company_phones (
  company_id uuid primary key references companies(id),
  device_id uuid not null,
  staff_id uuid not null references staff(id),
  seen_at timestamptz,
  ready boolean not null default false,
  battery int,
  sms_ready boolean not null default false,
  calls_ready boolean not null default false
);
alter table company_phones enable row level security;
do $$ begin
  if not exists(select 1 from pg_policies where tablename='company_phones' and policyname='company_read') then
    create policy company_read on company_phones for select to authenticated using(company_id=(select my_company()) and can('called'));
  end if;
end $$;
grant select on company_phones,customer_texts to authenticated;
revoke insert,update,delete on company_phones from anon,authenticated;

-- Pair only one handset per company. Replacing it is an explicit owner action.
create or replace function phone_connect(p_device uuid,p_replace boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare s staff:=me(); current_phone company_phones;
begin
  if s.id is null or not can('called') then raise exception 'Only the office can connect the company phone.'; end if;
  if p_device is null then raise exception 'Invalid device.'; end if;
  perform 1 from companies where id=s.company_id for update;
  select * into current_phone from company_phones where company_id=s.company_id;
  if current_phone.device_id=p_device and current_phone.staff_id=s.id then return s.company_id; end if;
  if s.role<>'owner' then raise exception 'An owner must pair the company phone.'; end if;
  if current_phone.device_id is not null and not coalesce(p_replace,false) then raise exception 'Another company phone is paired. An owner must explicitly replace it.'; end if;
  insert into company_phones(company_id,device_id,staff_id) values(s.company_id,p_device,s.id)
    on conflict(company_id) do update set device_id=p_device,staff_id=s.id,ready=false,seen_at=null,sms_ready=false,calls_ready=false,battery=null;
  insert into activity(company_id,staff_id,staff_name,action,value) values(s.company_id,s.id,s.name,'SETTINGS','Company Android phone paired');
  return s.company_id;
end $$;

create or replace function phone_heartbeat(p_device uuid,p_ready boolean,p_sms boolean,p_calls boolean,p_battery int default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare s staff:=me();
begin
  if s.id is null or not can('called') then raise exception 'Sign in with office access.'; end if;
  update company_phones set seen_at=now(),ready=coalesce(p_ready,false),sms_ready=coalesce(p_sms,false),calls_ready=coalesce(p_calls,false),battery=least(100,greatest(0,p_battery))
    where company_id=s.company_id and device_id=p_device and staff_id=s.id;
  if not found then raise exception 'This phone is not paired. Open TakeOff Phone and connect it.'; end if;
  return true;
end $$;

create or replace function phone_bridge_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare s staff:=me(); h company_phones; counts jsonb;
begin
  if s.id is null or not can('called') then raise exception 'Only the office can view phone health.'; end if;
  select * into h from company_phones where company_id=s.company_id;
  select jsonb_build_object('queued',count(*) filter(where status='queued' and expires_at>now()),
    'needs_review',count(*) filter(where reviewed_at is null and (status in ('failed','uncertain') or (status='sending' and claimed_at<now()-interval '2 minutes'))),
    'expired',count(*) filter(where status='expired' or (status='queued' and expires_at<=now()))) into counts
    from customer_texts where company_id=s.company_id and at>now()-interval '24 hours';
  return counts||jsonb_build_object('paired',h.device_id is not null,'online',coalesce(h.ready and h.seen_at>now()-interval '90 seconds',false),
    'sms_ready',coalesce(h.sms_ready,false),'calls_ready',coalesce(h.calls_ready,false),'last_seen',h.seen_at,'battery',h.battery);
end $$;
revoke all on function phone_connect(uuid,boolean),phone_heartbeat(uuid,boolean,boolean,boolean,int),phone_bridge_status() from public,anon;
grant execute on function phone_connect(uuid,boolean),phone_heartbeat(uuid,boolean,boolean,boolean,int),phone_bridge_status() to authenticated;

alter table customer_texts drop constraint if exists customer_texts_status_check;
alter table customer_texts add constraint customer_texts_status_check
  check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'skipped', 'demo', 'uncertain', 'expired'));

create table if not exists customer_sms (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id),
  booking_id uuid references bookings(id) on delete set null,
  external_id text not null,
  at timestamptz not null default now(),
  from_number text not null default '',
  body text not null default '',
  direction text not null default 'inbound' check (direction = 'inbound')
);
create unique index if not exists customer_sms_external_idx on customer_sms(company_id, external_id);
create index if not exists customer_sms_booking_idx on customer_sms(company_id, booking_id, at desc);
alter table customer_sms enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_sms' and policyname='company_read') then
    create policy company_read on customer_sms for select to authenticated using (company_id = (select my_company()));
  end if;
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='customer_sms') then
    alter publication supabase_realtime add table customer_sms;
  end if;
end $$;
grant select on customer_sms to authenticated;
revoke insert, update, delete on customer_sms from anon, authenticated;

create or replace function phone_text_review(p_id bigint)
returns boolean language plpgsql security definer set search_path=public as $$
declare s staff:=me(); t customer_texts;
begin
  if s.id is null or not can('called') then raise exception 'Only the office can review text failures.'; end if;
  update customer_texts set reviewed_at=now() where id=p_id and company_id=s.company_id and status in ('failed','uncertain') and reviewed_at is null returning * into t;
  if t.id is null then return false; end if;
  insert into activity(company_id,booking_id,staff_id,staff_name,action,value) values(s.company_id,t.booking_id,s.id,s.name,'TEXT','Reviewed send outcome for '||t.to_number);
  return true;
end $$;
revoke all on function phone_text_review(bigint) from public,anon;
grant execute on function phone_text_review(bigint) to authenticated;

-- A claim is a durable send attempt. Never reclaim an ambiguous attempt.
create or replace function phone_texts_claim(p_device uuid)
returns setof customer_texts language plpgsql security definer set search_path=public as $$
declare s staff:=me();
begin
  if s.id is null or not can('called') then raise exception 'Only the office phone can send customer texts.'; end if;
  if not exists(select 1 from company_phones where company_id=s.company_id and device_id=p_device and staff_id=s.id and ready and sms_ready and seen_at>now()-interval '90 seconds') then
    raise exception 'The paired company phone must be online with SMS permission.';
  end if;
  if not private.texts_on(s.company_id) then raise exception 'Customer texts are not enabled for this company.'; end if;
  -- Never send yesterday's urgent text after a handset reconnects.
  with changed as (
    update customer_texts set status='expired',error='Expired while waiting for the company phone' where company_id=s.company_id and status='queued' and expires_at<=now() returning *
  ) insert into activity(company_id,booking_id,staff_id,staff_name,action,value) select company_id,booking_id,s.id,s.name,'TEXT','Expired without sending to '||to_number from changed;
  with changed as (
    update customer_texts set status='uncertain',error='No send result received. Check the phone before sending again.' where company_id=s.company_id and status='sending' and claimed_at<now()-interval '2 minutes' returning *
  ) insert into activity(company_id,booking_id,staff_id,staff_name,action,value) select company_id,booking_id,s.id,s.name,'TEXT','Send outcome needs review for '||to_number from changed;
  return query with picked as (
    select id from customer_texts where company_id=s.company_id and status='queued' and expires_at>now()
      and (rule='test' or exists(select 1 from companies where id=s.company_id and (texts->>'on')::boolean and not coalesce((texts->>'demo')::boolean,false)))
    order by at,id limit 1 for update skip locked
  ) update customer_texts t set status='sending',claimed_at=now(),claim_token=gen_random_uuid(),claimed_device=p_device
    from picked p where t.id=p.id returning t.*;
end $$;

create or replace function phone_texts_finish(p_device uuid,p_id bigint,p_token uuid,p_status text,p_error text default '')
returns customer_texts language plpgsql security definer set search_path=public as $$
declare s staff:=me(); t customer_texts;
begin
  if s.id is null or not can('called') then raise exception 'Only the office phone can finish customer texts.'; end if;
  if p_status is null or p_status not in ('sent','delivered','failed','uncertain') then raise exception 'Invalid text status.'; end if;
  select * into t from customer_texts where id=p_id and company_id=s.company_id and claimed_device=p_device and claim_token=p_token for update;
  if t.id is null then raise exception 'This send attempt does not belong to this phone.'; end if;
  -- Callback retries are idempotent; late callbacks may resolve uncertainty.
  if t.status=p_status or t.status='delivered' or (t.status='sent' and p_status='uncertain') then return t; end if;
  if t.status not in ('sending','uncertain','sent') then raise exception 'This text is already finished.'; end if;
  update customer_texts set status=p_status,error=left(coalesce(p_error,''),200),staff_id=coalesce(staff_id,s.id),staff_name=coalesce(nullif(staff_name,''),s.name)
    where id=p_id returning * into t;
  insert into activity(company_id,booking_id,reg,customer,staff_id,staff_name,action,value)
    select t.company_id,t.booking_id,coalesce(b.reg,''),coalesce(b.name,''),s.id,coalesce(nullif(s.acting,''),s.name),'TEXT',
      case p_status when 'sent' then 'Sent to ' when 'delivered' then 'Delivered to ' when 'failed' then 'Failed to send to ' else 'Send outcome needs review for ' end||t.to_number||case when p_error<>'' then ': '||left(p_error,120) else '' end
    from (select 1) x left join bookings b on b.id=t.booking_id;
  return t;
end $$;
revoke all on function phone_texts_claim(uuid),phone_texts_finish(uuid,bigint,uuid,text,text) from public,anon;
grant execute on function phone_texts_claim(uuid),phone_texts_finish(uuid,bigint,uuid,text,text) to authenticated;

-- Store replies observed on the company handset, associated with the
-- current booking where a matching mobile number is found.
create or replace function phone_sms_inbound(p_external text,p_from text,p_body text,p_at timestamptz default now())
returns customer_sms language plpgsql security definer set search_path=public as $$
declare s staff := me(); b bookings; m customer_sms; n text := private.phone10(p_from);
begin
  if s.id is null or not can('called') then raise exception 'Only the office can save customer replies.'; end if;
  if not private.texts_on(s.company_id) then raise exception 'Customer texts are not enabled for this company.'; end if;
  if coalesce(p_external,'')='' or length(p_external)>120 or length(coalesce(p_body,''))>5000 then raise exception 'Invalid message.'; end if;
  if length(n)=10 then
    select bk.* into b from bookings bk join sheets sh on sh.id=bk.sheet_id
    where bk.company_id=s.company_id and bk.removed_at is null
      and private.phone10(bk.phone)=n
      and ((bk.kind='drops' and bk.cleared_at is null and sh.day=drops_day_of(coalesce(p_at,now()),(select c from companies c where c.id=s.company_id)))
        or (bk.kind='picks' and coalesce(bk.intake,'')='' and sh.day=(coalesce(p_at,now()) at time zone (select time_zone from companies where id=s.company_id))::date))
    order by (bk.kind='drops') desc limit 1;
  end if;
  -- General/private SMS are not stored in the parking database.
  if b.id is null then return null; end if;
  insert into customer_sms(company_id,booking_id,external_id,at,from_number,body)
    values(s.company_id,b.id,p_external,coalesce(p_at,now()),left(coalesce(p_from,''),40),p_body)
    on conflict(company_id,external_id) do nothing returning * into m;
  if m.id is null then
    select * into m from customer_sms where company_id=s.company_id and external_id=p_external;
  else
    insert into activity(company_id,booking_id,reg,customer,staff_id,staff_name,action,value)
      values(s.company_id,b.id,coalesce(b.reg,''),coalesce(b.name,''),s.id,coalesce(nullif(s.acting,''),s.name),'TEXT','Customer replied from '||left(coalesce(p_from,''),40));
  end if;
  return m;
end $$;
revoke all on function phone_sms_inbound(text,text,text,timestamptz) from public, anon;
grant execute on function phone_sms_inbound(text,text,text,timestamptz) to authenticated;

-- A CallScreeningService reports a ring immediately, then updates the same row
-- from the Android call log after the call. It never answers or redirects calls.
create or replace function phone_call_event(p_event text,p_from text,p_status text,p_at timestamptz default now(),p_seconds int default null)
returns customer_calls language plpgsql security definer set search_path=public as $$
declare s staff := me(); b bookings; k customer_calls; old_status text; event_key text := 'phone:'||left(coalesce(p_event,''),100); n text := private.phone10(p_from);
begin
  if s.id is null or not can('called') then raise exception 'Only the office can log customer calls.'; end if;
  if not private.calls_on(s.company_id) or coalesce((select (calls->>'on')::boolean from companies where id=s.company_id),false) is not true then
    raise exception 'Calls are not enabled for this company.';
  end if;
  if coalesce(p_event,'')='' or p_status is null or p_status not in ('ringing','answered','missed') then raise exception 'Invalid call event.'; end if;
  if length(n)=10 then
    select bk.* into b from bookings bk join sheets sh on sh.id=bk.sheet_id
    where bk.company_id=s.company_id and bk.removed_at is null and private.phone10(bk.phone)=n
      and ((bk.kind='drops' and bk.cleared_at is null and sh.day=drops_day_of(coalesce(p_at,now()),(select c from companies c where c.id=s.company_id)))
        or (bk.kind='picks' and coalesce(bk.intake,'')='' and sh.day=(coalesce(p_at,now()) at time zone (select time_zone from companies where id=s.company_id))::date))
    order by (bk.kind='drops') desc limit 1;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(s.company_id::text||':'||event_key,0));
  select status into old_status from customer_calls where sid=event_key and company_id=s.company_id;
  insert into customer_calls(company_id,sid,at,from_number,booking_id,kind,reg,name,status,seconds)
    values(s.company_id,event_key,coalesce(p_at,now()),left(coalesce(p_from,''),40),b.id,coalesce(b.kind,''),coalesce(b.reg,''),coalesce(b.name,''),p_status,greatest(0,p_seconds))
    on conflict(sid) do update set status=case when excluded.status='ringing' and customer_calls.status<>'ringing' then customer_calls.status else excluded.status end,
      seconds=coalesce(excluded.seconds,customer_calls.seconds),booking_id=coalesce(customer_calls.booking_id,excluded.booking_id),
      kind=coalesce(nullif(customer_calls.kind,''),excluded.kind),reg=coalesce(nullif(customer_calls.reg,''),excluded.reg),name=coalesce(nullif(customer_calls.name,''),excluded.name)
    returning * into k;
  if p_status in ('answered','missed') and old_status is distinct from p_status then
    insert into activity(company_id,booking_id,reg,customer,staff_id,staff_name,action,value)
      values(s.company_id,k.booking_id,k.reg,k.name,s.id,coalesce(nullif(s.acting,''),s.name),'CALL',
        case when p_status='missed' then 'Missed call from ' else 'Answered call from ' end||k.from_number);
  end if;
  return k;
end $$;
revoke all on function phone_call_event(text,text,text,timestamptz,int) from public, anon;
grant execute on function phone_call_event(text,text,text,timestamptz,int) to authenticated;

-- Settings now switch the phone-SIM feature on/off. The Android app asks the
-- phone owner for the system's call-screening and SMS roles on that handset.
create or replace function set_calls(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s staff := me(); out jsonb;
begin
  if s.id is null or s.role <> 'owner' then raise exception 'Only an owner can change calls.'; end if;
  if not private.calls_on(s.company_id) then raise exception 'Calls are not switched on for this company.'; end if;
  out := jsonb_build_object('on',coalesce((p->>'on')::boolean,false));
  update companies set calls=out where id=s.company_id;
  insert into activity(company_id,staff_id,staff_name,action,value)
    values(s.company_id,s.id,coalesce(nullif(s.acting,''),s.name),'SETTINGS',case when (out->>'on')::boolean then 'Phone calls on (company Android)' else 'Phone calls off' end);
  return out;
end $$;
revoke execute on function set_calls(jsonb) from public, anon;
grant execute on function set_calls(jsonb) to authenticated;

-- Both tables need publication for immediate queue wake-up and live history.
do $$ declare tab text; begin
  foreach tab in array array['customer_texts','company_phones'] loop
    if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tab) then
      execute format('alter publication supabase_realtime add table %I',tab);
    end if;
  end loop;
end $$;
commit;
