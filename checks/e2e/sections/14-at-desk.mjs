import { check, sleep, makeDb, phone, open, scenario, browser } from "../harness.mjs";

// AT DESK (setup 112): the row's CALLED button goes CALLED → AT DESK → CALLED, with the time and name;
// a car at the desk and not SENT is first in NEXT IN QUEUE; CALLED comes off in the car's panel. Every look.
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const btn = (page, id) => page.locator('.row[data-id="' + id + '"] .acts [data-act="called"]').first();
const word = async (page, id) => (await btn(page, id).innerText()).replace(/\s+/g, " ").trim().toUpperCase();
for (const theme of ["", "pro", "cards", "premium", "board", "stdplus", "ops", "ops-refined"]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  Object.assign(db.bookings.find((b) => b.id === "b2"), { called_at: ago(10), called_by: "s2", called_word: "Called" });
  const look = theme || "standard";
  const page = await phone(browser, db);
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page);
  await btn(page, "b1").click(); await sleep(300);
  check("At desk (" + look + "): first tap is CALLED as before", /^CALLED/.test(await word(page, "b1")) && db.calls.filter((x) => x.fn === "tap_drop").pop().args.p_action === "called");
  await btn(page, "b1").click(); await sleep(300);
  const c = db.calls.filter((x) => x.fn === "tap_drop").pop();
  check("At desk (" + look + "): second tap sends desk on", c.args.p_action === "desk" && c.args.p_on === true, c.args);
  const w = await word(page, "b1");
  check("At desk (" + look + "): the button reads AT DESK with the time and name", /^AT DESK/.test(w) && /\d\d:\d\d/.test(w) && /RAKESH/.test(w) && await btn(page, "b1").evaluate((e) => e.classList.contains("dk") && e.classList.contains("on")), w);
  check("At desk (" + look + "): the row is marked and first in the queue", await page.locator('.row[data-id="b1"]').evaluate((e) => e.classList.contains("atdesk")) &&
    await page.evaluate(() => document.querySelector("#main .row[data-id]").dataset.id) === "b1");
  const fits = await page.locator('.row[data-id="b1"] .acts button').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().right <= window.innerWidth + 1));
  check("At desk (" + look + "): the three buttons still fit a 360 px phone", fits && await page.locator('.row[data-id="b1"] .acts button').count() === 3);
  await btn(page, "b1").click(); await sleep(300);
  const c2 = db.calls.filter((x) => x.fn === "tap_drop").pop();
  check("At desk (" + look + "): third tap takes AT DESK off and leaves CALLED", c2.args.p_action === "desk" && c2.args.p_on === false && /^CALLED/.test(await word(page, "b1")) && !!db.bookings.find((b) => b.id === "b1").called_at);
  // CALLED comes off in the car's panel.
  await btn(page, "b1").click(); await sleep(300);
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  check("At desk (" + look + "): the panel shows AT DESK on, and its time", await page.locator('#panel [data-word="desk:"].on').count() === 1 && /AT DESK|At desk/.test(await page.locator("#panel").innerText()));
  await page.click('#panel [data-word="called:Called"]'); await sleep(400);
  const b1 = db.bookings.find((b) => b.id === "b1");
  check("At desk (" + look + "): CALLED off in the panel takes AT DESK off too", !b1.called_at && !b1.desk_at && /^CALLED$/.test(await word(page, "b1")));
  check("At desk (" + look + "): no errors", page.__errors.length === 0, page.__errors);
}, "atdesk");

// OVERSTAY taps off as before (never AT DESK); the Operations desktop says At desk in Status.
await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "ops", colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  Object.assign(db.bookings.find((b) => b.id === "b2"), { called_at: ago(10), called_by: "s2", called_word: "Overstay", overstay: true });
  Object.assign(db.bookings.find((b) => b.id === "b1"), { called_at: ago(12), called_by: "s2", called_word: "Called", desk_at: ago(3), desk_by: "s2" });
  const page = await phone(browser, db, { width: 1440 }); await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const st = (await page.locator('.row[data-id="b1"] .dc-s').innerText()).replace(/\s+/g, " ");
  check("At desk (ops desktop): Status says At desk with the minutes", /At desk \d\d:\d\d · 3 min/.test(st) && /waiting 12 min/.test(st), st);
  check("At desk (ops desktop): the button reads AT DESK and SUGU", /^AT DESK/.test(await word(page, "b1")) && /SUGU/.test(await word(page, "b1")));
  await btn(page, "b2").click(); await sleep(300);
  const c = db.calls.filter((x) => x.fn === "tap_drop").pop();
  check("At desk (ops desktop): OVERSTAY taps off as before", c.args.p_action === "called" && c.args.p_on === false, c.args);
  check("At desk (ops desktop): no errors", page.__errors.length === 0, page.__errors);
}, "atdesk");

// Part 115: Terminal has AT DESK without CALLED or OVERSTAY. The row button works only on a car already
// CALLED (CALLED → AT DESK → CALLED); an uncalled car and OVERSTAY stay greyed; the panel has AT DESK only.
for (const theme of ["", "ops", "ops-refined", "premium"]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  const look = theme || "standard";
  db.perms = { sent: false, called: false, desk: true, clear: true, yard: false, note: true, intake: true, flights: false, picksinfo: true };
  Object.assign(db.bookings.find((b) => b.id === "b2"), { called_at: ago(10), called_by: "s2", called_word: "Called" });
  const page = await phone(browser, db);
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page);
  check("Terminal AT DESK (" + look + "): the button on a car not called yet can be tapped", !(await btn(page, "b1").isDisabled()));
  check("Terminal AT DESK (" + look + "): CALLED on a called car can be tapped", !(await btn(page, "b2").isDisabled()));
  await btn(page, "b2").click(); await sleep(300);
  const c = db.calls.filter((x) => x.fn === "tap_drop").pop();
  check("Terminal AT DESK (" + look + "): the tap sends desk on", c.args.p_action === "desk" && c.args.p_on === true && /^AT DESK/.test(await word(page, "b2")), c.args);
  await btn(page, "b2").click(); await sleep(300);
  check("Terminal AT DESK (" + look + "): the next tap goes back to CALLED", db.calls.filter((x) => x.fn === "tap_drop").pop().args.p_on === false && /^CALLED/.test(await word(page, "b2")));
  await page.click('.row[data-id="b2"] .reg'); await page.waitForSelector("#panel[open]");
  check("Terminal AT DESK (" + look + "): the panel has AT DESK but no CALLED or OVERSTAY",
    await page.locator('#panel [data-word="desk:"]').count() === 1 && await page.locator('#panel [data-word="called:Called"], #panel [data-word="called:Overstay"]').count() === 0);
  await page.click("#panel [data-close]").catch(() => {}); await sleep(200);
  // A customer who comes straight to the desk: AT DESK on a car not called yet calls it too.
  await btn(page, "b1").click(); await sleep(300);
  const b1 = db.bookings.find((b) => b.id === "b1");
  check("Terminal AT DESK (" + look + "): a car not called yet goes straight to AT DESK", /^AT DESK/.test(await word(page, "b1")) && !!b1.called_at && !!b1.desk_at, [await word(page, "b1"), b1.called_at]);
  check("Terminal AT DESK (" + look + "): no errors", page.__errors.length === 0, page.__errors);
}, "atdesk");

