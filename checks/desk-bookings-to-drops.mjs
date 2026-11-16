// Setup part 148 (a desk booking reaches its night's DROPS; 15 Nov, MM69HSK) on a
// throwaway in-memory Postgres (PGlite).
//   cd checks && npm install @electric-sql/pglite && node desk-bookings-to-drops.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
await db.exec(`
create table companies (id uuid primary key default gen_random_uuid(), slug text, time_zone text not null default 'Europe/London', drops_day_end time not null default '06:00');
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid, name text);
create table sheets (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, day date, imported_by uuid, imported_at timestamptz not null default now(), source jsonb not null default '{}', unique (company_id, kind, day));
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, sheet_id uuid, kind text, ref text not null default '', reg text not null default '',
  name text not null default '', phone text not null default '', make text not null default '', num int, drop_at timestamptz, return_at timestamptz,
  removed_at timestamptz, cleared_at timestamptz);
create table activity (id bigint generated always as identity primary key, company_id uuid, staff_id uuid, staff_name text not null default '', sheet_id uuid, booking_id uuid, reg text, customer text, action text, value text);
create table who (id uuid);
create function me() returns staff language sql as $$ select s.* from staff s join who w on w.id = s.id limit 1 $$;
create function drops_day_of(p_at timestamptz, c companies) returns date language sql stable as $$
  select (p_at at time zone c.time_zone)::date - case when (p_at at time zone c.time_zone)::time <= c.drops_day_end then 1 else 0 end $$;
create role anon; create role authenticated;
insert into companies(slug) values ('takeoff'), ('apb');
insert into staff(company_id, name) select id, 'AASHISH' from companies where slug = 'takeoff';
`);
const part = fs.readFileSync(new URL("../setup/148-desk-bookings-to-drops.sql", import.meta.url), "utf8");
await db.exec(part); await db.exec(part); // safe to run twice
const q = async (s) => (await db.query(s)).rows;
let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
const tonight = (await q(`select (case when (now() at time zone 'Europe/London')::time <= '06:00' then (now() at time zone 'Europe/London')::date - 1
  else (now() at time zone 'Europe/London')::date end)::text d`))[0].d;
const night = (n) => { const t = new Date(tonight + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const co = (slug = "takeoff") => `(select id from companies where slug='${slug}')`;
const at = (n, hm) => `('${night(n)} ${hm}'::timestamp at time zone 'Europe/London')`;
const pick = async (ref, reg, n, hm = "17:00", how = "new booking at the desk", slug = "takeoff") => {
  const id = (await q(`insert into bookings(company_id, kind, ref, reg, name, drop_at, return_at) values (${co(slug)}, 'picks', '${ref}', '${reg}', 'Mr T', now() - interval '3 days', ${at(n, hm)}) returning id`))[0].id;
  if (how) await db.exec(`insert into activity(booking_id, action, value) values ('${id}', 'ADDED', '${how}')`);
  return id;
};
// An import: the sheet is made or touched, then the file's cars go on it, all in one transaction.
const imp = async (n, rows = [], slug = "takeoff") => db.transaction(async (tx) => {
  const sh = (await tx.query(`insert into sheets(company_id, kind, day) values (${co(slug)}, 'drops', '${night(n)}')
    on conflict (company_id, kind, day) do update set imported_at = now() returning id`)).rows[0].id;
  for (const r of rows) await tx.query(`insert into bookings(company_id, sheet_id, kind, ref, reg, drop_at, return_at, num) values (${co(slug)}, '${sh}', 'drops', '${r.ref}', '${r.reg}', now() - interval '3 days', ${at(n, "17:00")}, 1)`);
  const mid = (await tx.query(`select count(*)::int n from bookings where sheet_id = '${sh}'`)).rows[0].n;
  return { sh, mid };
});
const drops = (reg, slug = "takeoff") => q(`select s.day::text as day, b.ref from bookings b join sheets s on s.id = b.sheet_id where b.kind = 'drops' and b.reg = '${reg}' and b.company_id = ${co(slug)}`);

// 1. MM69HSK: a desk booking back tonight; tonight's import doesn't have it.
await pick("L4PUK-1367729", "MM69HSK", 0);
const r1 = await imp(0, [{ ref: "SITE1", reg: "AB12CDE" }]);
let d = await drops("MM69HSK");
ok("1. added to tonight's DROPS when the sheet is imported", d.length === 1 && d[0].day === night(0), d);
ok("1. only at the end of the import (not before the file's cars)", r1.mid === 1, r1);
const line = (await q(`select staff_name, value from activity where action = 'ADDED' and value like 'from PICKS%'`))[0];
ok("1. logged ADDED from PICKS, System with nobody signed in", line && line.staff_name === "System" && /^from PICKS: desk booking, back /.test(line.value), line);
await imp(0);
ok("1. a re-import doesn't add it twice", (await drops("MM69HSK")).length === 1);

// 2. The file has the same car under another ref: matched by reg, no second car.
await pick("APB-2623", "KV10CPE", 1, "19:00", "new booking at the desk", "apb");
await imp(1, [{ ref: "VIP APB-2623", reg: "KV10CPE" }], "apb");
d = await drops("KV10CPE", "apb");
ok("2. same reg in the file under another ref: no second car", d.length === 1 && d[0].ref === "VIP APB-2623", d);

// 3. Imported cars (no desk ADDED line) are never added; nor a removed PICKS car; nor another night's.
await pick("SITE9", "CD34EFG", 2, "17:00", null);
const gone = await pick("D3", "EF56GHI", 2); await db.exec(`update bookings set removed_at = now() where id = '${gone}'`);
await pick("D4", "GH78IJK", 3);
await db.exec(`insert into who select id from staff`);
await imp(2);
ok("3. an imported PICKS car is left to the import", (await drops("CD34EFG")).length === 0);
ok("3. a removed PICKS car is not added", (await drops("EF56GHI")).length === 0);
ok("3. a car back another night is not added", (await drops("GH78IJK")).length === 0);

// 4. Back before 06:00 counts as the night before; added by hand counts too; the signed-in name logged.
await pick("D5", "IJ90KLM", 4, "03:00", "added by hand");
await imp(3);
d = await drops("IJ90KLM");
ok("4. 03:00 return goes on the night before", d.length === 1 && d[0].day === night(3), d);
ok("4. logged as the person importing", (await q(`select staff_name from activity a join bookings b on b.id = a.booking_id where b.kind = 'drops' and b.reg = 'IJ90KLM'`))[0].staff_name === "AASHISH");
ok("4. GH78IJK (back night +3) added with that night", (await drops("GH78IJK")).length === 1);

// 5. A DROPS car removed on purpose stops it coming back.
const p6 = await pick("D6", "KL12MNO", 5);
const old = (await q(`insert into sheets(company_id, kind, day) values (${co()}, 'drops', '${night(4)}') returning id`))[0].id;
await db.exec(`insert into bookings(company_id, sheet_id, kind, ref, reg, drop_at, return_at, removed_at) values (${co()}, '${old}', 'drops', 'D6', 'KL12MNO', now() - interval '3 days', ${at(5, "17:00")}, now())`);
await imp(5);
ok("5. removed DROPS car: not added again", (await drops("KL12MNO")).length === 1);

// 6. A past night's sheet re-imported adds nothing; a PICKS sheet does nothing.
await pick("D7", "MN34OPQ", -2);
await imp(-2);
ok("6. a past night adds nothing", (await drops("MN34OPQ")).length === 0);

// 7. Another client's sheet never takes this client's car.
await pick("D8", "OP56QRS", 6);
await imp(6, [], "apb");
ok("7. other client's sheet: nothing", (await drops("OP56QRS", "apb")).length === 0 && (await drops("OP56QRS")).length === 0);

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
