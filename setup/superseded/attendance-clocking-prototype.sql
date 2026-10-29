-- Attendance-only storage and API. No existing parking objects are replaced.
begin;
create table if not exists public.attendance_worksites (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 80),
 lat double precision not null check(lat between -90 and 90),
 lng double precision not null check(lng between -180 and 180),
 radius_m integer not null default 150 check(radius_m between 10 and 5000),
 active boolean not null default true,
 unique(id,company_id)
);
create table if not exists public.attendance_shifts (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 staff_id uuid not null references public.staff(id),
 user_id uuid not null references auth.users(id),
 worksite_id uuid not null,
 clock_in_at timestamptz not null default now(),
 clock_out_at timestamptz,
 clock_in_lat double precision,clock_in_lng double precision,
 clock_in_metres integer,clock_in_ok boolean,
 clock_out_lat double precision,clock_out_lng double precision,
 clock_out_metres integer,clock_out_ok boolean,
 break_started_at timestamptz,
 break_minutes numeric not null default 0 check(break_minutes>=0),
 note text not null default '' check(length(note)<=1000),
 foreign key(worksite_id,company_id) references public.attendance_worksites(id,company_id),
 check(clock_out_at is null or clock_out_at>=clock_in_at)
);
create unique index if not exists attendance_one_open_shift on public.attendance_shifts(user_id) where clock_out_at is null;
create index if not exists attendance_shift_history on public.attendance_shifts(company_id,clock_in_at desc);
alter table public.attendance_worksites enable row level security;
alter table public.attendance_shifts enable row level security;
revoke all on public.attendance_worksites,public.attendance_shifts from public,anon,authenticated;
grant select on public.attendance_worksites,public.attendance_shifts to authenticated;
drop policy if exists attendance_sites_read on public.attendance_worksites;
create policy attendance_sites_read on public.attendance_worksites for select to authenticated
 using(exists(select 1 from public.attendance_staff_links l where l.company_id=attendance_worksites.company_id));
drop policy if exists attendance_shifts_read on public.attendance_shifts;
create policy attendance_shifts_read on public.attendance_shifts for select to authenticated
 using(user_id=auth.uid() and public.attendance_link_visible(company_id,staff_id));

create or replace function private.attendance_metres(a double precision,b double precision,c double precision,d double precision)
returns double precision language sql immutable set search_path='' as $$
 select 6371000*2*asin(sqrt(least(1.0,power(sin(radians(c-a)/2),2)+cos(radians(a))*cos(radians(c))*power(sin(radians(d-b)/2),2))))
$$;
revoke all on function private.attendance_metres(double precision,double precision,double precision,double precision) from public,anon,authenticated;

create or replace function public.attendance_clock_in(p_worksite uuid,p_lat double precision,p_lng double precision,p_accuracy double precision default 0)
returns public.attendance_shifts language plpgsql security definer set search_path='' as $$
declare l public.attendance_staff_links; w public.attendance_worksites; s public.attendance_shifts; metres double precision;
begin
 l:=private.attendance_identity();
 if l.id is null then raise exception 'Attendance is not available for this account.'; end if;
 perform 1 from public.attendance_staff_links where id=l.id for update;
 select * into s from public.attendance_shifts where user_id=auth.uid() and clock_out_at is null;
 if found then return s; end if;
 select * into w from public.attendance_worksites where id=p_worksite and company_id=l.company_id and active;
 if not found then raise exception 'Choose an active worksite in your company.'; end if;
 if p_lat is null or p_lng is null or not(p_lat between -90 and 90) or not(p_lng between -180 and 180) then raise exception 'Turn on location to clock in.'; end if;
 if p_accuracy is null or not(p_accuracy between 0 and 100000) then raise exception 'Your phone did not provide a valid location accuracy.'; end if;
 metres:=private.attendance_metres(p_lat,p_lng,w.lat,w.lng);
 if metres>w.radius_m+least(p_accuracy,50) then raise exception 'Move inside the worksite zone to clock in.'; end if;
 insert into public.attendance_shifts(company_id,staff_id,user_id,worksite_id,clock_in_lat,clock_in_lng,clock_in_metres,clock_in_ok)
 values(l.company_id,l.staff_id,auth.uid(),w.id,p_lat,p_lng,round(metres),true) returning * into s;
 return s;
end $$;

-- Finish-only access survives entitlement/pilot revocation, but never permits
-- a different account to finish someone else's shift or start a new one.
create or replace function public.attendance_clock_out(p_lat double precision default null,p_lng double precision default null,p_note text default '')
returns public.attendance_shifts language plpgsql security definer set search_path='' as $$
declare s public.attendance_shifts; w public.attendance_worksites; metres double precision;
begin
 if auth.uid() is null then raise exception 'Sign in again.'; end if;
 select * into s from public.attendance_shifts where user_id=auth.uid() and clock_out_at is null for update;
 if not found then raise exception 'You are not clocked in.'; end if;
 if length(coalesce(p_note,''))>1000 then raise exception 'Keep the note within 1000 characters.'; end if;
 select * into w from public.attendance_worksites where id=s.worksite_id and company_id=s.company_id;
 if p_lat between -90 and 90 and p_lng between -180 and 180 then metres:=private.attendance_metres(p_lat,p_lng,w.lat,w.lng); else p_lat:=null;p_lng:=null; end if;
 update public.attendance_shifts set clock_out_at=now(),clock_out_lat=p_lat,clock_out_lng=p_lng,
 clock_out_metres=round(metres),clock_out_ok=case when metres is null then null else metres<=w.radius_m end,
 break_minutes=break_minutes+case when break_started_at is null then 0 else extract(epoch from now()-break_started_at)/60 end,
 break_started_at=null,note=coalesce(p_note,'') where id=s.id returning * into s;
 return s;
end $$;

create or replace function public.attendance_break(p_end boolean default false)
returns public.attendance_shifts language plpgsql security definer set search_path='' as $$
declare l public.attendance_staff_links;s public.attendance_shifts;
begin
 if auth.uid() is null then raise exception 'Sign in again.'; end if;
 if p_end is null then raise exception 'Choose a break action.'; end if;
 if not p_end then l:=private.attendance_identity();if l.id is null then raise exception 'Attendance is not available for this account.';end if;end if;
 select * into s from public.attendance_shifts where user_id=auth.uid() and clock_out_at is null for update;
 if not found then raise exception 'You are not clocked in.';end if;
 if p_end and s.break_started_at is not null then
 update public.attendance_shifts set break_minutes=break_minutes+extract(epoch from now()-break_started_at)/60,break_started_at=null where id=s.id returning * into s;
 elsif not p_end and s.break_started_at is null then
 update public.attendance_shifts set break_started_at=now() where id=s.id returning * into s;
 end if;
 return s;
end $$;
revoke all on function public.attendance_clock_in(uuid,double precision,double precision,double precision),public.attendance_clock_out(double precision,double precision,text),public.attendance_break(boolean) from public,anon;
grant execute on function public.attendance_clock_in(uuid,double precision,double precision,double precision),public.attendance_clock_out(double precision,double precision,text),public.attendance_break(boolean) to authenticated;
commit;
