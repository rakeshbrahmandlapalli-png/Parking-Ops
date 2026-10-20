-- Part 99: Online / Offline on Staff & access.
-- The app calls i_am_here() every minute while it is open on screen; staff_seen()
-- gives whoever can manage staff each person's last check-in and last logged action.
-- Online = seen in the last 5 minutes (worked out in the app). Nothing is dropped.
begin;

create table if not exists staff_seen (
  staff_id uuid primary key references staff(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table staff_seen enable row level security;   -- read and written only through the functions below

create or replace function i_am_here() returns void
language plpgsql security definer set search_path = public as $$
declare s staff := me();
begin
  if s.id is null then return; end if;
  insert into staff_seen(staff_id, company_id, seen_at) values (s.id, s.company_id, now())
    on conflict (staff_id) do update set seen_at = excluded.seen_at, company_id = excluded.company_id;
end $$;

create or replace function staff_seen() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s staff := me();
begin
  if s.id is null or not can('staff') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'seen_at', v.seen_at,
      'acted_at', (select max(a.at) from activity a where a.staff_id = t.id and a.company_id = s.company_id)))
    from staff t left join staff_seen v on v.staff_id = t.id
    where t.company_id = s.company_id and t.removed_at is null), '[]'::jsonb);
end $$;

revoke all on function i_am_here() from public, anon;
revoke all on function staff_seen() from public, anon;
grant execute on function i_am_here() to authenticated;
grant execute on function staff_seen() to authenticated;

commit;
