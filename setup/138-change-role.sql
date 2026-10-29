-- Parking Ops — database part 138: change a person's role.
--
-- 29 Oct: rakesh asked for "an option to change their roles" after Anil and
-- AASHISH (Office) couldn't see the Dashboard, which needs Settings (Manager
-- default). Until now a role was fixed when the person was added.
--   • set_staff_role(staff, role): whoever can manage that person
--     (staff_target: a manager or the owner, never themselves, an owner only
--     by an owner). Only an owner can make someone an owner.
--   • Their per-person ticks (staff.extra) stay as they are; the new role's
--     defaults apply to everything not ticked by hand.
--   • Logged as STAFF "Role for <name>: was Office, now Manager".
-- Nothing else changes. Safe to run twice.

create or replace function set_staff_role(p_staff uuid, p_role text)
returns staff language plpgsql security definer set search_path = public as $$
declare
  t staff := staff_target(p_staff);
  was text := t.role;
  r text := lower(btrim(coalesce(p_role, '')));
begin
  if not (r = any(array['owner','manager','office','bongo','terminal','view'])) then raise exception 'Choose a role.'; end if;
  if r = 'owner' and (select role from me()) <> 'owner' then raise exception 'Only an owner can make someone an owner.'; end if;
  if r = was then return t; end if;
  update staff set role = r where id = t.id returning * into t;
  insert into activity(company_id, staff_id, staff_name, action, value)
  select t.company_id, s.id, s.name, 'STAFF', 'Role for ' || t.name || ': was ' || initcap(was) || ', now ' || initcap(r) from me() s;
  return t;
end;
$$;
revoke execute on function set_staff_role(uuid, text) from public, anon;
grant execute on function set_staff_role(uuid, text) to authenticated;
