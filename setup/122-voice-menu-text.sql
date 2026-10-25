-- Parking Ops, database part 122: text the caller the keypad instructions (demo first).
-- When the caller keypad menu answers a call from a UK mobile, the caller is also sent
-- "press 1 if your flight has landed, 2 if you are dropping off, 0 for the office".
--   * private.voice_routes.menu_text: 'off', 'demo' (the default: written on the call, never
--     sent) or 'on' (queued for the company phone; only while the Customer texts add-on and
--     Settings -> Customer texts are on and not in demo, otherwise it stays demo).
--   * voice_menu_settings also returns menu_text; set_voice_menu_text(mode), owners only.
--   * voice_call_begin: as part 121, plus one text per caller number per London day
--     (customer_texts, rule 'manual', dedupe_key 'text:callmenu:<number>:<day>'). The call is
--     never held up or failed by the text.
-- Nothing changes while the menu is off. Safe to run twice.
begin;
alter table private.voice_routes add column if not exists menu_text text not null default 'demo';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'voice_routes_menu_text_check') then
    alter table private.voice_routes add constraint voice_routes_menu_text_check check (menu_text in ('off', 'demo', 'on'));
  end if;
end $$;

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
   'on',coalesce(r.menu_on,false),'greeting',coalesce(r.greeting,''),'number',r.inbound_number,'app_ready',ready,'addon',private.voice_on(s.company_id),
   'menu_text',coalesce(r.menu_text,'demo'));
end $$;

create or replace function set_voice_menu_text(p_mode text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s staff:=me();
begin
 if s.id is null or s.role<>'owner' then raise exception 'Only an owner can change the caller menu text.'; end if;
 if not private.voice_on(s.company_id) then raise exception 'Calls are not enabled for this company.'; end if;
 if p_mode is null or p_mode not in ('off','demo','on') then raise exception 'Choose off, demo or on.'; end if;
 if not exists(select 1 from private.voice_routes where company_id=s.company_id) then raise exception 'The phone service must be configured first.'; end if;
 update private.voice_routes set menu_text=p_mode where company_id=s.company_id;
 insert into activity(company_id,staff_id,staff_name,action,value) values(s.company_id,s.id,coalesce(nullif(s.acting,''),s.name),'SETTINGS',
   case p_mode when 'on' then 'Caller menu text on' when 'demo' then 'Caller menu text demo (not sent)' else 'Caller menu text off' end);
 return voice_menu_settings();
end $$;
revoke execute on function set_voice_menu_text(text) from public, anon;
grant execute on function set_voice_menu_text(text) to authenticated;

create or replace function voice_call_begin(p_account text,p_to text,p_sid text,p_from text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r private.voice_routes; k customer_calls; x private.voice_sessions; hit jsonb; b bookings; co companies; word text; body text; st text;
begin
 if p_sid is null or p_sid !~ '^CA[0-9a-fA-F]{32}$' then raise exception 'Invalid call identifier.'; end if;
 select * into r from private.voice_routes where account_sid=p_account and inbound_number=p_to and approved_at is not null;
 if r.company_id is null or not private.voice_on(r.company_id) or not coalesce((select (calls->>'on')::boolean from companies where id=r.company_id),false) then return null; end if;
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
   -- The keypad instructions as a text, once per caller number per day. A failure here
   -- must never stop the call, so it is caught and discarded.
   if r.menu_on and coalesce(r.menu_text,'demo')<>'off' and p_from ~ '^\+447[0-9]{9}$' then
     begin
       select * into co from companies where id=r.company_id;
       word:=coalesce(nullif(trim(co.texts->>'sender'),''),co.brand->>'short',co.name);
       body:='Thanks for calling '||word||'. Press 1 if your flight has landed, 2 if you are dropping off, or 0 for the office.'||
         case when coalesce(trim(co.texts->>'office'),'')<>'' then ' Office: '||trim(co.texts->>'office')||'.' else '' end;
       st:=case when r.menu_text='on' and coalesce(co.brand->>'texts','')='true' and coalesce((co.texts->>'on')::boolean,false) and not coalesce((co.texts->>'demo')::boolean,false) then 'queued' else 'demo' end;
       insert into customer_texts(company_id,booking_id,rule,to_number,body,status,parts,staff_name,dedupe_key)
         values(r.company_id,b.id,'manual',p_from,body,st,case when length(body)<=160 then 1 else ceil(length(body)/153.0)::int end,'Phone',
           'text:callmenu:'||p_from||':'||(now() at time zone 'Europe/London')::date)
         on conflict (company_id,dedupe_key) do nothing;
     exception when others then null;
     end;
   end if;
 end if;
 return jsonb_build_object('company',r.company_id,'menu_on',r.menu_on,'greeting',r.greeting,'name',(select coalesce(brand->>'short',name) from companies where id=r.company_id));
end $$;
revoke all on function voice_call_begin(text,text,text,text) from public,anon,authenticated;
grant execute on function voice_call_begin(text,text,text,text) to service_role;
commit;
