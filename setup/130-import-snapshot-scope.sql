-- Parking Ops — database part 130: an import only snapshots the cars it can touch.
--
-- 28 Oct: Auto import of the next 7 days (363 bookings, 16 sheets) failed three
-- times with "canceling statement due to statement timeout". The whole import is
-- one call, and the API stops any call after 8 seconds. Most of that time wasn't
-- the import itself: for undo (part 44), import_sheet copied EVERY car of that
-- kind the company has ever had (~4,200 TakeOff DROPS) into a temporary table
-- before each sheet, and compared them all again after it, so 16 sheets cost
-- ~10-15 seconds whatever was in them, and it grew every day.
--   • import_sheet: the before-copy now holds only the cars this sheet can
--     change: the cars already on that sheet, and cars with a reference or
--     registration in the file (an earlier DROPS car moved here, part 33).
--     New cars are only ever added to this sheet. Undo records the same
--     added/changed cars as before.
-- Otherwise import_sheet is exactly part 53's. Safe to run twice.
-- Contains DELETE (the 2-day trim of private.imports): run it in the SQL editor.
-- Rollback: setup/rollback/130-import-snapshot-scope-rollback.sql (part 53's).

create or replace function import_sheet(p_kind text, p_day date, p_rows jsonb, p_source jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s staff := me();
  res jsonb;
  had_sheet boolean;
  imp_id bigint;
  sheet uuid;
  refs text[];
  regs text[];
begin
  if not can('import') then raise exception 'Not allowed for your role: import'; end if;
  select id into sheet from sheets where company_id = s.company_id and kind = p_kind and day = p_day;
  had_sheet := sheet is not null;
  if jsonb_typeof(p_rows) = 'array' then
    select coalesce(array_agg(distinct r->>'ref') filter (where coalesce(r->>'ref', '') <> ''), '{}'),
           coalesce(array_agg(distinct upper(regexp_replace(r->>'reg', '\s', '', 'g'))) filter (where regexp_replace(coalesce(r->>'reg', ''), '\s', '', 'g') <> ''), '{}')
      into refs, regs from jsonb_array_elements(p_rows) r;
  end if;
  create temp table if not exists _imp_before (id uuid primary key, row jsonb) on commit drop;
  truncate _imp_before;
  insert into _imp_before select b.id, to_jsonb(b) - 'updated_at' from bookings b
    where b.company_id = s.company_id and b.kind = p_kind
      and (b.sheet_id = sheet or b.ref = any(refs)
        or (cardinality(regs) > 0 and upper(regexp_replace(b.reg, '\s', '', 'g')) = any(regs)));

  -- Cars in the file exactly as they already are aren't rewritten (part 53).
  perform set_config('takeoff.import_noop', 'on', true);
  res := import_sheet_core(p_kind, p_day, p_rows, p_source);
  perform set_config('takeoff.import_noop', 'off', true);

  delete from private.imports where at < now() - interval '2 days';
  insert into private.imports(company_id, sheet_id, kind, day, staff_id, staff_name, result, added, changed, sheet_created)
  select s.company_id, (res->>'sheet_id')::uuid, p_kind, p_day, s.id, s.name, res,
    coalesce((select array_agg(b.id) from bookings b where b.sheet_id = (res->>'sheet_id')::uuid and b.kind = p_kind
              and not exists (select 1 from _imp_before o where o.id = b.id)), '{}'),
    coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'before', o.row, 'after', to_jsonb(b) - 'updated_at'))
              from bookings b join _imp_before o on o.id = b.id where (to_jsonb(b) - 'updated_at') is distinct from o.row), '[]'),
    not had_sheet
  returning id into imp_id;
  return res || jsonb_build_object('undo_id', imp_id, 'added_ids', (select to_jsonb(added) from private.imports where id = imp_id));
end;
$$;
