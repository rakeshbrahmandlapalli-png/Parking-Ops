// TAKEOFF OPS — browser tests, the shared part: the app served like Vercel does, a
// pretend Supabase, phones, and the helpers every section uses. run.mjs runs the
// sections in checks/e2e/sections in order. Nothing touches the live database.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.APP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
let passed = 0, failed = 0;
const check = (name, cond, detail) => {
  if (cond) passed++; else failed++;
  console.log((cond ? "PASS " : "FAIL ") + name + (cond || detail === undefined ? "" : "   -> " + JSON.stringify(detail).slice(0, 300)));
};
const cspBlocked = [];
// The app is built from its parts in src/app (node src/build.mjs): what is tested and deployed is those parts joined.
if (!process.env.APP_ROOT) {
  const appParts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/app");
  const joined = fs.readdirSync(appParts).filter((f) => /^\d\d-.+\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(appParts, f), "utf8")).join("");
  check("public/app.js is src/app's parts joined (run node src/build.mjs after editing a part)", joined === fs.readFileSync(path.join(ROOT, "app.js"), "utf8"));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the app, served like Vercel does (/p/<token> → pt.html), with the same
// security headers as vercel.json, so a blocked script or photo shows up here ──
const SITE_HEADERS = Object.fromEntries(JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../vercel.json"), "utf8"))
  .headers.find((h) => h.source === "/(.*)").headers.map((h) => [h.key, h.value]));
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (/^\/p\/[A-Za-z0-9_-]+$/.test(p)) p = "/pt.html";
  if (p === "/") p = "/index.html";
  if (p === "/manifest.webmanifest") p = "/manifest-default.webmanifest";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", ...SITE_HEADERS });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port;

// ── dates as the app sees them (London, the DROPS day runs to 06:00) ──
const lon = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
const L = lon(new Date());
const addDays = (key, n) => new Date(Date.parse(key + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
let TONIGHT = L.year + "-" + L.month + "-" + L.day; if (+L.hour < 6) TONIGHT = addDays(TONIGHT, -1);
const TOMORROW = addDays(TONIGHT, 1);
const iso = (key, hhmm) => new Date(key + "T" + hhmm + ":00Z").toISOString();

// ── a pretend Supabase with a tiny in-memory database ──
function makeDb(opts = {}) {
  const db = {
    me: { id: "s1", name: "RAKESH", role: "owner", company_id: "c1" },
    company: { id: "c1", name: "TAKEOFF", slug: "takeoff", yards: ["NB", "S"], drops_day_end: "06:00:00", brand: {}, time_zone: "Europe/London", pt_whatsapp: "447900000000", pt_method: opts.ptMethod || "photos", pt_method_ios: opts.ptMethodIos || opts.ptMethod || "photos", pt_copy_store: opts.ptStore || "supabase", overstay_rate: 0 },
    staff: [{ id: "s1", name: "RAKESH", role: "owner", active: true }, { id: "s2", name: "SUGU", role: "office", active: true }],
    sheets: [
      { id: "d0", company_id: "c1", kind: "drops", day: TONIGHT },
      { id: "d1", company_id: "c1", kind: "drops", day: TOMORROW },
      { id: "p0", company_id: "c1", kind: "picks", day: TONIGHT, short_until: addDays(TONIGHT, 3) },
    ],
    bookings: [
      { id: "b1", sheet_id: "d0", kind: "drops", ref: "R1", reg: "EK14JPV", num: 1, name: "SENIOR MISS", make: "FORD", flight: "U22312", return_at: iso(TONIGHT, "21:45"), phone: "07868 615571", note: "" },
      { id: "b2", sheet_id: "d0", kind: "drops", ref: "R2", reg: "CF75VLN", num: 2, name: "KHAIRA MS", make: "MG", flight: "U22368", return_at: iso(TONIGHT, "22:00"), phone: "7868615571 7868615571", note: "S/D" },
      { id: "b3", sheet_id: "d0", kind: "drops", ref: "R3", reg: "DV59ACF", num: 3, name: "GREBOSZ MX", flight: "U22580", return_at: iso(TONIGHT, "22:15"), note: "", sent_at: iso(TONIGHT, "20:56"), sent_by: "s2", yard: "T" },
      { id: "b4", sheet_id: "d1", kind: "drops", ref: "R4", reg: "DY16MYO", num: 2, name: "ATANASOV MX", flight: "W95393", return_at: iso(TOMORROW, "09:00"), note: "WRONG FLIGHT NUMBER" },
      { id: "b5", sheet_id: "d1", kind: "drops", ref: "R5", reg: "EN11KOO", num: 4, name: "JANKO MS", make: "BMW", flight: "W43301", return_at: iso(TOMORROW, "06:15"), note: "" },
      { id: "p1", sheet_id: "p0", kind: "picks", ref: "R4", reg: "DY16MYO", num: 1, name: "ATANASOV MX", drop_at: iso(TONIGHT, "14:00"), return_at: iso(addDays(TONIGHT, 1), "09:00"), intake: "", note: "" },
      { id: "p2", sheet_id: "p0", kind: "picks", ref: "P2", reg: "AF63WWH", num: 2, name: "MASON", drop_at: iso(TONIGHT, "15:00"), return_at: iso(addDays(TONIGHT, 2), "10:00"), intake: "", note: "" },
      { id: "p3", sheet_id: "p0", kind: "picks", ref: "P3", reg: "SF15LUA", num: 3, name: "KOLE", drop_at: iso(TONIGHT, "18:00"), return_at: iso(addDays(TONIGHT, 9), "10:00"), intake: "", note: "" },
      { id: "p4", sheet_id: "p0", kind: "picks", ref: "P4", reg: "HJ12PGK", num: 4, name: "FEJ", drop_at: iso(TONIGHT, "20:00"), return_at: iso(addDays(TONIGHT, 1), "20:00"), intake: "Collected", intake_at: iso(TONIGHT, "19:48"), intake_by: "s2", note: "" },
    ],
    ptLinks: [], uploads: [], calls: [], down: false,
  };
  db.bookings.forEach((b) => { b.company_id = "c1"; });
  return db;
}
const now = () => new Date().toISOString();
// Operations on a wide screen (board as a table, Flights as tables): a night with
// every kind of car on it: long references, missing details, each button state,
// delays, overnight times, each flight problem. Sample data only.
// A London wall-clock time as a moment (the board shows London time).
const lonIso = (key, hhmm) => { const g = new Date(key + "T" + hhmm + ":00Z"), p = lon(g); return new Date(2 * g.getTime() - Date.parse(p.year + "-" + p.month + "-" + p.day + "T" + p.hour.replace("24", "00") + ":" + hhmm.slice(3) + ":00Z")).toISOString(); };
function deskDb(theme = "ops") {
  const db = makeDb(); db.company.brand = { colour: "#F9A01B", ink: "#1A1A1A", short: "TakeOff", theme };
  db.company.yards = ["S", "CP", "NY", "T"]; db.company.yard_colours = { CP: "#E8590C", NY: "#2F9E44", S: "#1C7ED6", T: "#7048E8" };
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString(), N = TOMORROW;
  const cars = [
    { reg: "AB12CDE", make: "KIA NIRO", name: "TAYLOR MRS", ref: "TKO-2026-1042", flight: "U22001", r: "11:45", sched_time: "11:45", est_time: "11:47", flight_status: "expected", yard: "CP" },
    { reg: "CD34EFG", make: "LAND ROVER DISCOVERY SPORT HSE DYNAMIC", name: "PATEL MR", ref: "TKO-2026-1043", flight: "FR2002", r: "12:05", sched_time: "12:05", est_time: "12:03", flight_status: "scheduled", yard: "NY", called_at: ago(14), called_by: "s2" },
    { reg: "EF56GHI", make: "NISSAN QASHQAI", name: "JONES MS", ref: "TKO-2026-1044", flight: "U22003", r: "12:15", sched_time: "12:15", est_time: "12:47", flight_status: "expected", yard: "S" },
    { reg: "GH78JKL", make: "MERCEDES-BENZ A-CLASS", name: "SMITH DR", ref: "TKO-2026-1045", flight: "W94004", r: "12:20", sched_time: "12:20", est_time: "DELAY", flight_status: "delayed", yard: "T" },
    { reg: "IJ90MNO", make: "", name: "BROWN", ref: "AGENT-REF-PARK-AND-RIDE-0000001046-LONG", flight: "", r: "12:35", yard: "NY" },
    { reg: "KL12PQR", make: "PEUGEOT 208", name: "GREEN MR", ref: "TKO-2026-1047", flight: "FR2006", r: "12:40", sched_time: "12:40", est_time: "12:41", flight_status: "landed", yard: "T", sent_at: ago(6), sent_by: "s2", called_at: ago(30), called_by: "s1" },
    { reg: "MN34STU", make: "TOYOTA COROLLA", name: "WILSON MRS", ref: "TKO-2026-1048", flight: "TBC", r: "13:05", yard: "S" },
    { reg: "OP56VWX", make: "BMW 3 SERIES", name: "CLARK MR", ref: "TKO-2026-1049", flight: "U22007", r: "13:20", flight_note: "Not in the timetable · check the flight number", yard: "CP" },
    { reg: "QR78YZA", make: "FORD FOCUS", name: "WALKER MS", ref: "TKO-2026-1050", flight: "NO FLIGHT", flight_status: "noflight", est_time: "14:30", r: "14:10", yard: "CP" },
    { reg: "ST90BCD", make: "AUDI Q5", name: "HALL MR", ref: "TKO-2026-1051", flight: "FR3003", r: "15:25", sched_time: "15:25", flight_status: "cancelled", flight_note: "Cancelled · timetable, checked 10:20", yard: "T" },
    { reg: "UV12WXY", make: "VOLKSWAGEN GOLF", name: "KING MRS", ref: "TKO-2026-1052", flight: "EZY8812", r: "16:00", sched_time: "16:00", est_time: "16:05", flight_status: "airborne", yard: "S", note: "Child seat in boot" },
    { reg: "WX34ZAB", make: "SKODA OCTAVIA", name: "LEWIS MR", ref: "TKO-2026-1053", flight: "W43301", r: "17:10", flight_note: "Lands 03:10, over 6 h from the booked time · check the flight number", yard: "NY", note: "! Customer complained about a scratch" },
    { reg: "YZ56CDE", make: "HONDA JAZZ", name: "YOUNG MS", ref: "TKO-2026-1054", flight: "U22931", r: "19:45", yard: "S", cleared_at: ago(40), cleared_by: "s2", sent_at: ago(70), sent_by: "s2", clear_word: "Collected" },
    { reg: "BA98FED", make: "TESLA MODEL 3", name: "MORGAN MR", ref: "TKO-2026-1055", flight: "U22219", r: "23:55", sched_time: "23:55", flight_status: "scheduled", yard: null },
    { reg: "DC76HGF", make: "VAUXHALL CORSA", name: "EVANS MRS", ref: "TKO-2026-1056", flight: "FR8841", d: N, r: "00:40", sched_time: "00:40", est_time: "01:25", flight_status: "expected", yard: "CP" },
    { reg: "FE54JIH", make: "MINI COOPER", name: "HUGHES MR", ref: "TKO-2026-1057", flight: "W45523", d: N, r: "02:10", sched_time: "02:10", flight_status: "scheduled", yard: "NY", called_word: "Overstay", called_at: ago(90), overstay: true },
  ];
  db.bookings = db.bookings.filter((b) => b.sheet_id !== "d0").concat(cars.map((c, i) => {
    const { r, d, ...rest } = c;
    return { id: "w" + (i + 1), sheet_id: "d0", company_id: "c1", kind: "drops", num: i + 1, phone: "07700900" + String(100 + i), note: "", ...rest, return_at: lonIso(d || TONIGHT, r) };
  }));
  db.company.brand.picks_yard = true;
  const picks = [
    { reg: "PA11AAA", make: "FORD KUGA", name: "ADAMS MRS", ref: "TKO-2026-2001", d: "07:30", back: [3, "14:20"], flight: "U22410", intake: "Collected", intake_at: ago(200), intake_by: "s2", pt_at: ago(190), pt_by: "s2", yard: "S" },
    { reg: "PB22BBB", make: "AUDI A4 AVANT S LINE", name: "BAKER MR", ref: "TKO-2026-2002", d: "08:15", back: [1, "09:05"], flight: "FR1188", intake: "Collected", intake_at: ago(150), intake_by: "s4", yard: "CP" },
    { reg: "PC33CCC", make: "", name: "CARTER", ref: "AGENT-REF-PARK-AND-RIDE-0000002003-LONG", d: "09:40", back: [10, "21:30"], flight: "", intake: "" },
    { reg: "PD44DDD", make: "NISSAN LEAF", name: "DAVIES MS", ref: "TKO-2026-2004", d: "10:05", back: [2, "06:45"], flight: "W43302", intake: "No Show", intake_at: ago(60), intake_by: "s2" },
    { reg: "PE55EEE", make: "BMW X5", name: "EDWARDS MR", ref: "TKO-2026-2005", d: "11:50", back: [5, "18:10"], flight: "EZY8813", intake: "RTC", intake_at: ago(30), intake_by: "s1", note: "Customer rang, flight moved" },
    { reg: "PF66FFF", make: "KIA SPORTAGE", name: "FOSTER MRS", ref: "DESK-0001", d: "12:30", back: [1, "23:55"], flight: "", intake: "Collected", intake_at: ago(20), intake_by: "s2", pick_called: "New Booking", pick_called_at: ago(25), doc_path: "c1/docs/x/1.jpg", yard: "" },
    { reg: "PG77GGG", make: "TOYOTA YARIS", name: "GRAY MR", ref: "TKO-2026-2007", d: "15:45", back: [7, "11:00"], flight: "FR2207", intake: "" },
    { reg: "PH88HHH", make: "PEUGEOT 3008", name: "HILL MS", ref: "TKO-2026-2008", d: "23:20", back: [4, "02:15"], flight: "U22999", intake: "" },
  ];
  db.bookings = db.bookings.filter((b) => b.sheet_id !== "p0").concat(picks.map((c, i) => { const { d, back, ...rest } = c;
    return { id: "pk" + (i + 1), sheet_id: "p0", company_id: "c1", kind: "picks", num: i + 1, note: "", phone: "07700900" + (300 + i), ...rest, drop_at: lonIso(TONIGHT, d), return_at: lonIso(addDays(TONIGHT, back[0]), back[1]) }; }));
  db.flightRuns = [{ at: ago(35), source: "schedule", trigger: "timer", result: {} }, { at: ago(12), source: "live", trigger: "timer", result: {} }];
  return db;
}
// The key check (Menu → Key check): TakeOff's yards and a night of cars.
function keysDb(theme = "ops") {
  const db = makeDb(); db.company.yards = ["Y", "S", "CP", "NY", "T"];
  db.company.brand = { colour: "#F9A01B", ink: "#1A1A1A", short: "TakeOff", theme };
  const cars = [["N99LCD", "", "ANDRIICIUC MX", "06:50"], ["LX59XHS", "", "RETKA MX", "07:00"], ["KV18WVM", "CP", "NIKOLLI MR", "07:15"], ["PX71OWD", "CP", "MIHAI MX", "08:00"],
    ["SY70XOH", "S", "FINCH MR", "09:45"], ["GY16WJJ", "CP", "ZAJANCKAUSKAS MX", "11:00"], ["OW74TXH", "S", "TEMPBOOKING MR", "11:20"], ["WP19ENO", "NY", "TAIT MR", "11:30"],
    ["AF25KJV", "CP", "KHAN MR", "11:40"], ["SL73NFY", "CP", "MOON MR", "11:45"], ["KM71DDJ", "NY", "BRADBURY MR", "11:50"], ["AF75VWM", "Y", "TEMPBOOKING MR", "11:50"],
    ["YK71ZNM", "Y", "ROBSON MRS", "11:55"], ["SN22THV", "CP", "SMITH MR", "12:00"], ["BD68KLO", "Y", "PATEL MRS", "12:30"], ["MF19XRT", "S", "JONES MR", "13:10"], ["LR21PKN", "", "OKAFOR MS", "14:05"]];
  const day = TONIGHT;
  db.bookings = db.bookings.filter((b) => b.sheet_id !== "d0").concat(cars.map((c, i) => ({ id: "k" + (i + 1), sheet_id: "d0", company_id: "c1", kind: "drops", ref: "K" + i, reg: c[0], yard: c[1] || null, num: i + 1, name: c[2], flight: "W4" + (3600 + i), return_at: iso(day, c[3]), note: "" })))
    .concat([{ id: "k99", sheet_id: "d0", company_id: "c1", kind: "drops", ref: "K99", reg: "EF12GHJ", yard: "Y", num: 40, name: "GONE MR", flight: "W40001", return_at: iso(day, "06:20"), sent_at: iso(day, "06:00"), cleared_at: iso(day, "06:30"), note: "" }]);
  return db;
}
function rpc(db, fn, a) {
  const row = (id) => db.bookings.find((x) => x.id === id);
  // EARLY RETURN's night (part 75): tonight, or that day's DROPS sheet, made if missing.
  const earlySheet = (day) => {
    if (!day || day === TONIGHT) return "d0";
    let sh = db.sheets.find((x) => x.kind === "drops" && x.day === day);
    if (!sh) { sh = { id: "dx" + db.sheets.length, company_id: "c1", kind: "drops", day }; db.sheets.push(sh); }
    return sh.id;
  };
  switch (fn) {
    case "key_check_get": return db.keyChecks?.[a.p_sheet] || { session: null, entries: [] };
    case "key_check_start": {
      if (db.me.role === "view") throw new Error("You cannot check keys.");
      db.keyChecks ||= {};
      const old = db.keyChecks[a.p_sheet];
      if (old && !a.p_restart) return old;
      if (a.p_restart && old?.session.id !== a.p_previous) throw new Error("The key check changed. Refresh and try again.");
      const session = { id: 'key-' + (db.keySeq = (db.keySeq || 0) + 1), sheet_id: a.p_sheet, status: 'active', started_at: now(), started_by_name: db.me.name };
      const entries = db.bookings.filter(b => b.sheet_id === a.p_sheet && !b.sent_at && !b.cleared_at && !b.removed_at).map(b => ({ booking_id: b.id, state: 'unchecked', revision: 0 }));
      return db.keyChecks[a.p_sheet] = { session, entries };
    }
    case "key_check_set": {
      const k = Object.values(db.keyChecks || {}).find(k => k.session.id === a.p_session);
      if (!k || k.session.status !== 'active') throw new Error('This check has ended.');
      const b = row(a.p_booking);
      if (!b || b.sheet_id !== k.session.sheet_id || b.cleared_at || b.sent_at || b.removed_at) throw new Error('That key is no longer in the cabinet.');
      let e = k.entries.find(e => e.booking_id === a.p_booking);
      if (!e) { e = { booking_id: a.p_booking, state: 'unchecked', revision: 0 }; k.entries.push(e); }
      if (e.revision !== a.p_revision) throw new Error('Someone updated this key. Refresh and check its current status.');
      if (e.state !== a.p_state) Object.assign(e,{ state: a.p_state, revision: e.revision + 1, checked_at: now(), checked_by_name: db.me.name });
      return e;
    }
    case "key_check_finish": {
      const k = Object.values(db.keyChecks || {}).find(k => k.session.id === a.p_session);
      const cars = db.bookings.filter(b => b.sheet_id === k.session.sheet_id && !b.sent_at && !b.cleared_at && !b.removed_at);
      if (cars.some(b => !k.entries.some(e => e.booking_id === b.id && e.state === 'found'))) throw new Error('Keys still need attention.');
      Object.assign(k.session,{ status:'completed', finished_at:now(), finished_by_name:db.me.name, expected_count:cars.length, found_count:cars.length });return k.session;
    }
    case "me": return db.me;
    case "i_am_here": db.hereCalls = (db.hereCalls || 0) + 1; return null;
    case "staff_seen": return db.seen || [];
    case "set_acting": { if (a.p_name && !(db.me.desk_names || []).includes(a.p_name)) throw new Error("That name isn't on this login."); db.me.acting = a.p_name; return db.me; }
    case "set_desk_names": { const p = db.staff.find((x) => x.id === a.p_staff); p.desk_names = a.p_names; return p; }
    case "set_capacity": {
      const yc = {}; for (const [k, v] of Object.entries(a.p_yards || {})) { if (!db.company.yards.includes(k)) throw new Error("Not a valid yard: " + k); if (+v) yc[k] = +v; }
      db.company.capacity = +a.p_total || null; db.company.yard_capacity = yc; return { capacity: db.company.capacity, yard_capacity: yc };
    }
    case "set_yard_colours": {
      const yc = {}; for (const [k, v] of Object.entries(a.p_colours || {})) { if (!db.company.yards.includes(k)) throw new Error("Not a valid yard: " + k); if (v) yc[k] = v.toUpperCase(); }
      db.company.yard_colours = yc; return { yard_colours: yc };
    }
    case "set_swipe_only": db.company.swipe_only = !!a.p_on; return !!a.p_on;
    case "admin_clients": return [{ id: "c1", name: "TAKEOFF", slug: "takeoff", yards: ["NB", "S"], brand: { colour: "#F59E0B", host: "takeoff-ops.vercel.app" }, staff: 14, has_owner: true, sheets_7d: 18, cars_7d: 2074, last_activity: now() }];
    case "admin_usage": return { db_bytes: 25709715, store_bytes: 0, store_files: 0, clients: [{ id: "c1", name: "TAKEOFF", cars_30d: 2074, sheets_30d: 18, pt_sets_30d: 134, pt_photos_30d: 4277, fr24_calls_30d: 209, fr24_calls_today: 46, timetable_runs_30d: 148, timetable_last_ok: now(), timetable_last_error: "", activity_30d: 5805 }] };
    case "set_handover_note": { db.handover = { note: a.p_note, at: now(), by: "RAKESH" }; return db.handover; }
    case "owner_dashboard": (db.dashCalls = db.dashCalls || []).push(a.p_since); return db.dash || { added: [], paid: [], owed: [], removed: [], complaints: [], early: 0, changed: 0 };
    case "my_permissions": return db.perms || Object.fromEntries(["sent", "called", "clear", "yard", "summary", "log", "flights", "rtc", "picksinfo", "import", "staff", "settings", "note", "intake"].map((k) => [k, true]));
    case "tap_drop": {
      // part 98: the name picked on a shared login rides with the stamp.
      function byName(b, c) { b.by_name = { ...(b.by_name || {}) }; if (b[c] && db.me && db.me.acting) b.by_name[c] = db.me.acting; else delete b.by_name[c]; }
      const b = row(a.p_booking), f = { sent: "sent", called: "called", clear: "cleared" }[a.p_action];
      b[f + "_at"] = a.p_on ? now() : null; b[f + "_by"] = a.p_on ? "s1" : null;
      byName(b, f + "_by");
      if (a.p_action === "called" && !a.p_on && b.called_word === "Overstay" && !b.early) { const sh = db.sheets.find((x) => x.id === b.sheet_id); if (b.return_at && sh && b.return_at.slice(0, 10) >= sh.day) b.overstay = false; }
      if (a.p_action === "called") b.called_word = a.p_on ? a.p_word || "Called" : "";
      if (a.p_action === "called" && a.p_on && a.p_word === "Overstay") b.overstay = true;
      if (a.p_action === "clear") b.clear_word = a.p_on ? a.p_word || "Collected" : "";
      return b;
    }
    case "tap_pick": {
      function byName(b, c) { b.by_name = { ...(b.by_name || {}) }; if (b[c] && db.me && db.me.acting) b.by_name[c] = db.me.acting; else delete b.by_name[c]; }
      const b = row(a.p_booking);
      if (a.p_key === "intake") { b.intake = a.p_value; b.intake_at = a.p_value ? now() : null; b.intake_by = a.p_value ? "s1" : null; byName(b, "intake_by"); }
      else if (a.p_key === "pt") { b.pt_at = a.p_value ? now() : null; b.pt_by = a.p_value ? "s1" : null; byName(b, "pt_by"); }
      else { b.pick_called = a.p_value; b.pick_called_at = a.p_value ? now() : null; }
      return b;
    }
    case "set_note": { const b = row(a.p_booking); b.note = a.p_note; return b; }
    case "download_my_company": return { format: "takeoff-ops-company-export", bookings: db.bookings };
    case "import_sheet": { const sh = db.sheets.find((x) => x.kind === a.p_kind && x.day === a.p_day); (db.imports = db.imports || []).push({ id: 70 + db.imports.length, kind: a.p_kind, day: a.p_day, at: now(), by: "RAKESH", added: a.p_rows.length, changed: 0, undone: false, latest: true }); return { sheet_id: sh ? sh.id : "p0", added: a.p_rows.length, updated: 0, early: 0, moved: 0, new_marked: 0, undo_id: 70 + db.imports.length - 1 }; }
    case "admin_save_client": (db.clientSaves = db.clientSaves || []).push(a.p); return { id: a.p.id, name: a.p.name, brand: a.p.brand };
    case "recent_imports": return db.imports || [];
    case "swift_schedule_set": { if (db.me.role !== "owner" && db.me.role !== "manager") throw new Error("Only owners and managers can set the schedule."); db.autoImport = { ...db.autoImport, schedule: { on: a.p_on, times: a.p_times, by: db.me.name || "RAKESH", last: db.autoImport.schedule && db.autoImport.schedule.last } }; return { on: a.p_on, times: a.p_times }; }
    case "auto_import_status": return db.autoImport || { available: false };
    case "swift_reviews_open": return db.reviews || [];
    case "swift_review_resolve": { db.reviews = (db.reviews || []).filter((r) => r.id !== a.p_id); db.autoImport.open_reviews = db.reviews.length; return null; }
    case "pt_copy_report": (db.reports = db.reports || []).push(a); return null;
    case "undo_import": { const i = (db.imports || []).find((x) => x.id === a.p_id); if (i) i.undone = true; return { removed: 2, kept: 0, restored: 0, sheet_id: "p0", sheet_gone: false }; }
    case "pt_unsaved": return db.ptUnsaved || [];
    case "drops_missing": return (a.p_ids || []).map((id) => db.bookings.find((x) => x.id === id)).filter((b) => b && b.kind === "picks" && b.return_at)
      .map((b) => ({ b, d: db.sheets.find((s) => s.kind === "drops" && s.day === b.return_at.slice(0, 10)) }))
      .filter(({ b, d }) => d && !db.bookings.some((x) => x.sheet_id === d.id && x.reg === b.reg))
      .map(({ b, d }) => ({ id: b.id, reg: b.reg, name: b.name, return_at: b.return_at, day: d.day, sheet_id: d.id }));
    case "add_pick_to_drops": { const p = db.bookings.find((x) => x.id === a.p_booking), d = db.sheets.find((s) => s.kind === "drops" && s.day === p.return_at.slice(0, 10)); const n = { ...p, id: "dn" + db.bookings.length, sheet_id: d.id, kind: "drops" }; db.bookings.push(n); return n; }
    case "add_booking": { const n = { id: "new" + db.bookings.length, company_id: "c1", sheet_id: a.p_sheet, kind: db.sheets.find((x) => x.id === a.p_sheet).kind, ref: a.p.ref || "", reg: String(a.p.reg).toUpperCase(), name: a.p.name || "", num: 99, return_at: a.p.return_local ? new Date(a.p.return_local.replace(" ", "T") + ":00+01:00").toISOString() : null, note: a.p.note || "" };
      if (a.p.desk && n.kind === "picks") Object.assign(n, { pick_called: "New Booking", pick_called_at: now(), intake: a.p.taken_in ? "Collected" : "", intake_at: a.p.taken_in ? now() : null, yard: a.p.yard || "" });
      db.bookings.push(n); return n; }
    case "set_doc": { const b = row(a.p_booking); b.doc_path = a.p_path; b.doc_at = now(); return b; }
    case "set_exit_fee": db.company.exit_fee = a.p_fee; db.company.exit_free = a.p_free.map((x) => x.toUpperCase().replace(/[^A-Z0-9]/g, "")); return { exit_fee: a.p_fee, exit_free: db.company.exit_free };
    case "set_exit_paid": { const b = row(a.p_booking); Object.assign(b, { exit_method: a.p_method, exit_amount: a.p_method ? db.company.exit_fee : null, exit_at: a.p_method ? new Date().toISOString() : null, exit_by: a.p_method ? "s1" : null, exit_photo: a.p_photo || "" }); return b; }
    case "set_overstay_paid": { const b = row(a.p_booking); Object.assign(b, { charge_amount: a.p_amount, charge_method: a.p_method, charge_at: a.p_method ? new Date().toISOString() : null, charge_by: a.p_method ? "s1" : null }); return b; }
    case "set_overstay_agreed": { const b = row(a.p_booking); b.charge_agreed = a.p_amount; b.charge_reason = a.p_amount == null ? "" : (a.p_reason || ""); return b; }
    case "remove_booking": { const b = row(a.p_booking); Object.assign(b, { removed_at: new Date().toISOString(), removed_reason: a.p_reason, removed_by: "s1" }); return b; }
    case "restore_booking": { const b = db.bookings.find((x) => x.id === a.p_booking); Object.assign(b, { removed_at: null, removed_reason: "" }); return b; }
    case "set_return": { const b = row(a.p_booking); if (!b.orig_return_at) b.orig_return_at = b.return_at; b.return_at = new Date(a.p_return_local.replace(" ", "T") + ":00+01:00").toISOString();
      const to = db.sheets.find((x) => x.kind === "drops" && x.day === a.p_return_local.slice(0, 10) && x.day > (db.sheets.find((y) => y.id === b.sheet_id) || {}).day); if (to) b.sheet_id = to.id; return b; }
    case "set_reg": { const b = row(a.p_booking); b.reg = a.p_reg; return b; }
    case "set_yard": { const b = row(a.p_booking); b.yard = a.p_yard; return b; }
    case "set_flight": { const b = row(a.p_booking); if (b.flight !== a.p_flight) Object.assign(b, { sched_at: null, sched_time: "", est_at: null, est_time: "", flight_status: a.p_flight === "NO FLIGHT" ? "noflight" : "", flight_note: "" }); b.flight = a.p_flight; return b; }
    case "set_pick_flight": { const b = row(a.p_booking); b.flight = a.p_flight; return b; }
    case "set_pick_return": { const b = row(a.p_booking); b.return_at = new Date(a.p_return_local.replace(" ", "T") + ":00+01:00").toISOString(); return b; }
    case "set_sched_time": { const b = row(a.p_booking); b.sched_time = a.p_time; return db.schedEcho === false ? null : b; }
    case "early_return": { const b = row(a.p_booking); b.moved_from = b.sheet_id; b.sheet_id = earlySheet(a.p_day); b.early = true; b.early_at = now(); b.num = 105; return b; }
    case "early_return_from_picks": { const p = row(a.p_picks); const n = { ...p, id: "de" + db.bookings.length, sheet_id: earlySheet(a.p_day), kind: "drops", num: 106, early: true, early_at: now(), moved_from: "d1", intake: "", called_at: null, sent_at: null, cleared_at: null }; db.bookings.push(n); return n; }
    case "undo_early_return": { const b = row(a.p_booking); b.sheet_id = b.moved_from; b.moved_from = null; b.early = false; return b; }
    case "pt_link_save": {
      let l = db.ptLinks.find((x) => x.token === a.p_token);
      if (!l) db.ptLinks.push(l = { token: a.p_token, booking_id: a.p_booking, paths: [], at: now() });
      l.paths = [...new Set(l.paths.concat(a.p_paths))];
      return a.p_token;
    }
    case "pt_photos_for": {
      const me = row(a.p_booking);
      return db.ptLinks.filter((l) => { const b = row(l.booking_id); return b && (b.id === me.id || b.ref === me.ref); }).map((l) => ({ token: l.token, n: l.paths.length, at: l.at, by: "RAKESH" }));
    }
    case "set_pt_method": db.company.pt_method = a.p_method; return a.p_method;
    case "set_pt_method_ios": db.company.pt_method_ios = a.p_method; return a.p_method;
    default: return null;
  }
}
const R2 = "https://1b2139c185037dcd7e0328869b8b6fcf.r2.cloudflarestorage.com";
async function backend(ctx, db) {
  await ctx.route("**/*.supabase.co/**", async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (p.startsWith("/realtime/")) return route.abort();
    if (p.startsWith("/auth/")) return reply(200, {});
    if (db.down) return route.fulfill({ status: 503, contentType: "text/plain", body: "upstream connect error" });
    if (p.startsWith("/rest/v1/rpc/")) {
      const fn = p.slice(13), args = JSON.parse(req.postData() || "{}");
      db.calls.push({ fn, args });
      if (db.keyGate && fn.startsWith('key_check_')) { const error = await db.keyGate(fn,args); if (error) return reply(400,{message:error}); }
      try { return reply(200, rpc(db, fn, args)); } catch(e) { return reply(400,{message:e.message}); }
    }
    if (p.startsWith("/storage/v1/object/sign/pt-photos/")) return reply(200, { signedURL: "/object/sign/pt-photos/" + p.slice(34) + "?token=t" });
    if (p.startsWith("/storage/v1/object/pt-photos/")) { db.uploads.push(p.slice(29)); (db.uploadMarks = db.uploadMarks || []).push(((req.postDataBuffer() || Buffer.alloc(0)).toString("latin1").match(/name="cacheControl"\r\n\r\n(\d+)/) || [])[1] || ""); return reply(200, { Key: "pt-photos/" + p.slice(29) }); }
    if (p.startsWith("/functions/v1/manage-staff")) {
      const a = JSON.parse(req.postData() || "{}"); (db.staffCalls = db.staffCalls || []).push(a);
      // Opening a client: from now on the phone is that client's owner.
      if (a.action === "client_open") { db.company = db.clientCompany; db.me = { ...db.me, company_id: db.company.id, name: "RAKESH (PARKING OPS)" }; return reply(200, { token_hash: "th", name: db.company.name }); }
      return reply(400, { error: "not in the test" });
    }
    if (p.startsWith("/functions/v1/flights")) {
      const a = JSON.parse(req.postData() || "{}"); (db.flightCalls = db.flightCalls || []).push(a);
      // A driver or terminal sign-in: 2 presses an hour (the real function counts them).
      if (db.checksUsed !== undefined) {
        if (db.checksUsed >= 2) return reply(429, { error: "You've used your 2 flight checks this hour. Next one in 40 min.", left: 0 });
        db.checksUsed++; (db.flightRuns = db.flightRuns || []).unshift({ at: new Date().toISOString(), source: a.action === "timetable" ? "schedule" : "live", trigger: "button", result: { by: db.me.id } });
      }
      return reply(200, a.action === "timetable" ? { schedule: { filled: 2, moved: 0, notfound: 0 } } : { company: "TAKEOFF", live: { written: 1, landed: 1 } });
    }
    if (p.startsWith("/functions/v1/takeoff-bookings")) {
      const ar = JSON.parse(req.postData() || "{}"); (db.autoRuns = db.autoRuns || []).push(ar);
      if (db.bookingsDelay && ar.action === "apply") await new Promise((r) => setTimeout(r, db.bookingsDelay));
      if (ar.action === "preview") return db.previewError ? reply(200, { ok: false, error: db.previewError }) : reply(200, { ok: true, preview: db.preview || { hash: "h1", window: {}, counts: { new: 2, changed: 1, unchanged: 4, review: 1, invalid: 0 }, can_apply: true, items: [{ kind: "drops", day: TONIGHT, ref: "T1", reg: "AB12CDE", status: "changed", changes: [{ field: "return", from: "10:00", to: "12:30" }] }], reviews: [], invalid: [] } });
      if (db.applyError) return reply(200, { ok: false, error: db.applyError });
      return reply(200, { ok: true, summary: { days: [{ kind: "drops", day: TONIGHT, added: 2, updated: 1 }, { kind: "picks", day: TONIGHT, added: 3, updated: 0 }], drops_rows: 3, picks_rows: 3 } });
    }
    if (p.startsWith("/functions/v1/pt-r2")) {
      const a = JSON.parse(req.postData() || "{}");
      (db.r2Asks = db.r2Asks || []).push({ ...a, auth: req.headers()["authorization"] || "" });
      if (db.r2Down) return reply(503, { error: "Photo store not set up yet." });
      return reply(200, { urls: Object.fromEntries(a.names.map((n) => [n, `${R2}/takeoff-pt-photos/c1/${a.booking}/${a.token}/${n}?X-Amz-Signature=x`])) });
    }
    if (p.startsWith("/functions/v1/pt-photos")) {
      const l = db.ptLinks.find((x) => x.token === JSON.parse(req.postData()).token);
      return l ? reply(200, { reg: "DY16MYO", company: "TAKEOFF", by: "RAKESH", created_at: l.at, photos: l.paths.map((x, i) => ({ url: BASE + "/icons/icon-192.png", download: BASE + "/icons/icon-192.png", name: "DY16MYO-0" + (i + 1) + ".jpg" })) }) : reply(404, { error: "These photos have expired or the link isn't right." });
    }
    const q = Object.fromEntries(u.searchParams);
    if (p === "/rest/v1/companies") return reply(200, db.company);
    // The owner's last "download company data" (backup reminder): today, unless a test says otherwise.
    if (p === "/rest/v1/activity" && q.action === "eq.SETTINGS") return reply(200, db.lastDownload === null ? [] : [{ at: db.lastDownload || new Date().toISOString() }]);
    if (p === "/rest/v1/activity" && (q.booking_id || "").startsWith("in.(")) {
      const ids = q.booking_id.slice(4, -1).split(",").map((x) => x.replace(/"/g, ""));
      return reply(200, (db.activity || []).filter((a) => ids.includes(a.booking_id)).sort((x, y) => (x.at < y.at ? 1 : -1)));
    }
    // Summary → Activity: all activity, newest first.
    if (p === "/rest/v1/activity") return reply(200, (db.activity || []).slice().sort((x, y) => (x.at < y.at ? 1 : -1)));
    if (p === "/rest/v1/flight_runs") return reply(200, db.flightRuns || []);
    if (p === "/rest/v1/staff") return reply(200, db.staff);
    if (p === "/rest/v1/sheets") return reply(200, db.sheets);
    if (p === "/rest/v1/bookings") {
      // db.sheetGate[sheetId]: a function that returns a promise, "fail" makes the load fail (sheet-switching tests).
      if (db.sheetGate && q.sheet_id && q.sheet_id.startsWith("eq.") && db.sheetGate[q.sheet_id.slice(3)]) { const v = await db.sheetGate[q.sheet_id.slice(3)](); if (v === "fail") return reply(500, { message: "boom" }); }
      let rows = db.bookings.filter((b) => !b.removed_at);
      if (q.sheet_id && q.sheet_id.startsWith("eq.")) rows = rows.filter((b) => b.sheet_id === q.sheet_id.slice(3));
      if (q.sheet_id && q.sheet_id.startsWith("neq.")) rows = rows.filter((b) => b.sheet_id !== q.sheet_id.slice(4));
      if (q.id && q.id.startsWith("eq.")) rows = rows.filter((b) => b.id === q.id.slice(3));
      if (q.id && q.id.startsWith("neq.")) rows = rows.filter((b) => b.id !== q.id.slice(4));
      if (q.ref && q.ref.startsWith("eq.")) rows = rows.filter((b) => b.ref === q.ref.slice(3));
      if (q.ref && q.ref.startsWith("in.(")) { const refs = q.ref.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, "")); rows = db.bookings.filter((b) => refs.includes(b.ref)); }
      (db.bookingGets = db.bookingGets || []).push(q);
      if (q.updated_at && q.updated_at.startsWith("gte.")) { const t = q.updated_at.slice(4); rows = rows.filter((b) => (b.updated_at || "") >= t); }
      if (q.or) { const m = q.or.match(/%([^%]+)%/); const t = m ? m[1].toUpperCase() : ""; rows = rows.filter((b) => [b.reg, b.ref, b.phone, b.name].join(" ").toUpperCase().replace(/\s+/g, "").includes(t)); }
      if ((q.select || "").includes("sheets")) rows = rows.map((b) => ({ ...b, sheets: (({ day, kind }) => ({ day, kind }))(db.sheets.find((s) => s.id === b.sheet_id)) }));
      if (req.headers()["accept"] === "application/vnd.pgrst.object+json") return reply(200, rows[0] || null);
      return reply(200, rows);
    }
    return reply(200, []);
  });
  // Cloudflare R2: signed PUTs of the app's copies.
  await ctx.route(R2 + "/**", async (route) => {
    const req = route.request(), cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "PUT, GET" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
    if (req.method() === "PUT") { (db.r2Puts = db.r2Puts || []).push({ key: new URL(req.url()).pathname.slice(1), size: (req.postDataBuffer() || Buffer.alloc(0)).length, type: req.headers()["content-type"] }); return route.fulfill({ status: 200, headers: cors, body: "" }); }
    return route.fulfill({ status: 404, headers: cors, body: "" });
  });
  await ctx.route("https://wa.me/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "WhatsApp" }));
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = b64({ alg: "HS256" }) + "." + b64({ sub: "u1", role: "authenticated", exp: 4102444800 }) + ".sig";
async function phone(browser, db, { signedIn = true, ua, width = 390, noBitmap = false, still = "", pdfLabels = false, stuckBlob = false, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, userAgent: ua, permissions: ["camera"], ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
  await backend(ctx, db);
  await ctx.addInitScript(([jwt, signedIn, noBitmap, still, pdfLabels, stuckBlob]) => {
    // Every label the PDF button shows, however quickly it changes.
    if (pdfLabels) {
      window.__pdfLabels = [];
      new MutationObserver(() => { const b = document.querySelector("[data-ptpdf]"); if (b && window.__pdfLabels[window.__pdfLabels.length - 1] !== b.textContent) window.__pdfLabels.push(b.textContent); })
        .observe(document, { childList: true, subtree: true, characterData: true });
    }
    // A pretend Android camera for real photos: "ok" (landscape, like the
    // video), "side" (handed back on its side) or "fail".
    if (still) {
      window.__stills = 0;
      window.ImageCapture = class {
        constructor(track) { this.track = track; }
        async getPhotoCapabilities() { return { fillLightMode: ["auto", "off", "flash"] }; }
        async takePhoto() {
          window.__stills++;
          if (still === "fail") throw new Error("camera busy");
          const side = still === "side", c = document.createElement("canvas"); c.width = side ? 600 : 800; c.height = side ? 800 : 600;
          const g = c.getContext("2d"); g.fillStyle = "#3a6"; g.fillRect(0, 0, c.width, c.height);
          return await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.9));
        }
      };
    }
    if (signedIn && !sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("takeoff_link", "x".repeat(40));
      localStorage.setItem("sb-oioqjfrlwrjovnouhusp-auth-token", JSON.stringify({ access_token: jwt, refresh_token: "r", expires_at: 4102444800, expires_in: 3600, token_type: "bearer", user: { id: "u1" } }));
    }
    window.__shares = [];
    navigator.canShare = () => true;
    navigator.share = async (d) => { window.__shares.push({ n: (d.files || []).length, names: (d.files || []).map((f) => f.name), types: (d.files || []).map((f) => f.type), sizes: (d.files || []).map((f) => f.size), text: d.text || "" }); };
    try { navigator.clipboard.writeText = async () => {}; } catch (e) {}
    // Like an iPhone that won't decode a photo this way.
    if (noBitmap) window.createImageBitmap = () => Promise.reject(new Error("not supported"));
    // Like the Android phones where toBlob's answer never comes after the camera (10 Oct).
    if (stuckBlob) { window.__toBlobs = 0; HTMLCanvasElement.prototype.toBlob = function () { window.__toBlobs++; }; }
  }, [JWT, signedIn, noBitmap, still, pdfLabels, stuckBlob]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(e.message));
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) cspBlocked.push(m.text()); });
  page.__dialogs = [];
  page.on("dialog", (d) => { page.__dialogs.push(d.message()); d.accept(); });
  ctx.on("page", (p) => { if (p !== page) p.close().catch(() => {}); });
  return page;
}
const open = async (page) => { await page.goto(BASE + "/"); await page.waitForSelector("#main .row, #main .msg", { timeout: 8000 }); };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => "");
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const toast = (page) => page.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "));
// Open the DROPS or PICKS sheet: Operations' Drops | Picks in the bar, else the day picker.
const pickKind = async (page, kind) => {
  if (await page.isVisible("#kindBar")) await page.click('#kindBar [data-kind="' + kind + '"]');
  else if (await page.isVisible("#kindSeg")) await page.click('#kindSeg [data-kind="' + kind + '"]');
  else await page.selectOption("#sheetPick", kind === "picks" ? "p0" : "d0");
  await page.waitForFunction((k) => document.body.classList.contains("picks") === (k === "picks") && document.querySelector("#main .row"), kind);
};

// Each section stands alone: if one breaks part-way, it's reported and the rest still run.
async function scenario(fn, tag) {
  if (process.env.KEYS_ONLY && tag !== 'keys') return;
  if (process.env.DESK_ONLY && tag !== 'desk') return;
  if (process.env.HELD_ONLY && tag !== 'held') return;
  try { await fn(); } catch (e) {
    const at = (String(e.stack || "").match(/run\.mjs:(\d+)/) || [])[1];
    check("section finished without crashing", false, String(e.message || e).split("\n")[0] + (at ? " (run.mjs line " + at + ")" : ""));
  }
  // Each section starts clean: pages a section left open would pile up until the browser gives out.
  for (const c of browser.contexts()) await c.close().catch(() => {});
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });

// Pretend data used by more than one section.
const apbBrand = (theme) => ({ colour: "#1560BD", ink: "#FFFFFF", soft: "#E8F0FB", text: "#0E3F7E", short: "Parking Bay", theme, chrome: "#0E3F7E", mark: "P" });

const apbDb = (theme) => { const db = makeDb(); db.company = { ...db.company, name: "Airport Parking Bay", slug: "airport-parking-bay", yards: ["GS", "MY", "T"], brand: apbBrand(theme) }; return db; };

// A pretend Booking import page: sample data only (DEMO references), never real bookings.
function biDb(theme, over = {}) {
  const db = makeDb(); db.company.brand = { colour: "#F9A01B", ink: "#1A1A1A", short: "TakeOff", theme };
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  db.autoImport = { available: true, running: false, last_ok: ago(75), last_error: null, open_reviews: 1 };
  db.reviews = [{ id: 5, ref: "DEMO-1047", kind: "cancelled", detail: { name: "C Demo", reg: "CD34EFG", kind: "picks" } }];
  const site = (d, n) => ({ rows: n, by_day: { [d]: n }, by_status: { Completed: n }, site: { [d]: n }, form: "producttype=all (All) of all:All/0:Meet and Greet; filter_status=1 (Completed)" });
  db.preview = {
    hash: "h9", window: { from: TONIGHT, to: TOMORROW }, counts: { new: 3, changed: 3, unchanged: 4, review: 2, invalid: 0 }, can_apply: true,
    items: [
      { kind: "drops", day: TONIGHT, ref: "DEMO-1042", reg: "AB12CDE", status: "review", changes: [{ field: "return", from: TONIGHT + " 23:45", to: TOMORROW + " 00:30" }] },
      { kind: "drops", day: TONIGHT, ref: "DEMO-1051", reg: "EF56GHI", status: "changed", changes: [{ field: "make", from: "Kia Niro", to: "Toyota Auris" }] },
      { kind: "picks", day: TOMORROW, ref: "DEMO-1053", reg: "GH78JKL", status: "changed", changes: [{ field: "return", from: TOMORROW + " 20:25", to: TOMORROW + " 20:40" }] },
      { kind: "drops", day: TONIGHT, ref: "DEMO-1055", reg: "IJ90MNO", status: "changed", changes: [{ field: "phone", from: "07700900000", to: "07700900111" }] },
      { kind: "picks", day: TOMORROW, ref: "DEMO-1058", reg: "KL12PQR", status: "new" },
      { kind: "drops", day: TONIGHT, ref: "DEMO-1059", reg: "MN34STU", status: "new" },
      { kind: "picks", day: TOMORROW, ref: "DEMO-1060", reg: "OP56VWX", status: "new" },
    ],
    reviews: [
      { ref: "DEMO-1042", kind: "conflict", detail: { kind: "drops", why: "moved from sheet " + TONIGHT + " to " + TOMORROW + "; the app can't move it safely", changes: [] } },
      { ref: "DEMO-1047", kind: "cancelled", detail: { kind: "picks", name: "C Demo", reg: "CD34EFG", return: "", on_sheet: TOMORROW } },
    ],
    invalid: [], unchanged: ["DEMO-1001", "DEMO-1002", "DEMO-1003", "DEMO-1004"].map((r, i) => ({ kind: i % 2 ? "picks" : "drops", day: TONIGHT, ref: r, reg: "ZZ0" + i + "AAA" })),
    report: { picks: site(TOMORROW, 5), drops: site(TONIGHT, 6), flights: { rows: 7, matched: 5, cars: 6, by_day: { [TONIGHT]: 7 } } },
    ...over,
  };
  db.imports = [
    { id: 90, kind: "drops", day: TONIGHT, at: ago(20), by: "OFFICE", added: 9, changed: 1, undone: false, latest: true, source: "auto" },
    { id: 89, kind: "picks", day: TONIGHT, at: ago(35), by: "OFFICE", added: 0, changed: 0, undone: false, latest: true, source: "auto" },
    { id: 88, kind: "drops", day: TOMORROW, at: ago(120), by: "SUGU", added: 5, changed: 0, undone: false, latest: false, source: "manual" },
    { id: 87, kind: "picks", day: TOMORROW, at: ago(180), by: "SUGU", added: 4, changed: 2, undone: true, latest: false, source: "manual" },
  ];
  return db;
}

var db0Yard = "NB";

function dashData() {
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  return {
    added: [{ at: ago(2), reg: "AB12CDE", customer: "MR WALK IN", staff_name: "SUGU", action: "ADDED", value: "added by hand", kind: "drops" },
      { at: ago(5), reg: "XY34ZZZ", customer: "MRS DESK", staff_name: "TERRY", action: "CALLED", value: "New Booking", kind: "picks" }],
    paid: [{ id: "p1", reg: "CASH01", name: "MR CASH", charge_amount: 20, charge_method: "cash", charge_at: ago(3), charge_reason: "", by_name: "SUGU" },
      { id: "p2", reg: "CARD01", name: "MR CARD", charge_amount: 50, charge_method: "card", charge_at: ago(4), charge_reason: "return date changed", by_name: "SUGU" },
      { id: "p3", reg: "WAIVE1", name: "MR FREE", charge_amount: 30, charge_method: "waived", charge_at: ago(6), charge_reason: "", by_name: "RAKESH" }],
    owed: [{ id: "o1", kind: "drops", reg: "OWE001", name: "MR HERE", return_at: ago(30), cleared_at: null, overstay: true, charge_agreed: 40, charge_reason: "" },
      { id: "o2", kind: "drops", reg: "LEFT01", name: "MR GONE", return_at: ago(80), cleared_at: ago(1), overstay: true, charge_agreed: null, charge_reason: "" },
      { id: "o3", kind: "drops", reg: "ZERO01", name: "MR ONTIME", return_at: ago(1), cleared_at: null, overstay: true, charge_agreed: null, charge_reason: "" }],
    removed: [{ id: "r1", kind: "picks", reg: "NOSHOW1", name: "MR AWAY", removed_reason: "No show", removed_at: ago(7), by_name: "SUGU" }],
    complaints: [{ at: ago(8), reg: "MAD001", customer: "MR CROSS", staff_name: "TERRY" }],
    early: 2, changed: 3,
    handover: { note: "Gate 2 key is in the safe", at: new Date(Date.now() - 3600000).toISOString(), by: "SUGU" },
    onsite: (() => { const lp = new Date().toLocaleString("sv-SE", { timeZone: "Europe/London" }); const base = new Date(lp.slice(0, 10) + "T12:00:00Z"); if (lp.slice(11, 16) <= "06:00") base.setUTCDate(base.getUTCDate() - 1); return [38, 45, 30, 12].map((n, i) => ({ day: new Date(base.getTime() + i * 864e5).toISOString().slice(0, 10), here: n, in: 4 + i, out: 6 + i })); })(),
    parked: { total: 30, late: 2, late_cars: [{ reg: "LATE1", name: "Old Car", return_at: new Date(Date.now() - 2.5 * 86400000).toISOString(), yard: "NB" }, { reg: "LATE2", name: "New Car", return_at: new Date(Date.now() - 3600000).toISOString(), yard: "" }], days: [{ day: new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }), n: 8 }, { day: new Date(Date.now() + 2 * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/London" }), n: 20 }],
      yards: [{ yard: "", n: 12, days: [{ day: null, n: 2 }, { day: new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }), n: 10 }] }, { yard: db0Yard || "NB", n: 18, days: [{ day: new Date(Date.now() + 2 * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/London" }), n: 18 }] }] }
  };
}

// Exit fees for the period (database part 84), and tonight's DROPS / today's PICKS for Live queues and Checks.
function dashExit() {
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  return { fee: 10, paid: 18, cash: 60, card: 120, cash_n: 6, card_n: 12, no_photo: 1, exempt: 5, unpaid: 2,
    paid_cars: [{ id: "x1", reg: "PAID001", name: "MR PAID", ref: "FHR-9", exit_method: "card", exit_amount: 10, exit_at: ago(1), photo: true, by_name: "SUGU" }, { id: "x2", reg: "PAID002", name: "MRS PAID", ref: "", exit_method: "cash", exit_amount: 10, exit_at: ago(2), photo: false, by_name: "TERRY" }],
    cars: [{ id: "e1", reg: "NOEXIT1", name: "MR LEFT", ref: "FHR-1", cleared_at: ago(1), exit_method: "" }, { id: "e2", reg: "NOEXIT2", name: "MRS LEFT", ref: "FHR-2", cleared_at: ago(2), exit_method: "" },
      { id: "e3", reg: "NOPHOTO", name: "MR CASH", ref: "FHR-3", cleared_at: ago(3), exit_method: "cash", exit_at: ago(3), by_name: "SUGU" }] };
}

function dashSheets(db) {
  const inH = (h) => new Date(Date.now() + h * 3600000).toISOString();
  db.sheets.find((x) => x.id === "p0").day = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  db.bookings.push({ id: "pn1", sheet_id: "p0", kind: "picks", ref: "NB1", reg: "DESK001", num: 9, name: "DESK MR", drop_at: iso(TONIGHT, "10:00"), return_at: iso(TOMORROW, "10:00"), intake: "", pick_called: "New Booking", doc_path: "", note: "" },
    { id: "pn2", sheet_id: "p0", kind: "picks", ref: "NB2", reg: "DESK002", num: 10, name: "DESK TWO", drop_at: iso(TONIGHT, "11:00"), return_at: iso(TOMORROW, "10:00"), intake: "", pick_called: "New Booking", doc_path: "x/y.jpg", note: "" });
  db.bookings = db.bookings.filter((b) => b.sheet_id !== "d0").concat([
    { id: "q1", sheet_id: "d0", kind: "drops", ref: "Q1", reg: "CALL01", num: 1, name: "CALLED MR", return_at: inH(1), called_at: inH(-0.5), note: "" },
    { id: "q2", sheet_id: "d0", kind: "drops", ref: "Q2", reg: "SENT01", num: 2, name: "SENT MR", return_at: inH(0.5), called_at: inH(-1), sent_at: inH(-0.2), note: "" },
    { id: "q3", sheet_id: "d0", kind: "drops", ref: "Q3", reg: "SOON01", num: 3, name: "SOON MR", return_at: inH(1.5), note: "" },
    { id: "q4", sheet_id: "d0", kind: "drops", ref: "Q4", reg: "LATER1", num: 4, name: "LATER MR", return_at: inH(5), note: "" },
    { id: "q6", sheet_id: "d0", kind: "drops", ref: "Q6", reg: "OVER01", num: 6, name: "OVERSTAY MR", return_at: inH(-30), called_at: inH(-3), overstay: true, called_word: "Overstay", note: "" },
    { id: "q5", sheet_id: "d0", kind: "drops", ref: "Q5", reg: "DONE01", num: 5, name: "DONE MR", return_at: inH(-1), called_at: inH(-2), sent_at: inH(-1.5), cleared_at: inH(-1), note: "" }]);
}

export { chromium, http, fs, path, fileURLToPath, ROOT, TYPES, passed, check, cspBlocked, sleep, SITE_HEADERS, server, BASE, lon, L, addDays, TONIGHT, TOMORROW, iso, makeDb, now, lonIso, deskDb, keysDb, rpc, R2, backend, b64, JWT, phone, open, text, noSideScroll, toast, pickKind, scenario, browser, failed, apbBrand, apbDb, biDb, db0Yard, dashData, dashExit, dashSheets };
