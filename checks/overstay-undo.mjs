// Setup part 94 (OVERSTAY taken off undoes the overstay) on a throwaway
// in-memory Postgres (PGlite), with just the tables and columns tap_drop touches.
//   cd checks && npm install @electric-sql/pglite && node overstay-undo.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
await db.exec(`
create table companies (id uuid primary key default gen_random_uuid(), time_zone text not null default 'Europe/London', drops_day_end time not null default '06:00');
create table staff (id uuid primary key default gen_random_uuid(), name text, role text);
create table sheets (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, day date);
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, sheet_id uuid, kind text, reg text not null default '', name text not null default '',
  return_at timestamptz, early boolean not null default false, overstay boolean not null default false, yard text not null default '', yard_before_t text not null default '',
  sent_at timestamptz, sent_by uuid, called_word text not null default '', called_at timestamptz, called_by uuid,
  clear_word text not null default '', cleared_at timestamptz, cleared_by uuid, updated_at timestamptz);
create table activity (id bigint generated always as identity primary key, booking_id uuid, action text, value text);
insert into staff(name, role) values ('OFFICE', 'office');
create function me() returns staff language sql as $$ select * from staff limit 1 $$;
create function can(text) returns boolean language sql as $$ select true $$;
create function booking_for_update(p uuid) returns bookings language sql as $$ select * from bookings where id = p $$;
create function log_activity(b bookings, a text, v text) returns void language sql as $$ insert into activity(booking_id, action, value) values (b.id, a, v) $$;
create function drops_day_of(p_at timestamptz, c companies) returns date language sql stable as $$
  select (p_at at time zone c.time_zone)::date - case when (p_at at time zone c.time_zone)::time <= c.drops_day_end then 1 else 0 end $$;
insert into companies default values;
insert into sheets(company_id, kind, day) select id, 'drops', '2026-10-16' from companies;
`);
await db.exec(fs.readFileSync(new URL("../setup/94-overstay-undo.sql", import.meta.url), "utf8"));
await db.exec(fs.readFileSync(new URL("../setup/94-overstay-undo.sql", import.meta.url), "utf8")); // safe to run twice
const q = async (s) => (await db.query(s)).rows;
let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
const car = async (reg, ret, extra = "") => (await q(`insert into bookings(company_id, sheet_id, kind, reg, return_at${extra ? ", early" : ""})
  select company_id, id, 'drops', '${reg}', '${ret}'${extra ? ", " + extra : ""} from sheets returning id`))[0].id;
const tap = (id, on, word = "") => db.query(`select tap_drop('${id}', 'called', ${on}, '${word}')`);
const get = async (id) => (await q(`select overstay, called_word from bookings where id = '${id}'`))[0];

// 1. due tonight (23:59 London on the 16th, like KY75SNZ), OVERSTAY on then off
const a = await car("KY75SNZ", "2026-10-16 22:59+00");
await tap(a, true, "Overstay");
ok("OVERSTAY marks the car an overstay", (await get(a)).overstay === true);
await tap(a, false, "Overstay");
let r = await get(a);
ok("OVERSTAY off on a car due tonight clears the overstay", r.overstay === false && r.called_word === "", r);

// 2. due back after midnight (01:30 on the 17th is still the 16th's night)
const b = await car("AFTER1", "2026-10-17 00:30+00");
await tap(b, true, "Overstay"); await tap(b, false, "Overstay");
ok("a car due after midnight on this night is cleared too", (await get(b)).overstay === false);

// 3. carried from an earlier day, marked OVERSTAY then unmarked: still an overstay
const c = await car("OLD1", "2026-10-14 21:00+00");
await db.exec(`update bookings set overstay = true where id = '${c}'`);
await tap(c, true, "Overstay"); await tap(c, false, "Overstay");
r = await get(c);
ok("a car carried from an earlier day stays an overstay", r.overstay === true && r.called_word === "", r);

// 4. carried overstay, CALLED on and off: untouched
const d = await car("OLD2", "2026-10-13 21:00+00");
await db.exec(`update bookings set overstay = true where id = '${d}'`);
await tap(d, true); await tap(d, false);
ok("CALLED on and off leaves a carried overstay alone", (await get(d)).overstay === true);

// 5. an early return (booked later, moved to tonight) keeps what it had
const e = await car("EARLY1", "2026-10-20 10:00+00", "true");
await db.exec(`update bookings set overstay = true where id = '${e}'`);
await tap(e, true, "Overstay"); await tap(e, false, "Overstay");
ok("an early return is left as it was", (await get(e)).overstay === true);

// 6. plain CALLED on a car due tonight never makes it an overstay
const f = await car("CALL1", "2026-10-16 21:00+00");
await tap(f, true); await tap(f, false);
ok("CALLED on and off: not an overstay", (await get(f)).overstay === false);

console.log(fails ? fails + " failing" : "all passed");
process.exit(fails ? 1 : 0);
