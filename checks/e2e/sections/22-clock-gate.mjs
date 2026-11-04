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
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("takeoff_snap") || "null"));
  check("Clock gate (" + theme + "): clocked in, an offline copy is kept, ending 14 h after the shift", !!(kept && kept.rows && kept.rows.length && kept.until > Date.now() && kept.until <= Date.now() + 14 * 3600000 + 5000), kept && kept.until);

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

// The lock switched on while the app is open (31 Oct, SUGU on an iPhone): the server
// starts answering with no sheets. The board must say Clocked out, not "No day sheets yet".
await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "stdplus", colour: "#F9A01B", short: "TakeOff", attendance: true };
  const page = await phone(browser, db);
  await open(page); await sleep(2600);
  check("Clock gate: not locked, the board shows", await page.locator(".row[data-id]").count() > 0);
  db.meSaved = db.me; db.me = null; db.sheets.splice(0); db.gate = { gated: true, closed: true, name: "SUGU", company: "TAKEOFF", attendance: true };
  await page.click("#refreshBtn"); await sleep(1500);
  const boot = (await page.locator("#boot").innerText().catch(() => "")).replace(/\s+/g, " ");
  check("Clock gate: lock switched on while open shows Clocked out after a refresh", /Clocked out Hi SUGU/.test(boot) && await page.locator("#app").isHidden(), boot);
  check("Clock gate: never says No day sheets yet", !/No day sheets yet/.test(await page.evaluate(() => document.body.innerText)));
  check("Clock gate: no errors after the lock switched on", page.__errors.length === 0, page.__errors);
}, "gate");

// Clocked in, then no signal (4 Nov, rakesh turned mobile data off and got a blank
// "Can't reach the server"): a locked person on shift gets the last board, like everyone else.
for (const how of ["server down"]) await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "ops", colour: "#F9A01B", short: "TakeOff", attendance: true };
  const me = db.me; db.gate = { gated: true, closed: false, name: "RAKESH", company: "TAKEOFF", attendance: true };
  const page = await phone(browser, db); await page.setViewportSize({ width: 390, height: 844 });
  await open(page); await sleep(2600);
  const rows = await page.locator(".row[data-id]").count();
  if (how === "no signal") await page.context().setOffline(true); else db.down = true;
  await page.reload().catch(() => {}); await sleep(3000);
  check("Clock gate, " + how + ": a locked person on shift sees the last board", await page.isVisible("#app") && await page.locator(".row[data-id]").count() === rows && rows > 0, [rows, await page.locator("#boot").innerText().catch(() => "")]);
  check("Clock gate, " + how + ": the top bar says OFFLINE", /OFFLINE/.test(await page.locator("#sync").innerText().catch(() => "")));
  await page.click('.row[data-id="b1"] [data-act="sent"]'); await sleep(600);
  check("Clock gate, " + how + ": a tap waits to be sent", /TO SEND/.test(await page.locator("#sync").innerText()));
  if (how === "no signal") await page.context().setOffline(false); else db.down = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online"))); await sleep(4000);
  check("Clock gate, " + how + ": back online, the tap reaches the server", db.calls.some((c) => c.fn === "tap_drop" && c.args.p_booking === "b1"));
  check("Clock gate, " + how + ": no errors", page.__errors.length === 0, page.__errors);
}, "gate");

// Clocked out while the phone was offline: back online, the board and the saved copy go.
await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "stdplus", attendance: true };
  db.gate = { gated: true, closed: false, name: "ANIL", company: "TAKEOFF", attendance: true };
  const page = await phone(browser, db);
  await open(page); await sleep(2600);
  db.down = true; await page.reload(); await sleep(2500);
  check("Clock gate: offline, the saved board opens", await page.locator(".row[data-id]").count() > 0);
  db.meSaved = db.me; db.me = null; db.gate = { ...db.gate, closed: true }; db.down = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online"))); await sleep(3000);
  check("Clock gate: shift ended while offline, back online it says Clocked out", /Clocked out Hi ANIL/.test((await page.locator("#boot").innerText().catch(() => "")).replace(/\s+/g, " ")) && await page.locator(".row[data-id]").count() === 0);
  check("Clock gate: shift ended while offline, the saved copy is wiped", await page.evaluate(() => localStorage.getItem("takeoff_snap")) === null);
}, "gate");

// A locked person's saved copy past its 14 hours never opens, even with no signal.
await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "stdplus", attendance: true }; db.down = true;
  const page = await phone(browser, db);
  await page.addInitScript(() => localStorage.setItem("takeoff_snap", JSON.stringify({ v: 1, at: new Date().toISOString(), until: Date.now() - 1000, me: { id: "x", company_id: "c1" }, company: { id: "c1" }, rows: [{ id: "old", reg: "OLD1REG" }] })));
  await page.goto(BASE + "/"); await sleep(3000);
  check("Clock gate: an expired saved copy does not open", !/OLD1REG/.test(await page.evaluate(() => document.body.innerText)) && /Can't reach the server/.test(await page.locator("#boot").innerText()));
  check("Clock gate: an expired saved copy is wiped", await page.evaluate(() => localStorage.getItem("takeoff_snap")) === null);
}, "gate");
