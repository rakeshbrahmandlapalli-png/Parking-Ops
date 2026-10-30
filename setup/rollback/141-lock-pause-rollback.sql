-- Rollback for part 141: back to part 137's rule (no pause). Nobody's lock setting is touched.
begin;
create or replace function private.clock_gate_closed(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.clock_gate g join public.staff s on s.id = g.staff_id and s.company_id = g.company_id
    where g.staff_id = p_staff and g.active
      and not exists (select 1 from public.aero_shifts a
                      where a.user_id = s.user_id and a.company_id = s.company_id and a.clock_out_at is null))
$$;
revoke all on function private.clock_gate_closed(uuid) from public, anon, authenticated;
commit;
-- Optional, in the SQL editor (they hold a DROP): the two functions and the table are harmless to leave.
--   drop function public.clock_gate_pause_set(boolean); drop function public.clock_gate_pause_status();
--   drop table private.clock_gate_pause;
