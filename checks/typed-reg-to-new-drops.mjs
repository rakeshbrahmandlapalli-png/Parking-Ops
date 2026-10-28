// Setup part 132 (a reg changed on PICKS reaches a DROPS car imported later) on PGlite.
//   cd checks && npm install @electric-sql/pglite && node typed-reg-to-new-drops.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const sql = fs.readFileSync(new URL("../setup/132-typed-reg-to-new-drops.sql", import.meta.url), "utf8");
const db = new PGlite();
await db.exec(`
create table staff (id uuid primary key default gen_random_uuid(), name text);
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, ref text not null default '', reg text not null default '',
  drop_at timestamptz, return_at timestamptz, removed_at timestamptz, cleared_at timestamptz, updated_at timestamptz);
create table activity (id bigint generated always as identity primary key, company_id uuid, booking_id uuid, reg text, action text, value text);
create function log_activity(p_booking bookings, p_action text, p_value text) returns void language sql as $$
  insert into activity(company_id, booking_id, reg, action, value) values (p_booking.company_id, p_booking.id, p_booking.reg, p_action, p_value) $$;
create role anon; create role authenticated;
`);
await db.exec(sql); await db.exec(sql); // twice
const q = async (s, p) => (await db.query(s, p)).rows;
let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
const C = "00000000-0000-0000-0000-000000000001", C2 = "00000000-0000-0000-0000-000000000002";
const row = async (kind, ref, reg, co = C, drop = "2026-10-28 08:00Z", ret = "2026-11-01 15:00Z") =>
  (await q(`insert into bookings(company_id, kind, ref, reg, drop_at, return_at) values ($1,$2,$3,$4,$5,$6) returning id`, [co, kind, ref, reg, drop, ret]))[0].id;
const typed = async (id, v) => q(`insert into activity(booking_id, action, value) values ($1, 'REG', $2)`, [id, v]);
const reg = async (id) => (await q(`select reg from bookings where id = $1`, [id]))[0].reg;

// APL-113430: PICKS corrected HS21LVH > GF66BBJ, DROPS imported later with the site's HS21LVH.
let p = await row("picks", "R1", "GF66BBJ"); await typed(p, "HS21LVH > GF66BBJ");
let d = await row("drops", "R1", "HS21LVH");
ok("a DROPS car imported later takes the reg typed on PICKS", (await reg(d)) === "GF66BBJ", await reg(d));
const log = await q(`select action, value from activity where booking_id = $1`, [d]);
ok("logged as REG from PICKS, so later imports keep it", log.length === 1 && log[0].action === "REG" && log[0].value === "HS21LVH > GF66BBJ · from PICKS", log);

p = await row("picks", "R2", "YM65XWH"); await typed(p, "YM65 > YM65XWH");
d = await row("drops", "R2", "TBC");
ok("TBC on the site is replaced too", (await reg(d)) === "YM65XWH", await reg(d));

p = await row("picks", "R3", "LG75XCN");
d = await row("drops", "R3", "KS76AYA");
ok("a PICKS reg nobody changed leaves the site's newer reg", (await reg(d)) === "KS76AYA", await reg(d));

p = await row("picks", "R4", "AB12CDE"); await typed(p, "AB12CD > AB12CDE");
d = await row("drops", "R4", "AB12 CDE");
ok("same reg with a space: left alone, nothing logged", (await reg(d)) === "AB12 CDE" && (await q(`select 1 from activity where booking_id = $1`, [d])).length === 0);

p = await row("picks", "R5", "NEW5REG"); await typed(p, "OLD > NEW5REG");
d = await row("drops", "R5", "OLD", C2);
ok("another company's booking with the same ref is left alone", (await reg(d)) === "OLD");

p = await row("picks", "R6", "NEW6REG"); await typed(p, "OLD > NEW6REG");
await q(`update bookings set removed_at = now() where id = $1`, [p]);
d = await row("drops", "R6", "OLD");
ok("a removed PICKS car is left alone", (await reg(d)) === "OLD");

p = await row("picks", "R7", "NEW7REG", C, "2026-01-01 08:00Z"); await typed(p, "OLD > NEW7REG");
d = await row("drops", "R7", "OLD");
ok("a PICKS car from a stay months before is left alone", (await reg(d)) === "OLD");

p = await row("picks", "", "NEW8REG"); await typed(p, "OLD > NEW8REG");
d = await row("drops", "", "OLD");
ok("no ref: left alone", (await reg(d)) === "OLD");

p = await row("picks", "R9", "NEW9REG"); await typed(p, "OLD > NEW9REG");
const p2 = await row("picks", "R9", "X");
d = await row("picks", "R9", "OLD");
ok("a new PICKS car is not touched", (await reg(d)) === "OLD" && (await reg(p2)) === "X");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
