-- Parking Ops — database part 97: names on a shared login (the office PC).
--
-- 20 Oct: three people work the office PC on one login (OFFICE) with one link
-- and PIN. They switch names instead of signing out:
--   • staff.desk_names: the names that work on this login, set by whoever can
--     manage that person (set_desk_names, the same rule as set_staff_access).
--   • staff.acting: the name working now, set by the person signed in
--     (set_acting; '' = nobody picked, the login's own name).
--   • Every activity line written while a name is picked carries that name
--     (trigger on activity), so Summary and the history show RAKESH.O, not OFFICE.
-- Nothing else changes. Safe to run twice.

alter table staff add column if not exists desk_names text[] not null default '{}';
alter table staff add column if not exists acting text not null default '';

create or replace function set_desk_names(p_staff uuid, p_names text[])
returns staff language plpgsql security definer set search_path = public as $$
declare
  t staff := staff_target(p_staff);
  n text;
  clean text[] := '{}';
begin
  foreach n in array coalesce(p_names, '{}') loop
    n := btrim(n);
    if n = '' then continue; end if;
    if length(n) > 30 then raise exception 'Keep each name to 30 letters.'; end if;
    if not (upper(n) = any(select upper(x) from unnest(clean) x)) then clean := clean || n; end if;
  end loop;
  if cardinality(clean) > 20 then raise exception 'Up to 20 names.'; end if;
  update staff set desk_names = clean,
                   acting = case when acting = any(clean) then acting else '' end
    where id = t.id returning * into t;
  insert into activity(company_id, staff_id, staff_name, action, value)
  select t.company_id, s.id, s.name, 'STAFF', 'Names on ' || t.name || ': ' || coalesce(nullif(array_to_string(clean, ', '), ''), 'none') from me() s;
  return t;
end;
$$;
revoke execute on function set_desk_names(uuid, text[]) from public, anon;
grant execute on function set_desk_names(uuid, text[]) to authenticated;

create or replace function set_acting(p_name text)
returns staff language plpgsql security definer set search_path = public as $$
declare
  s staff := me();
  n text := btrim(coalesce(p_name, ''));
begin
  if s.id is null then raise exception 'Sign in again.'; end if;
  if n <> '' and not (n = any(s.desk_names)) then raise exception 'That name isn''t on this login.'; end if;
  update staff set acting = n where id = s.id returning * into s;
  return s;
end;
$$;
revoke execute on function set_acting(text) from public, anon;
grant execute on function set_acting(text) to authenticated;

-- Activity written while a name is picked carries that name.
create or replace function activity_acting() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text;
begin
  if new.staff_id is not null then
    select acting into a from staff where id = new.staff_id;
    if coalesce(a, '') <> '' then new.staff_name := a; end if;
  end if;
  return new;
end;
$$;
revoke execute on function activity_acting() from public, anon, authenticated;
create or replace trigger activity_acting before insert on activity for each row execute function activity_acting();
