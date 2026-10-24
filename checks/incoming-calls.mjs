// Setup part 115 (incoming calls) on a throwaway in-memory Postgres (PGlite), on top of part 114.
//   cd checks && npm install @electric-sql/pglite && node incoming-calls.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";

let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema private; create schema net; create schema cron; create schema extensions;
create table private.settings (name text primary key, value text);
create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) returns bigint language sql as $$ select 1::bigint $$;
create table cron.job (jobname text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ select 1::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as $$ select true $$;
create table companies (id uuid primary key default gen_random_uuid(), name text, slug text unique, yards text[], drops_day_end time default '06:00', time_zone text default 'Europe/London', brand jsonb not null default '{}');
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid, name text, role text, acting text not null default '');
create table sheets (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, day date);
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, sheet_id uuid, kind text, reg text default '', name text default '', phone text default '',
  return_at timestamptz, drop_at timestamptz, flight_status text default '', sent_at timestamptz, cleared_at timestamptz, removed_at timestamptz,
  called_word text default '', called_at timestamptz, called_by uuid, pick_called text default '', pick_called_at timestamptz, intake text default '');
create table activity (id bigint generated always as identity primary key, company_id uuid, sheet_id uuid, booking_id uuid, reg text, customer text, staff_id uuid, staff_name text, action text, value text);
create table cur (staff_id uuid);
create function me() returns staff language sql as $$ select s.* from staff s join cur on cur.staff_id = s.id $$;
create function my_company() returns uuid language sql as $$ select company_id from me() $$;
create function is_platform_admin() returns boolean language sql as $$ select (select role from me()) = 'platform' $$;
create function can(x text) returns boolean language sql as $$ select (select role from me()) in ('owner', 'office') $$;
create function drops_day_of(p_at timestamptz, c companies) returns date language sql stable as $$
  select (p_at at time zone c.time_zone)::date - case when (p_at at time zone c.time_zone)::time <= c.drops_day_end then 1 else 0 end $$;
insert into companies(name, slug, yards, brand) values ('TAKEOFF', 'takeoff', '{S}', '{"short":"TakeOff"}'), ('Parking Ops', 'platform', '{X}', '{}');
insert into staff(company_id, name, role) select id, 'RAKESH', 'owner' from companies where slug = 'takeoff';
insert into staff(company_id, name, role, acting) select id, 'OFFICE', 'office', 'KAMU' from companies where slug = 'takeoff';
insert into staff(company_id, name, role) select id, 'ALI', 'bongo' from companies where slug = 'takeoff';
insert into staff(company_id, name, role) select id, 'ADMIN', 'platform' from companies where slug = 'platform';
`);
for (const f of ["115-customer-texts.sql", "115b-customer-texts-fk.sql", "116-incoming-calls.sql", "116-incoming-calls.sql"]) await db.exec(fs.readFileSync(new URL("../setup/" + f, import.meta.url), "utf8"));
const q = async (s, p) => (await db.query(s, p)).rows;
const as = (name) => db.exec(`delete from cur; insert into cur select id from staff where name = '${name}'`);
const err = async (s, p) => { try { await db.query(s, p); return ""; } catch (e) { return e.message; } };
const co = (await q(`select id from companies where slug = 'takeoff'`))[0].id;
const C = { on: true, number: "0161 850 0000", ring: ["07700 900123"], auto: "off", from: "20:00", to: "02:00", words: "" };

await as("RAKESH");
ok("set_calls refused without the add-on", /aren't switched on/.test(await err(`select set_calls($1)`, [C])));
await as("ADMIN");
await q(`select admin_save_client($1)`, [{ id: co, name: "TAKEOFF", yards: ["S"], brand: { short: "TakeOff", texts: true, calls: true } }]);
const br = (await q(`select brand from companies where id = $1`, [co]))[0].brand;
ok("Platform: Calls add-on saved, texts kept", br.calls === true && br.texts === true);
ok("Platform: activity names Calls on", /Customer texts on, Calls on/.test((await q(`select value from activity order by id desc limit 1`))[0].value));
await as("OFFICE");
ok("set_calls: office refused", /Only an owner/.test(await err(`select set_calls($1)`, [C])));
await as("RAKESH");
ok("set_calls: on without a number to ring refused", /at least one number/.test(await err(`select set_calls($1)`, [{ ...C, ring: [] }])));
ok("set_calls: 4 numbers refused", /Up to 3/.test(await err(`select set_calls($1)`, [{ ...C, ring: ["07700900121", "07700900122", "07700900123", "07700900124"] }])));
ok("set_calls: a bad number refused", /Check the numbers/.test(await err(`select set_calls($1)`, [{ ...C, ring: ["123"] }])));
ok("set_calls: auto between times needs times", /starts and stops/.test(await err(`select set_calls($1)`, [{ ...C, auto: "times", from: "8pm" }])));
const saved = (await q(`select set_calls($1) c`, [C]))[0].c;
ok("set_calls: saved", saved.on === true && saved.ring[0] === "07700 900123" && saved.auto === "off");
ok("set_calls: activity line", /^Calls on: ring 07700 900123, auto-answer off$/.test((await q(`select value from activity order by id desc limit 1`))[0].value));

// Tonight's DROPS and today's PICKS, by London time.
const today = (await q(`select (now() at time zone 'Europe/London')::date::text d`))[0].d;
const dday = (await q(`select drops_day_of(now(), c)::text d from companies c where id = $1`, [co]))[0].d;
const ds = (await q(`insert into sheets(company_id, kind, day) values ($1, 'drops', $2) returning id`, [co, dday]))[0].id;
const ps = (await q(`insert into sheets(company_id, kind, day) values ($1, 'picks', $2) returning id`, [co, today]))[0].id;
const old = (await q(`insert into sheets(company_id, kind, day) values ($1, 'drops', '2026-01-01') returning id`, [co]))[0].id;
const car = async (sheet, kind, reg, phone) => (await q(`insert into bookings(company_id, sheet_id, kind, reg, name, phone, return_at, drop_at) values ($1, $2, $3, $4, 'KHAIRA MS', $5, now(), now()) returning id`, [co, sheet, kind, reg, phone]))[0].id;
await car(old, "drops", "OLD1", "07868 615571");
const d1 = await car(ds, "drops", "DR1", "7868615571 7868615571");
const p1 = await car(ps, "picks", "PK1", "07868615571");
const p2 = await car(ps, "picks", "PK2", "+44 7911 123456");

const r1 = (await q(`select call_in('+441618500000', '+447868615571', 'CA1') r`))[0].r;
ok("call_in: the client found by the number called", r1.company === co && r1.name === "TakeOff" && r1.ring[0] === "07700 900123");
ok("call_in: the caller's DROPS car tonight comes first (not an old sheet's)", r1.booking && r1.booking.id === d1 && r1.booking.kind === "drops");
ok("call_in: auto-answer off", r1.auto === false);
ok("call_in: the call is written for the pop-up", (await q(`select status, reg, kind from customer_calls where sid = 'CA1'`))[0].reg === "DR1");
const r2 = (await q(`select call_in('01618500000', '07911123456', 'CA2') r`))[0].r;
ok("call_in: a PICKS customer today", r2.booking && r2.booking.id === p2 && r2.booking.kind === "picks");
const r3 = (await q(`select call_in('01618500000', '07000000001', 'CA3') r`))[0].r;
ok("call_in: an unknown caller is still written, with no car", r3.booking === null && (await q(`select booking_id from customer_calls where sid = 'CA3'`))[0].booking_id === null);
ok("call_in: another number isn't this client", (await q(`select call_in('01610000000', '07868615571', 'CA4') r`))[0].r.company === null);
ok("call_in: Twilio asking twice writes one call", (await q(`select call_in('01618500000', '07868615571', 'CA1') r`))[0].r.call === r1.call && (await q(`select count(*)::int n from customer_calls where sid = 'CA1'`))[0].n === 1);

// Auto-answer: 1 marks the DROPS car CALLED, 2 the PICKS car; a CALLED push follows from the bookings trigger.
await as("RAKESH"); await q(`select set_calls($1)`, [{ ...C, auto: "on" }]);
ok("call_in: auto-answer on", (await q(`select call_in('01618500000', '07868615571', 'CA5') r`))[0].r.auto === true);
const m1 = (await q(`select call_digit('CA5', '1') r`))[0].r;
const b1 = (await q(`select called_word, called_at is not null c from bookings where id = $1`, [d1]))[0];
ok("call_digit 1: the DROPS car is CALLED", m1.marked === "CALLED" && b1.c && b1.called_word === "Called");
ok("call_digit 1: activity says the customer pressed 1", /pressed 1: landed/.test((await q(`select staff_name, value from activity where action = 'CALLED' order by id desc limit 1`))[0].value));
ok("call_digit 1 again: already", (await q(`select call_digit('CA5', '1') r`))[0].r.marked === "already");
await q(`select call_in('01618500000', '07868615571', 'CA6')`);
const m2 = (await q(`select call_digit('CA6', '2') r`))[0].r;
ok("call_digit 2: their PICKS car is CALLED", m2.marked === "CALLED" && (await q(`select pick_called from bookings where id = $1`, [p1]))[0].pick_called === "Called");
await q(`select call_in('01618500000', '07000000001', 'CA7')`);
ok("call_digit: an unknown caller pressing 1 marks nothing", (await q(`select call_digit('CA7', '1') r`))[0].r.marked === "");
await as("RAKESH"); await q(`select set_calls($1)`, [{ ...C, auto: "times", from: "00:00", to: "00:00" }]);
ok("call_in: between 00:00 and 00:00 is never", (await q(`select call_in('01618500000', '07868615571', 'CA8') r`))[0].r.auto === false);

// How it ended.
await q(`select call_end('CA1', 'completed', 72)`); await q(`select call_end('CA3', 'no-answer', 0)`); await q(`select call_end('CA5', 'no-answer', 0)`);
const st = Object.fromEntries((await q(`select sid, status, seconds from customer_calls`)).map((r) => [r.sid, r]));
ok("call_end: answered with how long", st.CA1.status === "answered" && st.CA1.seconds === 72);
ok("call_end: not answered is missed", st.CA3.status === "missed");
ok("call_end: not answered but the car was marked is auto, not missed", st.CA5.status === "auto");

// I've got it / Called back: office only, with the picked name.
await as("ALI");
ok("call_take: a driver can't", /Not allowed/.test(await err(`select call_take($1)`, [r3.call])));
await as("OFFICE");
const t = (await q(`select (call_take($1)).handled_name n`, [r3.call]))[0].n;
ok("call_take: the shared login's picked name", t === "KAMU");
ok("call_take: activity Called back", /^Called back 07000000001$/.test((await q(`select value from activity where action = 'CALL' order by id desc limit 1`))[0].value));
ok("Only the server can call call_in", !(await q(`select has_function_privilege('authenticated', 'call_in(text,text,text)', 'execute') p`))[0].p);

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
