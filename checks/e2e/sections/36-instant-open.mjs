import http from "node:http";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { check, sleep, makeDb, phone, browser, scenario, fs, path, ROOT, TYPES, SITE_HEADERS } from "../harness.mjs";

// Opening instantly (4 Nov): the app opens from the phone's saved copy (public/sw.js),
// a new version arrives as a whole set before it takes over, and each phone loads only
// its own look's stylesheets (public/look.js). A copy of public/ is served on localhost
// (the offline cache needs a secure address), so a test can switch the server off or
// publish a new version.
const COPY = fs.mkdtempSync(path.join(os.tmpdir(), "instant-open-"));
fs.cpSync(ROOT, COPY, { recursive: true });
let up = true;
const served = [];
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (!up) { req.socket.destroy(); return; }
  if (p === "/") p = "/index.html";
  if (p === "/manifest.webmanifest") p = "/manifest-default.webmanifest";
  const f = path.join(COPY, p);
  if (!f.startsWith(COPY) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  served.push(p);
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", ...SITE_HEADERS, ...(p === "/sw.js" ? { "Cache-Control": "no-cache" } : {}) });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "localhost", r));
const SITE = "http://localhost:" + server.address().port;
// Publish a new version on the copy: a changed file, then the BUILD written as the build does.
function publish(file, edit) {
  fs.writeFileSync(path.join(COPY, file), edit(fs.readFileSync(path.join(COPY, file), "utf8")));
  const sw = fs.readFileSync(path.join(COPY, "sw.js"), "utf8");
  fs.writeFileSync(path.join(COPY, "sw.js"), sw.replace(/const BUILD = "[0-9a-f]*";/, 'const BUILD = "' + Date.now().toString(16).slice(-10).padStart(10, "0") + '";'));
}
const db = () => { const d = makeDb(); d.company.brand = { theme: "ops", colour: "#F9A01B", short: "TAKEOFF" }; return d; };
const looks = (page) => page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href")));

await scenario(async () => {
  const page = await phone(browser, db());
  await page.goto(SITE + "/"); await page.waitForSelector("#main .row", { timeout: 8000 });
  // First open on this phone: no look remembered, so the look's sheets come when the company is known, in the old order.
  let sheets = await looks(page);
  check("Instant open: Operations wears app.css, stdplus.css, ops.css then the shared sheets, nothing of the other looks",
    JSON.stringify(sheets) === JSON.stringify(["/app.css", "/stdplus.css", "/ops.css", "/lanes.css", "/notifications.css", "/calls.css", "/attendance.css", "/topup.css", "/staff-panel.css"]), sheets);
  check("Instant open: the page is not left hidden while a look loads", !(await page.evaluate(() => document.documentElement.classList.contains("look-wait"))));
  check("Instant open: the Operations look is drawn (navy top bar)", await page.evaluate(() => getComputedStyle(document.querySelector(".top")).backgroundColor !== "rgba(0, 0, 0, 0)"));

  // Next open: the remembered look is written in place by look.js, before anything is drawn.
  await page.reload(); await page.waitForSelector("#main .row");
  sheets = await looks(page);
  check("Instant open: next open writes the remembered look's sheets in place, once each", JSON.stringify(sheets.slice(0, 4)) === JSON.stringify(["/app.css", "/stdplus.css", "/ops.css", "/lanes.css"]) && sheets.length === 9, sheets);

  // The offline cache (the app registers it on https; here by hand).
  await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForSelector("#main .row");
  check("Instant open: the offline cache controls the page", await page.evaluate(() => !!navigator.serviceWorker.controller));
  const build = fs.readFileSync(path.join(COPY, "sw.js"), "utf8").match(/const BUILD = "([0-9a-f]+)"/)[1];
  check("Instant open: the cache is named by its BUILD", (await page.evaluate(() => caches.keys())).includes("takeoff-ops-v19-" + build));

  // Opens from the saved copy: no app file asked of the server, and it opens with the server gone.
  served.length = 0;
  await page.reload(); await page.waitForSelector("#main .row");
  const asked = served.filter((p) => p !== "/sw.js");
  check("Instant open: an open asks the server for none of the app's files", asked.length === 0, asked);
  up = false;
  const t = Date.now();
  await page.reload(); await page.waitForSelector("#main .row", { timeout: 8000 });
  const ms = Date.now() - t;
  check("Instant open: with the server unreachable it still opens, without waiting 4 s per file", ms < 3000, ms);
  up = true;

  // The menu says which version this phone runs: the BUILD.
  await page.click("#menuBtn").catch(() => page.click('[data-bn="menuBtn"]'));
  await page.waitForSelector("#menuBody .appver");
  const ver = await page.locator("#menuBody .appver").innerText();
  check("Instant open: the menu shows the running BUILD", ver.includes(build.slice(0, 7)) && /up to date/.test(ver), ver);
  await page.keyboard.press("Escape");

  // A new version: the whole set is fetched, then the update is ready and the reload opens it.
  publish("app.css", (s) => s + "\nbody{--instant-open-test:1;}\n");
  await page.evaluate(() => { window.__before = 1; });
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration("/"); await r.update(); });
  await page.waitForFunction(() => !window.__before, null, { timeout: 15000 }).catch(() => {});
  await page.waitForSelector("#main .row");
  const fresh = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--instant-open-test").trim());
  check("Instant open: a new version is loaded by itself when nothing is in progress", fresh === "1", fresh);
  check("Instant open: only the new set's cache is kept", (await page.evaluate(() => caches.keys())).filter((k) => k.startsWith("takeoff-ops")).length === 1);

  // While someone is typing, a new version waits, and the menu offers it.
  await page.click("#q"); await page.keyboard.type("AB");
  publish("app.css", (s) => s.replace("--instant-open-test:1", "--instant-open-test:2"));
  await page.evaluate(() => { window.__before = 1; });
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration("/"); await r.update(); });
  await sleep(3000);
  check("Instant open: no reload while someone is typing", await page.evaluate(() => window.__before === 1));
  await page.evaluate(() => document.activeElement.blur());
  await page.click("#menuBtn").catch(() => page.click('[data-bn="menuBtn"]'));
  await page.waitForSelector("#menuBody .appver");
  check("Instant open: the menu offers the waiting version", /New version ready/.test(await page.locator("#menuBody .appver").innerText()));
  check("Instant open: no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "instant");

await scenario(async () => {
  // Every look wears exactly its own sheets, in the order they always had.
  const want = { "": [], pro: ["pro"], cards: ["cards"], premium: ["premium"], board: ["premium", "board"], stdplus: ["stdplus"], ops: ["stdplus", "ops"], "ops-refined": ["stdplus", "ops-refined"] };
  for (const [theme, names] of Object.entries(want)) {
    const d = makeDb(); d.company.brand = theme ? { theme } : {};
    const page = await phone(browser, d);
    await page.goto(SITE + "/"); await page.waitForSelector("#main .row", { timeout: 8000 });
    await page.reload(); await page.waitForSelector("#main .row", { timeout: 8000 });
    const got = (await looks(page)).filter((h) => !["/app.css", "/lanes.css", "/notifications.css", "/calls.css", "/attendance.css", "/topup.css", "/staff-panel.css"].includes(h));
    check("Instant open: look " + (theme || "Standard") + " loads only " + (names.join(" + ") || "app.css"), JSON.stringify(got) === JSON.stringify(names.map((n) => "/" + n + ".css")), got);
    await page.context().close();
  }
  // A look sheet must only style its own look: the files are no longer all on every page.
  const scope = { pro: /html\.pro\b/, cards: /\.cards\b/, premium: /\.premium\b/, board: /pboard/, stdplus: /stdplus/, ops: /html\.ops\b/, "ops-refined": /ops-refined/ };
  for (const [name, re] of Object.entries(scope)) {
    const css = fs.readFileSync(path.join(ROOT, name + ".css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const loose = [];
    for (const m of css.matchAll(/([^{}]+)\{/g)) {
      const sel = m[1].trim();
      if (!sel || sel.startsWith("@") || /^(from|to|\d+%)$/.test(sel) || /^[a-z-]+\s*:/.test(sel)) continue;
      // :is(a,b) lists are split too; judge the whole selector list by its parts outside parentheses
      const parts = sel.replace(/\([^()]*\)/g, "()").split(",").map((x) => x.trim());
      for (const p of parts) if (!re.test(p) && !/^(html|:root)$/.test(p)) loose.push(p);
    }
    const allowed = name === "stdplus" ? loose.filter((p) => !/^\.od-/.test(p)) : loose; // the Operations dashboard's own classes (only stdplus looks draw them)
    check("Instant open: " + name + ".css styles only its own look", allowed.length === 0, allowed.slice(0, 5));
  }
}, "instant");

server.close();
fs.rmSync(COPY, { recursive: true, force: true });
