// The AT DESK push in the send-alerts edge function (setups 112 and 113), with a
// pretend database and pretend push service (no network, no Deno needed):
//   node checks/at-desk-alert.mjs
// AT DESK pushes once per tap to everyone in the company with DROPS alerts on but
// the person who tapped it; never on a SENT, cleared or OVERSTAY car; a car called
// by the AT DESK tap itself gets the AT DESK push only.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { execFileSync } from "child_process";

if (!process.env.AT_DESK_ALERT_CHILD) {
  try { execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url)], { stdio: "inherit", env: { ...process.env, AT_DESK_ALERT_CHILD: "1" } }); }
  catch { process.exit(1); }
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../supabase/functions/send-alerts/index.ts"), "utf8")
  .replace(/^import \{ createClient \} from .*$/m, "const createClient = (globalThis as any).__createClient;")
  .replace(/^import webpush from .*$/m, "const webpush = (globalThis as any).__webpush;");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "alerts-"));
fs.writeFileSync(path.join(tmp, "index.ts"), src);

const now = Date.now(), iso = (ms) => new Date(ms).toISOString(), ago = (min) => iso(now - min * 60e3);
let db;
function fresh() {
  const car = { company_id: "c1", kind: "drops", num: 1, reg: "AB12CDE", yard: "MY", name: "Smith", flight: "U22464", est_time: "21:40", sched_time: "", return_at: iso(now), called_word: "", called_by: "st1", note: "", sent_at: null, cleared_at: null };
  db = {
    bookings: [
      { ...car, id: "waiting", called_at: ago(25) },
      { ...car, id: "recent", called_at: ago(10) },
      { ...car, id: "old", called_at: ago(90) },
      { ...car, id: "sent", called_at: ago(30), sent_at: ago(5) },
      { ...car, id: "cleared", called_at: ago(30), cleared_at: ago(5) },
      { ...car, id: "picks", kind: "picks", called_at: ago(30) },
      { ...car, id: "other", company_id: "c2", called_at: ago(40), called_by: null },
      { ...car, id: "overstay", called_at: ago(25), called_word: "Overstay" },
    ],
    staff: [
      { id: "st1", company_id: "c1", name: "Ann", active: true },
      { id: "st2", company_id: "c1", name: "Bob", active: true },
      { id: "st3", company_id: "c1", name: "Cy", active: true },
      { id: "st4", company_id: "c1", name: "Gone", active: false },
      { id: "st9", company_id: "c2", name: "Zed", active: true },
    ],
    alert_prefs: [{ staff_id: "st3", drops: false }],
    push_subscriptions: ["st1", "st2", "st3", "st4", "st9"].map((s) => ({ id: "p" + s, staff_id: s, endpoint: "https://push/" + s, p256dh: "k", auth: "a" })),
    alert_log: [],
  };
}
function q(table) {
  const f = [];
  const get = (r, c) => r[c];
  const rows = () => db[table].filter((r) => f.every((t) => t(r)));
  const b = {
    select() { return b; },
    eq(c, v) { f.push((r) => String(get(r, c)) === String(v)); return b; },
    is(c, v) { f.push((r) => (get(r, c) ?? null) === v); return b; },
    in(c, v) { f.push((r) => v.includes(get(r, c))); return b; },
    lte(c, v) { f.push((r) => get(r, c) != null && get(r, c) <= v); return b; },
    gte(c, v) { f.push((r) => get(r, c) != null && get(r, c) >= v); return b; },
    insert: async (v) => {
      for (const r of [].concat(v)) {
        if (table === "alert_log" && db.alert_log.some((x) => x.key === r.key)) return { error: { code: "23505" } };
        db[table].push(r);
      }
      return { error: null };
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    delete() { return { eq: async () => ({ error: null }) }; },
    then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
  };
  return b;
}
let timerOk = true;
globalThis.__createClient = () => ({ from: q, rpc: async (name) => ({ data: name === "timer_secret_ok" ? timerOk : name === "alert_discord" ? { drops_url: "https://discord.test/x", mention: "" } : null, error: null }) });
let pushed = [], discordPosts = 0;
globalThis.__webpush = { setVapidDetails() {}, sendNotification: async (sub, payload) => { pushed.push({ to: sub.endpoint.split("/").pop(), note: JSON.parse(payload) }); } };
globalThis.fetch = async () => { discordPosts++; return new Response(null, { status: 204 }); };
let handler;
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_ANON_KEY: "a", VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "s" })[k] }, serve: (h) => { handler = h; } };
await import(pathToFileURL(path.join(tmp, "index.ts")).href);

const post = async (body) => { pushed = []; const r = await handler(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "x-timer": "s" } })); return { status: r.status, json: await r.json() }; };
let failed = 0, passed = 0;
const check = (name, ok, info) => { if (ok) passed++; else failed++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " " + JSON.stringify(info))); };

const U = (n) => "00000000-0000-4000-8000-00000000000" + n;
fresh();
const base = db.bookings[0];
db.bookings = [
  { ...base, id: U(1), called_at: ago(8), called_by: "st2", desk_at: ago(0.1), desk_by: "st1" },
  { ...base, id: U(2), called_at: ago(0.1), called_by: "st1", desk_at: ago(0.1), desk_by: "st1" },
  { ...base, id: U(3), called_at: ago(8), desk_at: ago(0.1), desk_by: "st1", sent_at: ago(1) },
  { ...base, id: U(4), called_at: ago(8), called_word: "Overstay", desk_at: ago(0.1), desk_by: "st1" },
  { ...base, id: U(5), called_at: ago(8), desk_at: ago(0.1), desk_by: "st1", cleared_at: ago(1) },
];
// The CALLED push for car 1 went when it was called.
db.alert_log.push({ key: `called:${U(1)}:${db.bookings[0].called_at}` });
let r = await post({ type: "booking", id: U(1) });
const n1 = pushed[0]?.note;
check("AT DESK: one push per phone, to the others with DROPS alerts on (not the tapper, not alerts off)", r.status === 200 && pushed.map((p) => p.to).sort().join() === "st2", pushed);
check("AT DESK: the title names the car, the body when and who", /^AT DESK: #1 · AB12CDE \(MY\) — Smith$/.test(n1?.title) && /^AT DESK at \d\d:\d\d by Ann · U22464 · due 21:40$/.test(n1?.body), n1);
check("AT DESK: Discord's DROPS channel gets it too", discordPosts === 1, discordPosts);
r = await post({ type: "booking", id: U(1) });
check("AT DESK: the same tap never pushes twice", pushed.length === 0, pushed);
db.bookings[0].desk_at = ago(0.05);
r = await post({ type: "booking", id: U(1) });
check("AT DESK off and on again: a new push", pushed.length === 1 && /^AT DESK: /.test(pushed[0].note.title), pushed);
r = await post({ type: "booking", id: U(2) });
check("AT DESK on a car not called yet: only the AT DESK push, no CALLED push", pushed.length === 1 && /^AT DESK: /.test(pushed[0].note.title) && !db.alert_log.some((x) => x.key.startsWith("called:" + U(2))), pushed);
for (const [id, why] of [[U(3), "SENT"], [U(4), "OVERSTAY"], [U(5), "cleared"]]) {
  r = await post({ type: "booking", id });
  check("AT DESK on a " + why + " car: no AT DESK push", !pushed.some((p) => /^AT DESK/.test(p.note.title)), pushed);
}
// COMPLAINT still reads as before (the label's emoji is left off the body).
Object.assign(db.bookings[4], { id: U(6), desk_at: null, clear_word: "COMPLAINT", cleared_at: ago(0.1), cleared_by: "st2" });
r = await post({ type: "booking", id: U(6) });
check("COMPLAINT push unchanged", pushed.some((p) => /^🚨 COMPLAINT: /.test(p.note.title) && /^COMPLAINT at /.test(p.note.body)), pushed);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
