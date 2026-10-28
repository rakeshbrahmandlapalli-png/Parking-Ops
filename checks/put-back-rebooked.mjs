// Setup part 131 (put a rebooked no-show back on DROPS; 28 Oct, YD56VWO) on a throwaway
// in-memory Postgres (PGlite).
//   cd checks && npm install @electric-sql/pglite && node put-back-rebooked.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
await db.exec(`
create table companies (id uuid primary key default gen_random_uuid(), time_zone text not null default 'Europe/London', drops_day_end time not null default '06:00');
create table staff (id uuid primary key default gen_random_uuid(), name text, role text);
create table sheets (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, day date);
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, sheet_id uuid, kind text, ref text not null default '', reg text not null default '', num int,
  drop_at timestamptz, return_at timestamptz, orig_return_at timestamptz, early boolean not null default false, overstay boolean not null default false,
  called_word text not null default '', called_at timestamptz, called_by uuid, cleared_at timestamptz,
  removed_at timestamptz, removed_by uuid, removed_reason text not null default '',
  sched_at timestamptz, sched_time text not null default '', est_at timestamptz, est_time text not null default '',
  flight_status text not null default '', flight_note text not null default '', updated_at timestamptz);
create table activity (id bigint generated always as identity primary key, booking_id uuid, action text, value text);
create table perm (ok boolean); insert into perm values (true);
insert into staff(name, role) values ('OFFICE', 'office');
create function me() returns staff language sql as $$ select * from staff limit 1 $$;
create function can(text) returns boolean language sql as $$ select ok from perm $$;
create function booking_for_update(p uuid) returns bookings language sql as $$ select * from bookings where id = p $$;
create function log_activity(b bookings, a text, v text) returns void language sql as $$ insert into activity(booking_id, action, value) values (b.id, a, v) $$;
create function drops_day_of(p_at timestamptz, c companies) returns date language sql stable as $$
  select (p_at at time zone c.time_zone)::date - case when (p_at at time zone c.time_zone)::time <= c.drops_day_end then 1 else 0 end $$;
create role anon; create role authenticated;
insert into companies default values;
`);
const part = fs.readFileSync(new URL("../setup/131-put-back-rebooked.sql", import.meta.url), "utf8");
await db.exec(part);
await db.exec(part); // safe to run twice
const q = async (s) => (await db.query(s)).rows;
let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
// Days relative to today (London), so the check works any day.
const day = async (n) => (await q(`select ((now() at time zone 'Europe/London')::date + ${n})::text d`))[0].d;
const sheet = async (n) => (await q(`insert into sheets(company_id, kind, day) select id, 'drops', '${await day(n)}' from companies returning id`))[0].id;
const old = await sheet(-30), tomorrow = await sheet(1);
await db.exec(`insert into bookings(company_id, sheet_id, kind, num) select company_id, '${tomorrow}', 'drops', 7 from sheets limit 1`);
const car = async (reason, extra = "") => (await q(`insert into bookings(company_id, sheet_id, kind, ref, reg, num, drop_at, return_at, removed_at, removed_reason, sched_time, est_time, flight_status${extra ? ", " + extra.split("=")[0] : ""})
  select company_id, '${old}', 'drops', 'L4PUK-1265111', 'YD56VWO', 9, now() - interval '43 days', now() - interval '30 days', now() - interval '30 days', '${reason}', '09:40', '09:55', 'Landed'${extra ? ", " + extra.split("=")[1] : ""} from sheets limit 1 returning id`))[0].id;
const put = (id, drop, ret) => db.query(`select put_back_rebooked('${id}', '${drop}', '${ret}')`).then(() => "", (e) => e.message);
const get = async (id) => (await q(`select s.day::text as day, b.num, b.removed_at is null as back, b.removed_reason, to_char(b.drop_at at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI') as drop, to_char(b.return_at at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI') ret, b.orig_return_at, b.sched_time, b.est_time, b.flight_status from bookings b join sheets s on s.id = b.sheet_id where b.id = '${id}'`))[0];
const t = await day(1), d0 = await day(-12);

// Like YD56VWO: No show on an old night, rebooked for tomorrow 10:00.
const y = await car("No show");
let e = await put(y, d0 + " 04:00", t + " 10:00");
let r = await get(y);
ok("put back: no error", e === "", e);
ok("put back: on the new return night's DROPS sheet", r.day === t && r.back && r.removed_reason === "", r);
ok("put back: numbered after the last car there", r.num === 8, r);
ok("put back: the site's drop-off and return", r.drop === d0 + " 04:00" && r.ret === t + " 10:00" && r.orig_return_at === null, r);
ok("put back: the old night's flight times cleared", r.sched_time === "" && r.est_time === "" && r.flight_status === "", r);
const log = await q(`select action, value from activity where booking_id = '${y}'`);
ok("put back: logged PUT BACK (not RETURN CHANGED)", log.length === 1 && log[0].action === "PUT BACK" && /rebooked: back .* 10:00, was removed \(No show\) from DROPS .*; moved to DROPS/.test(log[0].value), log);
ok("put back again: refused, not removed any more", /not removed/.test(await put(y, d0 + " 04:00", t + " 10:00")));

// Cancelled can be put back too; Duplicate / RTC / Early return can't.
ok("cancelled: put back", await put(await car("Cancelled"), "", t + " 11:00") === "");
for (const why of ["Duplicate", "RTC", "Early return"]) ok(why + ": refused", /No show or Cancelled/.test(await put(await car(why), "", t + " 11:00")));

// Refusals that leave the car where it was.
const z = await car("No show");
ok("return night not imported: refused", /Import DROPS .* first/.test(await put(z, "", (await day(5)) + " 10:00")));
ok("return already past: refused", /has passed/.test(await put(z, "", (await day(-2)) + " 10:00")));
ok("no return time: refused", /return date and time/.test(await put(z, "", t)));
ok("drop-off after return: refused", /after the return/.test(await put(z, (await day(3)) + " 10:00", t + " 10:00")));
r = await get(z);
ok("refused: still removed on its old night", !r.back && r.day === (await day(-30)), r);
const cl = await car("No show", "cleared_at=now()");
ok("cleared car: refused", /already cleared/.test(await put(cl, "", t + " 10:00")));
await db.exec(`update perm set ok = false`);
ok("not the office: refused", /Only the office/.test(await put(z, "", t + " 10:00")));
await db.exec(`update perm set ok = true`);
// 03:00 belongs to the night before (DROPS day ends 06:00).
const n = await car("No show");
const t2 = await day(2);
ok("03:00 on the 2nd day goes on tomorrow's night", await put(n, "", t2 + " 03:00") === "" && (await get(n)).day === t);

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
