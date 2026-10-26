import { check, sleep, makeDb, phone, open, pickKind, scenario, browser } from "../harness.mjs";

// The customer's phone number in the car panel (setup 124): the office adds, changes or clears it;
// whoever takes cars in fills in a missing one; view-only sees no box. Every look.
for (const theme of ["", "pro", "cards", "premium", "board", "stdplus", "ops", "ops-refined"]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  const look = theme || "standard";
  const page = await phone(browser, db);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  check("Phone (" + look + "): the office gets the phone box with the booked number", await page.isVisible("#phoneText") && await page.inputValue("#phoneText") === "07868 615571");
  await page.fill("#phoneText", "07700 abc"); await page.click("[data-savepanel]"); await sleep(300);
  check("Phone (" + look + "): letters are refused", !db.calls.some((x) => x.fn === "set_phone") && await page.isVisible("#panel[open]"));
  await page.fill("#phoneText", "07700  900123"); await page.click("[data-savepanel]"); await sleep(600);
  const c = db.calls.filter((x) => x.fn === "set_phone").pop();
  check("Phone (" + look + "): Save sends the new number", c && c.args.p_booking === "b1" && c.args.p_phone === "07700 900123", c);
  check("Phone (" + look + "): nothing else is changed", !db.calls.some((x) => ["set_note", "set_reg", "set_return", "set_flight"].includes(x.fn)));
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  check("Phone (" + look + "): the panel shows the new number and calls it", await page.inputValue("#phoneText") === "07700 900123" && await page.locator('#panel a.tel[href="tel:07700900123"]').count() === 1);
  // A PICKS car with no number: add one.
  await page.click("#panel [data-close]"); await sleep(200);
  await pickKind(page, "picks");
  await page.click('.row[data-id="p1"] .reg'); await page.waitForSelector("#panel[open]");
  await page.fill("#phoneText", "+44 7700 900456"); await page.click("[data-savepanel]"); await sleep(600);
  check("Phone (" + look + "): a PICKS car with no number gets one", db.calls.filter((x) => x.fn === "set_phone").pop().args.p_phone === "+44 7700 900456");
  check("Phone (" + look + "): no errors", page.__errors.length === 0, page.__errors);
}, "phone");

// Permissions: a driver fills in a missing number but can't change one; view-only gets no box.
await scenario(async () => {
  const db = makeDb();
  db.perms = { sent: true, called: false, desk: false, clear: false, yard: false, note: false, intake: true, flights: false, picksinfo: true };
  const page = await phone(browser, db);
  await open(page);
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  check("Phone: a driver can't change a booked number", await page.locator("#phoneText").count() === 0);
  await page.click("#panel [data-close]"); await sleep(200);
  await pickKind(page, "picks");
  await page.click('.row[data-id="p1"] .reg'); await page.waitForSelector("#panel[open]");
  check("Phone: a driver can fill in a missing number", await page.isVisible("#phoneText") && await page.isVisible("[data-savepanel]"));
  check("Phone: no errors (driver)", page.__errors.length === 0, page.__errors);
}, "phone");
await scenario(async () => {
  const db = makeDb(); db.perms = { sent: false, called: false, desk: false, clear: false, yard: false, note: false, intake: false, flights: false, picksinfo: true };
  const page = await phone(browser, db);
  await open(page);
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  check("Phone: view-only gets no phone box, only the Call link", await page.locator("#phoneText").count() === 0 && await page.locator("#panel a.tel").count() === 1);
}, "phone");
