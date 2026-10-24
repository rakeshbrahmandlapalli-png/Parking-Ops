// Part 108 against throwaway Postgres (PGlite); no live data or credentials.
// Install @electric-sql/pglite@0.5.11, then node checks/activity-log.mjs.
// Also checks that manage-staff writes a line for each change it makes.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
const db = new PGlite({ extensions: { pgcrypto } });
const read = (path) => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");
const q = async (sql, args) => (await db.query(sql, args)).rows;
const error = async (sql, args) => { try { await q(sql, args); return ""; } catch (e) { return e.message; } };
let passed = 0, failed = 0;
const check = (name, good) => { console.log((good ? "PASS " : "FAIL ") + name); good ? passed++ : failed++; };
await db.exec(`
create extension pgcrypto;
create role anon; create role authenticated; create role service_role;
create schema private; create schema auth;
create table current_person (id uuid);
create table companies (id uuid primary key default gen_random_uuid(), name text, slug text unique, yards text[] default '{MY,GS,T}',
  drops_day_end time default '06:00', time_zone text, brand jsonb default '{}', suspended_at timestamptz);
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid references companies, user_id uuid default gen_random_uuid(),
  name text, role text, extra text[] not null default '{}', active boolean default true, removed_at timestamptz,
  desk_names text[] not null default '{}', acting text not null default '');
create table staff_secrets (staff_id uuid primary key, link_hash text, pin_hash text, failed_pins int default 0, locked_until timestamptz, updated_at timestamptz);
create table activity (id serial, company_id uuid references companies on delete cascade, at timestamptz default clock_timestamp(),
  staff_id uuid references staff on delete set null, staff_name text, sheet_id uuid, booking_id uuid, reg text, customer text, action text, value text);
create table alert_prefs (staff_id uuid primary key, company_id uuid, drops boolean, picks boolean, flights boolean, updated_at timestamptz);
create table parking_lanes (id uuid primary key default gen_random_uuid(), company_id uuid, yard text, name text, capacity int, access text, kind text);
create table private.swift_reviews (id bigserial primary key, company_id uuid, ref text, status text default 'open', resolved_at timestamptz, resolved_by text);
create function auth.uid() returns uuid language sql stable as $$ select (select user_id from staff where id=(select id from current_person)) $$;
create function me() returns staff language sql stable security definer set search_path=public as $$ select s from staff s where id=(select id from current_person) and active $$;
create function can(p text) returns boolean language sql stable as $$ select (me()).role in ('owner','manager','office') $$;
create function is_platform_admin() returns boolean language sql stable as $$ select exists(select 1 from staff s join companies c on c.id=s.company_id where s.id=(me()).id and c.slug='platform' and s.role='owner') $$;
create function private.lane_planner_on(p uuid) returns boolean language sql stable as $$ select coalesce((brand->>'lane_planner')::boolean,false) from companies where id=p $$;
`);
await db.exec(read("setup/17-staff-pin-remove-access.sql").match(/create or replace function staff_target\([\s\S]*?\n\$\$;/)[0]);
await db.exec(read("setup/97-desk-names.sql").match(/create or replace function activity_acting\(\)[\s\S]*?\n\$\$;/)[0] +
  "\ncreate trigger activity_acting before insert on activity for each row execute function activity_acting();");

const co = (await q("insert into companies(name,slug,brand) values('Airport Parking Bay','apb','{\"lane_planner\":true}') returning id"))[0].id;
const other = (await q("insert into companies(name,slug) values('TAKEOFF','takeoff') returning id"))[0].id;
const plat = (await q("insert into companies(name,slug) values('Parking Ops','platform') returning id"))[0].id;
const person = async (company, name, role, extra = {}) => (await q("insert into staff(company_id,name,role,active,desk_names) values($1,$2,$3,$4,$5) returning id",
  [company, name, role, extra.active ?? true, extra.desk ?? []]))[0].id;
const owner = await person(co, "Jasnu", "owner"), sarf = await person(co, "SARFARAZ", "bongo", { active: false });
const office = await person(co, "OFFICE", "office", { desk: ["RAKESH.O", "ANNA"] }), rakesh = await person(plat, "Rakesh", "owner");
await q("insert into staff_secrets(staff_id,link_hash,pin_hash) select id, 'link-'||name, crypt('1234', gen_salt('bf',4)) from staff");
const as = async (id) => { await db.exec("delete from current_person"); if (id) await q("insert into current_person values($1)", [id]); };
const last = async (company = co) => (await q("select staff_id, staff_name, action, value from activity where company_id=$1 order by id desc limit 1", [company]))[0] || {};
const count = async () => (await q("select count(*)::int n from activity"))[0].n;

const sql = read("setup/108-log-every-action.sql");
await db.exec(sql); await db.exec(sql);
check("part 108 runs twice", true);

// Sign-ins
const login = async (who, pin) => (await q("select staff_login_check($1,$2) r", ["link-" + who, pin]))[0].r;
check("switched-off person is refused", (await login("SARFARAZ", "1234")).status === "inactive");
let l = await last();
check("refused sign-in is logged against them", l.action === "SIGN IN" && l.staff_name === "SARFARAZ" && /access is off/.test(l.value));
await q("update staff set active=true where id=$1", [sarf]);
check("right PIN signs in", (await login("SARFARAZ", "1234")).status === "ok");
l = await last(); check("sign-in is logged", l.action === "SIGN IN" && l.value === "Signed in" && l.staff_id === sarf);
check("wrong PIN refused", (await login("SARFARAZ", "9999")).status === "bad_pin");
check("wrong PIN is logged", (await last()).value === "Wrong PIN");
for (let i = 0; i < 4; i++) await login("SARFARAZ", "9999");
check("fifth wrong PIN says locked", (await q("select value from activity where value like 'Wrong PIN%' order by id desc limit 1"))[0].value === "Wrong PIN, locked for 15 minutes");
check("locked sign-in refused", (await login("SARFARAZ", "1234")).status === "locked");
check("locked attempt is logged", /while locked/.test((await last()).value));
let n = await count(); await login("nobody", "1234");
check("unknown link writes nothing", await count() === n);
check("sign-in lines stay in their company", (await q("select count(*)::int n from activity where company_id<>$1", [co]))[0].n === 0);

// Own PIN
await as(owner);
check("own PIN changes", (await q("select change_my_pin('1234','4321') r"))[0].r.status === "ok");
l = await last(); check("own PIN change is logged", l.action === "STAFF" && l.value === "Changed their own PIN" && l.staff_name === "Jasnu");
n = await count(); await q("select change_my_pin('0000','5555')");
check("wrong current PIN writes no change line", await count() === n);

// Access, with what changed
await q("select set_staff_access($1,$2)", [sarf, ["clear", "-yard"]]);
l = await last(); check("access change says before and after", l.value === "Changed access for SARFARAZ: was role defaults, now clear, no yard");
await q("select set_staff_access($1,$2)", [sarf, []]);
check("back to role defaults is named", (await last()).value === "Changed access for SARFARAZ: was clear, no yard, now role defaults");
check("access still refused for another company's person", /Person not found/.test(await error("select set_staff_access($1,'{}')", [rakesh])));

// Shared login names
await as(office);
await q("select set_acting('RAKESH.O')");
l = await last(); check("name switch is logged under the picked name", l.staff_name === "RAKESH.O" && l.value === "Switched to RAKESH.O on OFFICE");
n = await count(); await q("select set_acting('RAKESH.O')");
check("picking the same name again writes nothing", await count() === n);
await q("select set_acting('')");
l = await last(); check("clearing the name is logged", l.staff_name === "OFFICE" && l.value === "No name picked on OFFICE");

// Alerts
await q("select set_alert_prefs(true,false,true)");
check("alerts are logged", (await last()).value === "Their own alerts: DROPS on, PICKS off, flights on");
n = await count(); await q("select set_alert_prefs(true,false,true)");
check("unchanged alerts write nothing", await count() === n);

// Yard planner area
await as(owner);
await q("select lane_save('MY','Lane 1',12,'front','lane')");
check("yard planner area is logged", (await last()).value === "Yard planner: added lane Lane 1 in MY (12 spaces)");

// Booking review
const rv = (await q("insert into private.swift_reviews(company_id,ref) values($1,'TO-123') returning id", [co]))[0].id;
await q("select swift_review_resolve($1)", [rv]);
check("review Done is logged with its ref", (await last()).value === "Booking review marked done: TO-123");
n = await count(); await q("select swift_review_resolve($1)", [rv]);
check("a review already done writes nothing", await count() === n);
const rvOther = (await q("insert into private.swift_reviews(company_id,ref) values($1,'X-1') returning id", [other]))[0].id;
await q("select swift_review_resolve($1)", [rvOther]);
check("another company's review is untouched and unlogged", await count() === n && (await q("select status from private.swift_reviews where id=$1", [rvOther]))[0].status === "open");

// The product owner's changes, in the client's log
await as(rakesh);
await q("select admin_save_client($1)", [{ id: co, name: "Airport Parking Bay", yards: ["MY", "GS", "T"], brand: { theme: "premium", picks_yard: true, lane_planner: true } }]);
l = await last(); check("client save is in the client's log", l.staff_name === "Rakesh (Parking Ops)" && l.staff_id === null && /look premium, yards MY GS T, PICKS location on, Yard planner on/.test(l.value));
await q("select admin_save_client($1)", [{ name: "New Co", slug: "new-co", yards: ["A"], brand: {} }]);
const nc = (await q("select id from companies where slug='new-co'"))[0].id;
check("new client is logged", (await last(nc)).value === "Client set up");
await q("select admin_suspend_client($1,true)", [co]);
check("pause is logged", (await last()).value === "App paused for everyone");
n = await count(); await q("select admin_suspend_client($1,true)", [co]);
check("pausing a paused client writes nothing", await count() === n);
await q("select admin_suspend_client($1,false)", [co]);
check("resume is logged", (await last()).value === "App resumed");
await as(owner);
check("client owners still can't save clients", /Not allowed/.test(await error("select admin_save_client('{}')")));

// manage-staff: each change writes its line
const ms = read("supabase/functions/manage-staff/index.ts");
for (const [what, re] of [["add", /"Added " \+ name \+ " \(" \+ role/], ["reset", /"New link and PIN for "/], ["on/off", /"Switched on " : "Switched off "/],
  ["client owner", /"Added " \+ name \+ " \(owner\)"/], ["client open", /"Parking Ops opened the app"/], ["first owner", /"Set up the first owner login: "/]])
  check("manage-staff logs " + what, re.test(ms));
check("manage-staff logs against the caller", /log\(me\.company_id, me\.staff_id, me\.name/.test(ms));

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
