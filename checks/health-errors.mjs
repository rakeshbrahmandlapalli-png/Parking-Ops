// Setup part 100 (phone error reports, System health) on a throwaway in-memory
// Postgres (PGlite), with just the tables the functions read and pretend cron
// and pg_net tables.
//   cd checks && npm install @electric-sql/pglite && node health-errors.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema private; create schema cron; create schema net;
create table companies (id uuid primary key default gen_random_uuid(), name text, slug text, suspended_at timestamptz);
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid references companies(id), name text, role text, active boolean default true);
create table flight_runs (id bigint generated always as identity primary key, company_id uuid, at timestamptz default now(), source text, trigger text, result jsonb);
create table activity (id bigint generated always as identity primary key, company_id uuid, at timestamptz default now());
create table push_subscriptions (id uuid primary key default gen_random_uuid(), staff_id uuid, company_id uuid);
create table staff_seen (staff_id uuid primary key, company_id uuid, seen_at timestamptz default now());
create table private.settings (name text primary key, value text);
create table private.backups (id bigint generated always as identity primary key, taken_at timestamptz);
create table private.imports (id bigint generated always as identity primary key, company_id uuid, at timestamptz);
create table private.auto_import (company_id uuid primary key, enabled boolean, last_run timestamptz, last_ok timestamptz, last_error text);
create table cron.job (jobid bigint generated always as identity primary key, jobname text unique, schedule text, command text, active boolean default true);
create table cron.job_run_details (runid bigint generated always as identity primary key, jobid bigint, status text, start_time timestamptz, end_time timestamptz, return_message text);
create table net._http_response (id bigint generated always as identity primary key, status_code int, error_msg text, created timestamptz default now());
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule returning jobid $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
create table private.who (staff_id uuid, admin boolean);
insert into private.who values (null, false);
create function me() returns staff language sql as $$ select s.* from staff s where s.id = (select staff_id from private.who) $$;
create function is_platform_admin() returns boolean language sql as $$ select admin from private.who $$;
insert into companies(name, slug) values ('Parking Ops', 'platform'), ('TAKEOFF', 'takeoff'), ('Airport Parking Bay', 'airport-parking-bay');
insert into staff(company_id, name, role) select id, 'Owner P', 'owner' from companies where slug = 'platform';
insert into staff(company_id, name, role) select id, 'RAKESH', 'owner' from companies where slug = 'takeoff';
insert into staff(company_id, name, role) select id, 'ZAIN', 'owner' from companies where slug = 'takeoff';
insert into staff(company_id, name, role) select id, 'DRIVER', 'bongo' from companies where slug = 'airport-parking-bay';
insert into private.backups(taken_at) values (now() - interval '5 hours');
insert into cron.job(jobname, schedule) values ('takeoff-flights', '* * * * *');
insert into private.settings values ('timer_secret', 'x');
`);
const sql = fs.readFileSync(new URL("../setup/100-health-and-errors.sql", import.meta.url), "utf8");
await db.exec(sql);
await db.exec(sql); // safe to run twice
const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
const as = (name, admin = false) => db.query(`update private.who set staff_id = (select id from staff where name = '${name}'), admin = ${admin}`);
const report = (list, dev = "Android 14 · Chrome", ver = "abc123") => one(`select report_errors('${JSON.stringify(list).replace(/'/g, "''")}'::jsonb, '${dev}', '${ver}') n`);

// 1. errors from a phone
await as("DRIVER");
let r = await report([{ m: "TypeError: x is undefined", view: "board" }, { m: "TypeError: x is undefined", view: "board" }, { m: "Other", view: "flights" }]);
let rows = await q("select message, view, n, device, version from private.client_errors order by id");
ok("the same message on the same screen within an hour is one line with a count", rows.length === 2 && rows[0].n === 2 && rows[1].message === "Other" && r.n === 3, rows);
ok("phone and app version are kept", rows[0].device === "Android 14 · Chrome" && rows[0].version === "abc123", rows[0]);
ok("the line belongs to the sender's company", (await one(`select count(*)::int c from private.client_errors e join companies c on c.id = e.company_id where c.slug = 'airport-parking-bay'`)).c === 2);
await db.query(`update private.client_errors set last_at = now() - interval '2 hours'`);
await report([{ m: "TypeError: x is undefined", view: "board" }]);
ok("over an hour later: a new line", (await one("select count(*)::int c from private.client_errors")).c === 3);
await report([{ m: "", view: "x" }, { m: "   " }]);
ok("empty messages are ignored", (await one("select count(*)::int c from private.client_errors")).c === 3);
await report([{ m: "x".repeat(900), view: "v".repeat(90) }]);
const long = await one("select length(message) m, length(view) v from private.client_errors order by id desc limit 1");
ok("long messages and screens are cut short", long.m === 300 && long.v === 40, long);
await report(Array.from({ length: 80 }, (_, i) => ({ m: "loop " + i })));
ok("at most 20 a call", (await one("select count(*)::int c from private.client_errors where message like 'loop %'")).c === 20);
for (let k = 0; k < 5; k++) await report(Array.from({ length: 20 }, (_, i) => ({ m: "more " + k + "-" + i })));
ok("at most 60 new lines a day per person", (await one("select count(*)::int c from private.client_errors where first_at > now() - interval '1 day'")).c === 60);
await db.query("update private.who set staff_id = null");
ok("not signed in: nothing is saved", (await report([{ m: "anon" }])).n === 0);

// 2. Health: only the product owner
await as("RAKESH");
let denied = false; try { await q("select admin_health()"); } catch (e) { denied = /Not allowed/.test(e.message); }
ok("a client owner can't read System health", denied);
await as("Owner P", true);
let h = (await one("select admin_health() h")).h;
ok("System health lists the clients, not the platform", h.clients.map((c) => c.name).sort().join() === "Airport Parking Bay,TAKEOFF", h.clients.map((c) => c.name));
const apb = h.clients.find((c) => c.name === "Airport Parking Bay");
ok("phone errors per client, with who and which phone", apb.errors_24h > 60 && apb.errors.length === 25 && apb.errors[0].who === "DRIVER", apb);
ok("timers listed with their last run", h.timers.some((t) => t.name === "health-warning" && t.schedule === "*/15 * * * *") && h.timers.some((t) => t.name === "health-trim"), h.timers);
ok("over 20 phone errors in the last hour: the one warning", h.warnings.length === 1 && /errors:Airport Parking Bay/.test(h.warnings[0].key), h.warnings);

// 3. Warnings
await db.query("delete from private.client_errors");
const w = async () => (await one("select health_warnings_list() w")).w.map((x) => x.key).sort();
ok("all well: no warnings", (await w()).length === 0, await w());
await db.query("update private.backups set taken_at = now() - interval '31 hours'");
ok("no backup for 30 hours", (await w()).includes("backup"));
await db.query("update private.backups set taken_at = now() - interval '2 hours'");
await db.query(`insert into cron.job_run_details(jobid, status, start_time, end_time, return_message) select jobid, 'failed', now() - interval '3 minutes', now(), 'boom' from cron.job where jobname = 'takeoff-flights'`);
ok("a timer that failed on its last run", (await w()).includes("timer:takeoff-flights"));
await db.query(`insert into cron.job_run_details(jobid, status, start_time, end_time) select jobid, 'succeeded', now() - interval '1 minute', now() from cron.job where jobname = 'takeoff-flights'`);
ok("…and not once it runs again", !(await w()).includes("timer:takeoff-flights"));
await db.query("insert into net._http_response(status_code) select 500 from generate_series(1, 4)");
ok("4 failed function calls in 30 minutes: not yet", !(await w()).includes("calls"));
await db.query("insert into net._http_response(status_code, error_msg) values (null, 'Timeout')");
ok("5 failed function calls: warned", (await w()).includes("calls"));
await db.query("delete from net._http_response");
const co = (slug) => `(select id from companies where slug = '${slug}')`;
await db.query(`insert into flight_runs(company_id, source, result) select ${co("takeoff")}, 'schedule', '{"calls": 3}' from generate_series(1, 5000)`);
ok("AeroDataBox under 80%: quiet", !(await w()).some((k) => k.startsWith("aerodata")));
await db.query(`insert into flight_runs(company_id, source, result) select ${co("airport-parking-bay")}, 'schedule', '{"calls": 3}' from generate_series(1, 400)`);
const ad = (await one("select private.aerodata_month() a")).a;
ok("AeroDataBox at 81% (16,200 calls × 2 units of 40,000): warned", (await w()).includes("aerodata:80") && ad.units === 32400 && ad.pct === 81, ad);
h = (await one("select admin_health() h")).h;
ok("calls per client this month", h.clients.find((c) => c.name === "TAKEOFF").aerodata_calls_month === 15000, h.clients);
await db.query(`insert into flight_runs(company_id, source, result) values (${co("takeoff")}, 'schedule', '{"error": "AeroDataBox 429: quota exceeded"}')`);
ok("quota used up: that warning instead of 80%", (await w()).includes("aerodata:quota") && !(await w()).includes("aerodata:80"));
await db.query("delete from flight_runs");
await db.query(`insert into private.auto_import values (${co("takeoff")}, true, now() - interval '10 minutes', now() - interval '1 day', 'Sign-in failed')`);
ok("scheduled import failed", (await w()).includes("import:TAKEOFF"));
await db.query(`update private.auto_import set last_ok = now()`);
ok("…and not once it works", !(await w()).includes("import:TAKEOFF"));
await as("DRIVER");
for (let i = 0; i < 20; i++) await report([{ m: "same", view: "board" }]);
ok("20 phone errors in an hour at one client: warned", (await w()).includes("errors:Airport Parking Bay"));

// 4. Who is told
const hs = (await one("select health_status() h")).h;
const names = (await q(`select name from staff where id::text in (select jsonb_array_elements_text('${JSON.stringify(hs.to)}'::jsonb))`)).map((x) => x.name).sort();
ok("only the platform owner unless more are listed", names.join() === "Owner P", names);
await db.query(`insert into private.settings values ('health_alert_staff', (select id::text from staff where name = 'RAKESH'))`);
const names2 = (await q(`select name from staff where id::text in (select jsonb_array_elements_text((health_status())->'to'))`)).map((x) => x.name).sort();
ok("plus the listed logins (not the other TakeOff owner)", names2.join() === "Owner P,RAKESH", names2);

// 5. Failed pushes
await db.query(`select note_push_failure(${co("takeoff")}, 500, 'Server error')`);
await as("Owner P", true);
h = (await one("select admin_health() h")).h;
ok("failed pushes counted", h.push_failed_24h === 1, h.push_failed_24h);

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
