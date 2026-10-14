-- Parking Ops — database part 89: Recent imports say where each import came from.
--
-- recent_imports() (part 44) gains 'source': "auto" for an import from the connected booking site,
-- "manual" for a booking file the office uploaded. The sheet row keeps the source of its latest
-- import (import_sheet_core writes it in the same transaction as the import log, so the two share a
-- timestamp); an older import of a sheet that has been imported since has no known source and is
-- listed without one. Nothing else changes: same rows, same Undo rule, same 24 hours. Read only.
-- Safe to run twice.

create or replace function recent_imports()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'day', i.day, 'at', i.at, 'by', i.staff_name,
      'added', cardinality(i.added), 'changed', jsonb_array_length(i.changed),
      'undone', i.undone_at is not null,
      'source', case when sh.imported_at = i.at then case when coalesce((sh.source->>'auto')::boolean, false) then 'auto' else 'manual' end end,
      'latest', not exists (select 1 from private.imports j where j.company_id = i.company_id and j.kind = i.kind and j.day = i.day
                            and j.id > i.id and j.undone_at is null)) order by i.id desc), '[]')
  from private.imports i
  left join sheets sh on sh.id = i.sheet_id
  where i.company_id = my_company() and i.at > now() - interval '24 hours' and can('import')
$$;
revoke execute on function recent_imports() from public, anon;
grant execute on function recent_imports() to authenticated;
