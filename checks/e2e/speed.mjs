// How long the app takes to open on a phone signal, before and after a change.
// Served like Vercel (gzip, ETag, must-revalidate) from SPEED_ROOT (default: public/),
// with the signal slowed down on the server so the offline cache's own fetches are
// slowed too. The pretend Supabase answers after the same delay.
//   node speed.mjs                         this checkout
//   SPEED_ROOT=/path/to/public node speed.mjs   another copy (e.g. main)
// Prints the median of SPEED_RUNS (default 3) for each case, in milliseconds.
import http from "node:http";
import zlib from "node:zlib";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { browser, makeDb, phone, TYPES, ROOT as APP_ROOT } from "./harness.mjs";

const ROOT = path.resolve(process.env.SPEED_ROOT || APP_ROOT);
const RUNS = +(process.env.SPEED_RUNS || 3);
const SIGNALS = {
  "4G": { rtt: 150, bps: 1.6e6 / 8 },       // "slow 4G": 150 ms, 1.6 Mbit/s
  weak: { rtt: 1200, bps: 0.4e6 / 8 },      // a car park corner: 1.2 s, 400 kbit/s
};
let signal = SIGNALS["4G"], served = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  if (p === "/manifest.webmanifest") p = "/manifest-default.webmanifest";
  const f = path.join(ROOT, p);
  await sleep(signal.rtt);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const raw = fs.readFileSync(f), tag = '"' + crypto.createHash("md5").update(raw).digest("hex") + '"';
  const head = { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", ETag: tag, "Cache-Control": "public, max-age=0, must-revalidate" };
  if (req.headers["if-none-match"] === tag) { res.writeHead(304, head); return res.end(); }
  const body = /\.(js|css|html|webmanifest|json)$/.test(f) ? zlib.gzipSync(raw) : raw;
  if (body !== raw) head["Content-Encoding"] = "gzip";
  res.writeHead(200, { ...head, "Content-Length": body.length });
  if (req.method === "HEAD") return res.end();
  served += body.length;
  for (let i = 0; i < body.length; i += 16384) { res.write(body.subarray(i, i + 16384)); await sleep((Math.min(16384, body.length - i) / signal.bps) * 1000); }
  res.end();
});
await new Promise((r) => server.listen(0, "localhost", r));
const BASE = "http://localhost:" + server.address().port;

function db() {
  const d = makeDb();
  d.company.brand = { theme: process.env.SPEED_THEME || "stdplus", colour: "#F9A01B", short: "TAKEOFF" };
  return d;
}
async function slowSupabase(page) {
  await page.context().route("**/*.supabase.co/**", async (route) => { await sleep(signal.rtt); return route.fallback(); });
}
async function timeOpen(page) {
  const t = Date.now(); served = 0;
  await page.goto(BASE + "/", { waitUntil: "commit", timeout: 60000 });
  await page.waitForSelector("#main .row", { timeout: 60000 });
  return { ms: Date.now() - t, kb: Math.round(served / 1024) };
}
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

const out = { first: [], again: [], againWeak: [], firstKb: [], againKb: [] };
for (let i = 0; i < RUNS; i++) {
  signal = SIGNALS["4G"];
  const page = await phone(browser, db());
  await slowSupabase(page);
  const a = await timeOpen(page); out.first.push(a.ms); out.firstKb.push(a.kb);
  // The app registers its offline cache only on https; do it here as the phone would.
  await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 }).catch(() => page.reload());
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 });
  await sleep(500);
  const b = await timeOpen(page); out.again.push(b.ms); out.againKb.push(b.kb);
  signal = SIGNALS.weak;
  const c = await timeOpen(page); out.againWeak.push(c.ms);
  await page.context().close();
}
console.log(JSON.stringify({
  root: ROOT, theme: process.env.SPEED_THEME || "stdplus", runs: RUNS,
  "first open, 4G (ms)": median(out.first), "first open downloaded (KB)": median(out.firstKb),
  "next open, 4G (ms)": median(out.again), "next open downloaded (KB)": median(out.againKb),
  "next open, weak signal (ms)": median(out.againWeak),
}, null, 1));
await browser.close(); server.close(); process.exit(0);
