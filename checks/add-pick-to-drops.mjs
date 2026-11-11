// Setup part 145 (ADD TO DROPS from a PICKS car; 2 Nov, LK06LFN) on a throwaway
// in-memory Postgres (PGlite).
//   cd checks && npm ci && node add-pick-to-drops.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
await db.exec(`
create table companies (id uuid primary key default gen_random_uuid(), time_zone text not null default 'Europe/London', drops_day_end time not null default '06:00');
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid, name text, role text);
create table sheets (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, day date);
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, sheet_id uuid, kind text, ref text not null default '', reg text not null default '',
  name text not null default '', phone text not null default '', make text not null default '', flight text not null default '', num int,
  drop_at timestamptz, return_at timestamptz, intake text not null default '', overstay boolean not null default false,
  cleared_at timestamptz, removed_at timestamptz, updated_at timestamptz);
create table activity (id bigint generated always as identity primary key, booking_id uuid, action text, value text);
create table perm (ok boolean); insert into perm values (true);
insert into companies default values;
insert into staff(company_id, name, role) select id, 'OFFICE', 'office' from companies;
create function me() returns staff language sql as $$ select * from staff limit 1 $$;
create function can(text) returns boolean language sql as $$ select ok from perm $$;
create function log_activity(b bookings, a text, v text) returns void language sql as $$ insert into activity(booking_id, action, value) values (b.id, a, v) $$;
create function drops_day_of(p_at timestamptz, c companies) returns date language sql stable as $$
  select (p_at at time zone c.time_zone)::date - case when (p_at at time zone c.time_zone)::time <= c.drops_day_end then 1 else 0 end $$;
create role anon; create role authenticated;
`);
const part = fs.readFileSync(new URL("../setup/145-add-pick-to-drops.sql", import.meta.url), "utf8");
await db.exec(part); await db.exec(part); // safe to run twice
const q = async (s, p) => (await db.query(s, p)).rows;
let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
const err = async (s, p) => { try { await q(s, p); return ""; } catch (e) { return e.message; } };
const co = (await q("select id from companies"))[0].id;
const sheet = async (kind, day) => (await q("insert into sheets(company_id, kind, day) values ($1,$2,$3) returning id", [co, kind, day]))[0].id;
const picks14 = await sheet("picks", "2026-10-14");
const drops21 = await sheet("drops", "2026-10-21");
const drops02 = await sheet("drops", "2026-11-02");
await q("insert into bookings(company_id, sheet_id, kind, ref, reg, num) values ($1,$2,'drops','X1','AA11AAA',53)", [co, drops21]);
const pick = async (ref, reg, extra = "") => (await q(`insert into bookings(company_id, sheet_id, kind, ref, reg, name, phone, make, flight, drop_at, return_at, intake, num)
  values ($1,$2,'picks',$3,$4,'Robert','07365223462','Skoda Octavia','LS123','2026-10-14 05:00+00','2026-10-21 14:00+00',$5,30) returning id`, [co, picks14, ref, reg, extra || "Collected"]))[0].id;
const add = (id, day) => q("select * from put_pick_on_drops($1, $2)", [id, day]);

const p1 = await pick("VIP APB-2308", "LK06LFN");
let r = (await add(p1, "2026-11-02"))[0];
ok("added to the night picked", r.sheet_id === drops02 && r.kind === "drops", r);
ok("details copied", r.ref === "VIP APB-2308" && r.reg === "LK06LFN" && r.name === "Robert" && r.phone === "07365223462" && r.make === "Skoda Octavia" && r.flight === "LS123", r);
ok("a night after its return is an OVERSTAY", r.overstay === true, r);
ok("numbered after the sheet's last car", r.num === 1, r);
const log = await q("select action, value from activity where booking_id=$1", [r.id]);
ok("logged ADDED", log.length === 1 && log[0].action === "ADDED" && /from PICKS/.test(log[0].value) && /overstay/.test(log[0].value), log);
ok("PICKS car untouched", (await q("select kind, sheet_id from bookings where id=$1", [p1]))[0].sheet_id === picks14);
ok("refused the second time", /Already on DROPS 02 Nov/.test(await err("select put_pick_on_drops($1,$2)", [p1, "2026-11-02"])));

const p2 = await pick("VIP APB-9", "LK06XYZ");
r = (await add(p2, "2026-10-21"))[0];
ok("on its return day: not an overstay", r.sheet_id === drops21 && r.overstay === false && r.num === 54, r);

const p3 = await pick("VIP APB-10", "LK06ABC");
ok("before its return day refused", /Pick 21 Oct or a later night/.test(await err("select put_pick_on_drops($1,$2)", [p3, "2026-10-20"])));
ok("night with no sheet refused", /isn't in yet/.test(await err("select put_pick_on_drops($1,$2)", [p3, "2026-10-25"])));
ok("no night refused", /Pick a night/.test(await err("select put_pick_on_drops($1,null)", [p3])));
const p4 = await pick("VIP APB-11", "LK06DEF", "No Show");
ok("not taken in refused", /hasn't been taken in/.test(await err("select put_pick_on_drops($1,$2)", [p4, "2026-11-02"])));
const p5 = await pick("X1", "AA11AAA");
ok("a ref already on DROPS refused", /Already on DROPS 21 Oct \(#53\)/.test(await err("select put_pick_on_drops($1,$2)", [p5, "2026-11-02"])));
await q("insert into bookings(company_id, sheet_id, kind, ref, reg, num, return_at) values ($1,$2,'drops','','BB22BBB',55,'2026-10-21 14:00+00')", [co, drops21]);
const p6 = await pick("", "BB22 BBB");
ok("no ref: the same reg due back after it came in counts", /Already on DROPS 21 Oct \(#55\)/.test(await err("select put_pick_on_drops($1,$2)", [p6, "2026-11-02"])));
await q("update perm set ok=false");
ok("office only", /Only the office/.test(await err("select put_pick_on_drops($1,$2)", [p3, "2026-11-02"])));
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
