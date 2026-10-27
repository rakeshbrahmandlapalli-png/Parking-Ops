// Part 128 (SKIDATA card top-up) against throwaway Postgres (PGlite); no live data or credentials.
// Install @electric-sql/pglite@0.5.11, then node checks/skidata-topup.mjs.
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
const fails = async (sql, args, re) => { try { await q(sql, args); return false; } catch (e) { return re.test(e.message); } };
await db.exec(`
create role anon; create role authenticated; create schema private;
create table companies (id uuid primary key default gen_random_uuid(), name text, slug text unique, yards text[], drops_day_end time default '06:00', time_zone text, brand jsonb not null default '{}', suspended_at timestamptz);
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid, name text, role text, extra text[] not null default '{}', active boolean default true, removed_at timestamptz, acting text);
create table activity (id serial, company_id uuid, staff_id uuid, staff_name text, action text, value text);
create table sheets (id uuid primary key default gen_random_uuid());
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, return_at timestamptz, drop_at timestamptz,
  sent_at timestamptz, cleared_at timestamptz, overstay boolean not null default false, intake text not null default '', removed_at timestamptz);
create table current_person (id uuid);
create function me() returns staff language sql stable security definer set search_path=public as $$ select s from staff s where id=(select id from current_person) and active $$;
create function my_company() returns uuid language sql stable as $$ select company_id from me() $$;
create function is_platform_admin() returns boolean language sql stable as $$ select exists (select 1 from me() s join companies c on c.id = s.company_id where c.slug = 'platform' and s.role = 'owner') $$;
create function staff_target(p uuid) returns staff language sql as $$ select * from staff where id = p $$;
create function private.access_words(p text[]) returns text language sql immutable as $$
  select coalesce(nullif(string_agg(case when x like '-%' then 'no ' || ltrim(x, '-') else x end, ', ' order by ltrim(x, '-')), ''), 'role defaults') from unnest(coalesce(p, '{}')) x $$;
create function private.collections_on(p uuid) returns boolean language sql stable as $$ select coalesce((select (brand->>'collections')::boolean from companies where id = p), false) $$;
`);
const co = {};
for (const [slug, brand] of [["takeoff", { theme: "ops", collections: true }], ["apb", { theme: "premium" }], ["platform", {}]])
  co[slug] = (await q("insert into companies(name,slug,yards,brand) values($1,$1,'{S}',$2) returning id", [slug, brand]))[0].id;
const roles = ["owner", "manager", "office", "bongo", "terminal", "view"], ids = {};
for (const slug of ["takeoff", "apb"]) for (const role of roles) ids[slug + ":" + role] = (await q("insert into staff(company_id,name,role) values($1,$2,$3) returning id", [co[slug], (slug + " " + role).toUpperCase(), role]))[0].id;
ids.admin = (await q("insert into staff(company_id,name,role) values($1,'RAKESH','owner') returning id", [co.platform]))[0].id;
const as = async (who) => { await db.exec("delete from current_person"); if (who) await q("insert into current_person values($1)", [ids[who]]); };
const extra = (who, list) => q("update staff set extra=$2 where id=$1", [ids[who], list]);
const perms = async () => (await q("select my_permissions() p"))[0].p;
const brand = async (slug) => (await q("select brand from companies where slug=$1", [slug]))[0].brand;
const save = (slug, b) => q("select admin_save_client($1)", [{ id: co[slug], name: slug, yards: ["S"], brand: b }]);

// Part 123 (the live can / my_permissions) as the starting point.
const p123 = read("123-call-popups.sql");
await db.exec(fn(p123, "can") + fn(p123, "my_permissions"));
const before = {};
for (const who of Object.keys(ids)) { await as(who); before[who] = await perms(); }
const sql = read("128-skidata-topup.sql");
await db.exec(sql); await db.exec(sql);
check("part 128 runs twice", true);
check("nobody gets the add-on by running it", !("topup" in await brand("takeoff")) && !("topup" in await brand("apb")));
for (const who of Object.keys(ids)) {
  await as(who);
  const { topup, ...now } = await perms();
  check("every other permission unchanged: " + who, JSON.stringify(now) === JSON.stringify(before[who]));
  check("topup off without the add-on: " + who, topup === false);
}

// The platform switch.
await as("admin");
await save("takeoff", { theme: "ops", collections: true, topup: true });
check("ticking the add-on switches it on", (await brand("takeoff")).topup === true && (await brand("takeoff")).collections === true);
const line = (await q("select value from activity where company_id=$1 order by id desc limit 1", [co.takeoff]))[0];
check("the client's activity line names it", /SKIDATA top-up on/.test(line?.value || ""), line);
const want = { owner: true, manager: true, office: true, terminal: true, bongo: false, view: false };
for (const role of roles) { await as("takeoff:" + role); check("topup default for " + role, (await perms()).topup === want[role]); }
await extra("takeoff:bongo", ["topup"]); await as("takeoff:bongo"); check("a driver can be given it", (await perms()).topup === true);
await extra("takeoff:terminal", ["-topup"]); await as("takeoff:terminal"); check("terminal can be refused it", (await perms()).topup === false);
await extra("takeoff:terminal", []);
await as("apb:owner"); await extra("apb:owner", ["topup"]);
check("a saved grant can't get round a missing add-on", (await q("select can('topup') c"))[0].c === false);
await as("takeoff:owner");
await q("select set_staff_access($1,$2)", [ids["takeoff:bongo"], ["-topup"]]);
check("Staff access accepts topup", (await q("select extra from staff where id=$1", [ids["takeoff:bongo"]]))[0].extra[0] === "-topup");
await as("admin"); await save("takeoff", { theme: "ops", collections: true });
check("an older form without the switch leaves it alone", (await brand("takeoff")).topup === true);

// Settings.
await as("takeoff:manager");
check("only an owner changes the settings", await fails("select set_topup_settings($1)", [{ ticket: 4, step: 10, shifts: [{ name: "Day", start: "06:00", end: "18:00" }] }], /Only an owner/));
await as("takeoff:owner");
check("a bad time is refused", await fails("select set_topup_settings($1)", [{ ticket: 3.5, step: 10, shifts: [{ name: "Day", start: "6", end: "18:00" }] }], /look like 04:00/));
check("no shifts is refused", await fails("select set_topup_settings($1)", [{ ticket: 3.5, step: 10, shifts: [] }], /1 to 4 shifts/));
const dc = (await q("select private.topup_conf($1) c", [co.takeoff]))[0].c;
check("defaults before any save: £3.50, £10, Morning 04:00–17:00 and Night 17:00–04:00", Number(dc.ticket) === 3.5 && Number(dc.step) === 10 && dc.shifts.map((x) => x.name + x.start + x.end).join() === "Morning04:0017:00,Night17:0004:00", dc);
const saved = (await q("select set_topup_settings($1) t", [{ ticket: "3.5", step: "10", shifts: [{ name: " Morning ", start: "03:00", end: "17:00" }, { name: "Night", start: "17:00", end: "04:00" }] }]))[0].t;
check("settings saved trimmed", saved.shifts[0].name === "Morning" && Number(saved.ticket) === 3.5, saved);
const sl = (await q("select value from activity where action='SETTINGS' and company_id=$1 order by id desc limit 1", [co.takeoff]))[0].value;
check("settings logged", /ticket £3\.50.*Morning 03:00–17:00, Night 17:00–04:00/.test(sl), sl);

// Counting: Night shift of 26 Oct 2026 (after the clock change, London = UTC) 17:00 → 04:00 next day.
const add = (kind, at, more = {}) => q("insert into bookings(company_id,kind," + (kind === "drops" ? "return_at" : "drop_at") + (Object.keys(more).length ? "," + Object.keys(more).join(",") : "") + ") values($1,$2,$3" + Object.keys(more).map((_, i) => ",$" + (i + 4)).join("") + ")", [co.takeoff, kind, at, ...Object.values(more)]);
for (let i = 0; i < 20; i++) await add("drops", "2026-10-26 18:00+00");
await add("drops", "2026-10-27 03:59+00");
await add("drops", "2026-10-27 04:00+00"); // next shift
await add("drops", "2026-10-26 16:59+00"); // morning
await add("drops", "2026-10-26 19:00+00", { sent_at: "2026-10-26 18:00+00" });
await add("drops", "2026-10-26 19:00+00", { cleared_at: "2026-10-26 18:00+00" });
await add("drops", "2026-10-26 19:00+00", { overstay: true });
await add("drops", "2026-10-26 19:00+00", { removed_at: "2026-10-26 18:00+00" });
for (let i = 0; i < 3; i++) await add("picks", "2026-10-26 20:00+00");
await add("picks", "2026-10-26 20:00+00", { intake: "Collected" });
await add("picks", "2026-10-26 20:00+00", { intake: "No Show" });
await add("picks", "2026-10-27 10:00+00");
await q("insert into bookings(company_id,kind,return_at) values($1,'drops','2026-10-26 18:00+00')", [co.apb]);
await as("takeoff:terminal");
const n = (await q("select topup_counts('2026-10-26', 1) c"))[0].c;
check("night counts drops left in the shift", n.drops === 21, n);
check("night counts picks left in the shift", n.picks === 3, n);
check("the window ends the next morning", n.name === "Night" && new Date(n.to).toISOString() === "2026-10-27T04:00:00.000Z", n);
const m = (await q("select topup_counts('2026-10-27', 0) c"))[0].c;
check("next morning (03:00–17:00) counts its own, and the hour both shifts share", m.drops === 2 && m.picks === 1, m);
const summer = (await q("select topup_counts('2026-07-01', 0) c"))[0].c;
check("shift hours are London time (BST)", new Date(summer.from).toISOString() === "2026-07-01T02:00:00.000Z", summer);
check("no such shift is refused", await fails("select topup_counts('2026-10-26', 5)", [], /No such shift/));
await as("takeoff:bongo");
check("someone refused it can't count", await fails("select topup_counts('2026-10-26', 1)", [], /Not allowed/));

// Recording.
await as("takeoff:terminal");
await q("update staff set acting='ANIL' where id=$1", [ids["takeoff:terminal"]]);
const photo = co.takeoff + "/docs/topup/t1793066116133.jpg";
const r = (await q("select to_jsonb(record_topup($1)) r", [{ day: "2026-10-26", shift: 1, amount: 80, card: 7, drivers: 4, drops: 20, picks: 0, rounds: 5, tickets: 25, need: 87.5, photo }]))[0].r;
check("top-up saved with its sums", Number(r.amount) === 80 && r.tickets === 25 && r.shift_name === "Night" && Number(r.ticket) === 3.5 && r.staff_name === "ANIL", r);
const tl = (await q("select value from activity where action='TOP UP' order by id desc limit 1"))[0].value;
check("logged TOP UP", tl === "£80.00 on the SKIDATA card · Night 26 Oct · card £7.00 → £87.00 · 25 tickets (20 drops, 0 picks, 5 rounds, 4 drivers) (photo)", tl);
check("another company's photo path is refused", await fails("select record_topup($1)", [{ day: "2026-10-26", shift: 1, amount: 80, photo: co.apb + "/docs/topup/t1.jpg" }], /not a top-up photo/));
check("£0 is refused", await fails("select record_topup($1)", [{ day: "2026-10-26", shift: 1, amount: 0 }], /£0.01 to £2000/));
await q("select record_topup($1)", [{ day: "2026-10-27", shift: 0, amount: 20 }]);
check("a top-up without the sums is fine", (await q("select count(*)::int n from card_topups"))[0].n === 2);
check("the list shows the company's top-ups, newest first", (await q("select amount from topup_list()")).map((x) => Number(x.amount)).join() === "20,80");
await as("apb:owner");
check("another client sees none", (await q("select count(*)::int n from topup_list()"))[0].n === 0);
check("another client can't record", await fails("select record_topup($1)", [{ day: "2026-10-26", shift: 1, amount: 10 }], /Not allowed/));

for (const signature of ["can(text)", "my_permissions()", "set_staff_access(uuid,text[])", "admin_save_client(jsonb)", "set_topup_settings(jsonb)", "topup_counts(date,integer)", "record_topup(jsonb)", "topup_list()"]) {
  const acl = (await q("select has_function_privilege('anon',$1,'EXECUTE') anon, has_function_privilege('authenticated',$1,'EXECUTE') signed", [signature]))[0];
  check("signed-in callers only: " + signature, !acl.anon && acl.signed);
}
for (const signature of ["private.topup_on(uuid)", "private.topup_conf(uuid)", "private.topup_window(uuid,date,integer)"]) {
  const acl = (await q("select has_function_privilege('authenticated',$1,'EXECUTE') signed", [signature]))[0];
  check("not callable from the app: " + signature, !acl.signed);
}
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
