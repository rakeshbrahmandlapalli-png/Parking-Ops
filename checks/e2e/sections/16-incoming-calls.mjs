import { check, sleep, makeDb, phone, open, scenario, browser } from "../harness.mjs";

// Incoming calls (setup 117): an add-on. A call pops up on office phones with the caller's car and a CALLED
// button; the car lists its calls; Menu → Calls lists the last day's, missed first; owners set it in Settings → Calls.
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const callsDb = (theme, addon = true) => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  db.company.brand = { ...(db.company.brand || {}), calls: addon };
  db.company.calls = { on: true };
  db.callsLog = [
    { id: 1, company_id: "c1", at: ago(40), from_number: "+447868615571", booking_id: "b1", kind: "drops", reg: "EK14JPV", name: "SENIOR MISS", status: "answered", seconds: 72, digit: "", marked: "", handled_name: "" },
    { id: 2, company_id: "c1", at: ago(12), from_number: "+447868615571", booking_id: "b1", kind: "drops", reg: "EK14JPV", name: "SENIOR MISS", status: "answered", seconds: 34, digit: "", marked: "", handled_name: "" },
    { id: 3, company_id: "c1", at: ago(5), from_number: "+447911123456", booking_id: null, kind: "", reg: "", name: "", status: "missed", seconds: 0, digit: "", marked: "", handled_name: "" }];
  return db;
};
const ring = (page, k) => page.evaluate((k) => window.dispatchEvent(new CustomEvent("takeoff:call", { detail: k })), k);
for (const theme of ["", "pro", "cards", "premium", "board", "stdplus", "ops", "ops-refined"]) await scenario(async () => {
  const look = theme || "standard", db = callsDb(theme);
  const page = await phone(browser, db);
  await open(page);
  await ring(page, { id: 9, company_id: "c1", at: ago(0), from_number: "07868 615571", booking_id: "b2", kind: "drops", reg: "CF75VLN", name: "KHAIRA MS", status: "ringing", marked: "", handled_name: "" }); await sleep(200);
  const pop = await page.innerText("#callPop");
  check("Calls (" + look + "): a call pops up with the caller's car", /Incoming call/.test(pop) && /CF75VLN/.test(pop) && /DROPS/.test(pop) && /07••• •••571 · Number matched/.test(pop) && /Return due/.test(pop) && /Key tag/.test(pop) && /Unclaimed/.test(pop) && /Claim call/.test(pop) && /Open booking/.test(pop) && await page.isVisible('[data-callmark="9"]'), pop);
  const fits = await page.locator("#callPop").evaluate((e) => e.getBoundingClientRect().right <= window.innerWidth + 1);
  check("Calls (" + look + "): the pop-up fits the phone", fits);
  await page.click('[data-callmark="9"]'); await sleep(300);
  const c = db.calls.filter((x) => x.fn === "tap_drop").pop();
  check("Calls (" + look + "): CALLED on the pop-up marks the car CALLED", c && c.args.p_booking === "b2" && c.args.p_action === "called" && /CALLED ✓/.test(await page.innerText("#callPop")), c);
  await ring(page, { id: 9, status: "missed" }); await sleep(150);
  check("Calls (" + look + "): not answered, it says Missed call and offers Call back", /Missed call/.test(await page.innerText("#callPop")) && await page.locator('#callPop a[href^="tel:"]').count() === 1);
  await page.click('[data-calltake="9"]').catch(() => {}); await sleep(100);
  await page.click('[data-callclose="9"]'); await sleep(150);
  check("Calls (" + look + "): × closes it", !(await page.$("#callPop")));
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]"); await sleep(500);
  const cl = await page.innerText("#carCalls");
  check("Calls (" + look + "): the car lists its calls, newest first", /Answered · 0:34[\s\S]*Answered · 1:12/.test(cl), cl);
  check("Calls (" + look + "): no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "calls");

// A caller not on today's cars: no CALLED button; Menu → Calls lists missed calls first, Called back marks it.
await scenario(async () => {
  const db = callsDb("stdplus");
  const page = await phone(browser, db);
  await open(page);
  await ring(page, db.callsLog[2] && { ...db.callsLog[2], id: 7, status: "ringing" }); await sleep(150);
  check("Calls: a caller not on a booking pops up without CALLED", /Not on today's cars/.test(await page.innerText("#callPop")) && !(await page.$('[data-callmark]')));
  await page.click('[data-callclose="7"]');
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(200);
  await page.click('#menuBody [data-view="calls"]'); await sleep(500);
  const t = await page.innerText("#main");
  check("Calls: Menu → Calls lists missed first, with counts", /To call back \(1\)/.test(t) && /Missed[\s\S]*Answered[\s\S]*Answered/.test(t), t.slice(0, 400));
  await page.click('[data-callsf="unknown"]'); await sleep(200);
  check("Calls: Not on a booking shows only those", /\+44 7911 123456/.test(await page.innerText("#main")) && !/EK14JPV/.test(await page.innerText("#main")));
  await page.click('[data-callsf="missed"]'); await sleep(200);
  await page.click('[data-calltake="3"]'); await sleep(400);
  check("Calls: Called back is saved", db.calls.some((x) => x.fn === "call_take" && x.args.p_call === 3));
  check("Calls: no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "calls");

// Without the add-on: no pop-up, no Calls in the menu, nothing on the car. Drivers don't get the pop-up.
await scenario(async () => {
  const db = callsDb("stdplus", false);
  const page = await phone(browser, db);
  await open(page);
  await ring(page, { id: 9, company_id: "c1", from_number: "07868615571", booking_id: "b2", kind: "drops", reg: "CF75VLN", status: "ringing" }); await sleep(150);
  check("Calls: without the add-on, no pop-up", !(await page.$("#callPop")));
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]"); await sleep(300);
  check("Calls: without the add-on, nothing on the car", !(await page.$("#carCalls")));
  await page.context().close();
  const d2 = callsDb("stdplus"); d2.me = { ...d2.me, role: "bongo" }; d2.perms = { sent: true, yard: true, intake: true, note: true };
  const p2 = await phone(browser, d2); await open(p2);
  await ring(p2, { id: 9, company_id: "c1", from_number: "07868615571", booking_id: "b2", kind: "drops", reg: "CF75VLN", status: "ringing" }); await sleep(150);
  check("Calls: a driver's phone doesn't pop up", !(await p2.$("#callPop")));
  await p2.context().close();
}, "calls");

// Settings → Calls (owners): saved as set.
for (const theme of ["stdplus", "ops", "ops-refined", "premium"]) await scenario(async () => {
  const db = callsDb(theme);
  const page = await phone(browser, db);
  await open(page);
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(200);
  await page.click('#menuBody [data-view="settings"]'); await sleep(500);
  if (await page.$('[data-setsec="calls"]')) { await page.click('[data-setsec="calls"]'); await sleep(200); }
  if (await page.$('[data-settab="calls"]')) { await page.click('[data-settab="calls"]'); await sleep(200); }
  check("Settings → Calls (" + theme + "): SIM controls do not offer a voice menu", !(await page.$("#clAuto")) && !(await page.$("[data-clring]")) && !(await page.$("#clNumber")));
  await page.selectOption("#clOn", "true");
  await page.click("[data-savecalls]"); await sleep(400);
  const p = db.calls.filter((x) => x.fn === "set_calls").pop()?.args.p;
  check("Settings → Calls (" + theme + "): saves the SIM call switch", p && p.on === true && Object.keys(p).join() === "on", p);
  check("Settings → Calls (" + theme + "): no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "calls");
