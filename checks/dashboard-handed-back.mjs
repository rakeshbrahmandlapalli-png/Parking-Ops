// Setup part 106 (the dashboard counts a PICKS car as handed back when its DROPS car is CLEAR under a
// differently typed reference, or the same reg cleared after it came in) on a throwaway in-memory
// Postgres (PGlite), with just the tables and columns owner_dashboard touches.
//   cd checks && npm install @electric-sql/pglite && node dashboard-handed-back.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
await db.exec(`
create table companies (id uuid primary key default gen_random_uuid(), slug text, time_zone text default 'Europe/London', drops_day_end time not null default '06:00',
  exit_fee numeric, exit_free text[] not null default '{}', handover_note text not null default '', handover_at timestamptz, handover_by text not null default '');
create table staff (id uuid primary key default gen_random_uuid(), name text);
create table sheets (id uuid primary key default gen_random_uuid(), kind text, day date);
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, sheet_id uuid, kind text, ref text not null default '', reg text not null default '', name text not null default '',
  drop_at timestamptz, return_at timestamptz, orig_return_at timestamptz, yard text not null default '', intake text not null default '', intake_at timestamptz,
  overstay boolean not null default false, removed_at timestamptz, removed_reason text, removed_by uuid, cleared_at timestamptz,
  charge_agreed numeric(8,2), charge_reason text not null default '', charge_at timestamptz, charge_amount numeric(8,2), charge_method text, charge_by uuid,
  exit_method text not null default '', exit_amount numeric, exit_at timestamptz, exit_by uuid, exit_photo text not null default '');
create table activity (id bigint generated always as identity primary key, at timestamptz default now(), company_id uuid, staff_id uuid, staff_name text not null default '', sheet_id uuid, booking_id uuid, reg text, customer text, action text, value text);
create table cur (co uuid);
create function my_company() returns uuid language sql as $$ select co from cur $$;
create function can(p text) returns boolean language sql as $$ select true $$;
create role anon; create role authenticated;
insert into companies(slug) values ('apb'), ('other');
`);
for (const part of ["106-dashboard-handed-back-match.sql", "106-dashboard-handed-back-match.sql"]) // twice: safe to run twice
  await db.exec(fs.readFileSync(new URL("../setup/" + part, import.meta.url), "utf8"));
const q = async (s) => (await db.query(s)).rows;
const co = (slug) => `(select id from companies where slug='${slug}')`;
await db.exec(`insert into cur select id from companies where slug='apb'`);
let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
// A PICKS car taken in 3 days ago, due back `back` hours from now (negative = past its return).
const pick = (ref, reg, back, slug = "apb") => db.exec(`insert into bookings(company_id, kind, ref, reg, drop_at, intake_at, return_at, intake)
  values (${co(slug)}, 'picks', '${ref}', '${reg}', now() - interval '3 days', now() - interval '3 days', now() + interval '${back} hours', 'Collected')`);
// Its DROPS car, cleared `ago` hours ago (null = still on the board).
const drop = (ref, reg, ago, extra = "", slug = "apb") => db.exec(`insert into bookings(company_id, kind, ref, reg, drop_at, return_at, cleared_at, removed_at)
  values (${co(slug)}, 'drops', '${ref}', '${reg}', now() - interval '3 days', now() - interval '1 hour', ${ago == null ? "null" : `now() - interval '${ago} hours'`}, ${extra === "removed" ? "now()" : "null"})`);
const dash = async () => (await q(`select owner_dashboard(now() - interval '7 days') d`))[0].d;

await pick("VIP APB-1", "AA11AAA", -5); await drop("VIP APB-1", "AA11AAA", 4);           // same ref: handed back (as before)
await pick("Apb2381", "BB22BBB", -5); await drop("VIP APB-2381", "BB 22BBB", 4);         // ref typed differently, same reg: handed back
await pick("Cpd 19660209", "CC33CCC", -5); await drop("CPD-19-660209", "XX99XXX", 4);    // reg typo, ref the same in letters and numbers: handed back
await pick("", "DD44DDD", -5); await drop("", "dd44 ddd", 4);                            // no ref, reg spaced and lower case: handed back
await pick("REPEAT-2", "EE55EEE", -5); await drop("REPEAT-1", "EE55EEE", 100);           // the same reg cleared on an earlier trip (before it came in): still late
await pick("NODROPS", "FF66FFF", -5);                                                    // never had a DROPS car: late
await pick("ONBOARD", "GG77GGG", -1); await drop("ONBOARD", "GG77GGG", null);            // due an hour ago, still on the board: late
await pick("GONE", "HH88HHH", -5); await drop("GONE", "HH88HHH", 4, "removed");          // its DROPS car was removed: late (the office decides)
await pick("LATER", "JJ99JJJ", 30);                                                      // due tomorrow: parked, not late
await pick("Apb2381", "BB22BBB", -5, "other");                                           // another client's car: not ours, and our cleared car doesn't hand it back

let P = (await dash()).parked;
const regs = P.late_cars.map((c) => c.reg).sort();
ok("cars past their return: only the ones not handed back", +P.late === 4, P);
ok("the late list names them", JSON.stringify(regs) === JSON.stringify(["EE55EEE", "FF66FFF", "GG77GGG", "HH88HHH"]), regs);
ok("parked now counts the same cars plus tomorrow's", +P.total === 5, P.total);

// Upcoming workload: a PICKS car not handed back and its DROPS car under another reference count once.
await db.exec(`delete from bookings`);
await db.exec(`insert into bookings(company_id, kind, ref, reg, drop_at, return_at, intake) values (${co("apb")}, 'picks', 'Apb77', 'KK11KKK', now() - interval '2 days', now() + interval '2 days', 'Collected')`);
await db.exec(`insert into bookings(company_id, kind, ref, reg, drop_at, return_at) values (${co("apb")}, 'drops', 'VIP APB-77', 'KK11 KKK', now() - interval '2 days', now() + interval '2 days')`);
await db.exec(`insert into bookings(company_id, kind, ref, reg, drop_at, return_at) values (${co("apb")}, 'drops', 'NOPICK', 'LL22LLL', now() - interval '2 days', now() + interval '2 days')`); // no PICKS car yet: counts
const on = (await dash()).onsite[0];
ok("on site tonight: the car once, plus the DROPS car with no PICKS car", +on.here === 2, on);

console.log(fails ? fails + " failing" : "all passing");
process.exit(fails ? 1 : 0);
