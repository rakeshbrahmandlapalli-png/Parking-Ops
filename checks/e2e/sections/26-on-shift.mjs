import { check, sleep, makeDb, deskDb, phone, open, scenario, browser, noSideScroll } from "../harness.mjs";

// Who is on shift (user, 30 Oct): chips on Staff & access and a list on the Dashboard, for owners and managers.
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const build = (theme, role = "owner") => {
  const db = deskDb(theme); db.company.brand = { ...db.company.brand, theme, attendance: true };
  db.me = { ...db.me, role };
  db.staff.push({ id: "s3", name: "ANIL", role: "office", active: true, user_id: "u3" }, { id: "s4", name: "SUGU", role: "office", active: true, user_id: "u4" }, { id: "s5", name: "TERRY", role: "terminal", active: true, user_id: "u5" });
  db.staff.find((x) => x.id === db.me.id).user_id = "u1";
  db.aero = { manager: true, sites: [], shifts: [], openAll: [
    { user_id: "u1", clock_in_at: ago(192), worksite_id: "w1" }, { user_id: "u3", clock_in_at: ago(118), worksite_id: "w2" }, { user_id: "u4", clock_in_at: ago(31 * 60), worksite_id: "w1" }] };
  db.aeroSites = [{ id: "w1", name: "Millfield Lane" }, { id: "w2", name: "Airport" }];
  db.att = { s3: { attendance: true, locked: true, on_shift: true }, s4: { attendance: true, locked: false, on_shift: true }, s5: { attendance: true, locked: false, on_shift: false } };
  return db;
};
for (const [theme, width] of [["ops", 390], ["ops", 1440], ["stdplus", 390]]) await scenario(async () => {
  const tag = "On shift (" + theme + " " + width + ")";
  const page = await phone(browser, build(theme), { width }); await page.setViewportSize({ width, height: width < 900 ? 844 : 1000 });
  await open(page); await sleep(500);
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]");
  await page.click('#menuBody [data-view="staff"]'); await sleep(1500);
  const txt = await page.locator("#main").innerText();
  check(tag + ": a person on shift shows time and site", /On shift 1h 58m · Airport/.test(txt), txt.slice(0, 300));
  check(tag + ": the lock shows on the person", /Lock on/.test(txt));
  check(tag + ": someone clocked in 31 hours is flagged", /Still clocked in since/.test(txt));
  check(tag + ": a person clocked out says so", /Clocked out/.test(txt));
  if (width < 900) check(tag + ": no sideways scrolling", await noSideScroll(page));
  check(tag + ": no errors", page.__errors.length === 0, page.__errors);
}, "gate");

await scenario(async () => {
  const page = await phone(browser, build("ops"), { width: 1440 }); await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page); await sleep(500);
  await page.click('.ops-tabs [data-view="dashboard"], [data-bn="dashboard"], #opsTabs [data-view="dashboard"]').catch(() => {});
  await page.evaluate(() => { const b = document.querySelector('[data-view="dashboard"]'); if (b) b.click(); }); await sleep(2500);
  const t = await page.locator(".od-onshift").innerText().catch(() => "");
  check("On shift dashboard: lists who is clocked in", /On shift now/.test(t) && /RAKESH|ANIL/.test(t) && /Airport/.test(t), t);
  check("On shift dashboard: a forgotten shift is flagged", /Still clocked in since/.test(t), t);
}, "gate");

// Without Attendance, or as office, nothing shows and nothing is asked.
await scenario(async () => {
  const db = build("ops", "office"); db.company.brand.attendance = false;
  const page = await phone(browser, db, { width: 390 }); await open(page); await sleep(500);
  await page.evaluate(() => document.getElementById("menuBtn") && document.getElementById("menuBtn").click());
  check("On shift: nothing without the Attendance add-on", await page.locator(".shiftchip").count() === 0);
}, "gate");
