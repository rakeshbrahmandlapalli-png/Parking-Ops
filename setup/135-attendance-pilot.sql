-- Server-enforced pilot access. No account is enrolled by this migration.
begin;
create table if not exists private.attendance_release (
 company_id uuid primary key references public.companies(id) on delete cascade,
 pilot boolean not null default true
);
create table if not exists private.attendance_testers (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 active boolean not null default true,
 unique(company_id,user_id)
);
alter table private.attendance_release enable row level security;
alter table private.attendance_testers enable row level security;
revoke all on private.attendance_release,private.attendance_testers from public,anon,authenticated;

create or replace function private.attendance_pilot_allowed(p_company uuid,p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_user is not null and (
 exists(select 1 from private.attendance_release where company_id=p_company and not pilot)
 or exists(select 1 from private.attendance_testers where company_id=p_company and user_id=p_user and active))
$$;
revoke all on function private.attendance_pilot_allowed(uuid,uuid) from public,anon,authenticated;

create or replace function private.attendance_identity()
returns public.attendance_staff_links
language sql stable security definer set search_path='' as $$
 select l from public.attendance_staff_links l
 join public.staff s on s.id=l.staff_id and s.company_id=l.company_id
 join public.companies c on c.id=l.company_id
 where auth.uid() is not null and l.attendance_user_id=auth.uid()
 and l.active and s.active and s.removed_at is null
 and coalesce(cardinality(s.desk_names),0)=0
 and c.suspended_at is null and c.brand->'attendance'='true'::jsonb
 and private.attendance_pilot_allowed(c.id,auth.uid())
$$;
revoke all on function private.attendance_identity() from public,anon,authenticated;

-- Explicitly enrol/revoke one existing linked individual; no name matching.
create or replace function public.attendance_set_tester(p_staff uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare l public.attendance_staff_links;
begin
 if auth.uid() is null or not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
 if p_enabled is null then raise exception 'Choose enabled or disabled.'; end if;
 select * into l from public.attendance_staff_links where staff_id=p_staff and active for update;
 if l.id is null or l.attendance_user_id is null then raise exception 'Link an individual attendance account first.'; end if;
 if p_enabled and not exists(select 1 from public.staff s where s.id=l.staff_id and s.company_id=l.company_id and s.active and s.removed_at is null and coalesce(cardinality(s.desk_names),0)=0) then raise exception 'Choose an active individual staff login.'; end if;
 insert into private.attendance_testers(company_id,user_id,active) values(l.company_id,l.attendance_user_id,p_enabled)
 on conflict(company_id,user_id) do update set active=excluded.active;
 insert into public.activity(company_id,staff_name,action,value)
 select l.company_id,m.name||' (Parking Ops)','SETTINGS',case when p_enabled then 'Attendance pilot access enabled' else 'Attendance pilot access disabled' end from public.me() m;
end $$;
revoke all on function public.attendance_set_tester(uuid,boolean) from public,anon;
grant execute on function public.attendance_set_tester(uuid,boolean) to authenticated;

-- All direct link reads use the same entitlement/pilot checks as the RPCs.
create or replace function public.attendance_link_visible(p_company uuid,p_staff uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.attendance_identity() l where l.id is not null and l.company_id=p_company and l.staff_id=p_staff)
$$;
revoke all on function public.attendance_link_visible(uuid,uuid) from public,anon;
grant execute on function public.attendance_link_visible(uuid,uuid) to authenticated;
drop policy if exists attendance_staff_links_read on public.attendance_staff_links;
create policy attendance_staff_links_read on public.attendance_staff_links for select to authenticated
 using(public.attendance_link_visible(company_id,staff_id));
commit;
