import { check, sleep, deskDb, phone, open, scenario, browser } from "../harness.mjs";

// Dashboard → On shift now: a manager closes a forgotten shift (13 hours or more), after asking.
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const build = (role = "owner") => {
  const db = deskDb("ops"); db.company.brand = { ...db.company.brand, theme: "ops", attendance: true };
  db.me = { ...db.me, role };
  db.staff.push({ id: "s3", name: "ANIL", role: "office", active: true, user_id: "u3" }, { id: "s4", name: "SUGU", role: "office", active: true, user_id: "u4" });
  db.staff.find((x) => x.id === db.me.id).user_id = "u1";
  db.aero = { manager: true, sites: [], shifts: [], openAll: [
    { id: "sh1", user_id: "u1", clock_in_at: ago(120), worksite_id: "w1" }, { id: "sh3", user_id: "u3", clock_in_at: ago(118), worksite_id: "w2" }, { id: "sh4", user_id: "u4", clock_in_at: ago(31 * 60), worksite_id: "w1" }] };
  db.aeroSites = [{ id: "w1", name: "Millfield Lane" }, { id: "w2", name: "Airport" }];
  db.att = {};
  return db;
};
const toDash = async (page) => { await open(page); await sleep(500); await page.evaluate(() => { const b = document.querySelector('[data-view="dashboard"]'); if (b) b.click(); }); await sleep(2500); };
await scenario(async () => {
  const db = build();
  const page = await phone(browser, db, { width: 1440 }); await page.setViewportSize({ width: 1440, height: 1000 });
  await toDash(page);
  check("Fix shift: only the forgotten shift has Clock out", await page.locator(".od-onshift [data-fixshift=ask]").count() === 1);
  await page.click('[data-fixshift="ask"]'); await sleep(300);
  check("Fix shift: asks first and sends nothing", /Clock out SUGU now\?/.test(await page.locator(".od-onshift").innerText()) && !db.fixCalls);
  await page.click('[data-fixshift="cancel"]'); await sleep(300);
  check("Fix shift: cancel changes nothing", !db.fixCalls && await page.locator('[data-fixshift="ask"]').count() === 1);
  await page.click('[data-fixshift="ask"]'); await page.click('[data-fixshift="yes"]'); await sleep(1500);
  check("Fix shift: sends the shift's id", db.fixCalls && db.fixCalls.length === 1 && db.fixCalls[0].p_shift_id === "sh4", db.fixCalls);
  check("Fix shift: the shift leaves the list", !/SUGU/.test(await page.locator(".od-onshift").innerText()), await page.locator(".od-onshift").innerText());
  check("Fix shift: no errors", page.__errors.length === 0, page.__errors);
}, "gate");
await scenario(async () => {
  const db = build(); db.fixDeny = true;
  const page = await phone(browser, db, { width: 1440 }); await page.setViewportSize({ width: 1440, height: 1000 });
  await toDash(page);
  await page.click('[data-fixshift="ask"]'); await page.click('[data-fixshift="yes"]'); await sleep(1000);
  check("Fix shift: the real error is shown", /already closed/.test(await page.locator(".toast.bad").first().innerText().catch(() => "")));
}, "gate");
await scenario(async () => {
  const db = build("manager");
  const page = await phone(browser, db, { width: 1440 }); await page.setViewportSize({ width: 1440, height: 1000 });
  await toDash(page);
  check("Fix shift: a manager has it too", await page.locator('.od-onshift [data-fixshift="ask"]').count() === 1);
}, "gate");
