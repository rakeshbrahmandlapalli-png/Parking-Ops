// Which flight APIs each way of calling the flights edge function uses, with a
// pretend database and pretend APIs (no network, no Deno needed):
//   node checks/flight-sources.mjs
// "Check flights" uses FlightRadar24 only. AeroDataBox (AeroData) is called by
// the timer every 90 min for tonight's sheet (only the 12-hour chunks with a
// car still waiting) and by "Fill times" (once per sheet per 10 min); neither
// calls it for 6 h after it says the month's quota is spent.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { execFileSync } from "child_process";

if (!process.env.FLIGHT_SOURCES_CHILD) {
  // Node strips the TypeScript types; needs the flag on Node 22.
  try { execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url)], { stdio: "inherit", env: { ...process.env, FLIGHT_SOURCES_CHILD: "1" } }); }
  catch { process.exit(1); }
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../supabase/functions/flights/index.ts"), "utf8")
  .replace(/^import \{ createClient, SupabaseClient \} from .*$/m, "const createClient = (globalThis as any).__createClient; type SupabaseClient = any;");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flights-"));
fs.writeFileSync(path.join(tmp, "index.ts"), src);

// ── pretend database ──
const now = Date.now(), iso = (ms) => new Date(ms).toISOString();
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(now - 6 * 3600e3));
let db;
function fresh() {
  db = {
    companies: [{ id: "c1", name: "TAKEOFF", slug: "takeoff", time_zone: "Europe/London", drops_day_end: "06:00", airport_iata: "LGW", airport_icao: "EGKK", flight_settings: { schedule_every_hours: 1, active_from: 0, active_to: 24 }, suspended_at: null }],
    sheets: [{ id: "s1", company_id: "c1", kind: "drops", day, imported_at: iso(now - 60e3) }],
    bookings: [{ id: "b1", company_id: "c1", sheet_id: "s1", ref: "R1", reg: "AB12CDE", name: "A", flight: "U22464", return_at: iso(now + 30 * 60e3), cleared_at: null, overstay: false,
      sched_at: iso(now + 30 * 60e3), sched_time: "", est_at: null, est_time: "", flight_status: "", flight_note: "" }],
    flight_runs: [], timetable: [], activity: [],
  };
}
function q(table) {
  const f = [];
  let lim = Infinity, order = null, op = "select", patch = null;
  const get = (r, c) => { const m = /^(\w+)->>(\w+)$/.exec(c); return m ? (r[m[1]] ?? {})[m[2]] : r[c]; };
  const rows = () => {
    let out = db[table].filter((r) => f.every((t) => t(r)));
    if (order) out = out.slice().sort((a, b) => (a[order.c] < b[order.c] ? -1 : 1) * (order.asc ? 1 : -1));
    return out.slice(0, lim);
  };
  const run = () => {
    if (op === "update") { rows().forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
    return { data: rows(), error: null };
  };
  const b = {
    select() { return b; },
    eq(c, v) { f.push((r) => String(get(r, c)) === String(v)); return b; },
    neq(c, v) { f.push((r) => get(r, c) !== v); return b; },
    is(c, v) { f.push((r) => (get(r, c) ?? null) === v); return b; },
    in(c, v) { f.push((r) => v.includes(get(r, c))); return b; },
    gt(c, v) { f.push((r) => get(r, c) > v); return b; },
    gte(c, v) { f.push((r) => get(r, c) >= v); return b; },
    ilike(c, v) { const re = new RegExp("^" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i"); f.push((r) => re.test(String(get(r, c) ?? ""))); return b; },
    order(c, o) { order = { c, asc: o?.ascending !== false }; return b; },
    limit(n) { lim = n; return b; },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    update(p) { op = "update"; patch = p; return b; },
    insert: async (v) => { [].concat(v).forEach((r) => db[table].push({ at: iso(Date.now()), ...r })); return { error: null }; },
    upsert: async (v) => { db[table].push(...[].concat(v)); return { error: null }; },
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
// who's pressing: role decides the limit (owner, manager, office: none).
let caller = { id: "st1", role: "office" };
const PERMS = { owner: ["flights", "settings"], manager: ["settings"], office: ["flights"], bongo: [], terminal: [], view: [] };
globalThis.__createClient = () => ({ from: q, rpc: async (name, args) => ({ data: name === "my_company" ? "c1" : name === "me" ? caller
  : name === "can" ? PERMS[caller.role].includes(args.p_action) : true, error: null }) });

// ── pretend APIs ──
let calls, aeroAnswer, aeroHeaders;
globalThis.fetch = async (url, opts) => {
  const host = new URL(url).host;
  calls[host] = (calls[host] || 0) + 1;
  if (/aerodatabox/.test(host)) aeroHeaders = opts?.headers;
  if (/aerodatabox/.test(host)) aeroUrls.push(url);
  if (/aerodatabox/.test(host) && typeof aeroAnswer === "function") return new Response(JSON.stringify({ arrivals: aeroAnswer(url) }), { status: 200 });
  if (/aerodatabox/.test(host)) return aeroAnswer === "quota"
    ? new Response(JSON.stringify({ message: "You have exceeded the MONTHLY quota for API Units on your current plan, PRO." }), { status: 429 })
    : new Response(JSON.stringify({ arrivals: [] }), { status: 200 });
  fr24Urls.push(new URL(url).searchParams);
  const asked = new URL(url).searchParams.get("flights") || "";
  if (fr24Refuse && asked.split(",").includes(fr24Refuse)) return new Response(JSON.stringify({ message: "Validation failed", details: `The provided flight number '${fr24Refuse}' is not a valid IATA flight number` }), { status: 400 });
  return new Response(JSON.stringify({ data: [] }), { status: 200 });
};
let fr24Urls = [], fr24Refuse = "", aeroUrls = [];
let handler;
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_ANON_KEY: "a", FR24_TOKEN: "t", AERODATABOX_KEY: "a" })[k] }, serve: (h) => { handler = h; } };
await import(pathToFileURL(path.join(tmp, "index.ts")).href);

const addSheet2 = () => { db.sheets.push({ id: "s2", company_id: "c1", kind: "drops", day: "2026-01-02", imported_at: iso(now) }); db.bookings.push({ ...db.bookings[0], id: "b2", sheet_id: "s2" }); };
const addSheet3 = () => { db.sheets.push({ id: "s3", company_id: "c1", kind: "drops", day: "2026-01-03", imported_at: iso(now) }); db.bookings.push({ ...db.bookings[0], id: "b3", sheet_id: "s3" }); };
const post = async (body) => { calls = {}; const r = await handler(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "x-timer": "s" } })); return { status: r.status, json: await r.json(), aero: calls["api.aerodatabox.com"] || 0, fr24: calls["fr24api.flightradar24.com"] || 0 }; };
let failed = 0, passed = 0;
const check = (name, ok, info) => { if (ok) passed++; else failed++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " " + JSON.stringify(info))); };

fresh(); aeroAnswer = "ok";
let r = await post({ action: "timer" });
check("timer: FR24, and AeroData for tonight's sheet, only the chunk(s) around the one car still waiting", r.fr24 === 1 && r.aero >= 1 && r.aero <= 2 && r.json.results[0].schedule, r);
check("AeroData goes to AeroDataBox's own gateway with the X-Api-Key header (Starter plan, not RapidAPI)", aeroHeaders?.["X-Api-Key"] === "a" && !Object.keys(aeroHeaders).some((k) => /rapidapi/i.test(k)), aeroHeaders);
r = await post({ action: "timer" });
check("timer again 10 min later: no AeroData (every 90 min), and only tonight's sheet", r.aero === 0 && !db.flight_runs.some((x) => x.source === "schedule" && x.result.day !== day), r);
db.flight_runs.forEach((x) => { x.at = iso(now - 89 * 60e3); });
r = await post({ action: "timer" });
check("timer 89 min after the last timetable: AeroData again", r.aero >= 1, r);
db.flight_runs.forEach((x) => { x.at = iso(now - 120 * 60e3); });
Object.assign(db.bookings[0], { sched_at: day + "T12:00:00Z", flight_status: "scheduled" });
r = await post({ action: "timer" });
check("a car matched at 13:00 is the only one waiting: just the 05:00-17:00 chunk", r.aero === 1, r);
check("a partial fetch never marks a car \"Not in the timetable\"", !/Not in the timetable/.test(db.bookings[0].flight_note), db.bookings[0].flight_note);
db.flight_runs.forEach((x) => { x.at = iso(now - 120 * 60e3); });
db.bookings[0].flight_status = "airborne";
r = await post({ action: "timer" });
check("the only waiting flight is in the air on FR24: the timetable leaves it to FR24 (no AeroData)", r.aero === 0, r);
db.bookings[0].flight_status = "scheduled";
db.flight_runs.forEach((x) => { x.at = iso(now - 120 * 60e3); });
db.bookings.push({ ...db.bookings[0], id: "b9", flight: "", sched_at: null, flight_status: "" });
r = await post({ action: "timer" });
check("a car with no flight number yet: every chunk (3 calls), for the flights-near-its-time list", r.aero === 3, r);
db.flight_runs.forEach((x) => { x.at = iso(now - 120 * 60e3); });
db.bookings.forEach((b) => { b.flight_status = "landed"; });
r = await post({ action: "timer" });
check("timer when every flight on tonight's sheet has landed: no AeroData", r.aero === 0, r);
fresh();
r = await post({ action: "check" });
check("Check flights: FR24 only, no AeroData", r.status === 200 && r.aero === 0 && r.fr24 === 1 && !r.json.schedule, r);
fresh(); db.bookings[0].sched_at = null;   // not matched yet: every chunk
r = await post({ action: "timetable", day });
check("Fill times: AeroData only (3 calls for the day), no FR24", r.status === 200 && r.aero === 3 && r.fr24 === 0, r);
check("the timetable run records the AeroData calls it made (part 100: units estimate)", db.flight_runs.filter((x) => x.source === "schedule").pop()?.result.calls === 3, db.flight_runs.filter((x) => x.source === "schedule").pop());
r = await post({ action: "timetable", day });
check("office: Fill times again straight away is allowed (no limit)", r.status === 200 && r.aero === 3 && r.json.left === null, r);
addSheet2();
r = await post({ action: "timetable", day: "2026-01-02" });
check("Fill times for another sheet: allowed", r.status === 200 && r.aero === 3, r);

fresh(); aeroAnswer = "quota"; db.bookings[0].sched_at = null;
r = await post({ action: "timetable", day });
check("monthly quota spent: one call, no retries, the error is shown", r.aero === 1 && /MONTHLY quota/.test(r.json.schedule.error), r);
check("a failed call still counts as a call", r.json.schedule.calls === 1, r.json.schedule);
addSheet2();
r = await post({ action: "timetable", day: "2026-01-02" });
check("after a spent quota: Fill times doesn't call AeroData for 6 h", r.aero === 0 && /used up/.test(r.json.schedule.skipped), r);
db.flight_runs.push({ at: iso(Date.now() + 1000), company_id: "c2", source: "schedule", trigger: "button", result: { error: "" } });
db.flight_runs.push({ at: iso(Date.now() + 2000), company_id: "c1", source: "live", trigger: "timer", result: { error: "" } });
addSheet3(); aeroAnswer = "ok";
r = await post({ action: "timetable", day: "2026-01-03" });
check("after a spent quota, a later timetable run that worked (any client) means AeroData is back", r.aero === 3, r);
fresh(); aeroAnswer = "quota"; db.bookings[0].sched_at = null;
r = await post({ action: "timetable", day });
aeroAnswer = "ok";
db.flight_runs.forEach((x) => { x.at = iso(now - 7 * 3600e3); });
addSheet2();
r = await post({ action: "timetable", day: "2026-01-02" });
check("6 h later Fill times tries AeroData again", r.aero === 3, r);

fresh(); db.bookings[0].flight_status = "landed";
r = await post({ action: "timetable", day });
check("Fill times on a sheet where every flight has landed: no AeroData calls", r.status === 200 && r.aero === 0 && r.json.schedule.done === 1, r);

// Who can press: owners, managers and the office any time; drivers and
// terminal staff 2 presses an hour between both buttons; view-only none.
for (const role of ["owner", "manager", "office"]) {
  fresh(); caller = { id: "st-" + role, role }; db.bookings[0].sched_at = null;
  let ok = true;
  for (let i = 0; i < 4; i++) { r = await post({ action: i % 2 ? "check" : "timetable", day }); ok = ok && r.status === 200 && r.json.left === null; }
  check(role + ": 4 checks in a row, no limit", ok, r);
}
fresh(); caller = { id: "st-bongo", role: "bongo" }; db.bookings[0].sched_at = null;
r = await post({ action: "timetable", day });
check("driver: first check of the hour works, 1 left", r.status === 200 && r.aero === 3 && r.json.left === 1, r);
r = await post({ action: "check" });
check("driver: second check (the other button) works, 0 left", r.status === 200 && r.fr24 === 1 && r.json.left === 0, r);
r = await post({ action: "timetable", day });
check("driver: a third in the hour is refused with when the next one is, no calls", r.status === 429 && r.aero === 0 && r.fr24 === 0 && /2 flight checks this hour\. Next one in \d+ min/.test(r.json.error), r);
caller = { id: "st-term", role: "terminal" };
r = await post({ action: "check" });
check("terminal staff: their own 2 an hour (a driver's presses don't count)", r.status === 200 && r.json.left === 1, r);
caller = { id: "st-bongo", role: "bongo" };
db.flight_runs.filter((x) => x.result.by === "st-bongo").forEach((x) => { x.at = iso(Date.now() - 61 * 60e3); });
r = await post({ action: "check" });
check("driver: an hour later they can check again", r.status === 200 && r.json.left === 1, r);
caller = { id: "st-view", role: "view" };
r = await post({ action: "check" });
check("view-only: refused", r.status === 403 && r.fr24 === 0, r);
caller = { id: "st1", role: "office" };

// KR66 FVF, 12 Oct: W4 3752 is the outbound flight, so FR24 found no plane
// and said DELAY. The timetable doesn't have it landing: CHECK MANUALLY.
fresh(); Object.assign(db.bookings[0], { flight: "W43752", sched_at: null, est_time: "DELAY", flight_status: "delayed", flight_note: "Not airborne at 07:00, so it will be late" });
r = await post({ action: "timetable", day });
check("a DELAY on a flight not in today's arrivals becomes Not in the timetable (CHECK MANUALLY)", db.bookings[0].flight_status === "" && db.bookings[0].est_time === "" && /^Not in the timetable/.test(db.bookings[0].flight_note), db.bookings[0]);
r = await post({ action: "check" });
check("FR24 with no aircraft for it then leaves it as CHECK MANUALLY, not DELAY", r.fr24 === 1 && db.bookings[0].flight_status === "" && /^Not in the timetable/.test(db.bookings[0].flight_note), db.bookings[0]);
fresh(); Object.assign(db.bookings[0], { sched_at: null });
r = await post({ action: "check" });
check("a flight not checked against the timetable yet, due within the hour with no aircraft: still DELAY", db.bookings[0].flight_status === "delayed", db.bookings[0]);

// More clients (15 Oct): with { slot: true } the timer wakes every minute and
// each client gets one minute in ten, so clients don't queue in one run.
fresh();
for (let i = 2; i <= 12; i++) db.companies.push({ ...db.companies[0], id: "c" + i, name: "C" + i, slug: "c" + i, created_at: iso(now + i) });
db.companies[0].created_at = iso(now);
db.companies.push({ ...db.companies[0], id: "cp", name: "Parking Ops", slug: "platform", created_at: iso(now - 1) });
db.companies.push({ ...db.companies[0], id: "cs", name: "Gone", slug: "gone", suspended_at: iso(now), created_at: iso(now - 2) });
const slotNow = new Date().getUTCMinutes() % 10;
r = await post({ action: "timer", slot: true });
const want = ["TAKEOFF", ...Array.from({ length: 11 }, (_, k) => "C" + (k + 2))].filter((_, i) => i % 10 === slotNow);
check("slot timer: only this minute's clients (not the platform or a suspended one)", JSON.stringify(r.json.results.map((x) => x.company)) === JSON.stringify(want), { got: r.json.results.map((x) => x.company), want });
r = await post({ action: "timer" });
check("old timer call (no slot): still every active client", r.json.results.length === 12, r.json.results.map((x) => x.company));

// 3 Nov: "5422" (airline left off) went to FR24 with 14 real flights and FR24
// refused the whole request ("not a valid IATA flight number"), 12 runs a week.
const car = (id, flight) => ({ ...db.bookings[0], id, ref: "R" + id, flight });
fresh(); db.bookings.push(car("b2", "5422"), car("b3", "93901"));
fr24Urls = [];
r = await post({ action: "check" });
const sent = fr24Urls.map((u) => (u.get("flights") || "") + "|" + (u.get("callsigns") || "")).join(" ");
check("a number with no airline (5422, 93901) never goes to FR24; the real flight still does", r.fr24 === 1 && /U22464/.test(sent) && !/5422|93901/.test(sent) && !r.json.live.error, { sent, live: r.json.live });
check("…and the number-only cars are left as they were (not DELAY)", db.bookings.filter((b) => b.id !== "b1").every((b) => b.flight_status === ""), db.bookings);

// A number FR24 still won't take: the rest of that request is asked again without it.
fresh(); db.bookings.push(car("b2", "ZZ9999")); fr24Refuse = "ZZ9999"; fr24Urls = [];
r = await post({ action: "check" });
check("FR24 refuses one number: asked again without it, the others are checked", r.fr24 === 2 && fr24Urls[1].get("flights") === "U22464" && !r.json.live.error && db.bookings[0].flight_checked_at, { live: r.json.live, urls: fr24Urls.map(String) });
check("…the refused one is left unchecked (no DELAY from a failed ask)", db.bookings[1].flight_status === "" && !db.bookings[1].flight_checked_at, db.bookings[1]);
fr24Refuse = "";

// Flights and callsigns sorted first, then 15 a request: 20 + 5 is 3 requests, not 4.
fresh();
for (let i = 0; i < 19; i++) db.bookings.push(car("f" + i, "U2" + (3000 + i)));
for (let i = 0; i < 5; i++) db.bookings.push(car("c" + i, "QQQ" + (700 + i)));
fr24Urls = [];
r = await post({ action: "check" });
check("20 flights and 5 callsigns: 3 FR24 requests (15 + 5 flights, 5 callsigns)", r.fr24 === 3 && fr24Urls.map((u) => (u.get("flights") || u.get("callsigns")).split(",").length).join(",") === "15,5,5", fr24Urls.map(String));

// ── 4 Nov 2026: more of the AeroDataBox plan ──
const lastSched = () => db.flight_runs.filter((x) => x.source === "schedule").pop();
const ago = (min) => iso(Date.now() - min * 60e3);
// An arrival as AeroDataBox sends it.
const arr = (number, schedMs, extra = {}) => ({ number, status: extra.status ?? "Expected", codeshareStatus: "IsOperator", airline: { icao: "EZY" },
  movement: { scheduledTime: { utc: iso(schedMs) }, ...(extra.actual ? { actualTime: { utc: iso(extra.actual) } } : {}) },
  departure: { airport: { municipalityName: "Alicante" }, scheduledTime: { utc: iso(schedMs - 150 * 60e3) } } });

// Near look: 16 min after a full run, one call for the hours around now.
fresh(); db.flight_runs.push({ company_id: "c1", source: "schedule", trigger: "timer", at: ago(16), result: { calls: 3, error: "" } });
aeroAnswer = () => [arr("U2 2464", now + 40 * 60e3)]; aeroUrls = [];
r = await post({ action: "timer" });
check("near look: 16 min after the full run, one AeroData call around now", r.aero === 1 && r.json.results[0].near && !r.json.results[0].schedule, r.json.results[0]);
const span = /\/(\d{4}-\d\d-\d\dT\d\d:\d\d)\/(\d{4}-\d\d-\d\dT\d\d:\d\d)\?/.exec(aeroUrls[0] || "");
check("near look: asks for 2 h back to 4 h ahead (6 hours, not the whole day)", !!span && (new Date(span[2] + "Z") - new Date(span[1] + "Z")) / 3600e3 === 6, aeroUrls[0]);
check("near look: logged as kind near, and the car's time moved to the timetable's", lastSched()?.result.kind === "near" && lastSched().result.moved === 1 && db.bookings[0].sched_at === iso(now + 40 * 60e3), { run: lastSched(), b: db.bookings[0] });
r = await post({ action: "timer" });
check("near look: not again within 15 min", r.aero === 0, r.json.results[0]);

fresh(); db.flight_runs.push({ company_id: "c1", source: "schedule", trigger: "timer", at: ago(16), result: { calls: 3, error: "" } });
Object.assign(db.bookings[0], { sched_at: iso(now + 8 * 3600e3), return_at: iso(now + 8 * 3600e3) });
r = await post({ action: "timer" });
check("near look: no car due in the next 4 h, no call and nothing logged", r.aero === 0 && db.flight_runs.length === 2, db.flight_runs);

fresh(); db.flight_runs.push({ company_id: "c1", source: "schedule", trigger: "timer", at: ago(16), result: { calls: 3, error: "" } });
db.bookings[0].sched_at = null; aeroAnswer = () => [];
r = await post({ action: "timer" });
check("near look: a flight missing from the window is never marked Not in the timetable", r.aero === 1 && !/Not in the timetable/.test(db.bookings[0].flight_note), db.bookings[0]);

fresh(); db.flight_runs.push({ company_id: "c1", source: "schedule", trigger: "timer", at: ago(91), result: { calls: 3, error: "" } },
  { company_id: "c1", source: "schedule", trigger: "timer", at: ago(5), result: { calls: 1, error: "", kind: "near" } });
aeroAnswer = "ok";
r = await post({ action: "timer" });
check("a near look doesn't push back the 90-minute full run", r.json.results[0].schedule && !r.json.results[0].near && !lastSched().result.kind, r.json.results[0]);

// Diverted.
fresh(); aeroAnswer = () => [arr("U2 2464", now + 30 * 60e3, { status: "Diverted", actual: now - 5 * 60e3 })];
r = await post({ action: "timetable", day });
check("diverted: the car says diverted, no ETA, no landed time from the other airport", db.bookings[0].flight_status === "diverted" && /^Diverted/.test(db.bookings[0].flight_note) && !db.bookings[0].est_at && r.json.schedule.diverted === 1, db.bookings[0]);
check("diverted: an activity line for the office", db.activity.some((a) => a.action === "DIVERTED" && a.value === "U22464"), db.activity);
r = await post({ action: "timetable", day });
check("diverted: told once (no second line on the next run)", db.activity.filter((a) => a.action === "DIVERTED").length === 1 && r.json.schedule.diverted === 0, db.activity);
r = await post({ action: "check" });
check("diverted: FR24 finding no plane doesn't turn it into DELAY", db.bookings[0].flight_status === "diverted", db.bookings[0]);
aeroAnswer = () => [arr("U2 2464", now + 30 * 60e3, { status: "Arrived", actual: now - 2 * 60e3 })];
r = await post({ action: "timetable", day });
check("diverted, then it lands here after all: Landed", db.bookings[0].flight_status === "landed" && db.bookings[0].est_at, db.bookings[0]);
fresh(); db.bookings[0].flight_status = "diverted"; aeroAnswer = () => [arr("U2 2464", now + 30 * 60e3)];
r = await post({ action: "timetable", day });
check("diverted, then back to normal in the timetable: Scheduled again", db.bookings[0].flight_status === "scheduled" && db.bookings[0].flight_note === "", db.bookings[0]);

// The evening look ahead: the client's own clock decides, so pick time zones
// where it is evening / morning right now.
function zoneAt(hours) {
  for (let off = -12; off <= 14; off++) {
    const tz = off === 0 ? "Etc/GMT" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
    const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date()).replace("24", "00"));
    if (hours.includes(h)) return tz;
  }
}
function aheadDb(tz) {
  fresh();
  const local = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(ms));
  const today = local(now - 6 * 3600e3 > 0 ? now : now), d1 = local(now + 86400e3), d2 = local(now + 2 * 86400e3);
  db.companies[0].time_zone = tz;
  db.sheets = [{ id: "s1", company_id: "c1", kind: "drops", day: today }, { id: "s4", company_id: "c1", kind: "drops", day: d1 }, { id: "s5", company_id: "c1", kind: "drops", day: d2 }];
  db.bookings.push({ ...db.bookings[0], id: "b4", sheet_id: "s4", sched_at: null, return_at: iso(now + 86400e3) }, { ...db.bookings[0], id: "b5", sheet_id: "s5", sched_at: null, return_at: iso(now + 2 * 86400e3) });
  db.bookings[0].flight_status = "landed";
  db.flight_runs.push({ company_id: "c1", source: "schedule", trigger: "timer", at: ago(20), result: { calls: 3, error: "" } });
}
const evening = zoneAt([19, 20, 21, 22]);
aheadDb(evening); aeroAnswer = (url) => /\/(\d{4}-\d\d-\d\d)T05:00\//.test(url) ? [arr("U2 2464", now + 86400e3, { status: "Canceled" })] : [];
r = await post({ action: "timer" });
const ahead = r.json.results[0].ahead;
check("evening: the next two sheets get a full timetable run (3 calls each)", ahead && ahead.sheets === 2 && r.aero === 6 && lastSched().result.kind === "ahead", { ahead, aero: r.aero, tz: evening });
check("evening: a cancellation on tomorrow's sheet shows tonight", db.bookings.find((b) => b.id === "b4").flight_status === "cancelled", db.bookings.find((b) => b.id === "b4"));
r = await post({ action: "timer" });
check("evening: once an evening, not every timer", !r.json.results[0].ahead && r.aero === 0, r.json.results[0]);
aheadDb(zoneAt([8, 9, 10, 11]));
r = await post({ action: "timer" });
check("morning: no look ahead", !r.json.results[0].ahead, r.json.results[0]);
aheadDb(evening); db.sheets = db.sheets.filter((x) => x.id === "s1");
r = await post({ action: "timer" });
check("evening with no later sheet imported yet: nothing logged, so it tries again once one is", !db.flight_runs.some((x) => x.result.kind === "ahead"), db.flight_runs);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
