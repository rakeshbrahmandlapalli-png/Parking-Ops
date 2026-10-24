-- 111: reviewed booking imports (auto import selection, manual import preview/apply, history, undo preview).
-- Prerequisites: setup parts through 110 (lanes from 104). Additive: no schedule is enabled and no existing
-- booking or config is changed by installing it. The 90-day trim of private.import_review_runs is in
-- 111b-reviewed-import-trim.sql (kept apart: the Supabase MCP refuses SQL that removes rows).
-- Snapshots compare only what an import reads or protects (supplier fields, sheet, SENT/CLEAR/removed/early/
-- overstay and typed-by-office marks), so flight checks, yards, lanes and other staff work during a review
-- don't make every import "changed since the preview".
create or replace function private.import_review_existing(p_company uuid, p_refs text[]) returns jsonb
language sql volatile security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(x.item order by x.kind,x.ref),'[]'::jsonb) from (
  select distinct on (b.kind,b.ref) b.kind,b.ref,
   jsonb_build_object('id',b.id,'kind',b.kind,'ref',b.ref,'reg',b.reg,'name',b.name,'phone',b.phone,'make',b.make,
    'drop_local',coalesce(to_char(b.drop_at at time zone c.time_zone,'YYYY-MM-DD HH24:MI'),''),
    'return_local',coalesce(to_char(b.return_at at time zone c.time_zone,'YYYY-MM-DD HH24:MI'),''),
    'flight',b.flight,'note',b.note,'sheet_day',s.day,'yard',b.yard,'num',b.num,
    'sent',b.sent_at is not null,'cleared',b.cleared_at is not null,'removed',b.removed_at is not null,'early',coalesce(b.early,false),'overstay',coalesce(b.overstay,false),
    'flight_typed',exists(select 1 from activity a where a.booking_id=b.id and a.action='FLIGHT'),
    'reg_typed',exists(select 1 from activity a where a.booking_id=b.id and a.action='REG'),
    'return_typed',exists(select 1 from activity a where a.booking_id=b.id and a.action='RETURN CHANGED' and a.value not like '%(moved from %'),
    'drop_typed',exists(select 1 from activity a where a.booking_id=b.id and a.action='DROP-OFF CHANGED'),
    'lane',l.name,'position',pp.position,
    'revision',md5(concat_ws('|',b.id,b.sheet_id,b.ref,b.reg,b.name,b.phone,b.make,b.drop_at,b.return_at,b.flight,b.note,b.sent_at is not null,b.cleared_at is not null,b.removed_at is not null,b.early,b.overstay,b.moved_from))) item
  from bookings b join sheets s on s.id=b.sheet_id join companies c on c.id=b.company_id
  left join parking_positions pp on pp.booking_id=b.id and pp.company_id=b.company_id
  left join parking_lanes l on l.id=pp.lane_id and l.company_id=b.company_id
  where b.company_id=p_company and b.ref<>'' and b.ref=any(p_refs)
  order by b.kind,b.ref,(b.removed_at is null) desc,s.day desc,b.id
 ) x
$$;
revoke all on function private.import_review_existing(uuid,text[]) from public,anon,authenticated;

create or replace function import_review_existing(p_company uuid,p_refs text[]) returns jsonb
language sql volatile security definer set search_path=public,pg_temp as $$
 select private.import_review_existing(p_company,p_refs)
$$;
revoke all on function import_review_existing(uuid,text[]) from public,anon,authenticated;
grant execute on function import_review_existing(uuid,text[]) to service_role;

-- A read-only manual preview. All row decisions are made on the server, using a
-- whitelist of supplier fields; the caller cannot submit operational columns.
create or replace function reviewed_import_preview(p_batches jsonb) returns jsonb
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare s staff:=me(); batch jsonb; r jsonb; row_out jsonb; ex jsonb; prior jsonb;
 all_existing jsonb; refs text[]; items jsonb:='[]'; clean_batches jsonb:='[]'; clean_rows jsonb;
 changes jsonb; st text; why text; f text; incoming text; current_value text;
 n int:=0; row_num int; k text; day_key date; day_end time; needed text; c companies;
 cnt jsonb; snapshot text; seen text[]:='{}'; duplicate_key text; at_time timestamp;
begin
 if s.id is null or not can('import') then raise exception 'Not allowed for your role: import'; end if;
 if p_batches is null or jsonb_typeof(p_batches)<>'array' or jsonb_array_length(p_batches)>60 then raise exception 'Choose up to 60 sheets.'; end if;
 if (select count(distinct (b->>'kind',b->>'day')) from jsonb_array_elements(p_batches) b)<>jsonb_array_length(p_batches) then raise exception 'Each sheet must appear once; combine overlapping files before checking.'; end if;
 select * into c from companies where id=s.company_id;
 select array_agg(distinct trim(x->>'ref')) into refs from jsonb_array_elements(p_batches) b cross join lateral jsonb_array_elements(b->'rows') x;
 select array_agg(distinct x.ref) into refs from (select unnest(coalesce(refs,'{}')) ref union select b.ref from bookings b join sheets sh on sh.id=b.sheet_id where b.company_id=s.company_id and exists(select 1 from jsonb_array_elements(p_batches) pb where pb->>'kind'=sh.kind and (pb->>'day')::date=sh.day)) x;
 all_existing:=private.import_review_existing(s.company_id,coalesce(refs,'{}'));
 for batch in select * from jsonb_array_elements(p_batches) loop
  k:=batch->>'kind'; day_key:=(batch->>'day')::date;
  if batch ? 'cutoff' and batch->>'cutoff' not in ('00:00','04:00','05:00','06:00','07:00') then raise exception 'Choose a supported day-end time.'; end if;
  day_end:=coalesce(nullif(batch->>'cutoff',''),c.drops_day_end::text)::time;
  if k not in ('drops','picks') or k is null or day_key is null or jsonb_typeof(batch->'rows')<>'array' or jsonb_array_length(batch->'rows')>1000 then raise exception 'Invalid sheet or more than 1000 bookings in a sheet.'; end if;
  clean_rows:='[]'; row_num:=0;
  for r in select * from jsonb_array_elements(batch->'rows') loop
   n:=n+1; row_num:=row_num+1; if n>10000 then raise exception 'Check at most 10000 bookings at a time.'; end if;
   -- Store only fields that import_sheet is allowed to change.
   select jsonb_object_agg(key,left(trim(value),case when key='note' then 500 else 200 end)) into row_out
    from jsonb_each_text(r) where key=any(array['ref','reg','name','phone','make','drop_local','return_local','flight','note']);
   row_out:=coalesce(row_out,'{}'); st:='new'; why:=''; changes:='[]';
   select e into ex from jsonb_array_elements(all_existing) e where e->>'kind'=k and e->>'ref'=row_out->>'ref' limit 1;
   duplicate_key:=k||'|'||upper(regexp_replace(coalesce(row_out->>'ref',''),'[^a-zA-Z0-9]','','g'));
   if coalesce(row_out->>'ref','')='' then st:='invalid'; why:='Missing booking reference';
   elsif coalesce(row_out->>'reg','') ~ '[A-Za-z0-9]' and (length(row_out->>'reg')>12 or row_out->>'reg' !~ '^[A-Za-z0-9 -]+$') then st:='invalid';why:='Check registration: use the vehicle plate, not its description';
   elsif duplicate_key=any(seen) then st:='invalid'; why:='Duplicate reference in these files';
   else
    seen:=array_append(seen,duplicate_key);
    needed:=case when k='drops' then 'return_local' else 'drop_local' end;
    begin
     if coalesce(row_out->>'drop_local','') !~ '^\d{4}-\d\d-\d\d \d\d:\d\d$' or coalesce(row_out->>'return_local','') !~ '^\d{4}-\d\d-\d\d \d\d:\d\d$' then raise exception 'Unreadable date or time'; end if;
     at_time:=(row_out->>needed)::timestamp;
     if (at_time::date - (case when k='drops' and day_end<>'00:00'::time and at_time::time<=day_end then 1 else 0 end))<>day_key then raise exception 'Date does not match the selected sheet'; end if;
     if nullif(row_out->>'return_local','')::timestamp<nullif(row_out->>'drop_local','')::timestamp then raise exception 'Return is before drop-off'; end if;
    exception when others then st:='invalid'; why:='Missing, unreadable or mismatched booking date/time'; end;
   end if;
   -- Formatting variants must never create a second car under a different reference.
   if ex is null and st='new' and exists(select 1 from bookings b where b.company_id=s.company_id and b.kind=k and upper(regexp_replace(b.ref,'[^a-zA-Z0-9]','','g'))=split_part(duplicate_key,'|',2)) then st:='review'; why:='Reference matches an existing booking with different formatting. Open the booking to check.'; end if;
   if ex is not null and st='new' then
    foreach f in array array['reg','name','phone','make','drop_local','return_local','flight','note'] loop
     incoming:=coalesce(row_out->>f,''); current_value:=coalesce(ex->>f,'');
     if f='note' and current_value<>'' then continue; end if;
     if f='flight' and (ex->>'flight_typed')::boolean then continue; end if;
     if f='reg' and (ex->>'reg_typed')::boolean and incoming<>'' and upper(regexp_replace(incoming,'\s','','g'))=upper(regexp_replace(current_value,'\s','','g')) then continue; end if;
     if incoming<>'' and incoming<>current_value then
      changes:=changes||jsonb_build_array(jsonb_build_object('field',case f when 'return_local' then 'return' when 'drop_local' then 'drop' else f end,'from',current_value,'to',incoming));
     end if;
    end loop;
    st:=case when changes='[]' then 'unchanged' else 'changed' end;
    if ex->>'sheet_day'<>day_key::text then st:='review'; why:='Booking belongs to another sheet. Open the booking to move it safely.';
    elsif st='changed' and ((ex->>'cleared')::boolean or (ex->>'removed')::boolean or (ex->>'sent')::boolean) then st:='review'; why:='Car is with a driver, handed back or removed. Check before updating.';
    elsif exists(select 1 from jsonb_array_elements(changes) ch where (ch->>'field'='reg' and (ex->>'reg_typed')::boolean) or (ch->>'field'='return' and (ex->>'return_typed')::boolean) or (ch->>'field'='drop' and (ex->>'drop_typed')::boolean)) then st:='review'; why:='Office edits conflict with this file. Compare the values before deciding.'; end if;
   end if;
   if coalesce((r->>'cancelled')::boolean,false) then st:='review';why:='Cancelled in this file. Check the booking; nothing is removed automatically.'; end if;
   -- Row key refers to source position, never editable customer text.
   items:=items||jsonb_build_array(jsonb_build_object('key',k||'|'||day_key||'|'||row_num,'kind',k,'day',day_key,'ref',row_out->>'ref','reg',row_out->>'reg','name',row_out->>'name',
    'can_resolve',st='review' and why like 'Office edits%' and not exists(select 1 from jsonb_array_elements(changes) ch where ch->>'field'='drop'),'status',st,'changes',changes,'reason',why,'source',left(r->>'source',250),'row',row_out,'booking_id',ex->>'id','yard',ex->>'yard','number',ex->>'num','lane',ex->>'lane','position',ex->>'position',
    'attention',case when exists(select 1 from jsonb_array_elements(changes) ch where ch->>'field'='return' and ch->>'to'<ch->>'from') then 'Earlier return — check yard access' when exists(select 1 from jsonb_array_elements(changes) ch where ch->>'field'='reg') then 'Registration changed — check key tag' when coalesce(row_out->>'reg','') !~ '[A-Za-z0-9]' and st in ('new','changed') then 'No registration yet' else '' end));
   clean_rows:=clean_rows||jsonb_build_array(row_out);
  end loop;
  clean_batches:=clean_batches||jsonb_build_array(jsonb_build_object('kind',k,'day',day_key,'rows',clean_rows));
 end loop;
 -- Reject ALL occurrences of a repeated reference, including across files/days.
 select coalesce(jsonb_agg(case when d.n>1 then i||jsonb_build_object('status','invalid','reason','Repeated reference in these files; remove the overlap before importing') else i end order by i->>'key'),'[]') into items
 from jsonb_array_elements(items) i join (select i->>'kind' k,upper(regexp_replace(i->>'ref','[^a-zA-Z0-9]','','g')) ref,count(*) n from jsonb_array_elements(items) i group by 1,2) d
 on d.k=i->>'kind' and d.ref is not distinct from upper(regexp_replace(i->>'ref','[^a-zA-Z0-9]','','g'));
 -- Missing from a file means review, never automatic cancellation.
 for ex in select e from jsonb_array_elements(all_existing) e where not coalesce((e->>'removed')::boolean,false) and not coalesce((e->>'cleared')::boolean,false) and not coalesce((e->>'early')::boolean,false) and not coalesce((e->>'overstay')::boolean,false) and exists(select 1 from jsonb_array_elements(p_batches) b where b->>'kind'=e->>'kind' and b->>'day'=e->>'sheet_day') and not exists(select 1 from jsonb_array_elements(items) i where i->>'kind'=e->>'kind' and i->>'ref'=e->>'ref') loop
  items:=items||jsonb_build_array(jsonb_build_object('key','missing|'||(ex->>'kind')||'|'||(ex->>'ref'),'kind',ex->>'kind','day',ex->>'sheet_day','ref',ex->>'ref','reg',ex->>'reg','booking_id',ex->>'id','status','review','changes','[]'::jsonb,'reason','Not listed in these files. Confirm a cancellation or date change in the booking before taking action.'));
 end loop;
 select jsonb_object_agg(status,total) into cnt from (select i->>'status' status,count(*) total from jsonb_array_elements(items) i group by 1) x;
 snapshot:=md5(p_batches::text||(select coalesce(jsonb_agg(i-array['yard','number','lane','position'] order by i->>'key'),'[]') from jsonb_array_elements(items) i)::text);
 return jsonb_build_object('hash',snapshot,'items',items,'counts',coalesce(cnt,'{}'),'batches',clean_batches);
end $$;
revoke all on function reviewed_import_preview(jsonb) from public,anon;
grant execute on function reviewed_import_preview(jsonb) to authenticated;

-- Durable request IDs make a lost response safe to retry. File metadata and
-- per-booking before/after changes remain available after the undo window.
create table if not exists private.import_review_runs(
 id uuid primary key,company_id uuid not null references companies(id),staff_id uuid not null references staff(id),
 at timestamptz not null default now(), source jsonb not null, input_hash text not null, result jsonb not null
);
alter table private.import_review_runs enable row level security;
revoke all on private.import_review_runs from public,anon,authenticated;

create or replace function reviewed_import_apply(p_batches jsonb,p_hash text,p_selected text[],p_request uuid,p_source jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s staff:=me(); p jsonb; prior private.import_review_runs; it jsonb; g record; r jsonb; out jsonb:='[]'; before_after jsonb; input_hash text;
begin
 if s.id is null or not can('import') then raise exception 'Not allowed for your role: import'; end if;
 if p_request is null or coalesce(cardinality(p_selected),0)=0 then raise exception 'Select at least one booking.'; end if;
 if p_source is null or jsonb_typeof(p_source)<>'object' then p_source:='{}'; end if;
 input_hash:=md5(coalesce(p_batches::text,'')||coalesce(p_hash,'')||coalesce(p_selected::text,'')||coalesce(p_source::text,''));
 perform 1 from companies where id=s.company_id for update;
 select * into prior from private.import_review_runs where id=p_request;
 if found then
  if prior.company_id<>s.company_id or prior.staff_id<>s.id or prior.input_hash<>input_hash then raise exception 'This import request ID was already used.'; end if;
  return prior.result;
 end if;
 -- Lock only the cars this import can touch: the uploaded refs and the cars on the uploaded sheets.
 perform 1 from bookings b where b.company_id=s.company_id and (b.ref in (select trim(x->>'ref') from jsonb_array_elements(p_batches) pb cross join lateral jsonb_array_elements(pb->'rows') x)
  or b.sheet_id in (select sh.id from sheets sh join jsonb_array_elements(p_batches) pb on pb->>'kind'=sh.kind and (pb->>'day')::date=sh.day where sh.company_id=s.company_id)) order by b.id for update;
 p:=reviewed_import_preview(p_batches);
 if p->>'hash' is distinct from p_hash then raise exception 'Bookings changed since the preview. Check the files again before importing.'; end if;
 if cardinality(p_selected)<>(select count(distinct k) from unnest(p_selected) k) or exists(select 1 from unnest(p_selected) k where not exists(select 1 from jsonb_array_elements(p->'items') i where i->>'key'=k and i->>'status' in ('new','changed'))) then raise exception 'Selection includes an unchanged, invalid or unresolved booking.'; end if;
 for g in select i->>'kind' kind,(i->>'day')::date as sheet_day,jsonb_agg(i->'row') as import_rows from jsonb_array_elements(p->'items') i where i->>'key'=any(p_selected) group by 1,2 order by 1,2 loop
  r:=import_sheet(g.kind,g.sheet_day,g.import_rows,coalesce(p_source,'{}')||jsonb_build_object('manual',true,'reviewed',true,'run_id',p_request,'bookings',jsonb_array_length(g.import_rows)));
  out:=out||jsonb_build_array(r||jsonb_build_object('kind',g.kind,'day',g.sheet_day));
 end loop;
 select jsonb_agg(i-'row') into before_after from jsonb_array_elements(p->'items') i where i->>'key'=any(p_selected);
 r:=jsonb_build_object('days',out,'selected',cardinality(p_selected),'changes',before_after,'run_id',p_request);
 insert into private.import_review_runs(id,company_id,staff_id,source,input_hash,result) values(p_request,s.company_id,s.id,coalesce(p_source,'{}'),input_hash,r);
 return r;
end $$;
revoke all on function reviewed_import_apply(jsonb,text,text[],uuid,jsonb) from public,anon;
grant execute on function reviewed_import_apply(jsonb,text,text[],uuid,jsonb) to authenticated;

-- Recheck the same database snapshot inside the automatic import transaction.
create or replace function swift_apply_checked(p_company uuid,p_batches jsonb,p_existing jsonb,p_refs text[],p_source jsonb,p_user uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare days jsonb; actor uuid; run uuid:=gen_random_uuid(); writing text[];
begin
 perform 1 from companies where id=p_company for update;
 -- Only the bookings this run writes need to be as they were when the plan was made.
 select coalesce(array_agg(distinct x->>'ref'),'{}') into writing from jsonb_array_elements(p_batches) b cross join lateral jsonb_array_elements(b->'rows') x where coalesce(x->>'ref','')<>'' and x->>'ref'=any(coalesce(p_refs,'{}'));
 perform 1 from bookings where company_id=p_company and ref=any(writing) order by id for update;
 if coalesce((select jsonb_object_agg(e->>'kind'||'|'||(e->>'ref'),e-array['yard','num','lane','position']) from jsonb_array_elements(private.import_review_existing(p_company,writing)) e),'{}')
 is distinct from coalesce((select jsonb_object_agg(e->>'kind'||'|'||(e->>'ref'),e-array['yard','num','lane','position']) from jsonb_array_elements(coalesce(p_existing,'[]')) e where e->>'ref'=any(writing)),'{}') then raise exception 'Bookings changed since the preview. Check them again before importing.'; end if;
 days:=swift_apply(p_company,p_batches,(p_source-'changes')||jsonb_build_object('run_id',run),p_user);
 select id into actor from staff where user_id=p_user and company_id=p_company and active;
 insert into private.import_review_runs(id,company_id,staff_id,source,input_hash,result) values(run,p_company,actor,p_source-'changes',md5(p_batches::text),jsonb_build_object('days',days,'changes',coalesce(p_source->'changes','[]'),'selected',(select coalesce(sum(jsonb_array_length(b->'rows')),0) from jsonb_array_elements(p_batches) b)));
 return days;
end $$;
revoke all on function swift_apply_checked(uuid,jsonb,jsonb,text[],jsonb,uuid) from public,anon,authenticated;
grant execute on function swift_apply_checked(uuid,jsonb,jsonb,text[],jsonb,uuid) to service_role;

create or replace function reviewed_import_history() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare s staff:=me();
begin
 if s.id is null or not can('import') then raise exception 'Not allowed for your role: import'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc) from (select r.id,r.at,st.name as by,r.source,r.result from private.import_review_runs r join staff st on st.id=r.staff_id where r.company_id=s.company_id order by r.at desc limit 100) x),'[]');
end $$;
revoke all on function reviewed_import_history() from public,anon;
grant execute on function reviewed_import_history() to authenticated;

-- Undo preview is read only. The existing undo RPC still guards each changed field.
create or replace function reviewed_import_undo_preview(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare s staff:=me(); i private.imports;
begin
 if s.id is null or not can('import') then raise exception 'Not allowed for your role: import'; end if;
 select * into i from private.imports where id=p_id and company_id=s.company_id and at>now()-interval '24 hours';
 if not found or i.undone_at is not null then raise exception 'This import is no longer available to undo.'; end if;
 if exists(select 1 from private.imports x where x.company_id=s.company_id and x.kind=i.kind and x.day=i.day and x.id>i.id and x.undone_at is null) then raise exception 'Undo the later import on this sheet first.'; end if;
 return jsonb_build_object('added',coalesce((select jsonb_agg(jsonb_build_object('reg',b.reg,'ref',b.ref)) from bookings b where b.company_id=s.company_id and b.id=any(i.added)),'[]'),
 'changed',coalesce((select jsonb_agg(jsonb_build_object('ref',x->'after'->>'ref','reg',x->'after'->>'reg','changes',coalesce((select jsonb_agg(jsonb_build_object('field',f,'from',x->'after'->>f,'to',x->'before'->>f)) from unnest(array['reg','name','phone','make','drop_at','return_at','flight','note']) f where x->'before'->f is distinct from x->'after'->f),'[]'))) from jsonb_array_elements(i.changed) x),'[]'));
end $$;
revoke all on function reviewed_import_undo_preview(bigint) from public,anon;
grant execute on function reviewed_import_undo_preview(bigint) to authenticated;

-- Office conflict resolution uses existing audited booking actions, never an
-- overwrite of operational columns. Recheck the complete preview first.
create or replace function reviewed_import_resolve(p_batches jsonb,p_hash text,p_key text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s staff:=me(); p jsonb; i jsonb; ch jsonb; b uuid;
begin
 if s.id is null or not can('import') then raise exception 'Not allowed for your role: import'; end if;
 perform 1 from companies where id=s.company_id for update;
 -- Lock only the cars this import can touch: the uploaded refs and the cars on the uploaded sheets.
 perform 1 from bookings b where b.company_id=s.company_id and (b.ref in (select trim(x->>'ref') from jsonb_array_elements(p_batches) pb cross join lateral jsonb_array_elements(pb->'rows') x)
  or b.sheet_id in (select sh.id from sheets sh join jsonb_array_elements(p_batches) pb on pb->>'kind'=sh.kind and (pb->>'day')::date=sh.day where sh.company_id=s.company_id)) order by b.id for update;
 p:=reviewed_import_preview(p_batches);
 if p->>'hash' is distinct from p_hash then raise exception 'Bookings changed since the preview. Check the files again.'; end if;
 select x into i from jsonb_array_elements(p->'items') x where x->>'key'=p_key;
 if i is null or not coalesce((i->>'can_resolve')::boolean,false) then raise exception 'Open this booking to resolve it safely.'; end if;
 b:=(i->>'booking_id')::uuid;
 for ch in select * from jsonb_array_elements(i->'changes') loop
  if ch->>'field'='reg' then perform set_reg(b,ch->>'to');
  elsif ch->>'field'='return' and i->>'kind'='drops' then perform set_return(b,ch->>'to');
  elsif ch->>'field'='return' and i->>'kind'='picks' then perform set_pick_return(b,ch->>'to'); end if;
 end loop;
 return reviewed_import_preview(p_batches);
end $$;
revoke all on function reviewed_import_resolve(jsonb,text,text) from public,anon;
grant execute on function reviewed_import_resolve(jsonb,text,text) to authenticated;

-- Bind undo-window rows to their durable reviewed run, even after a sheet was
-- imported again. Preserve the legacy result shape for other app versions.
create or replace function recent_imports() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'kind',i.kind,'day',i.day,'at',i.at,'by',i.staff_name,
  'added',cardinality(i.added),'changed',jsonb_array_length(i.changed),'undone',i.undone_at is not null,
  'run_id',run.id,'files',run.source->'files',
  'source',case when run.id is not null then case when coalesce((run.source->>'auto')::boolean,false) then 'auto' else 'manual' end when sh.imported_at=i.at then case when coalesce((sh.source->>'auto')::boolean,false) then 'auto' else 'manual' end end,
  'latest',not exists(select 1 from private.imports j where j.company_id=i.company_id and j.kind=i.kind and j.day=i.day and j.id>i.id and j.undone_at is null)) order by i.id desc),'[]')
 from private.imports i left join sheets sh on sh.id=i.sheet_id
 left join lateral (select r.id,r.source from private.import_review_runs r where r.company_id=i.company_id and exists(select 1 from jsonb_array_elements(r.result->'days') d where (d->>'undo_id')::bigint=i.id) limit 1) run on true
 where i.company_id=(me()).company_id and i.at>now()-interval '24 hours' and can('import')
$$;
revoke all on function recent_imports() from public,anon;
grant execute on function recent_imports() to authenticated;
