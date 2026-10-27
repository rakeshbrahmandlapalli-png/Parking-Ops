// Setup part 127 (Save with the same return on a car staying longer moves it to its
// night once that sheet is in; 26 Oct, JLZ646) on a throwaway in-memory Postgres (PGlite).
//   cd checks && npm install @electric-sql/pglite && node save-moves-staying-longer.mjs
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
const part96 = fs.readFileSync(new URL("../setup/96-later-return-stays-longer.sql", import.meta.url), "utf8");
const part = fs.readFileSync(new URL("../setup/127-save-moves-staying-longer.sql", import.meta.url), "utf8");
await db.exec(part96);
await db.exec(part);
await db.exec(part); // safe to run twice
let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
const get = async (id) => (await q(`select b.overstay, s.day::text as day, b.num, b.called_word, b.orig_return_at is not null as was from bookings b join sheets s on s.id = b.sheet_id where b.id = '${id}'`))[0];
const car = async (reg, ret) => (await q(`insert into bookings(company_id, sheet_id, kind, reg, return_at, num)
  select company_id, '${sheet16}', 'drops', '${reg}', '${ret}', 1 from sheets limit 1 returning id`))[0].id;
const setRet = (id, t) => db.query(`select set_return('${id}', '${t}')`);
const logs = async (id) => (await q(`select value from activity where booking_id = '${id}' order by id`)).map((x) => x.value);

// Like JLZ646: changed by hand to the 19th while the 19th wasn't in, so it stays on the 16th.
const j = await car("JLZ646", "2026-10-16 11:45+00");
await setRet(j, "2026-10-19 21:00");
let r = await get(j);
ok("changed to a day not in yet: staying longer on the 16th", r.day === "2026-10-16" && r.overstay === true, r);

// Saved again unchanged while the 19th still isn't in: nothing changes, nothing logged.
await setRet(j, "2026-10-19 21:00");
r = await get(j);
ok("saved unchanged, its night not in: stays on the 16th", r.day === "2026-10-16" && r.overstay === true, r);
ok("saved unchanged, its night not in: nothing logged", (await logs(j)).length === 1, await logs(j));

// The 19th comes in; saved unchanged: moves there, out of OVERSTAYS, numbered after the last car.
await db.exec(`insert into sheets(company_id, kind, day) select id, 'drops', '2026-10-19' from companies`);
const sheet19 = (await q(`select id from sheets where day = '2026-10-19'`))[0].id;
await db.exec(`insert into bookings(company_id, sheet_id, kind, reg, return_at, num) select company_id, '${sheet19}', 'drops', 'OTHER', '2026-10-19 20:00+00', 95 from sheets limit 1`);
await db.exec(`update bookings set called_word = 'Overstay', called_at = now() where id = '${j}'`);
await setRet(j, "2026-10-19 21:00");
r = await get(j);
ok("saved unchanged, its night is in: moved to the 19th", r.day === "2026-10-19", r);
ok("moved: out of OVERSTAYS and the OVERSTAY tap cleared", r.overstay === false && r.called_word === "", r);
ok("moved: numbered after the night's last car", r.num === 96, r);
ok("moved: WAS tag kept", r.was === true, r);
ok("moved: logged as saved by hand", /unchanged, 19 Oct 21:00 \(saved by hand; moved to DROPS 19 Oct\)/.test((await logs(j)).at(-1)), await logs(j));

// A real overstay (due back before the sheet it's on) saved unchanged: never moved back.
const o = await car("OVER", "2026-10-15 11:00+00");
await db.exec(`update bookings set overstay = true where id = '${o}'`);
await db.exec(`insert into sheets(company_id, kind, day) select id, 'drops', '2026-10-15' from companies`);
await setRet(o, "2026-10-15 11:00");
r = await get(o);
ok("a real overstay saved unchanged stays where it is", r.day === "2026-10-16" && r.overstay === true, r);

// A car due back tonight saved unchanged: nothing happens.
const t = await car("TONIGHT", "2026-10-16 20:00+00");
await setRet(t, "2026-10-16 20:00");
r = await get(t);
ok("a car due back tonight saved unchanged: stays, not an overstay", r.day === "2026-10-16" && r.overstay === false, r);

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
