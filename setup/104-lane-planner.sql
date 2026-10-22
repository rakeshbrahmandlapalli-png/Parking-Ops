-- Part 104: shared physical lane order. No existing locations are inferred.
-- Apply before deploying this frontend. Positions count from the front exit.
begin;
create table if not exists public.parking_lanes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  yard text not null,
  name text not null check(length(name) between 1 and 40),
  capacity integer not null check(capacity between 1 and 100),
  access text not null check(access in ('front','both','open')),
  kind text not null check(kind in ('lane','holding','temporary')),
  revision integer not null default 0,
  unique(company_id,yard,name), unique(id,company_id),
  check((kind='lane' and access in ('front','both')) or (kind<>'lane' and access='open'))
);
create table if not exists public.parking_positions (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  lane_id uuid,
  position integer check(position between 1 and 100),
  revision integer not null default 1,
  moved_at timestamptz not null default clock_timestamp(),
  moved_by uuid references public.staff(id) on delete set null,
  moved_by_name text not null,
  foreign key(lane_id,company_id) references public.parking_lanes(id,company_id),
  unique(lane_id,position), check((lane_id is null)=(position is null))
);
create index if not exists parking_positions_company on public.parking_positions(company_id);
alter table public.parking_lanes enable row level security;
alter table public.parking_positions enable row level security;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='parking_lanes' and policyname='company_read') then
    create policy company_read on public.parking_lanes for select to authenticated using(company_id=(select public.my_company()));
    create policy company_read on public.parking_positions for select to authenticated using(company_id=(select public.my_company()));
  end if;
end $$;
revoke all on public.parking_lanes,public.parking_positions from public,anon,authenticated;
grant select on public.parking_lanes,public.parking_positions to authenticated;

-- One physical stay = the same booking reference (PICKS row and its DROPS row),
-- the way the dashboard pairs them. Refs are unique per stay, so a repeat visit
-- by the same registration stays separate. A row with no ref pairs only with itself.
-- Plain SQL with no SET clause so Postgres can inline it into the queries below.
create or replace function private.lane_same_stay(a public.bookings,b public.bookings) returns boolean
language sql immutable as $$
 select a.id=b.id or (a.company_id=b.company_id and a.ref<>'' and a.ref=b.ref)
$$;
revoke all on function private.lane_same_stay(public.bookings,public.bookings) from public,anon,authenticated;

create or replace function public.lane_get() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare s staff:=me();
begin
 if auth.uid() is null or s.id is null then raise exception 'Sign in again.'; end if;
 return jsonb_build_object(
 'lanes',coalesce((select jsonb_agg(to_jsonb(l) order by yard,name) from parking_lanes l where company_id=s.company_id),'[]'::jsonb),
 'positions',coalesce((select jsonb_agg(to_jsonb(p)) from parking_positions p where company_id=s.company_id),'[]'::jsonb),
 'cars',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'reg',c.reg,'ref',c.ref,'drop_at',c.drop_at,
   'return_at',c.return_at,'yard',c.yard,'kind',c.kind,'make',c.make,
   'sent_at',c.sent_at,'cleared_at',c.cleared_at,'removed_at',c.removed_at)) from (
   select b.id,b.reg,b.ref,b.drop_at,coalesce(nullif(b.yard,''),d.yard,'') yard,b.kind,b.make,coalesce(d.return_at,b.return_at) return_at,
     coalesce(d.sent_at,b.sent_at) sent_at,coalesce(d.cleared_at,b.cleared_at) cleared_at,coalesce(d.removed_at,b.removed_at) removed_at,
     exists(select 1 from parking_positions p where p.booking_id=b.id and p.lane_id is not null) placed
   from bookings b left join lateral (select x.return_at,x.yard,x.sent_at,x.cleared_at,x.removed_at from bookings x
      where x.company_id=s.company_id and x.kind='drops' and private.lane_same_stay(b,x)
      order by x.updated_at desc,x.id limit 1) d on true
   where b.company_id=s.company_id and (
     exists(select 1 from parking_positions p where p.booking_id=b.id and p.lane_id is not null)
     or (b.removed_at is null and b.cleared_at is null and b.sent_at is null
       -- PICKS cars taken in and due back within the last 14 days (old history stays out),
       -- DROPS cars in a parking yard with no PICKS car taken in.
       and ((b.kind='picks' and b.intake='Collected' and coalesce(b.return_at,b.drop_at)>now()-interval '14 days')
         or (b.kind='drops' and b.yard not in ('','T')
           and not exists(select 1 from bookings x where x.company_id=s.company_id and x.kind='picks'
             and x.intake='Collected' and x.removed_at is null and private.lane_same_stay(b,x))))
       and not exists(select 1 from parking_positions p join bookings x on x.id=p.booking_id
         where p.company_id=s.company_id and private.lane_same_stay(b,x))))
   ) c where c.placed or (c.sent_at is null and c.cleared_at is null and c.removed_at is null)),'[]'::jsonb),
 'moves',coalesce((select jsonb_agg(to_jsonb(a)) from (select at,reg,action,value,staff_name from activity
   where company_id=s.company_id and action='LANE MOVE' order by at desc,id desc limit 30) a),'[]'::jsonb),
 'can_move', s.role<>'view' and (can('yard') or can('intake')),
 'can_manage',s.role in ('owner','manager') and can('settings'));
end $$;

create or replace function public.lane_save(p_yard text,p_name text,p_capacity integer,p_access text,p_kind text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s staff:=me(); l parking_lanes;
begin
 if auth.uid() is null or s.id is null or s.role not in ('owner','manager') or not can('settings') then raise exception 'Only a yard manager can add lanes.'; end if;
 if p_yard is null or not exists(select 1 from companies where id=s.company_id and p_yard=any(yards)) or p_yard='T' then raise exception 'Choose a parking yard.'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 40 or p_capacity is null or p_capacity not between 1 and 100
  or p_kind is null or p_kind not in ('lane','holding','temporary') or p_access is null
  or not ((p_kind='lane' and p_access in ('front','both')) or (p_kind<>'lane' and p_access='open')) then raise exception 'Check the lane details.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.company_id::text,104));
 insert into parking_lanes(company_id,yard,name,capacity,access,kind)
 values(s.company_id,p_yard,trim(p_name),p_capacity,p_access,p_kind) returning * into l;
 return to_jsonb(l);
end $$;

-- All planner writes for a company share one lock. Compare both the car's
-- revision AND the destination lane revision, then validate physical access.
create or replace function public.lane_move(p_booking uuid,p_lane uuid,p_position integer,p_revision integer,p_lane_revision integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s staff:=me(); b bookings; p parking_positions; dest parking_lanes; src parking_lanes; n integer; label_from text; label_to text;
begin
 if auth.uid() is null or s.id is null or s.role='view' or not (can('yard') or can('intake')) then raise exception 'You cannot move cars.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.company_id::text,104));
 select * into b from bookings where id=p_booking and company_id=s.company_id for update;
 if b.id is null then raise exception 'That car is not on your board.'; end if;
 select * into p from parking_positions where booking_id=b.id and company_id=s.company_id for update;
 if coalesce(p.revision,0) is distinct from p_revision then raise exception 'The car moved. Refresh before confirming.'; end if;
 if exists(select 1 from parking_positions q join bookings x on x.id=q.booking_id where q.company_id=s.company_id
   and q.booking_id<>b.id and private.lane_same_stay(b,x)) then raise exception 'This booking already has a tracked vehicle.'; end if;
 if p_lane is null and p_position is not null then raise exception 'Choose a valid destination.'; end if;
 if p_lane is not null then
   if b.removed_at is not null or b.cleared_at is not null or exists(select 1 from bookings x where x.company_id=s.company_id
      and x.kind='drops' and private.lane_same_stay(b,x) and (x.cleared_at is not null or x.removed_at is not null)) then raise exception 'This booking has ended. Confirm that the car left the yard.'; end if;
   select * into dest from parking_lanes where id=p_lane and company_id=s.company_id for update;
   if dest.id is null then raise exception 'Choose a lane in your yard.'; end if;
   if dest.revision is distinct from p_lane_revision then raise exception 'The destination changed. Refresh before confirming.'; end if;
   if p_position is null or p_position<1 or p_position>dest.capacity then raise exception 'Choose a valid position.'; end if;
   if p.lane_id=dest.id then raise exception 'Move to a holding space before repositioning in the same lane.'; end if;
   if exists(select 1 from parking_positions where lane_id=dest.id and position=p_position) then raise exception 'That position is occupied.'; end if;
   if dest.access<>'open' and exists(select 1 from parking_positions where lane_id=dest.id and position<p_position)
     and (dest.access='front' or exists(select 1 from parking_positions where lane_id=dest.id and position>p_position)) then raise exception 'Cars block access to that position.'; end if;
 else
   if p.lane_id is null then raise exception 'This car has no recorded position.'; end if;
 end if;
 if p.lane_id is not null then
   select * into src from parking_lanes where id=p.lane_id and company_id=s.company_id for update;
   if src.access<>'open' and exists(select 1 from parking_positions where lane_id=src.id and position<p.position)
     and (src.access='front' or exists(select 1 from parking_positions where lane_id=src.id and position>p.position)) then raise exception 'Move the blocking cars first.'; end if;
   label_from:=src.yard||' / '||src.name||' / '||p.position;
 else label_from:='Unrecorded'; end if;
 label_to:=case when p_lane is null then 'Left yard' else dest.yard||' / '||dest.name||' / '||p_position end;
 insert into parking_positions(booking_id,company_id,lane_id,position,moved_by,moved_by_name)
 values(b.id,s.company_id,p_lane,p_position,s.id,coalesce(nullif(to_jsonb(s)->>'acting',''),s.name))
 on conflict(booking_id) do update set lane_id=excluded.lane_id,position=excluded.position,revision=parking_positions.revision+1,
   moved_at=clock_timestamp(),moved_by=excluded.moved_by,moved_by_name=excluded.moved_by_name;
 update parking_lanes set revision=revision+1 where id=src.id or id=dest.id;
 if p_lane is not null then
   -- Explicit physical confirmation is authoritative; keep linked board yards aligned.
   update bookings x set yard=dest.yard,yard_before_t='',updated_at=clock_timestamp()
   where x.company_id=s.company_id and private.lane_same_stay(b,x) and x.removed_at is null and x.cleared_at is null
     and (x.yard is distinct from dest.yard or coalesce(x.yard_before_t,'')<>'');
 end if;
 perform log_activity(b,'LANE MOVE',label_from||' → '||label_to);
 return public.lane_get();
end $$;

-- Same pattern as the other RPCs: security definer in public, run only by signed-in staff.
revoke all on function public.lane_get(),public.lane_save(text,text,integer,text,text),public.lane_move(uuid,uuid,integer,integer,integer) from public,anon;
grant execute on function public.lane_get(),public.lane_save(text,text,integer,text,text),public.lane_move(uuid,uuid,integer,integer,integer) to authenticated;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='parking_lanes') then alter publication supabase_realtime add table public.parking_lanes; end if;
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='parking_positions') then alter publication supabase_realtime add table public.parking_positions; end if;
 end if;
end $$;
commit;
