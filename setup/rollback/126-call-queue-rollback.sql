-- Rollback for part 126 (call queue): run in the SQL editor after restoring the
-- frontend without the call queue. call_take goes back to part 117's; the callback
-- columns and their history are kept (the record).
begin;
drop function if exists public.call_queue_feed();
drop function if exists public.call_claim(bigint);
drop function if exists public.call_callback(bigint, text);
drop function if exists private.call_workflow_on(uuid);
create or replace function public.call_take(p_call bigint)
returns public.customer_calls language plpgsql security definer set search_path = public as $$
declare s staff := me(); k customer_calls;
begin
  if s.id is null or not can('called') then raise exception 'Not allowed for your role.'; end if;
  update customer_calls set handled_by = s.id, handled_name = coalesce(nullif(s.acting, ''), s.name)
  where id = p_call and company_id = s.company_id returning * into k;
  if k.id is null then raise exception 'Call not found.'; end if;
  insert into activity(company_id, booking_id, reg, customer, staff_id, staff_name, action, value)
  values (k.company_id, k.booking_id, k.reg, k.name, s.id, coalesce(nullif(s.acting, ''), s.name), 'CALL',
    case when k.status = 'missed' then 'Called back ' else 'Took the call from ' end || k.from_number);
  return k;
end;
$$;
revoke execute on function public.call_take(bigint) from public, anon;
grant execute on function public.call_take(bigint) to authenticated;
commit;
