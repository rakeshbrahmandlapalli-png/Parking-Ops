-- Parking Ops — database part 107: the Yard planner is an add-on per client.
--
-- Parking Ops → Clients → Edit gets "Yard planner (add-on)" (brand.lane_planner).
--   • admin_save_client: as part 103 (checked against the live definition on
--     23 Oct 2026), plus the lane_planner switch kept like picks_yard.
--   • lane_get / lane_save / lane_move: as part 104, plus a refusal when the
--     client doesn't have the add-on (private.lane_planner_on).
-- Switching it off keeps the client's lanes and positions; they come back when
-- it is switched on again. Nobody gets it by running this. Safe to run twice.

create or replace function admin_save_client(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
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
    'lane_planner', case when coalesce(b->>'lane_planner', '') = 'true' then true end));

  if coalesce(p->>'id', '') = '' then
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
      brand = (case when set_look then brand - 'theme' else brand end) - (case when set_py then 'picks_yard' else '' end) - (case when set_lp then 'lane_planner' else '' end) || b
    where id = (p->>'id')::uuid and slug <> 'platform' returning * into c;
    if not found then raise exception 'Client not found.'; end if;
  end if;
  return to_jsonb(c);
end;
$$;

revoke execute on function admin_save_client(jsonb) from public, anon;
grant execute on function admin_save_client(jsonb) to authenticated;

create or replace function private.lane_planner_on(p_company uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select (c.brand->>'lane_planner')::boolean from public.companies c where c.id = p_company), false)
$$;
revoke all on function private.lane_planner_on(uuid) from public, anon, authenticated;

create or replace function public.lane_get() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare s staff:=me();
begin
 if auth.uid() is null or s.id is null then raise exception 'Sign in again.'; end if;
 if not private.lane_planner_on(s.company_id) then raise exception 'The yard planner is not switched on for your company.'; end if;
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
 if not private.lane_planner_on(s.company_id) then raise exception 'The yard planner is not switched on for your company.'; end if;
 if p_yard is null or not exists(select 1 from companies where id=s.company_id and p_yard=any(yards)) or p_yard='T' then raise exception 'Choose a parking yard.'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 40 or p_capacity is null or p_capacity not between 1 and 100
  or p_kind is null or p_kind not in ('lane','holding','temporary') or p_access is null
  or not ((p_kind='lane' and p_access in ('front','both')) or (p_kind<>'lane' and p_access='open')) then raise exception 'Check the lane details.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.company_id::text,104));
 insert into parking_lanes(company_id,yard,name,capacity,access,kind)
 values(s.company_id,p_yard,trim(p_name),p_capacity,p_access,p_kind) returning * into l;
 return to_jsonb(l);
end $$;

create or replace function public.lane_move(p_booking uuid,p_lane uuid,p_position integer,p_revision integer,p_lane_revision integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s staff:=me(); b bookings; p parking_positions; dest parking_lanes; src parking_lanes; n integer; label_from text; label_to text;
begin
 if auth.uid() is null or s.id is null or s.role='view' or not (can('yard') or can('intake')) then raise exception 'You cannot move cars.'; end if;
 if not private.lane_planner_on(s.company_id) then raise exception 'The yard planner is not switched on for your company.'; end if;
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

revoke all on function public.lane_get(),public.lane_save(text,text,integer,text,text),public.lane_move(uuid,uuid,integer,integer,integer) from public,anon;
grant execute on function public.lane_get(),public.lane_save(text,text,integer,text,text),public.lane_move(uuid,uuid,integer,integer,integer) to authenticated;
