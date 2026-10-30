import { check, sleep, makeDb, deskDb, phone, open, scenario, browser, noSideScroll } from "../harness.mjs";

// Settings → Attendance (part 141): the owner pauses the clock-in lock for the whole company.
const build = (theme, role = "owner", brand = true) => {
  const db = deskDb(theme); db.company.brand = { ...db.company.brand, theme, attendance: brand };
  db.me = { ...db.me, role };
  db.staff.push({ id: "s3", name: "ANIL", role: "office", active: true, user_id: "u3" }, { id: "s4", name: "SUGU", role: "office", active: true, user_id: "u4" });
  db.att = { s3: { attendance: true, locked: true }, s4: { attendance: true, locked: true } };
  return db;
};
const toSettings = async (page, width) => {
  await open(page); await sleep(500);
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]");
  await page.click('#menuBody [data-view="settings"]'); await sleep(1200);
  if (width < 900) { const h = page.locator('[data-setsec="attendance"]'); if (await h.count()) { await h.click(); await sleep(300); } }
};
for (const [theme, width] of [["ops", 1440], ["stdplus", 390]]) await scenario(async () => {
  const tag = "Lock pause (" + theme + " " + width + ")";
  const db = build(theme);
  const page = await phone(browser, db, { width }); await page.setViewportSize({ width, height: width < 900 ? 844 : 1000 });
  await toSettings(page, width);
  let t = await page.locator("#lpBox").innerText();
  check(tag + ": shows how many are locked", /2 people have the lock on/.test(t), t);
  await page.click('[data-lockpause="pause"]'); await sleep(200);
  t = await page.locator("#lpBox").innerText();
  check(tag + ": asks first", /Let all 2 locked people in/.test(t) && !db.pauseCalls, t);
  await page.click('[data-lockpause="cancel"]'); await sleep(200);
  check(tag + ": cancel changes nothing", !db.pauseCalls && /Pause the lock for everyone/.test(await page.locator("#lpBox").innerText()));
  await page.click('[data-lockpause="pause"]'); await page.click('[data-lockpause="yes"]'); await sleep(900);
  check(tag + ": pausing sends the pause", JSON.stringify(db.pauseCalls) === "[true]", db.pauseCalls);
  t = await page.locator("#lpBox").innerText();
  check(tag + ": says it is paused and by whom", /lock is paused/.test(t) && /RAKESH/.test(t), t);
  check(tag + ": nobody's own lock changed", db.att.s3.locked && db.att.s4.locked);
  await page.click('[data-lockpause="resume"]'); await sleep(900);
  check(tag + ": resuming sends the resume", JSON.stringify(db.pauseCalls) === "[true,false]", db.pauseCalls);
  check(tag + ": back to the pause button", /Pause the lock for everyone/.test(await page.locator("#lpBox").innerText()));
  if (width < 900) check(tag + ": no sideways scrolling", await noSideScroll(page));
  check(tag + ": no errors", page.__errors.length === 0, page.__errors);
}, "gate");

await scenario(async () => {
  const page = await phone(browser, build("ops", "manager"), { width: 1440 }); await page.setViewportSize({ width: 1440, height: 1000 });
  await toSettings(page, 1440);
  check("Lock pause: a manager does not see it", await page.locator("#lpBox").count() === 0);
}, "gate");
await scenario(async () => {
  const page = await phone(browser, build("ops", "owner", false), { width: 1440 }); await page.setViewportSize({ width: 1440, height: 1000 });
  await toSettings(page, 1440);
  check("Lock pause: nothing without the Attendance add-on", await page.locator("#lpBox").count() === 0);
}, "gate");
await scenario(async () => {
  const db = build("ops"); db.noPausePart = true;
  const page = await phone(browser, db, { width: 1440 }); await page.setViewportSize({ width: 1440, height: 1000 });
  await toSettings(page, 1440);
  check("Lock pause: before the SQL is run it says not available, no error", /Not available yet/.test(await page.locator("#lpBox").innerText()) && page.__errors.length === 0, page.__errors);
}, "gate");
