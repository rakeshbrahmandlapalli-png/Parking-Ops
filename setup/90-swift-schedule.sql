-- Parking Ops — database part 90: scheduled booking import (the clock is NOT started here; see part 91).
-- APPLIED by Claude on 14 Oct at the user's request.
-- An owner or manager saves up to 6 London times and switches the schedule on or off. At a time, the function
-- checks the booking site like the button does and imports only if it is clean (no invalid record, no review case
-- the office has not already been told about, no unusually large change); otherwise it stops and the office is
-- notified. Imports are recorded as the person who switched the schedule on (setup 87: a made-up user breaks
-- staff_user_id_fkey). Nothing here starts anything: auto_import.enabled stays as it is until someone saves a schedule.

-- Owner or manager: save the times and switch the schedule on or off.
create or replace function swift_schedule_set(p_times text[], p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s staff := me(); t text[]; row_ jsonb;
begin
  if s.role not in ('owner', 'manager') then raise exception 'Only owners and managers can set the schedule.'; end if;
  select coalesce(array_agg(x order by x), '{}') into t from (select distinct trim(v) x from unnest(coalesce(p_times, '{}')) v where trim(v) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' limit 6) q;
  if p_on and coalesce(array_length(t, 1), 0) = 0 then raise exception 'Choose at least one time.'; end if;
  select config into row_ from private.auto_import where company_id = s.company_id;
  if row_ is null or coalesce(row_->>'base', '') = '' or coalesce((row_->>'manual_enabled')::boolean, false) is not true then
    raise exception 'Automatic bookings are not set up for this company.';
  end if;
  update private.auto_import
     set enabled = p_on,
         config = config || jsonb_build_object('schedule_times', to_jsonb(t), 'scheduled_by', s.user_id::text),
         updated_at = now()
   where company_id = s.company_id;
  insert into activity(company_id, staff_id, staff_name, action, value)
  values (s.company_id, s.id, s.name, 'AUTO IMPORT', case when p_on then 'schedule on: ' || array_to_string(t, ', ') else 'schedule off' end);
  return jsonb_build_object('on', p_on, 'times', to_jsonb(t));
end $$;
revoke all on function swift_schedule_set(text[], boolean) from public, anon;
grant execute on function swift_schedule_set(text[], boolean) to authenticated;

-- Service role: the slot just handled and what came of it (shown on the page).
create or replace function swift_schedule_mark(p_company uuid, p_slot text, p_result jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update private.auto_import
     set config = config || jsonb_build_object('last_slot', p_slot, 'last_schedule', coalesce(p_result, '{}') || jsonb_build_object('slot', p_slot, 'at', now())),
         updated_at = now()
   where company_id = p_company;
end $$;
revoke all on function swift_schedule_mark(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function swift_schedule_mark(uuid, text, jsonb) to service_role;

-- Service role: the review cases already on the open list ("kind|ref"), so only NEW ones hold a scheduled import.
create or replace function swift_reviews_known(p_company uuid) returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(kind || '|' || ref), '[]') from private.swift_reviews where company_id = p_company and status = 'open'
$$;
revoke all on function swift_reviews_known(uuid) from public, anon, authenticated;
grant execute on function swift_reviews_known(uuid) to service_role;

-- The screen's view of the connection: part 86's, plus the schedule (no config, no secrets).
create or replace function auto_import_status() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'available', coalesce(a.config->>'base', '') <> '' and coalesce((a.config->>'manual_enabled')::boolean, false),
      'running', a.lock_until is not null and a.lock_until > now(),
      'blocked_until', case when a.blocked_until > now() then a.blocked_until end,
      'last_run', a.last_run, 'last_ok', a.last_ok, 'last_error', a.last_error, 'last_summary', a.last_summary,
      'open_reviews', (select count(*) from private.swift_reviews r where r.company_id = a.company_id and r.status = 'open'),
      'schedule', jsonb_build_object('on', a.enabled, 'times', coalesce(a.config->'schedule_times', '[]'), 'last', a.config->'last_schedule',
        'by', (select st.name from staff st where st.user_id::text = a.config->>'scheduled_by' and st.company_id = a.company_id limit 1)))
    from private.auto_import a where a.company_id = (select company_id from me())),
    '{"available":false}'::jsonb)
$$;
revoke all on function auto_import_status() from public, anon;
grant execute on function auto_import_status() to authenticated;

-- Check
select 'ready' as part90,
  (select count(*) from pg_proc where proname in ('swift_schedule_set','swift_schedule_mark','swift_reviews_known','auto_import_status')) as functions;
