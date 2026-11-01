import { check, sleep, makeDb, deskDb, phone, open, scenario, browser, noSideScroll, BASE } from "../harness.mjs";

// Staff location while on shift (part 143, user 1 Nov): owner switch, the person is told, the phone sends
// only while on shift, owners and managers see the last position on the Dashboard.
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const SITES = [{ id: "w1", name: "Millfield Lane", lat: 51.8609617, lng: -0.4728942, radius_m: 200 }, { id: "w2", name: "Airport", lat: 51.877055, lng: -0.3737165, radius_m: 200 }];
const SHOT = (page, name) => process.env.LOC_SHOTS ? page.screenshot({ path: process.env.LOC_SHOTS + "/" + name + ".png" }) : null;
const HERE = { latitude: 51.8611, longitude: -0.4731, accuracy: 12 };

// The owner switches it on and off in Settings → Attendance.
for (const [theme, width] of [["ops", 1440], ["stdplus", 390]]) await scenario(async () => {
  const tag = "Staff location settings (" + theme + " " + width + ")";
  const db = deskDb(theme); db.company.brand = { ...db.company.brand, theme, attendance: true }; db.me = { ...db.me, role: "owner" }; db.loc = { on: false };
  const page = await phone(browser, db, { width }); await page.setViewportSize({ width, height: width < 900 ? 844 : 1000 });
  await open(page); await sleep(500);
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]");
  await page.click('#menuBody [data-view="settings"]'); await sleep(1200);
  if (width < 900) { const h = page.locator('[data-setsec="attendance"]'); if (await h.count()) { await h.click(); await sleep(300); } }
  let t = await page.locator("#locBox").innerText();
  check(tag + ": says it is off", /Staff location while on shift/.test(t) && /Off\./.test(t), t);
  await page.locator("#locBox").scrollIntoViewIfNeeded(); await SHOT(page, "settings-off-" + width);
  await page.click('[data-locshare="ask"]'); await sleep(200);
  t = await page.locator("#locBox").innerText();
  check(tag + ": asks first and says what staff are told", /Everyone is told/.test(t) && !db.loc.sets, t);
  await page.click('[data-locshare="yes"]'); await sleep(1200);
  check(tag + ": switching on sends it", JSON.stringify(db.loc.sets) === "[true]", db.loc.sets);
  t = await page.locator("#locBox").innerText();
  await SHOT(page, "settings-on-" + width);
  check(tag + ": says it is on, by whom, and only while the app is open", /On\./.test(t) && /RAKESH/.test(t) && /open on their phone/.test(t), t);
  await page.click('[data-locshare="off"]'); await sleep(1200);
  check(tag + ": switching off sends it", JSON.stringify(db.loc.sets) === "[true,false]", db.loc.sets);
  if (width < 900) check(tag + ": no sideways scrolling", await noSideScroll(page));
  check(tag + ": no errors", page.__errors.length === 0, page.__errors);
}, "gate");

// Someone on shift is told first; nothing is sent until they press OK, then the position goes.
await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "stdplus", colour: "#F9A01B", ink: "#172536", short: "TakeOff", attendance: true };
  db.me = { ...db.me, role: "office" };
  db.aero = { manager: false, sites: SITES, open: { id: "sh1", clock_in_at: ago(60), worksite_id: "w1" }, shifts: [] };
  db.loc = { on: true };
  const page = await phone(browser, db, { width: 390 });
  await page.context().grantPermissions(["geolocation"], { origin: BASE }); await page.context().setGeolocation(HERE);
  await open(page); await sleep(1500);
  await page.click("#clockBtn"); await sleep(800);
  let t = await page.locator("#panel").innerText();
  check("Staff location: the person on shift is told what is shared", /Your location is shared while you are on shift/.test(t) && /every 2 minutes/.test(t), t);
  await SHOT(page, "phone-1-told");
  check("Staff location: nothing is sent before OK", !(db.loc.sent || []).length);
  await page.click("[data-locok]"); await sleep(2500);
  check("Staff location: OK is recorded", (db.loc.notices || []).length === 1);
  const s = (db.loc.sent || [])[0];
  check("Staff location: the position is sent after OK", s && Math.abs(s.p_lat - 51.8611) < 1e-6 && s.p_acc === 12, db.loc.sent);
  t = await page.locator("#panel").innerText();
  await SHOT(page, "phone-2-sharing");
  check("Staff location: the shift box says it is sharing", /Sharing your location with your managers/.test(t), t);
  check("Staff location: no sideways scrolling", await noSideScroll(page));
  check("Staff location: no errors", page.__errors.length === 0, page.__errors);
}, "gate");

// Switched off: nothing is shown to staff and nothing is sent.
await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "stdplus", colour: "#F9A01B", ink: "#172536", short: "TakeOff", attendance: true };
  db.aero = { manager: false, sites: SITES, open: { id: "sh1", clock_in_at: ago(60), worksite_id: "w1" }, shifts: [] };
  db.loc = { on: false, notice_at: ago(600) };
  const page = await phone(browser, db, { width: 390 });
  await page.context().grantPermissions(["geolocation"], { origin: BASE }); await page.context().setGeolocation(HERE);
  await open(page); await sleep(1500); await page.click("#clockBtn"); await sleep(2000);
  check("Staff location off: nothing about it on the shift box", !/location/i.test(await page.locator("#panel .clk-box").innerText()));
  check("Staff location off: nothing is sent", !(db.loc.sent || []).length && !db.calls.some((c) => c.fn === "i_am_at"));
}, "gate");

// The Dashboard shows where each person on shift was last.
for (const role of ["owner", "manager"]) await scenario(async () => {
  const db = deskDb("ops"); db.company.brand = { ...db.company.brand, theme: "ops", attendance: true }; db.me = { ...db.me, role };
  db.staff.push({ id: "s3", name: "ANIL", role: "office", active: true, user_id: "u3" }, { id: "s4", name: "SUGU", role: "office", active: true, user_id: "u4" }, { id: "s5", name: "TERRY", role: "terminal", active: true, user_id: "u5" });
  db.aero = { manager: true, sites: [], shifts: [], openAll: [{ id: "a3", user_id: "u3", clock_in_at: ago(118), worksite_id: "w2" }, { id: "a4", user_id: "u4", clock_in_at: ago(90), worksite_id: "w1" }, { id: "a5", user_id: "u5", clock_in_at: ago(30), worksite_id: "w1" }] };
  db.aeroSites = SITES;
  db.loc = { on: true, where: [{ staff_id: "s3", lat: 51.8611, lng: -0.4731, acc: 10, at: ago(2) }, { staff_id: "s4", lat: 51.89, lng: -0.42, acc: 20, at: ago(25) }] };
  const page = await phone(browser, db, { width: 1440 }); await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page); await sleep(500);
  await page.evaluate(() => { const b = document.querySelector('[data-view="dashboard"]'); if (b) b.click(); }); await sleep(2500);
  const t = await page.locator(".od-onshift").innerText().catch(() => "");
  check("Staff location dashboard (" + role + "): at a site, how long ago", /At Millfield Lane · 2 min ago/.test(t), t);
  check("Staff location dashboard (" + role + "): away from a site says how far, and an old one is flagged", /km from Airport · 25 min ago \(app closed\?\)/.test(t), t);
  check("Staff location dashboard (" + role + "): someone who hasn't sent yet", /No location yet/.test(t), t);
  await page.locator(".od-onshift").scrollIntoViewIfNeeded(); await SHOT(page, "dashboard-" + role);
  const href = await page.locator(".od-where a").first().getAttribute("href").catch(() => "");
  check("Staff location dashboard (" + role + "): a Map link", /google\.com\/maps\?q=51\.8611/.test(href), href);
  check("Staff location dashboard (" + role + "): no errors", page.__errors.length === 0, page.__errors);
}, "gate");
