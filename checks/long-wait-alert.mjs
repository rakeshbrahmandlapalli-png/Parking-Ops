// The long-wait alert in the send-alerts edge function, with a pretend
// database and pretend push service (no network, no Deno needed):
//   node checks/long-wait-alert.mjs
// A DROPS car CALLED 20 to 60 minutes ago with no driver SENT and not cleared
// is pushed once to everyone in its company with DROPS alerts on (setup 88).
// OVERSTAY cars get no WAITING push, and their OVERSTAY push goes once per car.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { execFileSync } from "child_process";

if (!process.env.LONG_WAIT_CHILD) {
  try { execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url)], { stdio: "inherit", env: { ...process.env, LONG_WAIT_CHILD: "1" } }); }
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

fresh();
let r = await post({ type: "longwait" });
const cars = [...new Set(pushed.map((p) => p.note.tag))];
check("only the DROPS cars CALLED 20-60 min ago, not SENT, not cleared", r.status === 200 && cars.sort().join() === "drops-other,drops-waiting", { r, cars });
const mine = pushed.filter((p) => p.note.tag === "drops-waiting").map((p) => p.to).sort();
check("pushed to everyone active in that company with DROPS alerts on, the caller included", mine.join() === "st1,st2", mine);
check("never to another company's phones", !pushed.some((p) => p.note.tag === "drops-waiting" && p.to === "st9") && pushed.some((p) => p.note.tag === "drops-other" && p.to === "st9"), pushed);
const note = pushed.find((p) => p.note.tag === "drops-waiting")?.note;
check("title says how long and which car; body says who called and that no driver is SENT", /^⏱ WAITING 25 MIN: #1 · AB12CDE \(MY\) — Smith$/.test(note?.title) && /^CALLED at \d\d:\d\d by Ann, no driver SENT yet · U22464 · due 21:40$/.test(note?.body), note);
check("an OVERSTAY car gets no WAITING push", !pushed.some((p) => p.note.tag === "drops-overstay") && r.json.waiting === 2, r);
check("Discord gets one post per car", discordPosts === 2, discordPosts);
r = await post({ type: "longwait" });
check("five minutes later: nothing sent again for the same call", pushed.length === 0 && r.json.sent === 0, r);
db.bookings.find((b) => b.id === "waiting").called_at = ago(21);
r = await post({ type: "longwait" });
check("called again (a new CALLED time): one new alert", [...new Set(pushed.map((p) => p.note.tag))].join() === "drops-waiting", pushed);
// The database trigger sends booking ids (uuids).
const OV = "00000000-0000-4000-8000-000000000001", RC = "00000000-0000-4000-8000-000000000002";
const ov = db.bookings.find((b) => b.id === "overstay");
ov.id = OV; ov.called_at = ago(2);
r = await post({ type: "booking", id: OV });
const ovNote = pushed.find((p) => p.note.tag === "drops-" + OV)?.note;
check("OVERSTAY tapped: one OVERSTAY push to the others", r.status === 200 && /^OVERSTAY: /.test(ovNote?.title) && pushed.every((p) => p.to !== "st1"), pushed);
ov.called_at = ago(1);
r = await post({ type: "booking", id: OV });
check("OVERSTAY tapped off and on again: no second push", pushed.length === 0, pushed);
r = await post({ type: "longwait" });
Object.assign(db.bookings.find((b) => b.id === "recent"), { id: RC, called_at: ago(1) });
r = await post({ type: "booking", id: RC });
check("a normal CALLED still pushes", pushed.some((p) => p.note.tag === "drops-" + RC && /^CALLED: /.test(p.note.title)), pushed);
timerOk = false;
r = await post({ type: "longwait" });
check("without the timer secret: refused", r.status === 403 && pushed.length === 0, r);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
