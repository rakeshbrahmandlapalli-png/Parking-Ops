-- Rollback for part 138 (SQL editor). Roles already changed stay as they are.
drop function if exists set_staff_role(uuid, text);
