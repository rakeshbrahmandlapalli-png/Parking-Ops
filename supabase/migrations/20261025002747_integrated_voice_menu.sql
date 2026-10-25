-- TakeOff part 120: optional hosted keypad menu and calls answered inside TakeOff.
-- Prepared only; account/number/FCM setup and explicit cost approval are required.
-- Mirrors the CLI-created migration in supabase/migrations; apply ONE copy only.
begin;
create table if not exists private.voice_routes (
  company_id uuid primary key references public.companies(id),
  account_sid text not null check(account_sid ~ '^AC[0-9a-fA-F]{32}$'),
  inbound_number text unique not null check(inbound_number ~ '^\+[1-9][0-9]{7,14}$'),
  company_number text not null check(company_number ~ '^\+[1-9][0-9]{7,14}$'),
  fallback_number text not null default '' check(fallback_number='' or fallback_number ~ '^\+[1-9][0-9]{7,14}$'),
  approved_at timestamptz,
  menu_on boolean not null default false,
  greeting text not null default '',
  check(length(greeting)<=400),
  check(fallback_number='' or (fallback_number<>inbound_number and fallback_number<>company_number)),
  check(not menu_on or approved_at is not null)
);
create table if not exists private.voice_clients (
  company_id uuid primary key references public.companies(id),
  device_id uuid not null,
  staff_id uuid not null references public.staff(id),
  identity text unique not null,
  registered_until timestamptz not null
);
create table if not exists private.voice_sessions (
  sid text primary key check(sid ~ '^CA[0-9a-fA-F]{32}$'),
  company_id uuid not null references public.companies(id),
  call_id bigint unique not null references public.customer_calls(id),
  at timestamptz not null default now(),
  choice text,
  answered boolean not null default false,
  ended boolean not null default false,
  logged_status text
);
alter table private.voice_routes enable row level security;
alter table private.voice_clients enable row level security;
alter table private.voice_sessions enable row level security;
revoke all on private.voice_routes,private.voice_clients,private.voice_sessions from public,anon,authenticated;

-- Match the existing called permission, including active status and explicit overrides.
create or replace function private.voice_staff_allowed(p_staff uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce((select active and not ('-called'=any(extra)) and ('called'=any(extra) or role in ('owner','manager','office')) from staff where id=p_staff),false)
$$;
create or replace function private.voice_identity(p_company uuid,p_device uuid) returns text
language sql immutable set search_path=public as $$
 select 'to_'||replace(p_company::text,'-','')||'_'||replace(p_device::text,'-','')
$$;
revoke all on function private.voice_staff_allowed(uuid),private.voice_identity(uuid,uuid) from public,anon,authenticated;

create or replace function voice_menu_settings() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare s staff:=me(); r private.voice_routes; ready boolean;
begin
 if s.id is null or s.role<>'owner' then raise exception 'Only an owner can view voice setup.'; end if;
 select * into r from private.voice_routes where company_id=s.company_id;
 select exists(select 1 from private.voice_clients v join company_phones p using(company_id)
   where v.company_id=s.company_id and v.device_id=p.device_id and v.staff_id=p.staff_id
     and v.registered_until>now() and p.ready and p.seen_at>now()-interval '90 seconds' and private.voice_staff_allowed(v.staff_id)) into ready;
 return jsonb_build_object('configured',r.company_id is not null,'approved',r.approved_at is not null,
   'on',coalesce(r.menu_on,false),'greeting',coalesce(r.greeting,''),'number',r.inbound_number,'app_ready',ready);
end $$;
create or replace function set_voice_menu(p_on boolean,p_greeting text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s staff:=me(); cfg jsonb;
begin
 if s.id is null or s.role<>'owner' then raise exception 'Only an owner can change the caller menu.'; end if;
 if not private.calls_on(s.company_id) then raise exception 'Calls are not enabled for this company.'; end if;
 if length(coalesce(p_greeting,''))>400 then raise exception 'The greeting is 400 characters at most.'; end if;
 cfg:=voice_menu_settings();
 if not (cfg->>'configured')::boolean then raise exception 'The phone service must be configured first.'; end if;
 if coalesce(p_on,false) and (not (cfg->>'approved')::boolean or not (cfg->>'app_ready')::boolean) then
   raise exception 'Approve the service costs and register the company phone before enabling the menu.';
 end if;
 if coalesce(p_on,false) and not coalesce((select (calls->>'on')::boolean from companies where id=s.company_id),false) then raise exception 'Switch Calls in the app on first.'; end if;
 update private.voice_routes set menu_on=coalesce(p_on,false),greeting=trim(coalesce(p_greeting,'')) where company_id=s.company_id;
 insert into activity(company_id,staff_id,staff_name,action,value) values(s.company_id,s.id,coalesce(nullif(s.acting,''),s.name),'SETTINGS',case when coalesce(p_on,false) then 'Caller keypad menu on' else 'Caller keypad menu off' end);
 return voice_menu_settings();
end $$;
revoke all on function voice_menu_settings(),set_voice_menu(boolean,text) from public,anon;
grant execute on function voice_menu_settings(),set_voice_menu(boolean,text) to authenticated;

-- Called only by the authenticated access-token Edge Function, after checking the JWT.
create or replace function voice_device_context(p_company uuid,p_staff uuid,p_device uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r private.voice_routes;
begin
 if not private.calls_on(p_company) or not private.voice_staff_allowed(p_staff) or not exists(
   select 1 from company_phones where company_id=p_company and device_id=p_device and staff_id=p_staff
 ) then raise exception 'This login and phone are not approved for company calls.'; end if;
 select * into r from private.voice_routes where company_id=p_company;
 if r.company_id is null or r.approved_at is null or not coalesce((select (calls->>'on')::boolean from companies where id=p_company),false) then return jsonb_build_object('ready',false); end if;
 return jsonb_build_object('ready',true,'identity',private.voice_identity(p_company,p_device),'account',r.account_sid,'company',p_company);
end $$;
create or replace function voice_device_ready(p_company uuid,p_staff uuid,p_device uuid,p_registered boolean) returns boolean
language plpgsql security definer set search_path=public as $$
declare cfg jsonb:=voice_device_context(p_company,p_staff,p_device);
begin
 if not coalesce((cfg->>'ready')::boolean,false) then return false; end if;
 insert into private.voice_clients(company_id,device_id,staff_id,identity,registered_until)
 values(p_company,p_device,p_staff,cfg->>'identity',case when coalesce(p_registered,false) then now()+interval '24 hours' else now() end)
 on conflict(company_id) do update set device_id=excluded.device_id,staff_id=excluded.staff_id,identity=excluded.identity,registered_until=excluded.registered_until;
 return true;
end $$;

-- Only a validated provider webhook calls this; company comes from AccountSid + To.
create or replace function voice_call_begin(p_account text,p_to text,p_sid text,p_from text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r private.voice_routes; k customer_calls; x private.voice_sessions; hit jsonb; b bookings;
begin
 if p_sid is null or p_sid !~ '^CA[0-9a-fA-F]{32}$' then raise exception 'Invalid call identifier.'; end if;
 select * into r from private.voice_routes where account_sid=p_account and inbound_number=p_to and approved_at is not null;
 if r.company_id is null or not private.calls_on(r.company_id) or not coalesce((select (calls->>'on')::boolean from companies where id=r.company_id),false) then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('voice:'||p_sid,0));
 select * into x from private.voice_sessions where sid=p_sid;
 if x.sid is not null then
   if x.company_id<>r.company_id or x.at<now()-interval '24 hours' or x.ended then return null; end if;
 else
   if p_from ~ '^\+44[0-9]{10}$' then hit:=private.phone_booking(r.company_id,p_from,now()); end if;
   if hit->>'match'='one' then select * into b from bookings where id=(hit->>'id')::uuid; end if;
   insert into customer_calls(company_id,sid,from_number,booking_id,kind,reg,name)
     values(r.company_id,'voice:'||p_sid,left(coalesce(p_from,''),40),b.id,coalesce(b.kind,''),coalesce(b.reg,''),coalesce(b.name,'')) returning * into k;
   insert into private.voice_sessions(sid,company_id,call_id) values(p_sid,r.company_id,k.id);
 end if;
 return jsonb_build_object('company',r.company_id,'menu_on',r.menu_on,'greeting',r.greeting,'name',(select coalesce(brand->>'short',name) from companies where id=r.company_id));
end $$;

create or replace function voice_call_choice(p_sid text,p_digit text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare x private.voice_sessions; k customer_calls; c companies; b bookings; ids uuid[]; want text; mark text:='';
begin
 select * into x from private.voice_sessions where sid=p_sid for update;
 if x.sid is null or x.ended or x.at<now()-interval '24 hours' then return null; end if;
 select * into k from customer_calls where id=x.call_id;
 -- One selection per call; duplicate webhooks cannot mark again or switch kind.
 if x.choice is not null then return jsonb_build_object('marked',k.marked,'choice',x.choice); end if;
 if p_digit is null or p_digit not in ('0','1','2','') then raise exception 'Invalid keypad selection.'; end if;
 update private.voice_sessions set choice=p_digit where sid=p_sid;
 if not exists(select 1 from private.voice_routes where company_id=x.company_id and menu_on and approved_at is not null) or not coalesce((select (calls->>'on')::boolean from companies where id=x.company_id),false) then return jsonb_build_object('marked','','choice',p_digit); end if;
 want:=case p_digit when '1' then 'drops' when '2' then 'picks' end;
 select * into c from companies where id=x.company_id;
 if want is not null and k.from_number ~ '^\+44[0-9]{10}$' then
   select array_agg(bk.id) into ids from bookings bk join sheets sh on sh.id=bk.sheet_id
    where bk.company_id=x.company_id and bk.kind=want and bk.removed_at is null
      and private.phone10(bk.phone)=private.phone10(k.from_number)
      and ((want='drops' and bk.cleared_at is null and sh.day=drops_day_of(x.at,c)) or
           (want='picks' and coalesce(bk.intake,'')='' and sh.day=(x.at at time zone c.time_zone)::date));
   if cardinality(ids)=1 then
     select * into b from bookings where id=ids[1] for update;
     -- Re-check state after acquiring the booking lock, in case another caller cleared it.
     if b.company_id=x.company_id and exists(select 1 from sheets where id=b.sheet_id and day=case want when 'drops' then drops_day_of(x.at,c) else (x.at at time zone c.time_zone)::date end) and b.removed_at is null and b.kind=want and private.phone10(b.phone)=private.phone10(k.from_number) and ((want='drops' and b.cleared_at is null) or (want='picks' and coalesce(b.intake,'')='')) then
       if want='drops' and b.called_at is null then
         update bookings set called_at=now(),called_word='Called',called_by=null,by_name=coalesce(by_name,'{}')||jsonb_build_object('called_by','Phone menu') where id=b.id;
         mark:='CALLED';
       elsif want='picks' and coalesce(b.pick_called,'')='' then
         update bookings set pick_called='Called',pick_called_at=now() where id=b.id;
         mark:='CALLED';
       else mark:='already'; end if;
       update customer_calls set booking_id=b.id,kind=b.kind,reg=b.reg,name=b.name where id=k.id;
       if mark='CALLED' then
         insert into activity(company_id,booking_id,reg,customer,staff_name,action,value) values(x.company_id,b.id,b.reg,b.name,'Phone menu','CALLED',case p_digit when '1' then 'Customer pressed 1: landed' else 'Customer pressed 2: dropping off' end);
       end if;
     end if;
   else
     -- Do not leave the provisional DROPS match attached to a conflicting PICKS choice.
     update customer_calls set booking_id=null,kind='',reg='',name='' where id=k.id;
   end if;
 end if;
 update customer_calls set digit=p_digit,marked=mark where id=k.id;
 return jsonb_build_object('marked',mark,'choice',p_digit);
end $$;

create or replace function voice_call_route(p_sid text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare x private.voice_sessions; r private.voice_routes; k customer_calls; ident text;
begin
 select * into x from private.voice_sessions where sid=p_sid;
 if x.sid is null or x.ended or x.at<now()-interval '24 hours' then return null; end if;
 select * into r from private.voice_routes where company_id=x.company_id and approved_at is not null;
 if r.company_id is null or not private.calls_on(x.company_id) or not coalesce((select (calls->>'on')::boolean from companies where id=x.company_id),false) then return null; end if;
 select * into k from customer_calls where id=x.call_id;
 select v.identity into ident from private.voice_clients v join company_phones p using(company_id)
   where v.company_id=x.company_id and v.device_id=p.device_id and v.staff_id=p.staff_id
     and v.registered_until>now() and p.ready and p.seen_at>now()-interval '90 seconds' and private.voice_staff_allowed(v.staff_id);
 return jsonb_build_object('identity',ident,'fallback',r.fallback_number,'reg',k.reg,'name',k.name,'choice',k.digit);
end $$;

create or replace function voice_call_status(p_sid text,p_status text,p_seconds int default null) returns boolean
language plpgsql security definer set search_path=public as $$
declare x private.voice_sessions; k customer_calls; next_status text;
begin
 if p_status is null or p_status not in ('answered','missed','completed') then raise exception 'Invalid voice status.'; end if;
 select * into x from private.voice_sessions where sid=p_sid for update;
 if x.sid is null then return false; end if;
 select * into k from customer_calls where id=x.call_id;
 next_status:=case when x.answered or p_status in ('answered','completed') then 'answered' else 'missed' end;
 update private.voice_sessions set answered=(next_status='answered'),ended=ended or p_status in ('missed','completed') where sid=p_sid;
 update customer_calls set status=next_status,seconds=case when p_seconds is not null then greatest(coalesce(seconds,0),greatest(0,p_seconds)) else seconds end where id=k.id;
 if (p_status in ('missed','completed') or x.ended) and x.logged_status is distinct from next_status then
   insert into activity(company_id,booking_id,reg,customer,staff_name,action,value) values(x.company_id,k.booking_id,k.reg,k.name,'Phone menu','CALL',case next_status when 'answered' then 'Voice call confirmed answered from ' else 'Voice call missed from ' end||k.from_number);
   update private.voice_sessions set logged_status=next_status where sid=p_sid;
 end if;
 return true;
end $$;
revoke all on function voice_device_context(uuid,uuid,uuid),voice_device_ready(uuid,uuid,uuid,boolean),voice_call_begin(text,text,text,text),voice_call_choice(text,text),voice_call_route(text),voice_call_status(text,text,int) from public,anon,authenticated;
grant execute on function voice_device_context(uuid,uuid,uuid),voice_device_ready(uuid,uuid,uuid,boolean),voice_call_begin(text,text,text,text),voice_call_choice(text,text),voice_call_route(text),voice_call_status(text,text,int) to service_role;
commit;
