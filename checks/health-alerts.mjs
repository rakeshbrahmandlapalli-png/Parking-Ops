// The "health" message in the send-alerts edge function (setup 100), with a
// pretend database, push service and Discord (no network, no Deno needed):
//   node checks/health-alerts.mjs
// Each warning goes once a day to the people health_status() names, never to
// clients; a push that fails (not "phone gone") is noted for Clients → Health.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { execFileSync } from "child_process";

if (!process.env.HEALTH_CHILD) {
  try { execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url)], { stdio: "inherit", env: { ...process.env, HEALTH_CHILD: "1" } }); }
  catch { process.exit(1); }
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../supabase/functions/send-alerts/index.ts"), "utf8")
  .replace(/^import \{ createClient \} from .*$/m, "const createClient = (globalThis as any).__createClient;")
  .replace(/^import webpush from .*$/m, "const webpush = (globalThis as any).__webpush;");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "alerts-"));
fs.writeFileSync(path.join(tmp, "index.ts"), src);


let db, health, rpcCalls = [];
function fresh() {
  db = {
    staff: [{ id: "rk", company_id: "c1", name: "RAKESH", active: true }],
    alert_prefs: [],
    push_subscriptions: [{ id: "p1", staff_id: "rk", company_id: "c1", endpoint: "https://push/rk", p256dh: "k", auth: "a" }, { id: "p2", staff_id: "zz", company_id: "c1", endpoint: "https://push/zz", p256dh: "k", auth: "a" }],
    alert_log: [],
  };
  health = { warnings: [{ key: "backup", text: "No nightly backup since 19 Oct 04:15." }], to: ["rk"], discord: null };
}
function q(table) {
  const f = [];
  const rows = () => db[table].filter((r) => f.every((t) => t(r)));
  const b = {
    select() { return b; },
    eq(c, v) { f.push((r) => String(r[c]) === String(v)); return b; },
    in(c, v) { f.push((r) => v.includes(r[c])); return b; },
    insert: async (v) => {
      for (const r of [].concat(v)) {
        if (table === "alert_log" && db.alert_log.some((x) => x.key === r.key)) return { error: { code: "23505" } };
        db[table].push(r);
      }
      return { error: null };
    },
    delete() { return { eq: async () => ({ error: null }) }; },
    then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
  };
  return b;
}
let timerOk = true, failPush = 0;
globalThis.__createClient = () => ({ from: q, rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: name === "timer_secret_ok" ? timerOk : name === "health_status" ? health : null, error: null }; } });
let pushed = [], posts = [];
globalThis.__webpush = { setVapidDetails() {}, sendNotification: async (sub, payload) => { if (failPush) { const e = new Error("bad"); e.statusCode = failPush; e.body = "Server error"; throw e; } pushed.push({ to: sub.endpoint.split("/").pop(), note: JSON.parse(payload) }); } };
globalThis.fetch = async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); };
let handler;
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_ANON_KEY: "a", VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "s" })[k] }, serve: (h) => { handler = h; } };
await import(pathToFileURL(path.join(tmp, "index.ts")).href);

const post = async (body) => { pushed = []; posts = []; rpcCalls = []; const r = await handler(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "x-timer": "s" } })); return { status: r.status, json: await r.json() }; };
let failed = 0, passed = 0;
const check = (name, ok, info) => { if (ok) passed++; else failed++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " " + JSON.stringify(info))); };

fresh();
let r = await post({ type: "health" });
check("a warning is pushed to the people named, and only them", r.status === 200 && pushed.length === 1 && pushed[0].to === "rk", { r, pushed });
check("the push says what and where to look", pushed[0]?.note.title === "⚠️ Parking Ops: needs a look" && /No nightly backup/.test(pushed[0]?.note.body) && /Clients → Health/.test(pushed[0]?.note.body), pushed[0]);
check("no Discord post without a health webhook", posts.length === 0, posts);
r = await post({ type: "health" });
check("15 minutes later: the same warning is not sent again today", pushed.length === 0 && r.json.sent === 0, r);
health.warnings.push({ key: "aerodata:80", text: "AeroDataBox: about 81% of this month's units used." });
health.discord = "https://discord.com/api/webhooks/1/abc";
r = await post({ type: "health" });
check("a new warning goes out on its own", pushed.length === 1 && /AeroDataBox/.test(pushed[0].note.body) && !/backup/.test(pushed[0].note.body), pushed);
check("and to the health Discord webhook, pinging nobody", posts.length === 1 && posts[0].url === health.discord && /AeroDataBox/.test(posts[0].body.content) && posts[0].body.allowed_mentions.parse.length === 0, posts);
health.warnings.push({ key: "calls", text: "x" }); health.discord = "https://example.com/hook";
r = await post({ type: "health" });
check("a webhook that isn't Discord's is never called", posts.length === 0 && pushed.length === 1, posts);
health.warnings = [];
r = await post({ type: "health" });
check("nothing wrong: nothing sent", r.json.warnings === 0 && pushed.length === 0, r);
health.warnings = [{ key: "timer:x", text: "Timer x failed" }]; failPush = 500;
r = await post({ type: "health" });
const noted = rpcCalls.find((c) => c.name === "note_push_failure");
check("a failed push is noted with its company and code", noted && noted.args.p_company === "c1" && noted.args.p_code === 500 && /Server error/.test(noted.args.p_detail), rpcCalls);
failPush = 410; fresh(); health.warnings = [{ key: "timer:y", text: "y" }];
r = await post({ type: "health" });
check("a phone that's gone is not a failure", !rpcCalls.some((c) => c.name === "note_push_failure"), rpcCalls);
failPush = 0; timerOk = false;
r = await post({ type: "health" });
check("without the timer secret: refused", r.status === 403 && pushed.length === 0, r);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
