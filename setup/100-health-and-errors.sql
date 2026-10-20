-- Parking Ops — database part 100: phone error reports and System health.
--
-- Phone errors: the app sends what went wrong (the message, the screen, the
-- phone, the app version) through report_errors(). The same message from the
-- same person within an hour adds to one line's count instead of a new line,
-- and one person can add at most 60 lines a day, so a phone stuck in a loop
-- can't fill the table. Kept 30 days (takeoff-housekeeping-style timer below).
--
-- Health: admin_health() gives the product owner (Clients → Health) the state
-- of what runs on its own: timers, server-function calls, backups, flight
-- APIs, booking import, notifications and phone errors, per client.
-- health_warnings() is the short list that needs a person; send-alerts
-- ("health" message, every 15 minutes) pushes each one once a day to the
-- product owner's platform login and the staff ids listed in private.settings
-- 'health_alert_staff' (comma-separated: the product owner's own logins in
-- client apps, which have the phones), and to the Discord webhook in
-- private.settings 'health_discord_url' if one is set. Client owners are not
-- told: a warning can name another client.
--
-- AeroDataBox units: flights v29 writes the calls each timetable run made
-- (result.calls). Units = calls × 'aerodata_units_per_call' (2 unless set),
-- against 'aerodata_units_month' (40000, the Starter plan). An estimate: the
-- AeroDataBox dashboard has the real figure.
--
-- Needs send-alerts v21 (the "health" message) before the timer is useful;
-- the timer only posts a message, so running this first is harmless.
-- Safe to run twice.
begin;

create table if not exists private.client_errors (
  id bigserial primary key,
  company_id uuid not null references companies(id) on delete cascade,
  staff_id uuid references staff(id) on delete set null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  n int not null default 1,
  message text not null,
  view text not null default '',
  device text not null default '',
  version text not null default ''
);
create index if not exists client_errors_recent_idx on private.client_errors (company_id, last_at desc);
create index if not exists client_errors_same_idx on private.client_errors (staff_id, message, last_at desc);

create table if not exists private.push_failures (
  id bigserial primary key,
  at timestamptz not null default now(),
  company_id uuid references companies(id) on delete cascade,
  code int,
  detail text not null default ''
);
create index if not exists push_failures_at_idx on private.push_failures (at desc);

insert into private.settings(name, value) values ('aerodata_units_per_call', '2'), ('aerodata_units_month', '40000')
on conflict (name) do nothing;

-- p_list: [{m, view, at}], newest last; device and version once for the batch.
create or replace function report_errors(p_list jsonb, p_device text default '', p_version text default '')
returns int language plpgsql security definer set search_path = public as $$
declare s staff := me(); e jsonb; msg text; v text; added int := 0; today int;
begin
  if s.id is null or jsonb_typeof(p_list) <> 'array' then return 0; end if;
  today := (select count(*) from private.client_errors where staff_id = s.id and first_at > now() - interval '1 day');
  for e in select * from jsonb_array_elements(p_list) limit 20 loop
    msg := left(btrim(coalesce(e->>'m', '')), 300);
    v := left(coalesce(e->>'view', ''), 40);
    if msg = '' then continue; end if;
    update private.client_errors set n = n + 1, last_at = now()
      where id = (select id from private.client_errors where staff_id = s.id and message = msg and view = v and last_at > now() - interval '1 hour' order by last_at desc limit 1);
    if not found then
      if today >= 60 then continue; end if;
      insert into private.client_errors(company_id, staff_id, message, view, device, version)
        values (s.company_id, s.id, msg, v, left(coalesce(p_device, ''), 160), left(coalesce(p_version, ''), 40));
      today := today + 1;
    end if;
    added := added + 1;
  end loop;
  return added;
end $$;

-- The AeroDataBox estimate for this calendar month (UTC), every client together.
create or replace function private.aerodata_month() returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (
    select count(*) filter (where coalesce(result->>'error', '') = '') runs,
           coalesce(sum((result->>'calls')::int) filter (where result ? 'calls'), 0) calls,
           min(at) filter (where result ? 'calls') counted_from,
           max(at) filter (where result->>'error' ~* 'quota') quota_at
    from flight_runs where source = 'schedule' and at >= date_trunc('month', now())
  ), k as (
    select coalesce((select value::numeric from private.settings where name = 'aerodata_units_per_call'), 2) per,
           coalesce((select value::numeric from private.settings where name = 'aerodata_units_month'), 40000) cap
  )
  select jsonb_build_object('calls', r.calls, 'units', round(r.calls * k.per), 'cap', k.cap,
    'pct', round(100 * r.calls * k.per / nullif(k.cap, 0)), 'counted_from', r.counted_from, 'quota_at', r.quota_at,
    'per_call', k.per)
  from r, k
$$;

create or replace function admin_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object(
    'at', now(),
    'warnings', health_warnings_list(),
    'backup', (select jsonb_build_object('last', max(taken_at), 'count', count(*)) from private.backups),
    'timers', coalesce((select jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active,
        'last_ok', (select max(d.end_time) from cron.job_run_details d where d.jobid = j.jobid and d.status = 'succeeded'),
        'failed_24h', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.status = 'failed' and d.start_time > now() - interval '24 hours'),
        'last_error', (select left(d.return_message, 160) from cron.job_run_details d where d.jobid = j.jobid and d.status = 'failed' order by d.start_time desc limit 1))
      order by j.jobname) from cron.job j), '[]'::jsonb),
    'calls', (select jsonb_build_object('ok', count(*) filter (where status_code between 200 and 299),
        'failed', count(*) filter (where status_code is null or status_code not between 200 and 299),
        'last_error', (select left(coalesce(x.error_msg, x.status_code::text), 160) from net._http_response x
          where (x.status_code is null or x.status_code not between 200 and 299) and x.created > now() - interval '1 hour' order by x.created desc limit 1))
      from net._http_response where created > now() - interval '1 hour'),
    'aerodata', private.aerodata_month(),
    'push_failed_24h', (select count(*) from private.push_failures where at > now() - interval '24 hours'),
    'clients', coalesce((select jsonb_agg(x order by x->>'name') from (
      select jsonb_build_object(
        'id', c.id, 'name', c.name,
        'live_last', (select max(r.at) from flight_runs r where r.company_id = c.id and r.source = 'live'),
        'live_error', (select r.result->>'error' from flight_runs r where r.company_id = c.id and r.source = 'live' and r.at > now() - interval '2 hours' order by r.at desc limit 1),
        'timetable_last', (select max(r.at) from flight_runs r where r.company_id = c.id and r.source = 'schedule'),
        'timetable_error', (select r.result->>'error' from flight_runs r where r.company_id = c.id and r.source = 'schedule' order by r.at desc limit 1),
        'aerodata_calls_month', (select coalesce(sum((r.result->>'calls')::int), 0) from flight_runs r where r.company_id = c.id and r.source = 'schedule' and r.result ? 'calls' and r.at >= date_trunc('month', now())),
        'import_last', (select max(i.at) from private.imports i where i.company_id = c.id),
        'auto_import', (select jsonb_build_object('enabled', a.enabled, 'last_run', a.last_run, 'last_ok', a.last_ok, 'last_error', left(a.last_error, 160))
          from private.auto_import a where a.company_id = c.id),
        'phones_push', (select count(*) from push_subscriptions p where p.company_id = c.id),
        'online', (select count(*) from staff_seen v where v.company_id = c.id and v.seen_at > now() - interval '5 minutes'),
        'last_activity', (select max(a.at) from activity a where a.company_id = c.id),
        'errors_24h', (select coalesce(sum(e.n), 0) from private.client_errors e where e.company_id = c.id and e.last_at > now() - interval '24 hours'),
        'errors', coalesce((select jsonb_agg(jsonb_build_object('at', e.last_at, 'n', e.n, 'm', e.message, 'view', e.view, 'device', e.device,
            'version', e.version, 'who', (select t.name from staff t where t.id = e.staff_id)) order by e.last_at desc)
          from (select * from private.client_errors e where e.company_id = c.id and e.last_at > now() - interval '7 days' order by e.last_at desc limit 25) e), '[]'::jsonb)
      ) x from companies c where c.slug <> 'platform' and c.suspended_at is null) t), '[]'::jsonb)
  );
end $$;

-- What needs a person, each with a key that stays the same while it lasts
-- (send-alerts sends a key once a day).
create or replace function health_warnings_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w jsonb := '[]'::jsonb; last_backup timestamptz := (select max(taken_at) from private.backups); ad jsonb := private.aerodata_month(); r record;
begin
  if last_backup is null or last_backup < now() - interval '30 hours' then
    w := w || jsonb_build_object('key', 'backup', 'text', 'No nightly backup since ' || coalesce(to_char(last_backup at time zone 'Europe/London', 'DD Mon HH24:MI'), 'ever') || '.');
  end if;
  for r in select j.jobname, left(d.return_message, 120) msg from cron.job j
      join lateral (select * from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) d on true
      where j.active and d.status = 'failed' and d.start_time > now() - interval '2 hours' loop
    w := w || jsonb_build_object('key', 'timer:' || r.jobname, 'text', 'Timer ' || r.jobname || ' failed: ' || coalesce(r.msg, '') );
  end loop;
  if (select count(*) filter (where status_code is null or status_code not between 200 and 299) from net._http_response where created > now() - interval '30 minutes') >= 5 then
    w := w || jsonb_build_object('key', 'calls', 'text', 'Server functions are failing: ' ||
      (select count(*) filter (where status_code is null or status_code not between 200 and 299) from net._http_response where created > now() - interval '30 minutes') ||
      ' failed calls in the last 30 minutes.');
  end if;
  if (ad->>'quota_at')::timestamptz > now() - interval '6 hours' then
    w := w || jsonb_build_object('key', 'aerodata:quota', 'text', 'AeroDataBox says this month''s units are used up. Flight times stop filling until it renews or the plan is raised.');
  elsif (ad->>'pct')::int >= 80 then
    w := w || jsonb_build_object('key', 'aerodata:80', 'text', 'AeroDataBox: about ' || (ad->>'pct') || '% of this month''s units used (' || (ad->>'units') || ' of ' || (ad->>'cap') || ', estimated).');
  end if;
  for r in select c.name, left(a.last_error, 120) err from private.auto_import a join companies c on c.id = a.company_id
      where a.enabled and a.last_error is not null and a.last_run > now() - interval '3 hours' and (a.last_ok is null or a.last_ok < a.last_run) loop
    w := w || jsonb_build_object('key', 'import:' || r.name, 'text', r.name || ': the scheduled booking import failed: ' || r.err);
  end loop;
  for r in select c.name, sum(e.n) n from private.client_errors e join companies c on c.id = e.company_id
      where e.last_at > now() - interval '1 hour' group by c.name having sum(e.n) >= 20 loop
    w := w || jsonb_build_object('key', 'errors:' || r.name, 'text', r.name || ': ' || r.n || ' app errors on phones in the last hour.');
  end loop;
  return w;
end $$;

-- send-alerts reads the warnings and who gets them.
create or replace function health_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('warnings', health_warnings_list(),
    'to', (select coalesce(jsonb_agg(distinct s.id), '[]'::jsonb) from staff s join companies c on c.id = s.company_id
      where s.active and ((s.role = 'owner' and c.slug = 'platform')
        or s.id::text = any(string_to_array(replace(coalesce((select value from private.settings where name = 'health_alert_staff'), ''), ' ', ''), ',')))),
    'discord', (select value from private.settings where name = 'health_discord_url'))
$$;

create or replace function note_push_failure(p_company uuid, p_code int, p_detail text) returns void
language sql security definer set search_path = public as $$
  insert into private.push_failures(company_id, code, detail) values (p_company, p_code, left(coalesce(p_detail, ''), 200));
  delete from private.push_failures where at < now() - interval '30 days';
$$;

create or replace function private.trim_health() returns void
language sql security definer set search_path = public as $$
  delete from private.client_errors where last_at < now() - interval '30 days';
  delete from private.push_failures where at < now() - interval '30 days';
$$;

revoke all on function report_errors(jsonb, text, text) from public, anon;
grant execute on function report_errors(jsonb, text, text) to authenticated;
revoke all on function admin_health() from public, anon;
grant execute on function admin_health() to authenticated;
revoke all on function health_warnings_list() from public, anon, authenticated;
revoke all on function health_status() from public, anon, authenticated;
grant execute on function health_status() to service_role;
revoke all on function note_push_failure(uuid, int, text) from public, anon, authenticated;
grant execute on function note_push_failure(uuid, int, text) to service_role;
revoke all on function private.aerodata_month() from public, anon, authenticated;
revoke all on function private.trim_health() from public, anon, authenticated;

select cron.unschedule('health-warning') where exists (select 1 from cron.job where jobname = 'health-warning');
select cron.schedule('health-warning', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://oioqjfrlwrjovnouhusp.supabase.co/functions/v1/send-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-timer', (select value from private.settings where name = 'timer_secret')),
    body := '{"type":"health"}'::jsonb,
    timeout_milliseconds := 30000)
$job$);
select cron.unschedule('health-trim') where exists (select 1 from cron.job where jobname = 'health-trim');
select cron.schedule('health-trim', '50 2 * * *', 'select private.trim_health()');

commit;
