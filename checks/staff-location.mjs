// Part 143 (where people are while clocked in) against throwaway Postgres (PGlite); no live data.
// npm --prefix checks ci, then node checks/staff-location.mjs.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const db = new PGlite();
const part = fs.readFileSync(new URL("../setup/143-staff-location.sql", import.meta.url), "utf8");
const q = async (sql, args) => (await db.query(sql, args)).rows;
let passed = 0, failed = 0;
const check = (name, good, info) => { console.log((good ? "PASS " : "FAIL ") + name + (good || info === undefined ? "" : " " + JSON.stringify(info))); good ? passed++ : failed++; };
const fails = async (sql, args, re) => { try { await q(sql, args); return false; } catch (e) { return re.test(e.message); } };
check("part 143 has no DELETE or DROP statement", !/^\s*(delete|drop)\b/im.test(part) && !/;\s*(delete|drop)\b/i.test(part));
await db.exec(`
create role anon; create role authenticated; create schema private; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated;
create table companies (id uuid primary key default gen_random_uuid(), name text, slug text unique, brand jsonb not null default '{}', suspended_at timestamptz);
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid references companies(id), user_id uuid, name text, role text,
  active boolean default true, removed_at timestamptz, desk_names text[] not null default '{}');
create table activity (id serial, company_id uuid, staff_id uuid, staff_name text, action text, value text, at timestamptz default now());
create table aero_shifts (id uuid primary key default gen_random_uuid(), company_id uuid, user_id uuid, clock_in_at timestamptz default now(), clock_out_at timestamptz);
create function me() returns staff language sql stable security definer set search_path = public as $$
  select s.* from staff s where s.user_id = auth.uid() and s.active and s.removed_at is null limit 1 $$;
`);
await db.exec(part);
await db.exec(part); // safe to run again

const co = {}, staff = {}, user = {};
co.takeoff = (await q("insert into companies(name,slug,brand) values('T','takeoff','{\"attendance\":true}') returning id"))[0].id;
co.apb = (await q("insert into companies(name,slug,brand) values('A','apb','{\"attendance\":true}') returning id"))[0].id;
co.none = (await q("insert into companies(name,slug,brand) values('N','none','{}') returning id"))[0].id;
for (const [who, c, role, desk] of [["rakesh", "takeoff", "owner"], ["mgr", "takeoff", "manager"], ["anil", "takeoff", "office"], ["wasim", "takeoff", "bongo"],
  ["office", "takeoff", "office", ["A", "B"]], ["apb", "apb", "owner"], ["nobody", "none", "owner"]]) {
  user[who] = crypto.randomUUID();
  staff[who] = (await q("insert into staff(company_id,user_id,name,role,desk_names) values($1,$2,$3,$4,$5) returning id", [co[c], user[who], who.toUpperCase(), role, desk || []]))[0].id;
}
const as = async (who, fn) => {
  await db.exec("set role authenticated"); await q("select set_config('test.uid', $1, false)", [who ? user[who] : ""]);
  try { return await fn(); } finally { await db.exec("reset role"); }
};
const at = (who, lat = 51.47, lng = -0.45) => as(who, async () => (await q("select i_am_at($1,$2,12) ok", [lat, lng]))[0].ok);
const seen = async (who) => (await as(who, () => q("select staff_locations() l")))[0].l;
const status = async (who) => (await as(who, () => q("select location_status() s")))[0].s;
const clockIn = (who, c = "takeoff") => q("insert into aero_shifts(company_id,user_id) values($1,$2)", [co[c], user[who]]);
const clockOut = (who) => q("update aero_shifts set clock_out_at=now() where user_id=$1 and clock_out_at is null", [user[who]]);

check("off by default", (await status("anil")).on === false);
check("nothing is kept while off", (await clockIn("anil"), await at("anil")) === false);
check("a manager cannot switch it on", await as("mgr", () => fails("select location_share_set(true)", [], /Only an owner/)));
check("an office login cannot switch it on", await as("anil", () => fails("select location_share_set(true)", [], /Only an owner/)));
check("signed out cannot switch it on", await as(null, () => fails("select location_share_set(true)", [], /Not allowed/)));
await as("rakesh", () => q("select location_share_set(true)"));
check("switching on is logged", (await q("select count(*)::int n from activity where value = 'Staff location while on shift switched on'"))[0].n === 1);
check("on for the company", (await status("anil")).on === true && (await status("anil")).on_shift === true);
check("other company still off", (await status("apb")).on === false);
check("not kept before the person has been told", (await at("anil")) === false);
await as("anil", () => q("select location_notice_ok()"));
await as("anil", () => q("select location_notice_ok()"));
check("being told is logged once", (await q("select count(*)::int n from activity where value like 'Was told%'"))[0].n === 1);
check("on shift and told: kept", (await at("anil")) === true);
let l = await seen("rakesh");
check("the owner sees the position", l.length === 1 && l[0].staff_id === staff.anil && Math.abs(l[0].lat - 51.47) < 1e-9 && l[0].acc === 12, l);
check("a manager sees it", (await seen("mgr")).length === 1);
check("office cannot see positions", (await seen("anil")).length === 0);
check("a driver cannot see positions", (await seen("wasim")).length === 0);
check("another company's owner cannot see them", (await seen("apb")).length === 0);
check("bad coordinates ignored", (await at("anil", 200, 0)) === false);
await at("anil", 51.5, -0.4);
check("only the latest position is kept", (await q("select count(*)::int n from private.staff_location where staff_id=$1", [staff.anil]))[0].n === 1 && (await seen("rakesh"))[0].lat === 51.5);
await as("wasim", () => q("select location_notice_ok()"));
check("not on shift: nothing kept", (await at("wasim")) === false);
await clockIn("office"); await as("office", () => q("select location_notice_ok()"));
check("a shared desk login never sends", (await at("office")) === false);
check("staff cannot read the table directly", await as("anil", () => fails("select * from private.staff_location", [], /permission denied/)));
await clockOut("anil");
check("clocking out blanks the position", (await q("select lat from private.staff_location where staff_id=$1", [staff.anil]))[0].lat === null && (await seen("rakesh")).length === 0);
check("after clock out nothing is kept", (await at("anil")) === false);
await clockIn("anil");
check("a new shift doesn't show the old position", (await seen("rakesh")).length === 0);
await at("anil");
check("a new shift shows once sent", (await seen("rakesh")).length === 1);
await as("rakesh", () => q("select location_share_set(false)"));
check("switching off blanks everyone", (await q("select count(*)::int n from private.staff_location where lat is not null"))[0].n === 0 && (await seen("rakesh")).length === 0);
check("switching off is logged", (await q("select count(*)::int n from activity where value like '%switched off'"))[0].n === 1);
check("after off nothing is kept", (await at("anil")) === false);
await q("update companies set brand='{}' where id=$1", [co.takeoff]); await as("rakesh", () => q("select location_share_set(true)"));
check("without the Attendance add-on it stays off", (await status("anil")).on === false && (await at("anil")) === false);
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
