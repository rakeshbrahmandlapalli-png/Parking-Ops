// Setup part 114 (customer texts) on a throwaway in-memory Postgres (PGlite), and
// send-texts' words and numbers (supabase/functions/send-texts/texts.mjs).
//   cd checks && npm install @electric-sql/pglite && node customer-texts.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import { ukMobile, customerName, fillText, textParts, londonNow, nextDay } from "../supabase/functions/send-texts/texts.mjs";

let fails = 0; const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };

// ── the words and the number ──
ok("UK mobile: 07 number", ukMobile("07868 615571") === "+447868615571");
ok("UK mobile: +44 and 0044", ukMobile("+44 7868 615571") === "+447868615571" && ukMobile("0044 7868615571") === "+447868615571");
ok("UK mobile: no leading 0", ukMobile("7868615571") === "+447868615571");
ok("UK mobile: two numbers run together take the first", ukMobile("7868615571 7868615571") === "+447868615571");
ok("UK mobile: a landline is never texted", ukMobile("0161 496 0000") === "" && ukMobile("") === "" && ukMobile("+33 6 12 34 56 78") === "");
ok("Name: KHAIRA MS → Ms Khaira", customerName("KHAIRA MS") === "Ms Khaira");
ok("Name: MR JOHN SMITH → Mr Smith", customerName("MR JOHN SMITH") === "Mr Smith");
ok("Name: SARAH JONES as given", customerName("SARAH JONES") === "Sarah Jones");
ok("Name: none → there", customerName("") === "there" && customerName("MS") === "Ms");
const cfg = { sender: "TAKEOFF", office: "0161 496 0000", meet: "Terminal 2", landed: { on: true, text: "Hi {name}, call {office} for {reg} at {meet}. {company} {unknown}" } };
ok("Words filled in, unknown left as typed", fillText("landed", { name: "KHAIRA MS", reg: "AB12CDE" }, cfg, "TakeOff") === "Hi Ms Khaira, call 0161 496 0000 for AB12CDE at Terminal 2. TAKEOFF {unknown}");
ok("Reminder: the drop-off date and time in London", fillText("reminder", { name: "A B", reg: "X", drop_at: "2026-10-20T04:30:00Z" }, { meet: "T2", office: "1" }, "Co").includes("Tue 20 Oct at 05:30"));
ok("Parts: 160 is one text, 161 is two", textParts("x".repeat(160)) === 1 && textParts("x".repeat(161)) === 2 && textParts("x".repeat(307)) === 3);
ok("London now and the next day", /^\d{4}-\d\d-\d\d$/.test(londonNow().day) && nextDay("2026-10-31") === "2026-11-01");

// ── the database part ──
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema private; create schema net; create schema cron; create schema extensions;
create schema vault; create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text, name text, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(s text, n text, d text) returns uuid language sql as $$ insert into vault.secrets(secret, name, description) values (s, n, d) returning id $$;
create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret = s where id = i $$;
create function extensions.gen_random_bytes(n int) returns bytea language sql as $$ select substring(sha256(random()::text::bytea) || sha256(random()::text::bytea) from 1 for n) $$;
create function extensions.digest(t text, a text) returns bytea language sql as $$ select sha256(t::bytea) $$;
create table private.settings (name text primary key, value text); insert into private.settings values ('timer_secret', 'tick');
create table net.calls (url text, body jsonb, headers jsonb);
create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) returns bigint language sql as $$ insert into net.calls values (url, body, headers); select 1::bigint $$;
create table cron.job (jobname text, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job values (n, s, c); select 1::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as $$ update cron.job set jobname = '-' where jobname = n; select true $$;
create table companies (id uuid primary key default gen_random_uuid(), name text, slug text unique, yards text[], drops_day_end time default '06:00', time_zone text, brand jsonb not null default '{}');
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid, name text, role text);
create table sheets (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, day date);
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, sheet_id uuid, kind text, reg text default '', phone text default '',
  flight_status text default '', sent_at timestamptz, cleared_at timestamptz, removed_at timestamptz);
create table activity (id bigint generated always as identity primary key, company_id uuid, staff_id uuid, staff_name text, action text, value text);
create table cur (staff_id uuid);
create function me() returns staff language sql as $$ select s.* from staff s join cur on cur.staff_id = s.id $$;
create function my_company() returns uuid language sql as $$ select company_id from me() $$;
create function is_platform_admin() returns boolean language sql as $$ select (select role from me()) = 'platform' $$;
insert into companies(name, slug, yards, brand) values ('TAKEOFF', 'takeoff', '{S}', '{"theme":"stdplus","collections":true}'), ('Parking Ops', 'platform', '{X}', '{}');
insert into staff(company_id, name, role) select id, 'RAKESH', 'owner' from companies where slug = 'takeoff';
insert into staff(company_id, name, role) select id, 'KAMU', 'office' from companies where slug = 'takeoff';
insert into staff(company_id, name, role) select id, 'ADMIN', 'platform' from companies where slug = 'platform';
`);
const sql = fs.readFileSync(new URL("../setup/114-customer-texts.sql", import.meta.url), "utf8");
await db.exec(sql); await db.exec(sql); // safe to run twice
await db.exec(fs.readFileSync(new URL("../setup/114b-customer-texts-fk.sql", import.meta.url), "utf8"));
await db.exec(fs.readFileSync(new URL("../setup/114b-customer-texts-fk.sql", import.meta.url), "utf8"));
const q = async (s, p) => (await db.query(s, p)).rows;
const as = (name) => db.exec(`delete from cur; insert into cur select id from staff where name = '${name}'`);
const err = async (s, p) => { try { await db.query(s, p); return ""; } catch (e) { return e.message; } };
const co = (await q(`select id from companies where slug = 'takeoff'`))[0].id;
const P = { on: true, sender: "TAKEOFF", office: "0161 496 0000", meet: "Terminal 2", at: "18:00", landed: { on: true, text: "Landed {name}" }, sent: { on: false, text: "Sent {reg}" }, reminder: { on: true, text: "Remind" } };

ok("Two timers never: one reminder job", (await q(`select count(*)::int n from cron.job where jobname = 'customer-text-reminders'`))[0].n === 1);
await as("RAKESH");
ok("set_texts refused without the add-on", /aren't switched on/.test(await err(`select set_texts($1)`, [P])));
await as("ADMIN");
await q(`select admin_save_client($1)`, [{ id: co, name: "TAKEOFF", yards: ["S"], brand: { theme: "stdplus", collections: true, texts: true } }]);
ok("Platform: the add-on saved as true, other switches kept", (await q(`select brand from companies where id = $1`, [co]))[0].brand.texts === true && (await q(`select brand from companies where id = $1`, [co]))[0].brand.collections === true);
ok("Platform: the activity line names Customer texts on", /Customer texts on/.test((await q(`select value from activity order by id desc limit 1`))[0].value));
await as("KAMU");
ok("set_texts: office refused", /Only an owner/.test(await err(`select set_texts($1)`, [P])));
await as("RAKESH");
ok("set_texts: sender over 11 letters refused", /11 letters/.test(await err(`select set_texts($1)`, [{ ...P, sender: "TAKEOFFPARKING" }])));
ok("set_texts: on with no office number refused", /office number/.test(await err(`select set_texts($1)`, [{ ...P, office: "" }])));
ok("set_texts: a reminder at 03:00 refused", /08:00 and 21:00/.test(await err(`select set_texts($1)`, [{ ...P, at: "03:00" }])));
ok("set_texts: 460 letters refused", /459/.test(await err(`select set_texts($1)`, [{ ...P, landed: { on: true, text: "x".repeat(460) } }])));
const saved = (await q(`select set_texts($1) t`, [{ ...P, sender: "takeoff" }]))[0].t;
ok("set_texts: saved, sender in capitals", saved.on === true && saved.sender === "TAKEOFF" && saved.sent.on === false && saved.landed.text === "Landed {name}");
ok("set_texts: activity line", /Customer texts on: flight landed, reminder at 18:00, from the company mobile$/.test((await q(`select value from activity order by id desc limit 1`))[0].value));

ok("set_texts: Twilio needs the company name", /sent from first/.test(await err(`select set_texts($1)`, [{ ...P, via: "twilio", sender: "" }])));
ok("set_texts: the company mobile needs no company name", (await q(`select set_texts($1) t`, [{ ...P, sender: "" }]))[0].t.via === "phone");
ok("set_texts: Twilio activity names the sender", (await q(`select set_texts($1) t`, [{ ...P, via: "twilio" }]))[0].t.via === "twilio" && /from TAKEOFF \(Twilio\)$/.test((await q(`select value from activity order by id desc limit 1`))[0].value));
// The company mobile's SMS Gateway login: the password goes to the vault, never back.
await as("KAMU");
ok("Gateway login: office refused", /owner/i.test(await err(`select office_phone_gateway_set('ABC', 'pw')`)));
await as("RAKESH");
const g1 = (await q(`select office_phone_gateway_set('ABCDEF', 'pw1') g`))[0].g;
ok("Gateway login: saved, the password not returned", g1.gw_login === "ABCDEF" && g1.has_pass === true && !JSON.stringify(g1).includes("pw1"));
ok("Gateway login: the password in the vault", (await q(`select count(*)::int n from vault.secrets where name = $1 and secret = 'pw1'`, ["office_phone_sms:" + co]))[0].n === 1);
await q(`select office_phone_gateway_set('ABCDEF', null)`);
ok("Gateway login: no password keeps it", (await q(`select secret from vault.secrets where name = $1`, ["office_phone_sms:" + co]))[0].secret === "pw1");
ok("Gateway login: the app can't read it", !(await q(`select has_function_privilege('authenticated', 'office_phone_gateway(uuid)', 'execute') p`))[0].p);
const gw = (await q(`select office_phone_gateway($1) g`, [co]))[0].g;
ok("Gateway login: the server reads login and password", gw.login === "ABCDEF" && gw.password === "pw1", gw);
await as("RAKESH");
const demo = (await q(`select set_texts($1) t`, [{ ...P, demo: true }]))[0].t;
ok("set_texts: demo saved, still on (texts written, not sent)", demo.on === true && demo.demo === true);
ok("set_texts: demo activity line", /^Customer texts demo \(not sent\): flight landed/.test((await q(`select value from activity order by id desc limit 1`))[0].value));
ok("set_texts: off is never demo", (await q(`select set_texts($1) t`, [{ ...P, on: false, demo: true }]))[0].t.demo === false);
await q(`select set_texts($1)`, [{ ...P, demo: true }]);
// The trigger: flight landed and SENT ask send-texts; nothing else does.
const sh = (await q(`insert into sheets(company_id, kind, day) values ($1, 'drops', '2026-10-24') returning id`, [co]))[0].id;
const car = async (phone = "07868615571") => (await q(`insert into bookings(company_id, sheet_id, kind, reg, phone) values ($1, $2, 'drops', 'AB12CDE', $3) returning id`, [co, sh, phone]))[0].id;
const calls = async () => (await q(`select body from net.calls`)).map((r) => r.body);
const a = await car();
await q(`update bookings set flight_status = 'landed' where id = $1`, [a]);
let c = await calls();
ok("Landed: send-texts asked once, with the car and the rule", c.length === 1 && c[0].id === a && c[0].rule === "landed");
ok("Landed: the call carries the timer secret", (await q(`select headers from net.calls`))[0].headers["x-timer"] === "tick");
await q(`update bookings set flight_status = 'landed' where id = $1`, [a]);
ok("Landed again: not asked again", (await calls()).length === 1);
await q(`update bookings set sent_at = now() where id = $1`, [a]);
ok("SENT with Car on its way switched off: not asked", (await calls()).length === 1);
await as("RAKESH"); await q(`select set_texts($1)`, [{ ...P, sent: { on: true, text: "Sent" } }]);
const b2 = await car();
await q(`update bookings set sent_at = now() where id = $1`, [b2]);
ok("SENT: asked with rule sent", (await calls()).at(-1).rule === "sent" && (await calls()).at(-1).id === b2);
const b3 = await car("");
await q(`update bookings set flight_status = 'landed' where id = $1`, [b3]);
ok("No phone: not asked", (await calls()).length === 2);
const b4 = await car(); await q(`update bookings set cleared_at = now() where id = $1`, [b4]); await q(`update bookings set flight_status = 'landed' where id = $1`, [b4]);
ok("Cleared car: not asked", (await calls()).length === 2);
await q(`select set_texts($1)`, [{ ...P, on: false }]);
const b5 = await car(); await q(`update bookings set flight_status = 'landed' where id = $1`, [b5]);
ok("Texts off: not asked", (await calls()).length === 2);
ok("Off: activity says Customer texts off", (await q(`select value from activity order by id desc limit 1`))[0].value === "Customer texts off");
await db.exec(`update private.text_config set function_url = null`);
await q(`select set_texts($1)`, [P]);
const b6 = await car(); await q(`update bookings set flight_status = 'landed' where id = $1`, [b6]);
ok("No function address: the tap still saves", (await q(`select flight_status from bookings where id = $1`, [b6]))[0].flight_status === "landed");

// Read rule: a company sees only its own texts; the app can't write them.
ok("customer_texts: read rule per company", (await q(`select count(*)::int n from pg_policies where tablename = 'customer_texts' and policyname = 'company_read'`))[0].n === 1);
ok("customer_texts: the car link keeps texts when a booking goes", (await q(`select confdeltype from pg_constraint where conname = 'customer_texts_booking_id_fkey'`))[0].confdeltype === "n");

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
