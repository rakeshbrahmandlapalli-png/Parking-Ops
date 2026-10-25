-- Parking Ops, database part 121: Voice calls (the caller keypad menu and calls answered
-- inside the TakeOff app) is an add-on per client, given from Parking Ops -> Clients -> Edit.
--   * private.voice_on(company) = Calls add-on on AND brand.voice true.
--   * admin_save_client: as part 117 (checked against the live definition on 25 Oct 2026),
--     plus the voice switch kept as true or false like texts and calls.
--   * voice_menu_settings, set_voice_menu, voice_device_context, voice_call_begin and
--     voice_call_route: as part 120, with private.voice_on in place of private.calls_on.
--     Switched off, the Twilio number answers 'unavailable', phones cannot register and
--     owners see no caller-menu settings. The route row and its history stay.
--   * TAKEOFF is switched on once (the pilot); a client already holding a choice is left alone.
-- Safe to run twice.
begin;
create or replace function private.voice_on(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.calls_on(p_company) and coalesce((select (c.brand->>'voice')::boolean from public.companies c where c.id = p_company), false)
$$;
revoke all on function private.voice_on(uuid) from public, anon, authenticated;

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
   'on',coalesce(r.menu_on,false),'greeting',coalesce(r.greeting,''),'number',r.inbound_number,'app_ready',ready,'addon',private.voice_on(s.company_id));
end $$;

create or replace function set_voice_menu(p_on boolean,p_greeting text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s staff:=me(); cfg jsonb;
begin
 if s.id is null or s.role<>'owner' then raise exception 'Only an owner can change the caller menu.'; end if;
 if not private.voice_on(s.company_id) then raise exception 'Calls are not enabled for this company.'; end if;
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

create or replace function voice_device_context(p_company uuid,p_staff uuid,p_device uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r private.voice_routes;
begin
 if not private.voice_on(p_company) or not private.voice_staff_allowed(p_staff) or not exists(
   select 1 from company_phones where company_id=p_company and device_id=p_device and staff_id=p_staff
 ) then raise exception 'This login and phone are not approved for company calls.'; end if;
 select * into r from private.voice_routes where company_id=p_company;
 if r.company_id is null or r.approved_at is null or not coalesce((select (calls->>'on')::boolean from companies where id=p_company),false) then return jsonb_build_object('ready',false); end if;
 return jsonb_build_object('ready',true,'identity',private.voice_identity(p_company,p_device),'account',r.account_sid,'company',p_company);
end $$;

create or replace function voice_call_begin(p_account text,p_to text,p_sid text,p_from text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r private.voice_routes; k customer_calls; x private.voice_sessions; hit jsonb; b bookings;
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
 end if;
 return jsonb_build_object('company',r.company_id,'menu_on',r.menu_on,'greeting',r.greeting,'name',(select coalesce(brand->>'short',name) from companies where id=r.company_id));
end $$;

create or replace function voice_call_route(p_sid text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare x private.voice_sessions; r private.voice_routes; k customer_calls; ident text;
begin
 select * into x from private.voice_sessions where sid=p_sid;
 if x.sid is null or x.ended or x.at<now()-interval '24 hours' then return null; end if;
 select * into r from private.voice_routes where company_id=x.company_id and approved_at is not null;
 if r.company_id is null or not private.voice_on(x.company_id) or not coalesce((select (calls->>'on')::boolean from companies where id=x.company_id),false) then return null; end if;
 select * into k from customer_calls where id=x.call_id;
 select v.identity into ident from private.voice_clients v join company_phones p using(company_id)
   where v.company_id=x.company_id and v.device_id=p.device_id and v.staff_id=p.staff_id
     and v.registered_until>now() and p.ready and p.seen_at>now()-interval '90 seconds' and private.voice_staff_allowed(v.staff_id);
 return jsonb_build_object('identity',ident,'fallback',r.fallback_number,'reg',k.reg,'name',k.name,'choice',k.digit);
end $$;

create or replace function admin_save_client(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c companies;
  y text;
  ys text[] := coalesce((select array_agg(upper(trim(v))) from jsonb_array_elements_text(coalesce(p->'yards', '[]')) v where trim(v) <> ''), '{}');
  b jsonb := coalesce(p->'brand', '{}');
  k text;
  -- The form always sends the look; an older app that doesn't leaves it alone.
  set_look boolean := coalesce(p->'brand', '{}') ? 'theme';
  -- Same for the PICKS location switch: an older form leaves it alone.
  set_py boolean := coalesce(p->'brand', '{}') ? 'picks_yard';
  -- Part 107: the Yard planner add-on switch, the same way.
  set_lp boolean := coalesce(p->'brand', '{}') ? 'lane_planner';
  -- Part 109: the Collections add-on, kept as true or false so part 109's
  -- one-time switch-on never comes back after it has been switched off.
  set_co boolean := coalesce(p->'brand', '{}') ? 'collections';
  -- Part 116: the Customer texts add-on, the same way.
  set_tx boolean := coalesce(p->'brand', '{}') ? 'texts';
  -- Part 117: the Calls add-on, the same way.
  set_cl boolean := coalesce(p->'brand', '{}') ? 'calls';
  -- Part 121: the Voice calls add-on, the same way.
  set_vc boolean := coalesce(p->'brand', '{}') ? 'voice';
  made boolean := coalesce(p->>'id', '') = '';
begin
  if not is_platform_admin() then raise exception 'Not allowed.'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter the client''s name.'; end if;
  if array_length(ys, 1) is null then raise exception 'Enter at least one yard.'; end if;
  foreach y in array ys loop
    if y !~ '^[A-Z0-9]{1,4}$' then raise exception 'Yard codes are 1 to 4 letters or numbers: %', y; end if;
  end loop;
  foreach k in array array['colour', 'ink', 'soft', 'text'] loop
    if coalesce(b->>k, '') <> '' and b->>k !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Colours look like #1560BD (%).', k; end if;
  end loop;
  if coalesce(b->>'host', '') <> '' and b->>'host' !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then raise exception 'The address looks like clientname-ops.vercel.app'; end if;
  if coalesce(b->>'theme', '') not in ('', 'pro', 'cards', 'premium', 'board', 'stdplus', 'ops', 'ops-refined') then raise exception 'Unknown look: %', b->>'theme'; end if;
  b := jsonb_strip_nulls(jsonb_build_object('name', trim(p->>'name'), 'short', nullif(trim(b->>'short'), ''),
    'colour', nullif(b->>'colour', ''), 'ink', nullif(b->>'ink', ''), 'soft', nullif(b->>'soft', ''), 'text', nullif(b->>'text', ''),
    'host', nullif(lower(b->>'host'), ''), 'logo', nullif(b->>'logo', ''), 'theme', nullif(b->>'theme', ''),
    'picks_yard', case when coalesce(b->>'picks_yard', '') = 'true' then true end,
    'lane_planner', case when coalesce(b->>'lane_planner', '') = 'true' then true end,
    'collections', case when set_co then coalesce(b->>'collections', '') = 'true' end,
    'texts', case when set_tx then coalesce(b->>'texts', '') = 'true' end,
    'calls', case when set_cl then coalesce(b->>'calls', '') = 'true' end,
    'voice', case when set_vc then coalesce(b->>'voice', '') = 'true' end));

  if made then
    if coalesce(p->>'slug', '') !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'The short code is lower-case letters, numbers and dashes, like airport-parking-bay.'; end if;
    if p->>'slug' = 'platform' then raise exception 'That short code is taken.'; end if;
    if exists (select 1 from companies where slug = p->>'slug') then raise exception 'That short code is taken.'; end if;
    insert into companies (name, slug, yards, drops_day_end, time_zone, brand)
    values (trim(p->>'name'), p->>'slug', ys, coalesce(nullif(p->>'drops_day_end', '')::time, '06:00'), 'Europe/London', b)
    returning * into c;
  else
    -- Standard drops the theme key: merging alone could never take it away.
    update companies set name = trim(p->>'name'), yards = ys,
      drops_day_end = coalesce(nullif(p->>'drops_day_end', '')::time, drops_day_end),
      brand = (case when set_look then brand - 'theme' else brand end) - (case when set_py then 'picks_yard' else '' end) - (case when set_lp then 'lane_planner' else '' end) - (case when set_co then 'collections' else '' end) - (case when set_tx then 'texts' else '' end) - (case when set_cl then 'calls' else '' end) - (case when set_vc then 'voice' else '' end) || b
    where id = (p->>'id')::uuid and slug <> 'platform' returning * into c;
    if not found then raise exception 'Client not found.'; end if;
  end if;
  insert into activity(company_id, staff_name, action, value)
  select c.id, s.name || ' (Parking Ops)', 'SETTINGS',
    case when made then 'Client set up' else 'Client details saved: look ' || coalesce(c.brand->>'theme', 'standard') ||
      ', yards ' || array_to_string(c.yards, ' ') ||
      ', PICKS location ' || case when (c.brand->>'picks_yard')::boolean then 'on' else 'off' end ||
      ', Yard planner ' || case when (c.brand->>'lane_planner')::boolean then 'on' else 'off' end ||
      ', Collections ' || case when (c.brand->>'collections')::boolean then 'on' else 'off' end ||
      ', Customer texts ' || case when (c.brand->>'texts')::boolean then 'on' else 'off' end ||
      ', Calls ' || case when (c.brand->>'calls')::boolean then 'on' else 'off' end ||
      ', Voice calls ' || case when (c.brand->>'voice')::boolean then 'on' else 'off' end end
  from me() s;
  return to_jsonb(c);
end;
$$;

update companies set brand = brand || '{"voice": true}'::jsonb where slug = 'takeoff' and not (brand ? 'voice');
revoke execute on function admin_save_client(jsonb) from public, anon;
grant execute on function admin_save_client(jsonb) to authenticated;
commit;
