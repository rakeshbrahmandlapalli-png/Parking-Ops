import { check, sleep, makeDb, phone, open, scenario, browser, noSideScroll, BASE } from "../harness.mjs";

// Clock in to see the board (part 137, user 29 Oct): a listed person who is clocked out sees
// nobody's bookings, only their name and a way to clock in; the offline copy is wiped.
const nudge = (page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
for (const theme of ["stdplus", "ops"]) await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff", attendance: true };
  const me = db.me; db.gate = { gated: true, closed: false, name: "AASHISH", company: "TAKEOFF", attendance: true };
  const page = await phone(browser, db); await page.setViewportSize({ width: 390, height: 844 });
  await open(page); await sleep(2600);
  check("Clock gate (" + theme + "): clocked in, the board shows", await page.locator(".row[data-id]").count() > 0);
  check("Clock gate (" + theme + "): no offline copy kept for a gated person", await page.evaluate(() => localStorage.getItem("takeoff_snap")) === null);

  db.me = null; db.gate = { ...db.gate, closed: true }; await nudge(page); await sleep(900);
  const boot = (await page.locator("#boot").innerText()).replace(/\s+/g, " ").trim();
  check("Clock gate (" + theme + "): after clock-out the board is gone", await page.locator("#app").isHidden() && await page.locator(".row[data-id]").count() === 0);
  check("Clock gate (" + theme + "): says clocked out, with the name and a way in", /^TAKEOFF Clocked out Hi AASHISH .*Slide to clock in .*Customer details stay hidden until you clock in\. Check again Sign out$/.test(boot), boot);
  check("Clock gate (" + theme + "): no car details anywhere on the page", !(await page.evaluate(() => document.body.innerText)).match(new RegExp(db.bookings.slice(0, 5).map((b) => b.reg).join("|"))));
  check("Clock gate (" + theme + "): no offline copy left", await page.evaluate(() => localStorage.getItem("takeoff_snap")) === null);
  check("Clock gate (" + theme + "): phone, no sideways scrolling", await noSideScroll(page));

  await page.click("#gateAgain"); await sleep(500);
  check("Clock gate (" + theme + "): Check again while still out says so", await page.locator("#boot").isVisible() && /not clocked in yet/.test(await page.locator(".toast").last().innerText().catch(() => "")));

  db.me = me; db.gate = { ...db.gate, closed: false }; await page.click("#gateAgain"); await sleep(2600);
  check("Clock gate (" + theme + "): after clocking in the board is back", await page.locator(".row[data-id]").count() > 0 && await page.locator("#boot").isHidden(), [await page.locator(".row[data-id]").count(), await page.locator("#boot").innerText()]);
  check("Clock gate (" + theme + "): no errors", page.__errors.length === 0, page.__errors);
}, "gate");

// Opening the app while clocked out: straight to the clocked-out screen, never signed out.
await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "stdplus", attendance: true };
  db.me = null; db.gate = { gated: true, closed: true, name: "ANIL", company: "TAKEOFF", attendance: true };
  const page = await phone(browser, db);
  await page.addInitScript(() => localStorage.setItem("takeoff_snap", JSON.stringify({ v: 1, me: { id: "x" }, company: { id: "c1" }, rows: [{ id: "old", reg: "OLD1REG" }] })));
  await page.goto(BASE + "/"); await page.waitForSelector(".gatebox", { timeout: 8000 });
  check("Clock gate: opening while clocked out shows the clocked-out screen", /Hi ANIL/.test(await page.locator("#boot").innerText()) && await page.locator("#pinGate").isHidden());
  check("Clock gate: opening while clocked out wipes an old offline copy", await page.evaluate(() => localStorage.getItem("takeoff_snap")) === null);
  check("Clock gate: no errors when opening clocked out", page.__errors.length === 0, page.__errors);
}, "gate");

// Before part 137 is installed nobody is gated and nothing changes.
await scenario(async () => {
  const db = makeDb(); db.noGatePart = true;
  const page = await phone(browser, db);
  await open(page); await sleep(2600);
  check("Clock gate: without the database part the board loads as before", await page.locator(".row[data-id]").count() > 0);
  check("Clock gate: without the database part the offline copy is kept", await page.evaluate(() => localStorage.getItem("takeoff_snap")) !== null);
}, "gate");
