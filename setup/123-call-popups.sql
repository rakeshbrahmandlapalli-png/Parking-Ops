-- Parking Ops, database part 123: call pop-ups are their own permission, and an incoming call can push
-- to phones when TakeOff is closed (26 Oct 2026, the user's request).
--   * can('callpop'): owners, managers and the office by default; anyone can be given it or refused it in
--     Staff -> PIN and access ("Call pop-ups and call alerts", stored as 'callpop' / '-callpop'). It no longer
--     rides on CALLED. my_permissions returns it and set_staff_access accepts it.
--   * alert_prefs.calls (default true) is each person's own "Incoming calls" alert switch,
--     saved by set_call_alerts(on). set_alert_prefs is left alone.
--   * call_alert_staff(company): the active people who get the push, service role only: calls add-on on,
--     'callpop' by role and access list, switch not off.
--   * Trigger customer_calls_alert: a new ringing call tells send-alerts ({type:'call', id}), the same way
--     bookings_alert does; an alert must never block the call, so errors are caught.
-- can() is part 115's, my_permissions part 115's, set_staff_access part 115's (checked against the live
-- definitions on 26 Oct 2026), each with only these changes. Safe to run twice.
begin;

create or replace function can(p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  s staff := me();
  roles text[];
begin
  if s.id is null then return false; end if;
  if p_action = 'collections' and not private.collections_on(s.company_id) then return false; end if;
  if ('-' || p_action) = any(s.extra) then return false; end if;
  if p_action = any(s.extra) then return true; end if;
  if s.role = 'owner' then return true; end if;
  -- AT DESK: whoever can press CALLED can also press AT DESK (part 115).
  if p_action = 'desk' and s.role <> 'view' and can('called') then return true; end if;
  roles := case p_action
    when 'sent'        then array['office','manager','bongo']
    when 'called'      then array['office','manager']
    when 'desk'        then array['office','manager','terminal']
    when 'clear'       then array['office','manager','terminal']
    when 'yard'        then array['office','manager']
    when 'summary'     then array['office','manager']
    when 'log'         then array['office','manager']
    when 'flights'     then array['office']
    when 'rtc'         then array['office','manager','bongo']
    when 'picksinfo'   then array['office','manager','terminal']
    when 'import'      then array['office','manager']
    when 'staff'       then array['office','manager']
    when 'settings'    then array['manager']
    when 'collections' then array['office','manager']
    when 'callpop'     then array['office','manager']
    else null end;
  if roles is null then return s.role <> 'view'; end if;
  return s.role = any(roles);
end;
$$;

create or replace function my_permissions() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(a, can(a)) from unnest(array['sent','called','desk','clear','yard','summary','log','flights','rtc','picksinfo','import','staff','note','intake','settings','collections','callpop']) a
$$;

create or replace function set_staff_access(p_staff uuid, p_extra text[])
returns staff language plpgsql security definer set search_path = public as $$
declare
  t staff := staff_target(p_staff);
  was text[] := t.extra;
  x text;
  allowed text[] := array['sent','called','desk','clear','yard','note','flights','intake','rtc','picksinfo','summary','log','import','staff','settings','collections','callpop'];
begin
  foreach x in array coalesce(p_extra, '{}') loop
    if not (ltrim(x, '-') = any(allowed)) then raise exception 'Unknown permission: %', x; end if;
  end loop;
  update staff set extra = coalesce(p_extra, '{}') where id = t.id returning * into t;
  insert into activity(company_id, staff_id, staff_name, action, value)
  select t.company_id, s.id, s.name, 'STAFF', 'Changed access for ' || t.name || ': was ' || private.access_words(was) || ', now ' || private.access_words(t.extra) from me() s;
  return t;
end;
$$;

alter table alert_prefs add column if not exists calls boolean not null default true;

create or replace function set_call_alerts(p_on boolean)
returns alert_prefs language plpgsql security definer set search_path = public as $$
declare s staff := me(); r alert_prefs;
begin
  if s.id is null then raise exception 'Sign in again.'; end if;
  insert into alert_prefs (staff_id, company_id, calls) values (s.id, s.company_id, coalesce(p_on, true))
  on conflict (staff_id) do update set calls = excluded.calls, updated_at = now()
  returning * into r;
  return r;
end;
$$;

create or replace function call_alert_staff(p_company uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(s.id), '{}') from staff s
  left join alert_prefs a on a.staff_id = s.id
  where s.company_id = p_company and s.active and private.calls_on(p_company)
    and coalesce(a.calls, true)
    and not ('-callpop' = any(s.extra))
    and ('callpop' = any(s.extra) or s.role in ('owner', 'manager', 'office'))
$$;

create or replace function customer_calls_alert()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare url text;
begin
  if new.status <> 'ringing' then return null; end if;
  select function_url into url from private.alert_config;
  if url is null then return null; end if;
  perform net.http_post(url := url,
    body := jsonb_build_object('type', 'call', 'id', new.id),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000);
  return null;
exception when others then
  raise warning 'call alert skipped: %', sqlerrm;   -- an alert must never block a call
  return null;
end;
$$;
create or replace trigger customer_calls_alert after insert on customer_calls
  for each row execute function customer_calls_alert();

revoke execute on function can(text), my_permissions(), set_staff_access(uuid, text[]), set_call_alerts(boolean) from public, anon;
grant execute on function can(text), my_permissions(), set_staff_access(uuid, text[]), set_call_alerts(boolean) to authenticated;
revoke all on function call_alert_staff(uuid), customer_calls_alert() from public, anon, authenticated;
grant execute on function call_alert_staff(uuid) to service_role;
commit;
