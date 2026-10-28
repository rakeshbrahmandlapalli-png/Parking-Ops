-- Parking Ops — database part 130: Attendance add-on foundation.
-- Additive and default-off. Existing parking tables, logins and workflows are
-- deliberately untouched. Apply after the latest setup part.
begin;
create table if not exists attendance_staff_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  staff_id uuid not null unique references staff(id) on delete cascade,
  attendance_user_id uuid unique references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists attendance_staff_links_company_idx on attendance_staff_links(company_id);
alter table attendance_staff_links enable row level security;
drop policy if exists attendance_staff_links_read on attendance_staff_links;
create policy attendance_staff_links_read on attendance_staff_links for select to authenticated
  using (company_id = (select (me()).company_id)
    and exists(select 1 from public.companies c where c.id=company_id and c.brand->'attendance'='true'::jsonb));
revoke all on table attendance_staff_links from public, anon, authenticated;
grant select on table attendance_staff_links to authenticated;

create or replace function private.attendance_on(p_company uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select (c.brand->>'attendance')::boolean from public.companies c where c.id = p_company), false)
$$;
revoke all on function private.attendance_on(uuid) from public, anon, authenticated;

-- Existing client save behavior preserved; only the attendance key is added.
create or replace function admin_save_client(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c companies;
  y text;
  ys text[] := coalesce((select array_agg(upper(trim(v))) from jsonb_array_elements_text(coalesce(p->'yards', '[]')) v where trim(v) <> ''), '{}');
  b jsonb := coalesce(p->'brand', '{}');
  k text;
  set_look boolean := coalesce(p->'brand', '{}') ? 'theme';
  set_py boolean := coalesce(p->'brand', '{}') ? 'picks_yard';
  set_lp boolean := coalesce(p->'brand', '{}') ? 'lane_planner';
  set_co boolean := coalesce(p->'brand', '{}') ? 'collections';
  set_tx boolean := coalesce(p->'brand', '{}') ? 'texts';
  set_cl boolean := coalesce(p->'brand', '{}') ? 'calls';
  set_vc boolean := coalesce(p->'brand', '{}') ? 'voice';
  set_tu boolean := coalesce(p->'brand', '{}') ? 'topup';
  set_att boolean := coalesce(p->'brand', '{}') ? 'attendance';
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
    'voice', case when set_vc then coalesce(b->>'voice', '') = 'true' end,
    'attendance', case when set_att then coalesce(b->>'attendance', '') = 'true' end,
    'topup', case when set_tu then coalesce(b->>'topup', '') = 'true' end));

  if made then
    if coalesce(p->>'slug', '') !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'The short code is lower-case letters, numbers and dashes, like airport-parking-bay.'; end if;
    if p->>'slug' = 'platform' then raise exception 'That short code is taken.'; end if;
    if exists (select 1 from companies where slug = p->>'slug') then raise exception 'That short code is taken.'; end if;
    insert into companies (name, slug, yards, drops_day_end, time_zone, brand)
    values (trim(p->>'name'), p->>'slug', ys, coalesce(nullif(p->>'drops_day_end', '')::time, '06:00'), 'Europe/London', b)
    returning * into c;
  else
    update companies set name = trim(p->>'name'), yards = ys,
      drops_day_end = coalesce(nullif(p->>'drops_day_end', '')::time, drops_day_end),
      brand = (case when set_look then brand - 'theme' else brand end) - (case when set_py then 'picks_yard' else '' end) - (case when set_lp then 'lane_planner' else '' end) - (case when set_co then 'collections' else '' end) - (case when set_tx then 'texts' else '' end) - (case when set_cl then 'calls' else '' end) - (case when set_vc then 'voice' else '' end) - (case when set_tu then 'topup' else '' end) - (case when set_att then 'attendance' else '' end) || b
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
      ', Voice calls ' || case when (c.brand->>'voice')::boolean then 'on' else 'off' end ||
      ', SKIDATA top-up ' || case when (c.brand->>'topup')::boolean then 'on' else 'off' end end
  from me() s;
  return to_jsonb(c);
end;
$$;

revoke execute on function admin_save_client(jsonb) from public, anon;
grant execute on function admin_save_client(jsonb) to authenticated;
commit;
