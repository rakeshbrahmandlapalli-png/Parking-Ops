// Part 105 against throwaway Postgres (PGlite); no live data or credentials.
// Install @electric-sql/pglite@0.5.11, then node checks/board-collections-access.mjs.
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
const error = async (sql, args) => { try { await q(sql, args); return ""; } catch (e) { return e.message; } };
let passed = 0, failed = 0;
const check = (name, good) => { console.log((good ? "PASS " : "FAIL ") + name); good ? passed++ : failed++; };
await db.exec(`
create role anon; create role authenticated;
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid, name text, role text, extra text[] not null default '{}', active boolean default true, removed_at timestamptz);
create table activity (id serial, company_id uuid, staff_id uuid, staff_name text, action text, value text);
create table current_person (id uuid);
create function me() returns staff language sql stable security definer set search_path=public as $$ select s from staff s where id=(select id from current_person) and active $$;
`);
const roles = ["owner", "manager", "office", "bongo", "terminal", "view"], company = "00000000-0000-0000-0000-000000000001", otherCompany = "00000000-0000-0000-0000-000000000002";
const ids = {};
for (const role of roles) ids[role] = (await q("insert into staff(company_id,name,role) values($1,$2,$2) returning id", [company, role]))[0].id;
ids.otherOwner = (await q("insert into staff(company_id,name,role) values($1,'Other owner','owner') returning id", [company]))[0].id;
ids.foreign = (await q("insert into staff(company_id,name,role) values($1,'Other company','terminal') returning id", [otherCompany]))[0].id;
const as = async (role) => { await db.exec("delete from current_person"); if (role) await q("insert into current_person values($1)", [ids[role]]); };
const extra = (role, list) => q("update staff set extra=$2 where id=$1", [ids[role], list]);
const permits = async () => (await q("select my_permissions() p"))[0].p;
const canCollect = async () => (await q("select can('collections') c"))[0].c;
const setAccess = (role, list) => q("select set_staff_access($1,$2)", [ids[role], list]);

const baselineSql = read("03-flights-and-timers.sql");
await db.exec(fn(baselineSql, "can") + fn(baselineSql, "my_permissions") + fn(read("17-staff-pin-remove-access.sql"), "staff_target"));
const baselines = [];
for (const role of roles) for (const overrides of [[], ["clear"], ["-clear"], ["flights", "-flights"]]) {
  await as(role); await extra(role, overrides); baselines.push({ role, overrides, perms: await permits() });
}
const sql = read("105-board-collections-access.sql");
await db.exec(sql); await db.exec(sql);
for (const { role, overrides, perms } of baselines) {
  await as(role); await extra(role, overrides);
  const { collections, ...after } = await permits();
  check("existing permissions preserved: " + role + " " + JSON.stringify(overrides), JSON.stringify(after) === JSON.stringify(perms));
}

for (const role of roles) {
  await as(role); await extra(role, []);
  const def = ["owner", "manager", "office"].includes(role);
  check(role + " collections default", await canCollect() === def && (await permits()).collections === def);
  await extra(role, ["collections"]);
  check(role + " explicit collections grant", await canCollect() === true && (await permits()).collections === true);
  await extra(role, ["-collections"]);
  check(role + " explicit collections removal", await canCollect() === false && (await permits()).collections === false);
  await extra(role, ["collections", "-collections"]);
  check(role + " removal wins over grant", await canCollect() === false);
  await extra(role, []);
}
await as(); check("no signed-in staff has no collections access", await canCollect() === false);
await as("terminal"); await extra("terminal", ["collections"]); await q("update staff set active=false where id=$1", [ids.terminal]);
check("inactive staff cannot use a saved grant", await canCollect() === false);
await q("update staff set active=true where id=$1", [ids.terminal]);

await as("owner");
for (const role of ["bongo", "terminal", "view"]) {
  await setAccess(role, ["collections"]); await as(role);
  check("owner's saved grant reaches " + role, await canCollect() === true);
  await as("owner");
}
await setAccess("office", ["-collections"]); await as("office");
check("saved removal revokes office's default", await canCollect() === false);
await as("owner"); await setAccess("office", []); await as("office");
check("saving Role defaults restores office's access", await canCollect() === true);
await as("manager"); await setAccess("terminal", ["collections"]);
check("manager can grant collections to own-company staff", (await q("select extra from staff where id=$1", [ids.terminal]))[0].extra.includes("collections"));
check("manager cannot change another owner", /Only an owner/.test(await error("select set_staff_access($1,$2)", [ids.otherOwner, ["-collections"]])));
check("manager cannot grant themselves access", /yourself/.test(await error("select set_staff_access($1,$2)", [ids.manager, ["collections"]])));
check("other-company grants are rejected", /Person not found/.test(await error("select set_staff_access($1,$2)", [ids.foreign, ["collections"]])));
check("unknown permission rejected", /Unknown permission/.test(await error("select set_staff_access($1,$2)", [ids.terminal, ["invented_permission"]])));
await as("office"); await extra("office", ["staff", "collections"]);
check("office cannot manage access despite collections and staff grants", /Only a manager/.test(await error("select set_staff_access($1,$2)", [ids.terminal, ["collections"]])));
await as("owner");
check("access changes are logged for the caller's company", (await q("select count(*)::int n from activity where action='STAFF' and company_id=$1", [company]))[0].n >= 6);
check("foreign company's permissions remain unchanged", (await q("select extra from staff where id=$1", [ids.foreign]))[0].extra.length === 0);
await db.exec(sql);
await as("terminal"); check("reapplying part 105 preserves saved grants", await canCollect() === true);
for (const signature of ["can(text)", "my_permissions()", "set_staff_access(uuid,text[])"]) {
  const acl = (await q("select has_function_privilege('anon',$1,'EXECUTE') anon, has_function_privilege('authenticated',$1,'EXECUTE') signed", [signature]))[0];
  check("signed-in callers only: " + signature, !acl.anon && acl.signed);
}
await db.close();
console.log(passed + " passed, " + failed + " failed");
process.exitCode = failed ? 1 : 0;
