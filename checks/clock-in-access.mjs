// Part 137 (clock in to see Parking Ops) against throwaway Postgres (PGlite); no live data or credentials.
// npm --prefix checks ci, then node checks/clock-in-access.mjs.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const db = new PGlite();
const part = fs.readFileSync(new URL("../setup/137-clock-in-access.sql", import.meta.url), "utf8");
const q = async (sql, args) => (await db.query(sql, args)).rows;
let passed = 0, failed = 0;
const check = (name, good, info) => { console.log((good ? "PASS " : "FAIL ") + name + (good || info === undefined ? "" : " " + JSON.stringify(info))); good ? passed++ : failed++; };
const fails = async (sql, args, re) => { try { await q(sql, args); return false; } catch (e) { return re.test(e.message); } };
await db.exec(`
create role anon; create role authenticated; create schema private; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated;
create table companies (id uuid primary key default gen_random_uuid(), name text, slug text unique, brand jsonb not null default '{}', suspended_at timestamptz, time_zone text default 'Europe/London');
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid references companies(id), user_id uuid, name text, role text,
  extra text[] not null default '{}', active boolean default true, removed_at timestamptz, desk_names text[] not null default '{}');
create table activity (id serial, company_id uuid, staff_id uuid, staff_name text, action text, value text);
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, reg text, customer text, phone text);
alter table bookings enable row level security;
create table aero_companies (id uuid primary key, name text, time_zone text);
create table aero_profiles (id uuid primary key, company_id uuid, full_name text, role text check (role in ('owner','admin','staff')) default 'staff', active boolean default true);
create table attendance_staff_links (id uuid primary key default gen_random_uuid(), company_id uuid, staff_id uuid unique, attendance_user_id uuid unique, active boolean default true);
create table private.attendance_release (company_id uuid primary key, pilot boolean not null default true);
create table private.attendance_testers (id uuid primary key default gen_random_uuid(), company_id uuid, user_id uuid, active boolean default true, unique(company_id,user_id));
create function private.attendance_pilot_allowed(p_company uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select p_user is not null and (exists(select 1 from private.attendance_release where company_id=p_company and not pilot)
 or exists(select 1 from private.attendance_testers where company_id=p_company and user_id=p_user and active)) $$;
create table aero_shifts (id uuid primary key default gen_random_uuid(), company_id uuid, user_id uuid, clock_in_at timestamptz default now(), clock_out_at timestamptz);
create table push_subscriptions (id uuid primary key default gen_random_uuid(), staff_id uuid, company_id uuid, endpoint text, p256dh text default 'k', auth text default 'a');
create table private.ops_push_outbox (id uuid primary key default gen_random_uuid(), subscription_id uuid, staff_id uuid, company_id uuid, delivery_key text,
  kind text, payload jsonb, urgency text, expires_at timestamptz, state text default 'pending', attempts int default 0, lease_id uuid, lease_until timestamptz,
  due_at timestamptz default now(), unique (subscription_id, delivery_key));
create table private.ops_note_options (staff_id uuid, paused_until timestamptz, routine_silent boolean);
create function private.ops_push_valid(o private.ops_push_outbox) returns boolean language sql stable as $$ select true $$;
create function me() returns staff language sql stable security definer set search_path = public as $$ select null::staff $$;
create function my_company() returns uuid language sql stable security definer set search_path = public as $$ select null::uuid $$;
create function can(p text) returns boolean language sql stable security definer set search_path = public as $$ select (me()).id is not null $$;
create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff s join companies c on c.id = s.company_id where s.user_id = auth.uid() and s.active and s.role = 'owner' and c.slug = 'platform') $$;
create function staff_admin_context() returns jsonb language sql stable as $$ select null::jsonb $$;
create policy bookings_read on bookings for select to authenticated using (company_id = (select my_company()));
grant select on bookings to authenticated;
grant execute on all functions in schema public to authenticated;
`);
const part2 = fs.readFileSync(new URL("../setup/139-attendance-switches.sql", import.meta.url), "utf8");
await db.exec(part);
await db.exec(part); // safe to run again

const co = {}, staff = {}, user = {};
for (const slug of ["takeoff", "apb", "platform"]) co[slug] = (await q("insert into companies(name,slug,brand) values($1,$1,'{\"attendance\":true}') returning id", [slug]))[0].id;
for (const [who, slug, role, desk] of [["rakesh", "takeoff", "owner"], ["aashish", "takeoff", "office"], ["anil", "takeoff", "office"], ["wasim", "takeoff", "bongo"], ["sam", "takeoff", "office"],
  ["office", "takeoff", "office", ["A", "B"]], ["apb", "apb", "manager"], ["admin", "platform", "owner"]]) {
  user[who] = crypto.randomUUID();
  staff[who] = (await q("insert into staff(company_id,user_id,name,role,desk_names) values($1,$2,$3,$4,$5) returning id", [co[slug], user[who], who.toUpperCase(), role, desk || []]))[0].id;
  if (["rakesh", "aashish", "anil", "wasim"].includes(who)) await q("insert into aero_profiles(id,company_id,full_name,role) values($1,$2,$3,'staff')", [user[who], co[slug], who]);
}
await q("insert into bookings(company_id,reg,customer,phone) values($1,'AB12CDE','Mr Customer','07700900000'),($2,'XY99ZZZ','Other client','07700900001')", [co.takeoff, co.apb]);
for (const who of ["rakesh", "aashish", "anil", "wasim"]) await q("insert into push_subscriptions(staff_id,company_id,endpoint) values($1,$2,$3)", [staff[who], co.takeoff, "https://push.invalid/" + who]);

const as = async (who, fn) => {
  await db.exec("set role authenticated"); await q("select set_config('test.uid', $1, false)", [who ? user[who] : ""]);
  try { return await fn(); } finally { await db.exec("reset role"); }
};
const sees = (who) => as(who, () => q("select reg, customer, phone from bookings"));
const gate = (who, on, by = "admin") => as(by, () => q("select clock_gate_set($1,$2)", [staff[who], on]));
const clockIn = (who) => q("insert into aero_shifts(company_id,user_id) values($1,$2)", [co.takeoff, user[who]]);
const clockOut = (who) => q("update aero_shifts set clock_out_at=now() where user_id=$1 and clock_out_at is null", [user[who]]);

// Nobody listed: nothing changes for anyone.
check("before the trial, Aashish sees TAKEOFF bookings", (await sees("aashish")).length === 1);
check("before the trial, status says not gated", (await as("aashish", () => q("select clock_gate_status() s")))[0].s.gated === false);

// Who may switch it.
check("before part 139, a client owner cannot switch the gate", await as("rakesh", () => fails("select clock_gate_set($1,true)", [staff.aashish], /Not allowed/)));
check("signed out cannot switch the gate", await as(null, () => fails("select clock_gate_set($1,true)", [staff.aashish], /Not allowed/)));
check("a shared desk login cannot be gated", await as("admin", () => fails("select clock_gate_set($1,true)", [staff.office], /shared login/)));
check("someone without Attendance cannot be gated", await as("admin", () => fails("select clock_gate_set($1,true)", [staff.apb], /Attendance first/)));
for (const who of ["rakesh", "aashish", "anil"]) await gate(who, true);
check("switching on is logged", (await q("select count(*)::int n from activity where value like 'Clock in to see the board: on for %'"))[0].n === 3);

// Clocked out: nothing visible.
for (const who of ["rakesh", "aashish", "anil"]) {
  check(who + " clocked out sees no bookings", (await sees(who)).length === 0);
  check(who + " clocked out: me() is empty", (await as(who, () => q("select (me()).id")))[0].id === null);
  check(who + " clocked out: my_company() is empty", (await as(who, () => q("select my_company() c")))[0].c === null);
  check(who + " clocked out: can() refuses", (await as(who, () => q("select can('sent') ok")))[0].ok === false);
  check(who + " clocked out: staff admin context is empty", (await as(who, () => q("select staff_admin_context() c")))[0].c === null);
  const st = (await as(who, () => q("select clock_gate_status() s")))[0].s;
  check(who + " clocked out: status says closed, own name only", st.gated && st.closed && st.name === who.toUpperCase() && Object.keys(st).sort().join() === "attendance,closed,company,gated,name", st);
}
check("status never carries booking details", !JSON.stringify((await as("aashish", () => q("select clock_gate_status() s")))[0].s).match(/AB12|Customer|0770/));

// Everyone else unchanged.
check("an ungated colleague still sees the board", (await sees("wasim")).length === 1);
check("the shared office login still sees the board", (await sees("office")).length === 1);
check("another client is untouched", (await sees("apb")).length === 1 && (await sees("apb"))[0].reg === "XY99ZZZ");

// Clocked in: everything back, own company only.
await clockIn("aashish");
check("Aashish clocked in sees TAKEOFF bookings", (await sees("aashish")).length === 1 && (await sees("aashish"))[0].reg === "AB12CDE");
check("Aashish clocked in: can() works", (await as("aashish", () => q("select can('sent') ok")))[0].ok === true);
check("Aashish clocked in: status open", (await as("aashish", () => q("select clock_gate_status() s")))[0].s.closed === false);
check("Anil still clocked out sees nothing", (await sees("anil")).length === 0);
check("a shift in another company does not open the gate", await (async () => {
  await q("insert into aero_shifts(company_id,user_id) values($1,$2)", [co.apb, user.anil]);
  const n = (await sees("anil")).length; await q("delete from aero_shifts where user_id=$1 and company_id=$2", [user.anil, co.apb]); return n === 0; })());

// Pushes: only to people who may see the board right now.
await q("select ops_push_enqueue($1,'k1','drops','{\"title\":\"AB12CDE called\"}'::jsonb,600,'normal')", [[staff.rakesh, staff.aashish, staff.anil, staff.wasim]]);
const queued = (await q("select s.name from private.ops_push_outbox o join staff s on s.id=o.staff_id where delivery_key='k1' order by 1")).map(r => r.name);
check("push queued only for the clocked-in and the ungated", queued.join() === "AASHISH,WASIM", queued);
await clockOut("aashish");
check("Aashish clocked out sees nothing again", (await sees("aashish")).length === 0);
const claimed = (await q("select ops_push_claim('k1') j"))[0].j.map(j => j.endpoint);
check("a push queued while on shift is not sent after clock-out", claimed.length === 1 && claimed[0].endsWith("/wasim"), claimed);
check("that push is expired, not left pending", (await q("select o.state from private.ops_push_outbox o where o.staff_id=$1", [staff.aashish]))[0].state === "expired");

// Switching off restores normal access with no shift.
await gate("anil", false);
check("Anil switched off the trial sees the board without clocking in", (await sees("anil")).length === 1);
check("switching off is logged", (await q("select count(*)::int n from activity where value = 'Clock in to see the board: off for ANIL'"))[0].n === 1);

// Part 139: an owner switches Attendance and the lock for the other people at their own company.
await db.exec(part2);
await db.exec(part2); // safe to run again
await clockIn("rakesh"); // the owner is gated too; a clocked-out owner has no access to switch anything
const people = (who) => as(who, () => q("select * from attendance_people()"));
const byName = (rows) => Object.fromEntries(rows.map(r => [Object.keys(staff).find(k => staff[k] === r.staff_id), r]));
const p1 = byName(await people("rakesh"));
check("owner sees their own company's people only", !("apb" in p1) && "aashish" in p1 && "sam" in p1, Object.keys(p1));
check("Attendance reads: Aashish on, Sam off", p1.aashish.attendance === false && p1.sam.attendance === false, [p1.aashish, p1.sam]);
check("lock and on-shift show", p1.rakesh.locked === true && p1.rakesh.on_shift === true && p1.aashish.locked === true && p1.aashish.on_shift === false, [p1.rakesh, p1.aashish]);
check("a driver (bongo) reads nobody", (await people("wasim")).length === 0);
check("another company's manager sees only their own", (await people("apb")).every(r => r.staff_id === staff.apb));
const set = (who, target, on) => as(who, () => q("select attendance_person_set($1,$2)", [staff[target], on]));
check("a non-owner cannot switch Attendance", await as("aashish", () => fails("select attendance_person_set($1,true)", [staff.sam], /Only an owner/)));
check("an owner cannot switch their own Attendance", await as("rakesh", () => fails("select attendance_person_set($1,true)", [staff.rakesh], /your own/)));
check("an owner cannot reach another company's person", await as("rakesh", () => fails("select attendance_person_set($1,true)", [staff.apb], /at your company/)));
check("a shared desk login cannot be given Attendance", await as("rakesh", () => fails("select attendance_person_set($1,true)", [staff.office], /shared login/)));
await q("update companies set brand='{}' where id=$1", [co.takeoff]);
check("refused when the company has no Attendance add-on", await as("rakesh", () => fails("select attendance_person_set($1,true)", [staff.sam], /not switched on/)));
await q("update companies set brand='{\"attendance\":true}' where id=$1", [co.takeoff]);
await set("rakesh", "sam", true);
await set("rakesh", "sam", true); // twice is fine
const sam = (await q("select p.role, p.active, l.active la, t.active ta from aero_profiles p join attendance_staff_links l on l.attendance_user_id=p.id join private.attendance_testers t on t.user_id=p.id where p.id=$1", [user.sam]))[0];
check("switching on writes the profile, link and trial list", sam && sam.role === "staff" && sam.active && sam.la && sam.ta, sam);
check("Sam now reads Attendance on", byName(await people("rakesh")).sam.attendance === true);
check("switching on is logged with the owner's name", (await q("select count(*)::int n from activity where value='Attendance: on for SAM' and staff_name='RAKESH'"))[0].n === 2);
check("owner locks Sam", await as("rakesh", () => q("select clock_gate_set($1,true)", [staff.sam])).then(() => true));
check("Sam is shut out until he clocks in", (await sees("sam")).length === 0);
check("cannot switch Attendance off while locked", await as("rakesh", () => fails("select attendance_person_set($1,false)", [staff.sam], /lock off first/)));
check("an owner cannot lock themselves", await as("rakesh", () => fails("select clock_gate_set($1,true)", [staff.rakesh], /Not allowed/)));
check("an owner cannot lock another company's person", await as("rakesh", () => fails("select clock_gate_set($1,true)", [staff.apb], /Not allowed/)));
check("a non-owner still cannot switch the lock", await as("aashish", () => fails("select clock_gate_set($1,false)", [staff.sam], /Not allowed/)));
await as("rakesh", () => q("select clock_gate_set($1,false)", [staff.sam]));
check("lock off: Sam sees the board again", (await sees("sam")).length === 1);
check("the owner's lock change is logged under their own name", (await q("select count(*)::int n from activity where value='Clock in to see the board: off for SAM' and staff_name='RAKESH'"))[0].n === 1);
await set("rakesh", "sam", false);
check("Attendance off leaves the trial list, keeps the link and profile", (await q("select (select active from private.attendance_testers where user_id=$1) ta, (select count(*)::int from aero_profiles where id=$1) pr, (select active from attendance_staff_links where staff_id=$2) la", [user.sam, staff.sam]))[0].ta === false);
check("Sam reads Attendance off again", byName(await people("rakesh")).sam.attendance === false);
check("a platform admin can still switch the lock for anyone", await gate("anil", true).then(() => true));

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
