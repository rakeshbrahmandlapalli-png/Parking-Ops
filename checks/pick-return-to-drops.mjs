// Setup part 147 (a return changed on a PICKS car reaches DROPS; 15 Nov, LS54FAA) on a
// throwaway in-memory Postgres (PGlite), with the real set_return (127) and early_at_for (75).
//   cd checks && npm install @electric-sql/pglite && node pick-return-to-drops.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
await db.exec(`
create table companies (id uuid primary key default gen_random_uuid(), slug text, time_zone text not null default 'Europe/London', drops_day_end time not null default '06:00');
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid, name text, role text);
create table sheets (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, day date, imported_by uuid, source jsonb, unique (company_id, kind, day));
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, sheet_id uuid, kind text, ref text not null default '', reg text not null default '',
  name text not null default '', phone text not null default '', make text not null default '', num int,
  drop_at timestamptz, return_at timestamptz, orig_return_at timestamptz, early boolean not null default false, early_at timestamptz, moved_from uuid,
  overstay boolean not null default false, called_word text not null default '', called_at timestamptz, called_by uuid, cleared_at timestamptz, removed_at timestamptz,
  sched_at timestamptz, sched_time text not null default '', est_at timestamptz, est_time text not null default '',
  flight_status text not null default '', flight_note text not null default '', updated_at timestamptz);
create table activity (id bigint generated always as identity primary key, company_id uuid, staff_id uuid, staff_name text not null default '', sheet_id uuid, booking_id uuid, reg text, customer text, action text, value text);
create table perms (a text);
insert into companies(slug) values ('takeoff'), ('apb');
insert into staff(company_id, name, role) select id, 'OFFICE', 'office' from companies where slug = 'takeoff';
create function me() returns staff language sql as $$ select * from staff limit 1 $$;
create function can(a text) returns boolean language sql as $$ select exists (select 1 from perms where perms.a = can.a) $$;
create function booking_for_update(p uuid) returns bookings language sql as $$ select * from bookings where id = p $$;
create function log_activity(b bookings, a text, v text) returns void language sql as $$ insert into activity(booking_id, sheet_id, reg, action, value) values (b.id, b.sheet_id, b.reg, a, v) $$;
create function drops_day_of(p_at timestamptz, c companies) returns date language sql stable as $$
  select (p_at at time zone c.time_zone)::date - case when (p_at at time zone c.time_zone)::time <= c.drops_day_end then 1 else 0 end $$;
create role anon; create role authenticated;
insert into perms values ('import');
`);
const read = (f) => fs.readFileSync(new URL("../setup/" + f, import.meta.url), "utf8");
await db.exec(read("75-early-return-pick-night.sql"));
await db.exec(read("96-later-return-stays-longer.sql"));
await db.exec(read("127-save-moves-staying-longer.sql"));
const part = read("147-pick-return-to-drops.sql");
await db.exec(part);
await db.exec(part); // safe to run twice
const q = async (s) => (await db.query(s)).rows;
let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
const err = async (s) => { try { await db.query(s); return ""; } catch (e) { return e.message; } };

// Nights counted from tonight's DROPS day (London; up to 06:00 is the night before).
const tonight = (await q(`select (case when (now() at time zone 'Europe/London')::time <= '06:00' then (now() at time zone 'Europe/London')::date - 1
  else (now() at time zone 'Europe/London')::date end)::text d`))[0].d;
const night = (n) => { const t = new Date(tonight + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const co = (slug = "takeoff") => `(select id from companies where slug='${slug}')`;
const sheet = async (n, slug) => (await q(`insert into sheets(company_id, kind, day) values (${co(slug)}, 'drops', '${night(n)}') on conflict (company_id, kind, day) do update set day = excluded.day returning id`))[0].id;
const at = (n, hm) => `('${night(n)} ${hm}'::timestamp at time zone 'Europe/London')`;
const pick = async (ref, reg, back, extra = "") => (await q(`insert into bookings(company_id, kind, ref, reg, name, drop_at, return_at ${extra ? ", removed_at" : ""})
  values (${co()}, 'picks', '${ref}', '${reg}', 'Mr Test', now() - interval '2 days', ${back === null ? "null" : at(back, "15:30")} ${extra ? ", now()" : ""}) returning id`))[0].id;
const drop = async (ref, reg, n, extra = {}) => (await q(`insert into bookings(company_id, sheet_id, kind, ref, reg, drop_at, return_at, removed_at, cleared_at)
  values (${co(extra.slug)}, '${await sheet(n, extra.slug)}', 'drops', '${ref}', '${reg}', now() - interval '2 days', ${at(n, "15:30")},
  ${extra.removed ? "now()" : "null"}, ${extra.cleared ? "now()" : "null"}) returning id`))[0].id;
const setRet = (id, n, hm = "15:30") => q(`select * from set_pick_return('${id}', '${night(n)} ${hm}')`);
const drops = (ref) => q(`select b.id, s.day::text as day, b.early, b.moved_from, b.return_at, b.removed_at, (select day::text from sheets where id = b.moved_from) from_day
  from bookings b join sheets s on s.id = b.sheet_id where b.kind = 'drops' and b.ref = '${ref}' and b.company_id = ${co()} order by s.day`);
const last = async (id) => (await q(`select action, value from activity where booking_id = '${id}' order by id desc limit 1`))[0];

// 1. LS54FAA: a desk booking (no DROPS car; its old night is in without it), return changed to night +1.
await sheet(1); await sheet(0);
let p = await pick("D1", "LS54FAA", 0);
await setRet(p, 1);
let r = await drops("D1");
ok("1. no DROPS car: added to the new night's sheet", r.length === 1 && r[0].day === night(1) && !r[0].early, r);
ok("1. logged ADDED from PICKS", /^from PICKS: return changed to .* added to DROPS/.test((await last(r[0].id) || {}).value), await last(r[0]?.id));
await setRet(p, 1, "16:00");
ok("1. saving again doesn't add a second car", (await drops("D1")).length === 1, await drops("D1"));

// 2. Coming back earlier: DROPS car on a later night (+5) moves to +2 as an early return.
p = await pick("D2", "AB12CDE", 5); let d2 = await drop("D2", "AB12CDE", 5);
await setRet(p, 2);
r = await drops("D2");
ok("2. moved to the new night as an early return", r.length === 1 && r[0].day === night(2) && r[0].early && r[0].from_day === night(5), r);
ok("2. its return changed too", (await q(`select (return_at = ${at(2, "15:30")}) x from bookings where id = '${d2}'`))[0].x);
ok("2. logged EARLY RETURN", (await last(d2)).action === "EARLY RETURN", await last(d2));

// 3. No DROPS car, coming back earlier than a night not in yet (+9): added early, the +9 sheet made for moved_from.
p = await pick("D3", "CD34EFG", 9);
await setRet(p, 3);
r = await drops("D3");
ok("3. added as an early return from the booked night", r.length === 1 && r[0].day === night(3) && r[0].early && r[0].from_day === night(9), r);

// 4. Later night, its booked night not in yet (+11 -> +12): left for that night's import (no second car).
p = await pick("D4", "EF56GHI", 11);
await setRet(p, 12);
ok("4. booked night not in: nothing added", (await drops("D4")).length === 0, await drops("D4"));

// 5. Later night with a DROPS car already in (+1 -> +2): part 127 moves it, nothing added.
p = await pick("D5", "GH78IJK", 1); await drop("D5", "GH78IJK", 1);
await setRet(p, 2);
r = await drops("D5");
ok("5. existing car moved to the later sheet, no second car", r.length === 1 && r[0].day === night(2) && !r[0].early, r);

// 6. A DROPS car removed on purpose never comes back.
p = await pick("D6", "IJ90KLM", 1); await drop("D6", "IJ90KLM", 1, { removed: true });
await setRet(p, 2);
r = await drops("D6");
ok("6. removed DROPS car: nothing added", r.length === 1 && r[0].removed_at, r);

// 7. A past night: PICKS changes, DROPS untouched.
p = await pick("D7", "KL12MNO", 1);
await setRet(p, -2);
ok("7. a past night adds nothing", (await drops("D7")).length === 0);

// 8. Tonight with tonight's sheet not in: nothing (and no error).
await db.exec(`delete from sheets where day = '${tonight}' and company_id = ${co()}`);
p = await pick("D8", "MN34OPQ", null);
ok("8. no error", (await err(`select set_pick_return('${p}', '${tonight} 23:00')`)) === "");
ok("8. tonight's sheet not in: nothing added", (await drops("D8")).length === 0);

// 9. Another client's car with the same ref is never touched; a removed PICKS car adds nothing.
await drop("D9", "ZZ99ZZZ", 6, { slug: "apb" });
p = await pick("D9", "ZZ99ZZZ", 6);
await setRet(p, 4);
ok("9. other client's DROPS car stays", (await q(`select s.day::text d from bookings b join sheets s on s.id = b.sheet_id where b.ref='D9' and b.company_id = ${co("apb")}`))[0].d === night(6));
ok("9. ours added as an early return", (await drops("D9")).length === 1);
p = await pick("D10", "AA11BBB", 1, "removed");
await setRet(p, 2);
ok("9. removed PICKS car adds nothing", (await drops("D10")).length === 0);

// 10. Permissions as before.
await db.exec(`delete from perms`);
ok("10. office only", /Only the office/.test(await err(`select set_pick_return('${p}', '${night(3)} 10:00')`)));

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
