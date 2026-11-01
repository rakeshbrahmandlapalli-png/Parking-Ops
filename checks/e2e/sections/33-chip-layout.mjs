import { check, sleep, deskDb, makeDb, phone, open, scenario, browser, noSideScroll, BASE } from "../harness.mjs";
import fs from "node:fs";

// Attendance chips (On shift, Clocked out, Lock on, Still clocked in) sit inside their row in every look and width
// (1 Nov: on Operations Refined, RAIHAN's "Clocked out" and "Lock on" landed in the avatar column on the far left,
// one word per line). Also the Dashboard's On shift now and Settings → Attendance. CHIP_SHOTS=<dir> saves pictures.
const SHOTS = process.env.CHIP_SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const LOOKS = ["", "pro", "cards", "premium", "board", "stdplus", "ops", "ops-refined"];
const WIDTHS = [360, 390, 430, 1024, 1440];
const build = (theme) => {
  const db = deskDb(theme); db.company.brand = { ...db.company.brand, theme, attendance: true };
  db.me = { ...db.me, role: "owner" };
  db.staff.push(
    { id: "s3", name: "ANIL", role: "office", active: true, user_id: "u3" },
    { id: "s4", name: "SUGU", role: "office", active: true, user_id: "u4" },
    { id: "s5", name: "RAIHAN", role: "terminal", active: true, user_id: "u5" },
    { id: "s6", name: "MOHAMMED ABDULRAHMAN", role: "bongo", active: true, user_id: "u6" });
  db.staff.find((x) => x.id === db.me.id).user_id = "u1";
  db.aero = { manager: true, sites: [], shifts: [], openAll: [
    { user_id: "u1", clock_in_at: ago(192), worksite_id: "w1" }, { user_id: "u3", clock_in_at: ago(118), worksite_id: "w2" },
    { user_id: "u4", clock_in_at: ago(31 * 60), worksite_id: "w1" }, { user_id: "u6", clock_in_at: ago(64), worksite_id: "w3" }] };
  db.aeroSites = [{ id: "w1", name: "Millfield Lane" }, { id: "w2", name: "Airport" }, { id: "w3", name: "Crescent Road overflow car park" }];
  db.att = { s3: { attendance: true, locked: true, on_shift: true }, s4: { attendance: true, locked: false, on_shift: true },
    s5: { attendance: true, locked: true, on_shift: false }, s6: { attendance: true, locked: true, on_shift: true } };
  return db;
};
// Every chip row inside its person's row, right of the name's left edge, clear of Actions, one line per chip.
const chipGeometry = (page) => page.evaluate(() => {
  const bad = [];
  document.querySelectorAll("#main .shiftchips").forEach((c) => {
    const row = c.closest(".ops-person, .rowline, .row, li") || c.parentElement;
    const name = row.querySelector("strong"), who = name ? name.textContent : "?";
    const cr = c.getBoundingClientRect(), rr = row.getBoundingClientRect(), nr = name && name.getBoundingClientRect();
    if (cr.left < rr.left - 1 || cr.right > rr.right + 1 || cr.bottom > rr.bottom + 1) bad.push(who + ": chips outside the row");
    if (nr && cr.left < nr.left - 1) bad.push(who + ": chips left of the name (" + Math.round(cr.left) + " < " + Math.round(nr.left) + ")");
    const dd = row.querySelector(".ops-dd summary, .ops-dd");
    if (dd) { const d = dd.getBoundingClientRect(); if (cr.right > d.left + 1 && cr.left < d.right - 1 && cr.bottom > d.top + 1 && cr.top < d.bottom - 1) bad.push(who + ": chips under Actions"); }
    c.querySelectorAll(".shiftchip").forEach((x) => {
      const r = x.getBoundingClientRect();
      // A chip may take a second line only when it already fills the whole width it has.
      if (r.height > 26 && r.width < cr.width - 2) bad.push(who + ": '" + x.textContent + "' wraps (" + Math.round(r.height) + "px)");
      if (r.right > rr.right + 1 || r.left < rr.left - 1) bad.push(who + ": '" + x.textContent + "' leaves the row");
    });
  });
  return bad;
});
const toView = async (page, view) => {
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click());
  await page.waitForSelector("#menu[open]");
  await page.click('#menuBody [data-view="' + view + '"]'); await sleep(1500);
};

for (const theme of LOOKS) await scenario(async () => {
  for (const width of WIDTHS) {
    const tag = "Chips (" + (theme || "standard") + " " + width + ")";
    const page = await phone(browser, build(theme), { width }); await page.setViewportSize({ width, height: width < 900 ? 844 : 1000 });
    await open(page); await sleep(500);
    await toView(page, "staff");
    const n = await page.locator("#main .shiftchip").count();
    check(tag + ": Staff & access shows the chips", n >= 5, n);
    const bad = await chipGeometry(page);
    check(tag + ": every chip sits inside its row", bad.length === 0, bad);
    if (width < 900) check(tag + ": Staff & access has no sideways scrolling", await noSideScroll(page));
    if (SHOTS) {
      await page.evaluate(() => { const r = [...document.querySelectorAll("#main .ops-person, #main .rowline")].find((x) => /ANIL/.test(x.textContent)); if (r) r.scrollIntoView({ block: "start" }); });
      await page.screenshot({ path: SHOTS + "/staff-" + (theme || "standard") + "-" + width + ".png" });
    }
    check(tag + ": no errors", page.__errors.length === 0, page.__errors);
    await page.context().close();
  }
}, "gate");

// Dashboard On shift now and Settings → Attendance on the looks that have them.
for (const theme of ["stdplus", "ops", "ops-refined"]) await scenario(async () => {
  for (const width of [360, 390, 1440]) {
    const tag = "On shift lists (" + theme + " " + width + ")";
    const page = await phone(browser, build(theme), { width }); await page.setViewportSize({ width, height: width < 900 ? 844 : 1000 });
    await open(page); await sleep(500);
    await toView(page, "dashboard"); await sleep(1200);
    const bad = await page.evaluate(() => {
      const out = [], sec = document.querySelector(".od-onshift"); if (!sec) return ["no On shift now"];
      const sr = sec.getBoundingClientRect();
      sec.querySelectorAll(".od-shiftrow, .od-shiftrow > *, .od-shiftrow strong, .od-shiftrow small, .od-shiftrow .btn").forEach((e) => {
        const r = e.getBoundingClientRect(); if (r.width && (r.left < sr.left - 1 || r.right > sr.right + 1)) out.push(e.textContent.slice(0, 40) + " leaves the panel");
      });
      return out;
    });
    check(tag + ": Dashboard On shift now stays inside its panel", bad.length === 0, bad);
    if (width < 900) check(tag + ": Dashboard has no sideways scrolling", await noSideScroll(page));
    if (SHOTS) { await page.evaluate(() => { const s = document.querySelector(".od-onshift"); if (s) s.scrollIntoView({ block: "start" }); }); await page.screenshot({ path: SHOTS + "/dashboard-" + theme + "-" + width + ".png" }); }
    await toView(page, "settings");
    if (width < 900) { const h = page.locator('[data-setsec="attendance"]'); if (await h.count()) { await h.click(); await sleep(400); } }
    if (width < 900) check(tag + ": Settings has no sideways scrolling", await noSideScroll(page));
    if (SHOTS) { await page.evaluate(() => { const s = document.querySelector("#lpBox"); if (s) s.scrollIntoView({ block: "start" }); }); await page.screenshot({ path: SHOTS + "/settings-" + theme + "-" + width + ".png" }); }
    check(tag + ": no errors", page.__errors.length === 0, page.__errors);
    await page.context().close();
  }
}, "gate");

// Parking Ops → Clients: the add-ons line and Health problems wrap inside the client.
await scenario(async () => {
  for (const width of [360, 390, 1440]) {
    const db = makeDb(); db.clientCompany = db.company;
    db.company = { id: "c0", name: "Parking Ops", slug: "platform", yards: [], drops_day_end: "06:00:00", brand: {}, time_zone: "Europe/London" };
    db.me = { ...db.me, company_id: "c0" };
    db.adminClients = [
      { id: "c1", name: "TAKEOFF", slug: "takeoff", yards: ["NB"], brand: { host: "takeoff-ops.vercel.app", attendance: true, texts: true, calls: true, voice: true, topup: true, collections: true, lane_planner: true }, staff: 14, has_owner: true, sheets_7d: 18, cars_7d: 2074, last_activity: new Date().toISOString() },
      { id: "c2", name: "Airport Parking Bay", slug: "apb", yards: ["A"], brand: { host: "parkingbay-ops.vercel.app", attendance: true }, staff: 9, has_owner: true, sheets_7d: 17, cars_7d: 960, last_activity: new Date().toISOString() }];
    const page = await phone(browser, db, { width }); await page.setViewportSize({ width, height: width < 900 ? 844 : 1000 });
    await page.goto(BASE + "/"); await page.waitForSelector("[data-clientopen]", { timeout: 8000 }); await sleep(1200);
    const bad = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll(".client").forEach((c) => { const cr = c.getBoundingClientRect();
        c.querySelectorAll("*").forEach((e) => { const r = e.getBoundingClientRect(); if (r.width && (r.left < cr.left - 1 || r.right > cr.right + 1)) out.push(e.textContent.slice(0, 40)); }); });
      return out;
    });
    check("Clients chips (" + width + "): everything stays inside its client", bad.length === 0, bad);
    if (width < 900) check("Clients chips (" + width + "): no sideways scrolling", await noSideScroll(page));
    if (SHOTS) await page.screenshot({ path: SHOTS + "/clients-" + width + ".png" });
    await page.context().close();
  }
}, "platform");
