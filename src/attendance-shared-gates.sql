-- Canonical companies remain in Parking Ops. aero_companies holds only the
-- Attendance settings for that SAME id, never a new client identity.
begin;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='aero_company_parking_fk') then
 alter table public.aero_companies add constraint aero_company_parking_fk foreign key(id) references public.companies(id) on delete cascade;
 end if;
end $$;

create or replace function public.aero_current_company_id() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare result uuid;
begin
 select p.company_id into result from public.aero_profiles p
 join public.aero_companies c on c.id=p.company_id
 join private.attendance_identity() l on l.company_id=p.company_id and l.attendance_user_id=p.id
 where l.id is not null and p.id=auth.uid() and p.active and not c.suspended;
 return result;
end $$;
revoke all on function public.aero_current_company_id() from public,anon;
grant execute on function public.aero_current_company_id() to authenticated;

create or replace function public.aero_is_manager() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.aero_profiles p where p.id=auth.uid()
 and p.company_id=public.aero_current_company_id() and p.role in ('owner','admin') and p.active)
$$;
revoke all on function public.aero_is_manager() from public,anon;
grant execute on function public.aero_is_manager() to authenticated;

-- Starts require the current gate. Finish operations remain available to the
-- owner of an open shift after entitlement/test access is revoked.
create or replace function public.aero_start_break() returns public.aero_shifts
language plpgsql security definer set search_path='' as $$
declare s public.aero_shifts;
begin
 if public.aero_current_company_id() is null then raise exception 'Attendance is not available for this account.';end if;
 select * into s from public.aero_shifts where user_id=auth.uid() and company_id=public.aero_current_company_id() and clock_out_at is null for update;
 if not found then raise exception 'You are not clocked in.';end if;
 if not (select use_breaks from public.aero_companies where id=s.company_id) then raise exception 'Breaks are switched off for this company.';end if;
 if s.break_started_at is null then update public.aero_shifts set break_started_at=now() where id=s.id returning * into s;end if;
 return s;
end $$;
revoke all on function public.aero_start_break() from public,anon;
grant execute on function public.aero_start_break() to authenticated;

-- A narrowly scoped endpoint keeps the finish UI working after pilot removal.
create or replace function public.aero_open_shift() returns jsonb
language sql stable security definer set search_path='' as $$
 select to_jsonb(s) from public.aero_shifts s where auth.uid() is not null and s.user_id=auth.uid() and s.clock_out_at is null limit 1
$$;
revoke all on function public.aero_open_shift() from public,anon;
grant execute on function public.aero_open_shift() to authenticated;

-- Essentials only. Staff can never enable a deferred feature by editing UI.
create or replace function public.aero_has_feature(p_feature text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.aero_current_company_id() is not null and p_feature='breaks'
$$;
revoke all on function public.aero_has_feature(text) from public,anon;
grant execute on function public.aero_has_feature(text) to authenticated;

create or replace function public.aero_push_recipients(p_users uuid[]) returns table(user_id uuid)
language sql stable security definer set search_path='' as $$
 select p.id from public.aero_profiles p
 join public.attendance_staff_links l on l.attendance_user_id=p.id and l.company_id=p.company_id
 join public.staff s on s.id=l.staff_id and s.company_id=l.company_id
 join public.companies c on c.id=l.company_id
 join public.aero_companies a on a.id=c.id
 where p.id=any(p_users) and p.active and l.active and s.active and s.removed_at is null
 and coalesce(cardinality(s.desk_names),0)=0 and not a.suspended
 and c.suspended_at is null and c.brand->'attendance'='true'::jsonb
 and private.attendance_pilot_allowed(c.id,p.id)
$$;
revoke all on function public.aero_push_recipients(uuid[]) from public,anon,authenticated;
grant execute on function public.aero_push_recipients(uuid[]) to service_role;

-- Pilot enrolment is explicit and atomic. It never changes parking login,
-- passwords, roles, active flags or company IDs.
create or replace function public.aero_prepare_pilot(p_staff uuid,p_role text default 'staff') returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.staff; c public.companies; link_id uuid;
begin
 if auth.uid() is null or not public.is_platform_admin() then raise exception 'Not allowed.';end if;
 if p_role is null or p_role not in ('staff','admin','owner') then raise exception 'Choose an Attendance role.';end if;
 select * into s from public.staff where id=p_staff for update;
 if s.id is null or not s.active or s.removed_at is not null or s.user_id is null or coalesce(cardinality(s.desk_names),0)>0 then raise exception 'Choose an active individual parking account.';end if;
 select * into c from public.companies where id=s.company_id for update;
 if c.suspended_at is not null or c.slug='platform' then raise exception 'Choose an active client company.';end if;
 if exists(select 1 from private.attendance_release where company_id=c.id and not pilot) then raise exception 'This company has already left private pilot mode.';end if;
 if exists(select 1 from public.aero_profiles where id=s.user_id and (company_id<>s.company_id or role<>p_role or not active)) then raise exception 'This account already has a different Attendance assignment.';end if;
 if exists(select 1 from public.attendance_staff_links where staff_id=s.id and attendance_user_id is not null and attendance_user_id<>s.user_id) then raise exception 'This person already has another Attendance account.';end if;
 update public.companies set brand=brand||'{"attendance":true}'::jsonb where id=c.id;
 insert into public.aero_companies(id,name,time_zone) values(c.id,c.name,c.time_zone) on conflict(id) do nothing;
 insert into public.attendance_staff_links(company_id,staff_id,attendance_user_id,active) values(c.id,s.id,s.user_id,true)
 on conflict(staff_id) do update set active=true,company_id=excluded.company_id,attendance_user_id=excluded.attendance_user_id returning id into link_id;
 insert into public.aero_profiles(id,company_id,full_name,role) values(s.user_id,c.id,s.name,p_role) on conflict(id) do nothing;
 insert into private.attendance_release(company_id,pilot) values(c.id,true) on conflict(company_id) do nothing;
 insert into private.attendance_testers(company_id,user_id,active) values(c.id,s.user_id,true) on conflict(company_id,user_id) do update set active=true;
 insert into public.activity(company_id,staff_name,action,value) select c.id,m.name||' (Parking Ops)','SETTINGS','Attendance pilot account enrolled: '||s.name from public.me() m;
 return link_id;
end $$;
revoke all on function public.aero_prepare_pilot(uuid,text) from public,anon;
grant execute on function public.aero_prepare_pilot(uuid,text) to authenticated;
revoke update(show_pay,use_rota,overtime_weekly_hours) on public.aero_companies from authenticated;
commit;
