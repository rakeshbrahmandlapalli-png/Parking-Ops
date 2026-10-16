// Setup part 96 (a return moved to a later day whose sheet isn't in yet: the
// car goes to OVERSTAYS) on a throwaway in-memory Postgres (PGlite).
//   cd checks && npm install @electric-sql/pglite && node later-return.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
await db.exec(`
create table companies (id uuid primary key default gen_random_uuid(), time_zone text not null default 'Europe/London', drops_day_end time not null default '06:00');
create table staff (id uuid primary key default gen_random_uuid(), name text, role text);
create table sheets (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, day date);
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, sheet_id uuid, kind text, reg text not null default '', num int,
  return_at timestamptz, orig_return_at timestamptz, early boolean not null default false, overstay boolean not null default false,
  called_word text not null default '', called_at timestamptz, called_by uuid, cleared_at timestamptz, removed_at timestamptz,
  sched_at timestamptz, sched_time text not null default '', est_at timestamptz, est_time text not null default '',
  flight_status text not null default '', flight_note text not null default '', updated_at timestamptz);
create table activity (id bigint generated always as identity primary key, booking_id uuid, action text, value text);
insert into staff(name, role) values ('OFFICE', 'office');
create function me() returns staff language sql as $$ select * from staff limit 1 $$;
create function can(text) returns boolean language sql as $$ select true $$;
create function booking_for_update(p uuid) returns bookings language sql as $$ select * from bookings where id = p $$;
create function log_activity(b bookings, a text, v text) returns void language sql as $$ insert into activity(booking_id, action, value) values (b.id, a, v) $$;
create function drops_day_of(p_at timestamptz, c companies) returns date language sql stable as $$
  select (p_at at time zone c.time_zone)::date - case when (p_at at time zone c.time_zone)::time <= c.drops_day_end then 1 else 0 end $$;
create role anon; create role authenticated;
insert into companies default values;
insert into sheets(company_id, kind, day) select id, 'drops', '2026-10-16' from companies;
`);
const q = async (s) => (await db.query(s)).rows;
const sheet16 = (await q(`select id from sheets where day = '2026-10-16'`))[0].id;
// Changed before the part (like FY70UXW): the catch-up marks it once.
const old = (await q(`insert into bookings(company_id, sheet_id, kind, reg, return_at, orig_return_at)
  select company_id, id, 'drops', 'FY70UXW', '2026-10-19 12:00+00', '2026-10-16 11:45+00' from sheets returning id`))[0].id;
const plain = (await q(`insert into bookings(company_id, sheet_id, kind, reg, return_at)
  select company_id, id, 'drops', 'PLAIN', '2026-10-16 20:00+00' from sheets returning id`))[0].id;
const part = fs.readFileSync(new URL("../setup/96-later-return-stays-longer.sql", import.meta.url), "utf8");
await db.exec(part);
await db.exec(part); // safe to run twice
let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
const get = async (id) => (await q(`select b.overstay, s.day::text as day, b.orig_return_at is not null as was from bookings b join sheets s on s.id = b.sheet_id where b.id = '${id}'`))[0];
const car = async (reg, ret) => (await q(`insert into bookings(company_id, sheet_id, kind, reg, return_at)
  select company_id, '${sheet16}', 'drops', '${reg}', '${ret}' from sheets limit 1 returning id`))[0].id;
const setRet = (id, t) => db.query(`select set_return('${id}', '${t}')`);

ok("a car already moved to a later day goes to OVERSTAYS", (await get(old)).overstay === true);
ok("a car due back tonight is left alone", (await get(plain)).overstay === false);

// 1. moved to the 19th, no sheet for the 19th yet: stays on the 16th, staying longer
const a = await car("AAA", "2026-10-16 11:45+00");
await setRet(a, "2026-10-19 13:00");
let r = await get(a);
ok("later day, no sheet: stays on the 16th", r.day === "2026-10-16", r);
ok("later day, no sheet: in OVERSTAYS", r.overstay === true, r);
ok("later day, no sheet: WAS tag kept", r.was === true, r);

// 2. changed back to the 16th: out of OVERSTAYS again
await setRet(a, "2026-10-16 22:00");
r = await get(a);
ok("back to its sheet's day: not an overstay", r.overstay === false, r);

// 3. a later time the same DROPS night (up to 06:00 next morning): not an overstay
await setRet(a, "2026-10-17 04:30");
r = await get(a);
ok("same DROPS night (04:30 next morning): not an overstay", r.overstay === false && r.day === "2026-10-16", r);

// 4. the later day's sheet is in: the car moves there, not an overstay
await db.exec(`insert into sheets(company_id, kind, day) select id, 'drops', '2026-10-18' from companies`);
const b = await car("BBB", "2026-10-16 11:45+00");
await setRet(b, "2026-10-18 10:00");
r = await get(b);
ok("later day with its sheet: moved there", r.day === "2026-10-18", r);
ok("later day with its sheet: not an overstay", r.overstay === false, r);

// 5. a carried car (overstay already) moved later still stays an overstay
const c = await car("CCC", "2026-10-15 11:00+00");
await db.exec(`update bookings set overstay = true where id = '${c}'`);
await setRet(c, "2026-10-20 10:00");
ok("carried car moved later: still an overstay", (await get(c)).overstay === true);

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
