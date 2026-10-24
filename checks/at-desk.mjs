// Setup part 112 (AT DESK on a DROPS car) on a throwaway in-memory Postgres
// (PGlite), with just the tables and columns tap_drop and bookings_by_name touch.
//   cd checks && npm install @electric-sql/pglite && node at-desk.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create table companies (id uuid primary key default gen_random_uuid(), time_zone text not null default 'Europe/London', drops_day_end time not null default '06:00');
create table staff (id uuid primary key default gen_random_uuid(), name text, role text, acting text not null default '');
create table sheets (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, day date);
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, sheet_id uuid, kind text, reg text not null default '', name text not null default '',
  return_at timestamptz, early boolean not null default false, overstay boolean not null default false, yard text not null default '', yard_before_t text not null default '',
  sent_at timestamptz, sent_by uuid, called_word text not null default '', called_at timestamptz, called_by uuid,
  clear_word text not null default '', cleared_at timestamptz, cleared_by uuid, updated_at timestamptz,
  intake_by uuid, pt_by uuid, exit_by uuid, charge_by uuid, removed_by uuid, by_name jsonb not null default '{}');
create table activity (id bigint generated always as identity primary key, booking_id uuid, action text, value text);
insert into staff(name, role, acting) values ('OFFICE', 'office', 'RAKESH.O');
create function me() returns staff language sql as $$ select * from staff limit 1 $$;
create table perms (p text);
create function can(x text) returns boolean language sql as $$ select not exists (select 1 from perms where p = 'no-' || x) $$;
create function booking_for_update(p uuid) returns bookings language sql as $$ select * from bookings where id = p $$;
create function log_activity(b bookings, a text, v text) returns void language sql as $$ insert into activity(booking_id, action, value) values (b.id, a, v) $$;
create function drops_day_of(p_at timestamptz, c companies) returns date language sql stable as $$
  select (p_at at time zone c.time_zone)::date - case when (p_at at time zone c.time_zone)::time <= c.drops_day_end then 1 else 0 end $$;
insert into companies default values;
insert into sheets(company_id, kind, day) select id, 'drops', '2026-10-24' from companies;
`);
const sql = fs.readFileSync(new URL("../setup/112-at-desk.sql", import.meta.url), "utf8");
await db.exec(sql); await db.exec(sql); // safe to run twice
// Part 115 changes tap_drop (the stub can() stays); its can() is tested further down.
const p115 = fs.readFileSync(new URL("../setup/115-at-desk-access.sql", import.meta.url), "utf8");
const tap115 = p115.slice(p115.indexOf("create or replace function tap_drop"), p115.indexOf("$$;", p115.indexOf("create or replace function tap_drop")) + 3);
await db.exec(tap115); await db.exec(tap115);
await db.exec(`create or replace trigger bookings_by_name before insert or update on bookings for each row execute function bookings_by_name();`);
const q = async (s) => (await db.query(s)).rows;
let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
const car = async (reg) => (await q(`insert into bookings(company_id, sheet_id, kind, reg, return_at) select company_id, id, 'drops', '${reg}', '2026-10-24 20:00+00' from sheets returning id`))[0].id;
const tap = (id, act, on, word = "") => db.query(`select tap_drop('${id}', '${act}', ${on}, '${word}')`);
const get = async (id) => (await q(`select called_word, called_at is not null called, desk_at is not null desk, desk_by is not null desk_by, by_name from bookings where id = '${id}'`))[0];
const last = async () => (await q(`select action, value from activity order by id desc limit 1`))[0];

const a = await car("A1");
await tap(a, "called", true); await tap(a, "desk", true);
let r = await get(a);
ok("AT DESK on a CALLED car stamps the time and who", r.called && r.desk && r.desk_by && r.called_word === "Called", r);
ok("the picked name rides with the AT DESK stamp", r.by_name.desk_by === "RAKESH.O", r.by_name);
ok("AT DESK is logged as DESK", JSON.stringify(await last()) === JSON.stringify({ action: "DESK", value: "At desk" }), await last());
await tap(a, "desk", false); r = await get(a);
ok("AT DESK off leaves CALLED", r.called && !r.desk && r.called_word === "Called" && !r.by_name.desk_by, r);
ok("AT DESK off is logged", (await last()).value === "(cleared)");
await tap(a, "desk", true); await tap(a, "called", false); r = await get(a);
ok("CALLED off takes AT DESK off too", !r.called && !r.desk, r);

const b = await car("B1");
await tap(b, "desk", true); r = await get(b);
ok("AT DESK on a car not called yet calls it too", r.called && r.desk && r.called_word === "Called", r);
await tap(b, "called", true, "Overstay"); r = await get(b);
ok("switching to OVERSTAY takes AT DESK off", r.called_word === "Overstay" && !r.desk, r);
let err = ""; try { await tap(b, "desk", true); } catch (e) { err = e.message; }
ok("AT DESK is refused on OVERSTAY", /OVERSTAY/.test(err), err);

await db.exec(`insert into perms values ('no-called')`);
// Part 115: AT DESK is its own permission. The stub can() says no only to a listed "no-<action>".
await db.exec(`drop table perms; create table perms (p text); insert into perms values ('no-called')`);
await tap(a, "desk", false);
await db.exec(`update bookings set called_word = 'Called', called_at = now() where id = '${a}'`);
await tap(a, "desk", true); r = await get(a);
ok("without CALLED, AT DESK still works on a car that is already called", r.desk && r.called, r);
await tap(a, "desk", false); r = await get(a);
ok("without CALLED, AT DESK comes off again (back to CALLED)", !r.desk && r.called, r);
const d = await car("D1");
err = ""; try { await tap(d, "desk", true); } catch (e) { err = e.message; }
ok("without CALLED, AT DESK on a car not called yet is refused", /Not called yet/.test(err) && !(await get(d)).called, err);
err = ""; try { await tap(d, "called", true); } catch (e) { err = e.message; }
ok("without CALLED, CALLED is still refused", /Not allowed/.test(err), err);
await db.exec(`insert into perms values ('no-desk')`);
err = ""; try { await tap(a, "desk", true); } catch (e) { err = e.message; }
ok("without the AT DESK permission it is refused", /Not allowed/.test(err), err);

// The real can() of part 115 (who gets AT DESK by default, and the -desk / desk grants).
const cdb = new PGlite();
await cdb.exec(`
create schema private;
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid default gen_random_uuid(), role text, extra text[] not null default '{}');
create function me() returns staff language sql as $$ select * from staff order by id limit 1 $$;
create function private.collections_on(c uuid) returns boolean language sql as $$ select true $$;
`);
const full = p115;
const canSql = full.slice(full.indexOf("create or replace function can"), full.indexOf("$$;", full.indexOf("create or replace function can")) + 3);
await cdb.exec(canSql);
const who = async (role, extra, act) => { await cdb.exec(`delete from staff; insert into staff(role, extra) values ('${role}', '{${extra}}')`); return (await cdb.query(`select can('${act}') c`)).rows[0].c; };
ok("terminal: AT DESK yes, CALLED no, OVERSTAY (called) no", (await who("terminal", "", "desk")) && !(await who("terminal", "", "called")), 0);
ok("bongo: no AT DESK by default", !(await who("bongo", "", "desk")));
ok("bongo given CALLED gets AT DESK with it", await who("bongo", "called", "desk"));
ok("office and manager and owner: AT DESK", (await who("office", "", "desk")) && (await who("manager", "", "desk")) && (await who("owner", "", "desk")));
ok("terminal with -desk: no", !(await who("terminal", "-desk", "desk")));
ok("office with -desk: no, even though it can press CALLED", !(await who("office", "-desk", "desk")));
ok("bongo given desk: yes, and still no CALLED", (await who("bongo", "desk", "desk")) && !(await who("bongo", "desk", "called")));
ok("view-only: no AT DESK", !(await who("view", "", "desk")));

console.log(fails ? "\n" + fails + " failed" : "\nall passed"); process.exit(fails ? 1 : 0);
