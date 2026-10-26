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
  check("Calls (" + look + "): not answered, it says Missed call and offers Claim callback", /Missed call/.test(await page.innerText("#callPop")) && await page.locator('#callPop [data-calltake="9"]').count() === 1);
  await page.click('[data-calltake="9"]').catch(() => {}); await sleep(100);
  await page.click('[data-callclose="9"]'); await sleep(150);
  check("Calls (" + look + "): × closes it", !(await page.$("#callPop")));
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]"); await sleep(500);
  const cl = await page.innerText("#carCalls");
  check("Calls (" + look + "): the car lists its calls, newest first", /Answered · 0:34[\s\S]*Answered · 1:12/.test(cl), cl);
  check("Calls (" + look + "): no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "calls");

// A call about a car on another sheet than the one on screen (26 Oct): the card still shows the car's details
// and Open booking opens that sheet and the car; CALLED and AT DESK work on it from the card.
await scenario(async () => {
  const db = callsDb("stdplus");
  const page = await phone(browser, db);
  await open(page);
  await ring(page, { id: 11, company_id: "c1", at: ago(0), from_number: "07700 900123", booking_id: "b4", kind: "drops", reg: "DY16MYO", name: "ATANASOV MX", status: "ringing", marked: "", handled_name: "" }); await sleep(500);
  const pop = await page.innerText("#callPop");
  check("Calls: a car on another sheet still shows its details", /DY16MYO/.test(pop) && /Return due/.test(pop) && /Vehicle status/.test(pop) && /Key tag/.test(pop) && /Open booking/.test(pop), pop);
  check("Calls: CALLED and AT DESK are offered for a car on another sheet", !!(await page.$('[data-callmark="11"][data-callwhat="called"]')) && !!(await page.$('[data-callmark="11"][data-callwhat="desk"]')), pop);
  await page.click('[data-callmark="11"][data-callwhat="called"]'); await sleep(500);
  const oc = db.calls.filter((x) => x.fn === "tap_drop").pop();
  check("Calls: CALLED on another sheet's car goes to that car and the card shows CALLED ✓", oc && oc.args.p_booking === "b4" && oc.args.p_action === "called" && /CALLED ✓/.test(await page.innerText("#callPop")), oc);
  await page.click('[data-callmark="11"][data-callwhat="desk"]'); await sleep(500);
  const od = db.calls.filter((x) => x.fn === "tap_drop").pop();
  check("Calls: AT DESK on another sheet's car", od && od.args.p_booking === "b4" && od.args.p_action === "desk" && /AT DESK ✓/.test(await page.innerText("#callPop")), od);
  await page.click('[data-callopen="11"]'); await page.waitForSelector("#panel[open]", { timeout: 4000 }).catch(() => {}); await sleep(600);
  check("Calls: Open booking opens that car's sheet and panel", /DY16MYO/.test(await page.innerText("#panel")), await page.innerText("#panel").catch(() => ""));
  check("Calls (other sheet): no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "calls");

// A PICKS car marked NEW BOOKING was never called (26 Oct, LN13ELV): the card says NEW BOOKING ✓, not CALLED ✓,
// and keeps the mark (no CALLED button to write over it). A PICKS car with no mark still gets CALLED.
await scenario(async () => {
  const db = callsDb("stdplus");
  db.bookings.find((b) => b.id === "p2").pick_called = "New Booking";
  db.bookings.find((b) => b.id === "p2").pick_called_at = ago(3);
  const page = await phone(browser, db);
  await open(page);
  await page.selectOption("#sheetPick", "p0"); await page.waitForSelector('.row[data-id="p1"]');
  await ring(page, { id: 21, company_id: "c1", at: ago(0), from_number: "07700 900222", booking_id: "p2", kind: "picks", reg: "AF63WWH", name: "MASON", status: "ringing", marked: "", handled_name: "" }); await sleep(250);
  let pop = await page.innerText("#callPop");
  check("Calls: a NEW BOOKING car says NEW BOOKING ✓, not CALLED ✓", /NEW BOOKING ✓/.test(pop) && !/CALLED ✓/.test(pop) && !(await page.$('[data-callmark="21"]')), pop);
  await page.click('[data-callclose="21"]'); await sleep(100);
  await ring(page, { id: 22, company_id: "c1", at: ago(0), from_number: "07700 900333", booking_id: "p3", kind: "picks", reg: "SF15LUA", name: "KOLE", status: "ringing", marked: "", handled_name: "" }); await sleep(250);
  check("Calls: a PICKS car with no mark still gets CALLED", await page.isVisible('[data-callmark="22"]'), await page.innerText("#callPop"));
  await page.click('[data-callmark="22"]'); await sleep(300);
  const c = db.calls.filter((x) => x.fn === "tap_pick").pop();
  check("Calls: CALLED on a PICKS car marks it Called", c && c.args.p_booking === "p3" && c.args.p_value === "Called" && /CALLED ✓/.test(await page.innerText("#callPop")), c);
  check("Calls (NEW BOOKING): no errors", page.__errors.length === 0, page.__errors);
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
  await page.click('[data-callreview="3"]'); await sleep(100); await page.click('[data-calltake="3"]'); await sleep(400);
  check("Calls: claim is saved without resolving", db.calls.some((x) => x.fn === "call_claim" && x.args.p_call === 3));
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
  // CALLED without Call pop-ups: no pop-up. Call pop-ups without CALLED: pop-up.
  const d3 = callsDb("stdplus"); d3.perms = { sent: true, called: true, clear: true, yard: true, intake: true, note: true, callpop: false };
  const p3 = await phone(browser, d3); await open(p3);
  await ring(p3, { id: 9, company_id: "c1", from_number: "07868615571", booking_id: "b2", kind: "drops", reg: "CF75VLN", status: "ringing" }); await sleep(150);
  check("Calls: CALLED alone doesn't give the pop-up (own permission)", !(await p3.$("#callPop")));
  await p3.context().close();
  const d4 = callsDb("stdplus"); d4.perms = { sent: true, called: false, clear: true, yard: true, intake: true, note: true, callpop: true };
  const p4 = await phone(browser, d4); await open(p4);
  await ring(p4, { id: 9, company_id: "c1", from_number: "07868615571", booking_id: "b2", kind: "drops", reg: "CF75VLN", status: "ringing" }); await sleep(250);
  check("Calls: Call pop-ups without CALLED still pops up, with no CALLED button", !!(await p4.$("#callPop")) && !(await p4.$('[data-callmark="9"]')));
  await p4.context().close();
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

// A PICKS car on another sheet gets CALLED from the card.
await scenario(async () => {
  const db = callsDb("stdplus");
  const b4 = db.bookings.find((x) => x.id === "b4"); b4.kind = "picks"; b4.pick_called = "";
  const page = await phone(browser, db);
  await open(page);
  await ring(page, { id: 21, company_id: "c1", at: ago(0), from_number: "07700 900123", booking_id: "b4", kind: "picks", reg: "DY16MYO", name: "ATANASOV MX", status: "ringing", marked: "", handled_name: "" }); await sleep(600);
  check("Calls: a PICKS car on another sheet offers CALLED", !!(await page.$('[data-callmark="21"][data-callwhat="called"]')));
  await page.click('[data-callmark="21"]'); await sleep(500);
  const c = db.calls.filter((x) => x.fn === "tap_pick").pop();
  check("Calls: CALLED reaches that PICKS car and the card shows CALLED ✓", c && c.args.p_booking === "b4" && c.args.p_key === "called" && c.args.p_value === "Called" && /CALLED ✓/.test(await page.innerText("#callPop")), c);
  check("Calls (picks, other sheet): no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "calls");

// A car already SENT still offers CALLED on the card (no AT DESK); once called it says CALLED ✓ and On its way.
await scenario(async () => {
  const db = callsDb("stdplus");
  const b = db.bookings.find((x) => x.id === "b2"); b.sent_at = ago(3); b.called_at = null; b.called_word = "";
  const page = await phone(browser, db);
  await open(page);
  await ring(page, { id: 31, company_id: "c1", at: ago(0), from_number: "07868 615571", booking_id: "b2", kind: "drops", reg: "CF75VLN", name: "KHAIRA MS", status: "ringing", marked: "", handled_name: "" }); await sleep(500);
  const pop = await page.innerText("#callPop");
  check("Calls: a SENT car still offers CALLED, not AT DESK, and says On its way", !!(await page.$('[data-callmark="31"][data-callwhat="called"]')) && !(await page.$('[data-callmark="31"][data-callwhat="desk"]')) && /On its way/.test(pop), pop);
  await page.click('[data-callmark="31"]'); await sleep(500);
  const c = db.calls.filter((x) => x.fn === "tap_drop").pop();
  check("Calls: CALLED on a SENT car reaches the car", c && c.args.p_booking === "b2" && c.args.p_action === "called", c);
  check("Calls (sent car): no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "calls");
