-- Rollback for 111. Run only AFTER the previous frontend and takeoff-bookings (v19) are back, since the new
-- code calls these. Revokes the new RPCs and puts recent_imports back as it was (110). Keeps
-- private.import_review_runs (the audit of what was imported) and every booking/import row.
revoke execute on function reviewed_import_preview(jsonb) from authenticated;
revoke execute on function reviewed_import_apply(jsonb,text,text[],uuid,jsonb) from authenticated;
revoke execute on function reviewed_import_resolve(jsonb,text,text) from authenticated;
revoke execute on function reviewed_import_history() from authenticated;
revoke execute on function reviewed_import_undo_preview(bigint) from authenticated;
revoke execute on function import_review_existing(uuid,text[]) from service_role;
revoke execute on function swift_apply_checked(uuid,jsonb,jsonb,text[],jsonb,uuid) from service_role;

create or replace function public.recent_imports() returns jsonb
language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'day', i.day, 'at', i.at, 'by', i.staff_name,
      'added', cardinality(i.added), 'changed', jsonb_array_length(i.changed),
      'undone', i.undone_at is not null,
      'source', case when sh.imported_at = i.at then case when coalesce((sh.source->>'auto')::boolean, false) then 'auto' else 'manual' end end,
      'latest', not exists (select 1 from private.imports j where j.company_id = i.company_id and j.kind = i.kind and j.day = i.day
                            and j.id > i.id and j.undone_at is null)) order by i.id desc), '[]')
  from private.imports i
  left join sheets sh on sh.id = i.sheet_id
  where i.company_id = my_company() and i.at > now() - interval '24 hours' and can('import')
$function$;
