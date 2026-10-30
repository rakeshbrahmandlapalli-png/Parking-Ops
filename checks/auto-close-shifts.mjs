// Part 140 (a forgotten clock-out closes itself) against throwaway Postgres (PGlite); no live data.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const db = new PGlite();
const part = fs.readFileSync(new URL("../setup/140-auto-close-forgotten-shifts.sql", import.meta.url), "utf8");
const q = async (sql, args) => (await db.query(sql, args)).rows;
let passed = 0, failed = 0;
const check = (name, good, info) => { console.log((good ? "PASS " : "FAIL ") + name + (good || info === undefined ? "" : " " + JSON.stringify(info))); good ? passed++ : failed++; };
await db.exec(`
create role anon; create role authenticated; create schema private;
create table aero_profiles (id uuid primary key, company_id uuid, full_name text);
create table aero_shifts (id uuid primary key default gen_random_uuid(), company_id uuid, user_id uuid, clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz, clock_out_ok boolean, note text not null default '', break_minutes integer not null default 0, break_started_at timestamptz);
create table aero_audit_events (id serial, company_id uuid, actor_id uuid, action text, entity text, entity_id uuid, summary text, details jsonb);
create table activity (id serial, company_id uuid, staff_name text, action text, value text);
create function aero_write_audit_event(c uuid, a uuid, act text, ent text, eid uuid, s text, d jsonb default '{}') returns void language sql set search_path = public as $$
  insert into aero_audit_events(company_id, actor_id, action, entity, entity_id, summary, details) values (c, a, act, ent, eid, s, d) $$;
`);
await db.exec(part);
await db.exec(part); // safe to run again (no pg_cron here, so the timer step is skipped)
const co = crypto.randomUUID(), u = { fresh: crypto.randomUUID(), forgot: crypto.randomUUID(), brk: crypto.randomUUID(), done: crypto.randomUUID(), edge: crypto.randomUUID() };
for (const [k, id] of Object.entries(u)) await q("insert into aero_profiles values ($1,$2,$3)", [id, co, k.toUpperCase()]);
const ago = (h) => `now() - interval '${h} hours'`;
await db.exec(`
insert into aero_shifts(company_id,user_id,clock_in_at) values ('${co}','${u.fresh}',${ago(5)});
insert into aero_shifts(company_id,user_id,clock_in_at) values ('${co}','${u.edge}',${ago(13)});
insert into aero_shifts(company_id,user_id,clock_in_at,note) values ('${co}','${u.forgot}',${ago(20)},'Late start');
insert into aero_shifts(company_id,user_id,clock_in_at,break_started_at) values ('${co}','${u.brk}',now() - interval '15 hours',now() - interval '2 hours');
insert into aero_shifts(company_id,user_id,clock_in_at,clock_out_at,clock_out_ok) values ('${co}','${u.done}',${ago(30)},${ago(22)},true);`);
const n = (await q("select private.aero_auto_close_stale() n"))[0].n;
const shift = async (k) => (await q("select *, extract(epoch from (clock_out_at - clock_in_at))/3600 hrs from aero_shifts where user_id=$1", [u[k]]))[0];
check("two forgotten shifts closed", n === 2, n);
check("a 5-hour shift is left open", (await shift("fresh")).clock_out_at === null);
check("a 13-hour shift is left open (managers are told then)", (await shift("edge")).clock_out_at === null);
const f = await shift("forgot");
check("a 20-hour shift ends exactly 14 hours after clock-in", Math.abs(f.hrs - 14) < 0.001, f.hrs);
check("the location is unknown, the note keeps what was there and says why", f.clock_out_ok === null && /^Late start Closed automatically after 14 hours/.test(f.note) && /Check the hours/.test(f.note), f.note);
const b = await shift("brk");
check("an open break is closed at the cap (started 2 h ago, cap 1 h ago: 60 minutes)", b.break_started_at === null && b.break_minutes === 60, [b.break_started_at, b.break_minutes]);
check("a shift already closed by a person is untouched", (await shift("done")).clock_out_ok === true);
check("audit lines were written, one per shift, no actor", (await q("select count(*)::int n from aero_audit_events where details->>'automatic'='true' and actor_id is null"))[0].n === 2);
check("Parking Ops activity says who and how", (await q("select value from activity where staff_name='Attendance' order by value")).map(r => r.value).join("|") === "BRK was clocked out automatically after 14 hours|FORGOT was clocked out automatically after 14 hours");
check("a second run closes nothing more", (await q("select private.aero_auto_close_stale() n"))[0].n === 0);
check("the cap cannot be set below 12 hours", await q("select private.aero_auto_close_stale(3)").then(() => false, (e) => /12 hours/.test(e.message)));
check("nobody signed in can run it", await (async () => { await db.exec("set role authenticated"); try { await q("select private.aero_auto_close_stale()"); return false; } catch { return true; } finally { await db.exec("reset role"); } })());
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
