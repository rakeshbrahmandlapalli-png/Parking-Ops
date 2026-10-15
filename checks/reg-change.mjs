// Setup part 92 (a changed reg reaches the booking's other row) on PGlite.
//   cd checks && npm install @electric-sql/pglite && node reg-change.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const sql = fs.readFileSync(new URL("../setup/92-reg-change-reaches-other-row.sql", import.meta.url), "utf8");
const setRegOnly = sql.slice(0, sql.indexOf("create or replace function import_sheet_core"));
const db = new PGlite();
await db.exec(`
create table staff (id uuid primary key default gen_random_uuid(), name text);
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, ref text not null default '', reg text not null default '', name text not null default '', removed_at timestamptz, updated_at timestamptz);
create table activity (id bigint generated always as identity primary key, company_id uuid, booking_id uuid, reg text, action text, value text);
create function me() returns staff language sql as $$ select null::staff $$;
create function can(p text) returns boolean language sql as $$ select true $$;
create function booking_for_update(p uuid) returns bookings language sql as $$ select * from bookings where id = p for update $$;
create function log_activity(p_booking bookings, p_action text, p_value text) returns void language sql as $$
  insert into activity(company_id, booking_id, reg, action, value) values (p_booking.company_id, p_booking.id, p_booking.reg, p_action, p_value) $$;
create role anon; create role authenticated;
`);
await db.exec(setRegOnly); await db.exec(setRegOnly); // twice
const q = async (s) => (await db.query(s)).rows;
let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
const row = (kind, ref, reg) => db.exec(`insert into bookings(company_id, kind, ref, reg) values ('00000000-0000-0000-0000-000000000001','${kind}','${ref}','${reg}')`);
const id = async (kind, ref) => (await q(`select id from bookings where kind='${kind}' and ref='${ref}'`))[0].id;
const reg = async (kind, ref) => (await q(`select reg from bookings where kind='${kind}' and ref='${ref}'`))[0].reg;

await row("picks", "R1", "MY26GAU"); await row("drops", "R1", "MY26GAU");
await db.query(`select set_reg($1, ' mt26gau ')`, [await id("picks", "R1")]);
ok("PICKS edit reaches the DROPS car with the same ref", (await reg("drops", "R1")) === "MT26GAU", await reg("drops", "R1"));
const log = await q(`select a.action, a.value, b.kind from activity a join bookings b on b.id = a.booking_id order by a.id`);
ok("both rows log OLD > NEW", log.length === 2 && log.every((l) => l.action === "REG" && l.value.startsWith("MY26GAU > MT26GAU")), log);

await row("picks", "R2", "AA11AAA"); await row("drops", "R2", "ZZ99ZZZ");
await db.query(`select set_reg($1, 'BB22BBB')`, [await id("picks", "R2")]);
ok("a DROPS car with a different reg is left alone", (await reg("drops", "R2")) === "ZZ99ZZZ");

await row("picks", "R3", "CC33CCC"); await row("drops", "R3", "CC33 CCC");
await db.query(`select set_reg($1, 'DD44DDD')`, [await id("drops", "R3")]);
ok("works the other way, spaces ignored", (await reg("picks", "R3")) === "DD44DDD");

await row("picks", "R4", ""); await row("drops", "R4", "");
await db.query(`select set_reg($1, 'EE55EEE')`, [await id("picks", "R4")]);
ok("a blank other row is still filled", (await reg("drops", "R4")) === "EE55EEE");

await row("picks", "R5", "FF66FFF"); await row("drops", "R5", "FF66FFF");
await db.exec(`update bookings set removed_at = now() where kind='drops' and ref='R5'`);
await db.query(`select set_reg($1, 'GG77GGG')`, [await id("picks", "R5")]);
ok("a removed booking is left alone", (await reg("drops", "R5")) === "FF66FFF");

ok("import keeps a reg changed in the app", /keep_reg := exists \(select 1 from activity where booking_id = existing.id and action = 'REG'\)/.test(sql) && /if keep_reg then r := r - 'reg'/.test(sql));
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
