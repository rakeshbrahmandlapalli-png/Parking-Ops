-- Attendance identities use explicit links; existing parking auth is unchanged.
begin;
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
$$;
revoke all on function private.attendance_identity() from public,anon,authenticated;

-- Explicit platform-only provisioning. Never matches users by display name.
create or replace function public.attendance_link_staff(p_staff uuid,p_user uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.staff; link_id uuid;
begin
 if auth.uid() is null or not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
 select * into s from public.staff where id=p_staff for update;
 if s.id is null or not s.active or s.removed_at is not null then raise exception 'Choose an active staff member.'; end if;
 if coalesce(cardinality(s.desk_names),0)>0 then raise exception 'Attendance needs an individual login, not a shared desk login.'; end if;
 if not exists(select 1 from public.companies c where c.id=s.company_id and c.suspended_at is null and c.brand->'attendance'='true'::jsonb) then raise exception 'Attendance is not enabled for this company.'; end if;
 if p_user is null or not exists(select 1 from auth.users where id=p_user) then raise exception 'Choose an existing attendance account.'; end if;
 if exists(select 1 from public.staff where user_id=p_user and id<>s.id) then raise exception 'This account already belongs to another staff login.'; end if;
 if exists(select 1 from public.attendance_staff_links where staff_id=s.id and attendance_user_id is not null and attendance_user_id<>p_user) then raise exception 'This person already has an attendance account.'; end if;
 insert into public.attendance_staff_links(company_id,staff_id,attendance_user_id,active)
 values(s.company_id,s.id,p_user,true)
 on conflict(staff_id) do update set attendance_user_id=excluded.attendance_user_id,active=true
 returning id into link_id;
 insert into public.activity(company_id,staff_name,action,value)
 select s.company_id,m.name||' (Parking Ops)','STAFF','Attendance account linked for '||s.name from public.me() m;
 return link_id;
end $$;
revoke all on function public.attendance_link_staff(uuid,uuid) from public,anon;
grant execute on function public.attendance_link_staff(uuid,uuid) to authenticated;

create or replace function public.attendance_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.attendance_staff_links;
begin
 l:=private.attendance_identity();
 if l.id is null then raise exception 'Attendance is not available for this account.'; end if;
 return (select jsonb_build_object('company_id',c.id,'company_name',c.name,
 'staff_id',s.id,'name',s.name,'time_zone',c.time_zone)
 from public.staff s join public.companies c on c.id=s.company_id where s.id=l.staff_id);
end $$;
revoke all on function public.attendance_context() from public,anon;
grant execute on function public.attendance_context() to authenticated;
commit;
