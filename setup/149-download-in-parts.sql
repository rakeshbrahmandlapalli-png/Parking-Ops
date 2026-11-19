--  PARKING OPS — part 149: the owner's "Download a backup" in parts
--
--  download_my_company() built the whole company in one statement. By 19 Nov
--  TakeOff's copy was 38 MB (10k bookings, 56k activity lines) and took about
--  18 s, past the 8 s the app's requests are allowed, so every press failed
--  with "canceling statement due to statement timeout", nothing was logged and
--  the board's "Keep your own copy" reminder never went away.
--
--  download_my_company_part() hands the same data over a piece at a time
--  (each well under a second); the app joins the pieces into the same file as
--  before. 'done' writes the activity line the reminder reads, so it is only
--  written once the whole copy has arrived. Owner only, own company only, no
--  secrets: the same rules as download_my_company(), which stays for phones
--  still on the old app.
--
--  Parts:
--    head                      format, version, exported_at, company, staff
--                              (no user_id), timetable, alert_prefs
--    sheets/bookings/activity  up to p_limit rows (at most 5000) after p_after,
--                              in id order; an empty array means that table is done
--    done                      logs "Downloaded a backup of the company's data"
--
--  Functions only, no table change. Rollback: setup/rollback/149-*.

create or replace function download_my_company_part(p_part text, p_after text default null, p_limit int default 3000)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s staff := me(); c companies; n int := least(greatest(coalesce(p_limit, 3000), 1), 5000); d jsonb;
begin
  if s.id is null or s.role <> 'owner' then raise exception 'Only the owner can download the company''s data.'; end if;
  select * into c from companies where id = s.company_id;
  if c.slug = 'platform' then raise exception 'Nothing to download here.'; end if;

  if p_part = 'head' then
    return jsonb_build_object(
      'format',      'takeoff-ops-company-export',
      'version',     1,
      'exported_at', now(),
      'company',     to_jsonb(c),
      'staff',       coalesce((select jsonb_agg(to_jsonb(t) - 'user_id') from staff t where t.company_id = c.id), '[]'::jsonb),
      'timetable',   coalesce((select jsonb_agg(to_jsonb(t)) from timetable t where t.company_id = c.id), '[]'::jsonb),
      'alert_prefs', coalesce((select jsonb_agg(to_jsonb(t)) from alert_prefs t where t.company_id = c.id), '[]'::jsonb));
  elsif p_part = 'sheets' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) into d from
      (select * from sheets where company_id = c.id and (p_after is null or id > p_after::uuid) order by id limit n) t;
  elsif p_part = 'bookings' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) into d from
      (select * from bookings where company_id = c.id and (p_after is null or id > p_after::uuid) order by id limit n) t;
  elsif p_part = 'activity' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) into d from
      (select * from activity where company_id = c.id and (p_after is null or id > p_after::bigint) order by id limit n) t;
  elsif p_part = 'done' then
    insert into activity(company_id, staff_id, staff_name, action, value)
    values (c.id, s.id, s.name, 'SETTINGS', 'Downloaded a backup of the company''s data');
    return null;
  else
    raise exception 'Unknown part %', p_part;
  end if;
  return d;
end $$;
revoke execute on function download_my_company_part(text, text, int) from public, anon;
grant execute on function download_my_company_part(text, text, int) to authenticated;
