-- Rollback of part 130: import_sheet as in part 53 (snapshots every car of the kind).
-- Contains DELETE: run it in the SQL editor.

create or replace function import_sheet(p_kind text, p_day date, p_rows jsonb, p_source jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s staff := me();
  res jsonb;
  had_sheet boolean;
  imp_id bigint;
begin
  if not can('import') then raise exception 'Not allowed for your role: import'; end if;
  select exists (select 1 from sheets where company_id = s.company_id and kind = p_kind and day = p_day) into had_sheet;
  create temp table if not exists _imp_before (id uuid primary key, row jsonb) on commit drop;
  truncate _imp_before;
  insert into _imp_before select b.id, to_jsonb(b) - 'updated_at' from bookings b where b.company_id = s.company_id and b.kind = p_kind;

  -- Cars in the file exactly as they already are aren't rewritten (see top).
  perform set_config('takeoff.import_noop', 'on', true);
  res := import_sheet_core(p_kind, p_day, p_rows, p_source);
  perform set_config('takeoff.import_noop', 'off', true);

  delete from private.imports where at < now() - interval '2 days';
  insert into private.imports(company_id, sheet_id, kind, day, staff_id, staff_name, result, added, changed, sheet_created)
  select s.company_id, (res->>'sheet_id')::uuid, p_kind, p_day, s.id, s.name, res,
    coalesce((select array_agg(b.id) from bookings b where b.company_id = s.company_id and b.kind = p_kind
              and not exists (select 1 from _imp_before o where o.id = b.id)), '{}'),
    coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'before', o.row, 'after', to_jsonb(b) - 'updated_at'))
              from bookings b join _imp_before o on o.id = b.id where (to_jsonb(b) - 'updated_at') is distinct from o.row), '[]'),
    not had_sheet
  returning id into imp_id;
  return res || jsonb_build_object('undo_id', imp_id, 'added_ids', (select to_jsonb(added) from private.imports where id = imp_id));
end;
$$;
