// Setup part 124 (the customer's phone number, added or changed in the app) on a
// throwaway in-memory Postgres (PGlite), with just the tables set_phone touches.
//   cd checks && npm install @electric-sql/pglite && node booking-phone.mjs
//   (or PGLITE_MODULE=/path/to/pglite/dist/index.js node booking-phone.mjs)
import fs from "fs";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create schema private;
create table companies (id uuid primary key default gen_random_uuid(), time_zone text not null default 'Europe/London', drops_day_end time not null default '06:00');
create table sheets (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, day date);
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, sheet_id uuid, kind text, ref text not null default '', reg text not null default '',
  name text not null default '', phone text not null default '', removed_at timestamptz, personal_wiped_at timestamptz, cleared_at timestamptz, intake text not null default '', updated_at timestamptz);
create table activity (id bigint generated always as identity primary key, booking_id uuid, action text, value text);
create table perms (p text);
create function can(x text) returns boolean language sql as $$ select exists (select 1 from perms where p = x) $$;
create function booking_for_update(p uuid) returns bookings language sql as $$ select * from bookings where id = p $$;
create function log_activity(b bookings, a text, v text) returns void language sql as $$ insert into activity(booking_id, action, value) values (b.id, a, v) $$;
create function private.phone10(p text) returns text language sql immutable as $$ select right(regexp_replace(coalesce(p, ''), '\\D', '', 'g'), 10) $$;
insert into companies default values;
insert into sheets(company_id, kind, day) select id, k, '2026-10-26' from companies, (values ('drops'), ('picks')) v(k);
insert into perms values ('import'), ('intake');
`);
const sql = fs.readFileSync(new URL("../setup/124-booking-phone.sql", import.meta.url), "utf8");
await db.exec(sql); await db.exec(sql); // safe to run twice
const q = async (s) => (await db.query(s)).rows;
let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
const car = async (kind, ref, phone) => (await q(`insert into bookings(company_id, sheet_id, kind, ref, reg, phone) select company_id, id, kind, '${ref}', 'AB12CDE', '${phone}' from sheets where kind = '${kind}' returning id`))[0].id;
const phone = async (id) => (await q(`select phone from bookings where id = '${id}'`))[0].phone;
const err = async (s) => { try { await db.query(s); return ""; } catch (e) { return e.message; } };

const p = await car("picks", "REF1", "07700 900111"), d = await car("drops", "REF1", "07700 900111"), other = await car("drops", "REF2", "");
await db.query(`select set_phone('${p}', '07700  900222 ')`);
ok("set_phone saves the number (spaces tidied)", await phone(p) === "07700 900222", await phone(p));
ok("the booking's other row takes it", await phone(d) === "07700 900222", await phone(d));
ok("another booking is left alone", await phone(other) === "", await phone(other));
const log = await q(`select booking_id, value from activity where action = 'PHONE' order by id`);
ok("both rows log PHONE old > new", log.length === 2 && log[0].value === "07700 900111 > 07700 900222" && log[1].value === "07700 900111 > 07700 900222 · from PICKS", log);

// An import (any path) writing the file's old number doesn't overwrite it.
await db.query(`update bookings set phone = coalesce(nullif('07700 900111', ''), phone), name = 'MR X' where id = '${d}'`);
ok("an import keeps the number typed in the app", await phone(d) === "07700 900222", await phone(d));
ok("the import's other fields still change", (await q(`select name from bookings where id = '${d}'`))[0].name === "MR X");
// A row imported later for the same ref starts with it.
const late = await car("drops", "REF1", "07700 900111");
ok("a row imported later for the ref starts with the typed number", await phone(late) === "07700 900222", await phone(late));
// The personal-data wipe still empties it.
await db.query(`update bookings set name = '', phone = '', personal_wiped_at = now() where id = '${late}'`);
ok("the 90-day wipe empties it", await phone(late) === "", await phone(late));
// A booking never edited in the app takes the file's number as before.
await db.query(`update bookings set phone = '07700 900333' where id = '${other}'`);
ok("an untouched booking takes the file's number", await phone(other) === "07700 900333");

// Validation.
ok("letters refused", /Check the phone number/.test(await err(`select set_phone('${p}', '07700 abc')`)));
ok("too few digits refused", /Check the phone number/.test(await err(`select set_phone('${p}', '12345')`)));
ok("+44 accepted", (await err(`select set_phone('${p}', '+44 7700 900444')`)) === "" && await phone(p) === "+44 7700 900444");
ok("call matching sees the new number", (await q(`select private.phone10(phone) n from bookings where id = '${d}'`))[0].n === "7700900444");
await db.query(`select set_phone('${p}', '')`);
ok("the office can clear it", await phone(p) === "" && await phone(d) === "");
ok("clearing logs (cleared)", (await q(`select value from activity where action = 'PHONE' and booking_id = '${p}' order by id desc limit 1`))[0].value === "+44 7700 900444 > (cleared)");
const n0 = (await q(`select count(*)::int n from activity`))[0].n;
await db.query(`select set_phone('${p}', '')`);
ok("the same number again logs nothing", (await q(`select count(*)::int n from activity`))[0].n === n0);

// Permissions: a driver (intake only) fills in a missing number, can't change one.
await db.exec(`delete from perms where p = 'import'`);
ok("intake can fill a missing number", (await err(`select set_phone('${p}', '07700 900555')`)) === "" && await phone(p) === "07700 900555");
ok("intake can't change one", /Only the office/.test(await err(`select set_phone('${p}', '07700 900666')`)));
await db.exec(`delete from perms`);
ok("view-only can't add one", /Only the office/.test(await err(`select set_phone('${other}', '07700 900777')`)));
await db.exec(`insert into perms values ('import'); update bookings set removed_at = now() where id = '${other}'`);
ok("a removed car is refused", /removed/.test(await err(`select set_phone('${other}', '07700 900777')`)));

console.log(fails ? fails + " failing" : "all passed");
process.exit(fails ? 1 : 0);
