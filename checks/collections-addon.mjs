// Part 109 against throwaway Postgres (PGlite); no live data or credentials.
// Install @electric-sql/pglite@0.5.11, then node checks/collections-addon.mjs.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const db = new PGlite();
const read = (name) => fs.readFileSync(new URL("../setup/" + name, import.meta.url), "utf8");
const fn = (sql, name) => {
  const match = sql.match(new RegExp("create or replace function " + name + "\\([\\s\\S]*?\\n\\$\\$;"));
  if (!match) throw new Error("Missing function " + name);
  return match[0];
};
const q = async (sql, args) => (await db.query(sql, args)).rows;
let passed = 0, failed = 0;
const check = (name, good, info) => { console.log((good ? "PASS " : "FAIL ") + name + (good || info === undefined ? "" : " " + JSON.stringify(info))); good ? passed++ : failed++; };
await db.exec(`
create role anon; create role authenticated; create schema private;
create table companies (id uuid primary key default gen_random_uuid(), name text, slug text unique, yards text[], drops_day_end time default '06:00', time_zone text, brand jsonb not null default '{}', suspended_at timestamptz);
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid, name text, role text, extra text[] not null default '{}', active boolean default true, removed_at timestamptz);
create table activity (id serial, company_id uuid, staff_id uuid, staff_name text, action text, value text);
create table current_person (id uuid);
create function me() returns staff language sql stable security definer set search_path=public as $$ select s from staff s where id=(select id from current_person) and active $$;
create function is_platform_admin() returns boolean language sql stable as $$ select exists (select 1 from me() s join companies c on c.id = s.company_id where c.slug = 'platform' and s.role = 'owner') $$;
`);
const co = {};
for (const [slug, brand] of [["takeoff", { theme: "ops", lane_planner: true }], ["airport-parking-bay", { theme: "ops", picks_yard: true }], ["newclient", {}], ["platform", {}]])
  co[slug] = (await q("insert into companies(name,slug,yards,brand) values($1,$1,'{S}',$2) returning id", [slug, brand]))[0].id;
const roles = ["owner", "manager", "office", "bongo", "terminal", "view"], ids = {};
for (const slug of ["takeoff", "newclient"]) for (const role of roles) ids[slug + ":" + role] = (await q("insert into staff(company_id,name,role) values($1,$2,$3) returning id", [co[slug], slug + " " + role, role]))[0].id;
ids.admin = (await q("insert into staff(company_id,name,role) values($1,'RAKESH','owner') returning id", [co.platform]))[0].id;
const as = async (who) => { await db.exec("delete from current_person"); if (who) await q("insert into current_person values($1)", [ids[who]]); };
const extra = (who, list) => q("update staff set extra=$2 where id=$1", [ids[who], list]);
const perms = async () => (await q("select my_permissions() p"))[0].p;
const brand = async (slug) => (await q("select brand from companies where slug=$1", [slug]))[0].brand;
const save = (slug, b) => q("select admin_save_client($1)", [{ id: co[slug], name: slug, yards: ["S"], brand: b }]);

// Part 105 (the live definition) as the starting point.
const p105 = read("105-board-collections-access.sql");
await db.exec(fn(p105, "can") + fn(p105, "my_permissions"));
const before = {};
for (const who of Object.keys(ids)) for (const ov of [[], ["collections"], ["-collections"], ["clear", "-flights"]]) {
  await as(who); await extra(who, ov); before[who + JSON.stringify(ov)] = await perms();
}
const sql = read("109-collections-addon.sql");
await db.exec(sql); await db.exec(sql);
check("TakeOff keeps Collections", (await brand("takeoff")).collections === true);
check("Airport Parking Bay keeps Collections", (await brand("airport-parking-bay")).collections === true);
check("another client doesn't get it by running part 109", !("collections" in await brand("newclient")));
check("the platform doesn't get it", !("collections" in await brand("platform")));
check("the other brand settings are untouched", (await brand("takeoff")).lane_planner === true && (await brand("airport-parking-bay")).picks_yard === true);

for (const who of Object.keys(ids)) for (const ov of [[], ["collections"], ["-collections"], ["clear", "-flights"]]) {
  await as(who); await extra(who, ov);
  const { collections, ...now } = await perms(), { collections: was, ...then } = before[who + JSON.stringify(ov)];
  check("every other permission unchanged: " + who + " " + JSON.stringify(ov), JSON.stringify(now) === JSON.stringify(then));
  const on = who.startsWith("takeoff:");
  check("collections " + (on ? "as before inside the add-on" : "off without the add-on") + ": " + who + " " + JSON.stringify(ov), collections === (on ? was : false));
}
await as("newclient:owner"); await extra("newclient:owner", ["collections"]);
check("a saved grant can't get round a missing add-on", (await q("select can('collections') c"))[0].c === false);
await extra("newclient:owner", []);

// The platform switch.
await as("admin");
await save("newclient", { theme: "ops", collections: true });
check("ticking the add-on switches it on", (await brand("newclient")).collections === true);
await as("newclient:office"); check("…and that client's office sees Collections", (await perms()).collections === true);
await as("admin"); await save("takeoff", { theme: "ops", lane_planner: true, collections: false });
check("unticking keeps it off, saved as false", (await brand("takeoff")).collections === false && (await brand("takeoff")).lane_planner === true);
await as("takeoff:owner"); check("…and TakeOff's owner no longer sees Collections", (await perms()).collections === false);
await db.exec(sql);
check("running part 109 again doesn't switch an unticked client back on", (await brand("takeoff")).collections === false);
await as("admin"); await save("airport-parking-bay", { theme: "ops", picks_yard: true });
check("an older form without the switch leaves it alone", (await brand("airport-parking-bay")).collections === true);
const line = (await q("select value from activity where company_id=$1 order by id desc limit 1", [co.takeoff]))[0];
check("the client's activity log names the switch", /Collections off/.test(line?.value || ""), line);
check("a new client starts without it", (await q("select admin_save_client($1) c", [{ name: "Fresh", slug: "fresh", yards: ["S"], brand: { theme: "", collections: false } }]))[0].c.brand.collections === false);

for (const signature of ["can(text)", "admin_save_client(jsonb)"]) {
  const acl = (await q("select has_function_privilege('anon',$1,'EXECUTE') anon, has_function_privilege('authenticated',$1,'EXECUTE') signed", [signature]))[0];
  check("signed-in callers only: " + signature, !acl.anon && acl.signed);
}
check("private.collections_on isn't callable from the app", !(await q("select has_function_privilege('authenticated','private.collections_on(uuid)','EXECUTE') x"))[0].x);
await db.close();
console.log(passed + " passed, " + failed + " failed");
process.exitCode = failed ? 1 : 0;
