-- Parking Ops — database part 87: the Swift sync imports AS THE PERSON who pressed the button.
-- APPLIED by Claude on 14 Oct at the user's request.
-- Part 61's import_sheet_system makes an "Auto import" staff row with a random user_id,
-- which staff_user_id_fkey (auth.users) rejects, so the first Get bookings now imported
-- nothing (all or nothing). swift_apply now takes the signed-in user (checked by the edge
-- function) and runs import_sheet as them: history and Undo are theirs, as for a hand import.
create or replace function swift_apply(p_company uuid, p_batches jsonb, p_source jsonb, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b jsonb; res jsonb; out jsonb := '[]';
begin
  if jsonb_typeof(p_batches) <> 'array' then raise exception 'Nothing to import.'; end if;
  if not exists (select 1 from staff where user_id = p_user and company_id = p_company and active) then
    raise exception 'Not a signed-in member of this company.';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  if not can('import') then raise exception 'You don''t have permission to import.'; end if;
  for b in select * from jsonb_array_elements(p_batches) loop
    res := import_sheet(b->>'kind', (b->>'day')::date, b->'rows', coalesce(p_source, '{}') || jsonb_build_object('bookings', jsonb_array_length(b->'rows')));
    out := out || jsonb_build_array(jsonb_build_object('kind', b->>'kind', 'day', b->>'day') || (res - 'added_ids'));
  end loop;
  return out;
end $$;
revoke all on function swift_apply(uuid,jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function swift_apply(uuid,jsonb,jsonb,uuid) to service_role;
create or replace function swift_apply(p_company uuid, p_batches jsonb, p_source jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
begin raise exception 'Superseded: use swift_apply with the signed-in user.'; end $$;
