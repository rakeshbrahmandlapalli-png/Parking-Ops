-- Parking Ops — database part 98: button stamps carry the name picked on a shared login.
--
-- 20 Oct: part 97 put the picked name (RAKESH.O) on activity lines, but the
-- small name on SENT / CALLED / CLEAR (and PICKS, PT, exit fee, charges,
-- removed) still showed the login's name, because the app turned sent_by etc.
-- into staff.name. Now:
--   • bookings.by_name: {"sent_by": "RAKESH.O", ...}, one entry per *_by column
--     set while a name was picked on that login.
--   • Trigger bookings_by_name: whenever a *_by column is set, its entry is the
--     person's staff.acting (none when no name is picked); cleared with it.
-- The app shows by_name first, then the login's name. Nothing else changes.
-- Safe to run twice.

alter table bookings add column if not exists by_name jsonb not null default '{}';

create or replace function bookings_by_name() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c text;
  n jsonb := coalesce(new.by_name, '{}');
  nv uuid; ov uuid; a text;
begin
  foreach c in array array['sent_by','called_by','cleared_by','intake_by','pt_by','exit_by','charge_by','removed_by'] loop
    nv := (to_jsonb(new) ->> c)::uuid;
    ov := case when tg_op = 'UPDATE' then (to_jsonb(old) ->> c)::uuid end;
    if tg_op = 'INSERT' or nv is distinct from ov then
      a := '';
      if nv is not null then select acting into a from staff where id = nv; end if;
      if coalesce(a, '') <> '' then n := n || jsonb_build_object(c, a); else n := n - c; end if;
    end if;
  end loop;
  new.by_name := n;
  return new;
end;
$$;
revoke execute on function bookings_by_name() from public, anon, authenticated;
create or replace trigger bookings_by_name before insert or update on bookings for each row execute function bookings_by_name();
