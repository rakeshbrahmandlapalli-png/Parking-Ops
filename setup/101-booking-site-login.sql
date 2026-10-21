-- Parking Ops — database part 101: the client's own booking website and login,
-- saved by its owner in Settings → Booking website, for the automatic import.
--
--   • private.booking_site: one row per company, the address and the login name.
--   • The password is kept in Supabase Vault (vault.secrets, encrypted), named
--     booking_site:<company id>. Nothing the app can call returns it: the owner
--     sees only "saved"; booking_site_login() is for the import function
--     (service role) alone.
--   • booking_site_set(url, login, password): owners only, their own company.
--     A null password keeps the saved one; '' everywhere removes the login
--     (the Vault row is emptied, not deleted).
--   • booking_site_status(): owners only, address, login name, whether a
--     password is saved, who saved it and when.
-- No DELETE or DROP here. Safe to run twice.

create table if not exists private.booking_site (
  company_id uuid primary key references companies(id) on delete cascade,
  url        text not null default '',
  login      text not null default '',
  secret_id  uuid,
  has_pass   boolean not null default false,
  saved_by   text not null default '',
  saved_at   timestamptz
);
revoke all on private.booking_site from public, anon, authenticated;

create or replace function booking_site_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s staff := me();
  b private.booking_site;
begin
  if s.role <> 'owner' then raise exception 'Only an owner can see the booking website login.'; end if;
  select * into b from private.booking_site where company_id = s.company_id;
  return jsonb_build_object('url', coalesce(b.url, ''), 'login', coalesce(b.login, ''), 'has_pass', coalesce(b.has_pass, false),
    'saved_by', coalesce(b.saved_by, ''), 'saved_at', b.saved_at);
end;
$$;
revoke execute on function booking_site_status() from public, anon;
grant execute on function booking_site_status() to authenticated;

create or replace function booking_site_set(p_url text, p_login text, p_password text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s staff := me();
  b private.booking_site;
  u text := btrim(coalesce(p_url, ''));
  l text := btrim(coalesce(p_login, ''));
  clear boolean := u = '' and l = '' and coalesce(p_password, '') = '';
  sid uuid;
begin
  if s.role <> 'owner' then raise exception 'Only an owner can change the booking website login.'; end if;
  if not clear then
    if u !~* '^https://[a-z0-9.-]+\.[a-z]{2,}(/\S*)?$' then raise exception 'The website address starts with https://'; end if;
    if length(u) > 300 then raise exception 'The website address is too long.'; end if;
    if l = '' then raise exception 'Enter the login name.'; end if;
    if length(l) > 200 or length(coalesce(p_password, '')) > 200 then raise exception 'The login is 200 characters at most.'; end if;
  end if;
  insert into private.booking_site(company_id) values (s.company_id) on conflict do nothing;
  select * into b from private.booking_site where company_id = s.company_id for update;
  if not clear and p_password is null and not b.has_pass then raise exception 'Enter the password.'; end if;
  sid := b.secret_id;
  if p_password is not null or clear then
    if sid is null then
      sid := vault.create_secret(coalesce(p_password, ''), 'booking_site:' || s.company_id, 'Booking website password');
    else
      perform vault.update_secret(sid, coalesce(p_password, ''));
    end if;
  end if;
  update private.booking_site set url = u, login = l, secret_id = sid,
    has_pass = case when clear then false when p_password is null then has_pass else p_password <> '' end,
    saved_by = s.name, saved_at = now()
  where company_id = s.company_id;
  insert into activity(company_id, staff_id, staff_name, action, value)
  values (s.company_id, s.id, s.name, 'SETTINGS', case when clear then 'Booking website login removed' else 'Booking website login saved' end);
  return booking_site_status();
end;
$$;
revoke execute on function booking_site_set(text, text, text) from public, anon;
grant execute on function booking_site_set(text, text, text) to authenticated;

-- For the import function only.
create or replace function booking_site_login(p_company uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('url', b.url, 'login', b.login, 'password', coalesce(d.decrypted_secret, ''))
  from private.booking_site b left join vault.decrypted_secrets d on d.id = b.secret_id
  where b.company_id = p_company and b.login <> '' and b.has_pass;
$$;
revoke execute on function booking_site_login(uuid) from public, anon, authenticated;
grant execute on function booking_site_login(uuid) to service_role;
