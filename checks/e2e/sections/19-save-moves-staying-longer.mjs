import { check, sleep, addDays, TONIGHT, TOMORROW, iso, makeDb, phone, open, scenario, browser } from "../harness.mjs";

// A car staying longer (return changed by hand to a later night) whose night's sheet is in:
// Save with the date unchanged puts it on that night (setup 127; 26 Oct, JLZ646). Every look.
for (const theme of ["", "pro", "cards", "premium", "board", "stdplus", "ops", "ops-refined"]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  const look = theme || "standard";
  Object.assign(db.bookings.find((b) => b.id === "b1"), { overstay: true, return_at: iso(TOMORROW, "18:00"), orig_return_at: iso(TONIGHT, "21:45") });
  Object.assign(db.bookings.find((b) => b.id === "b2"), { overstay: true, return_at: iso(addDays(TONIGHT, 5), "10:00"), orig_return_at: iso(TONIGHT, "22:00") });
  const page = await phone(browser, db);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  await page.click("[data-savepanel]"); await sleep(800);
  const c = db.calls.filter((x) => x.fn === "set_return").pop();
  check("Staying longer (" + look + "): Save with the date unchanged sends its return", c && c.args.p_booking === "b1" && c.args.p_return_local.slice(0, 10) === TOMORROW, c);
  check("Staying longer (" + look + "): the car goes to its night and leaves tonight's board", db.bookings.find((b) => b.id === "b1").sheet_id === "d1" && await page.locator('.row[data-id="b1"]').count() === 0);
  // Its night isn't in yet: Save changes nothing.
  if (await page.locator("#panel[open]").count()) await page.click("#panel [data-close]").catch(() => {});
  await page.click('.row[data-id="b2"] .reg'); await page.waitForSelector("#panel[open]");
  await page.click("[data-savepanel]"); await sleep(600);
  check("Staying longer (" + look + "): its night not in yet, Save sends nothing", !db.calls.some((x) => x.fn === "set_return" && x.args.p_booking === "b2"));
  check("Staying longer (" + look + "): no errors", page.__errors.length === 0, page.__errors);
}, "staylonger");

// A real overstay (due back before tonight) and a car due back tonight: Save never moves them.
await scenario(async () => {
  const db = makeDb();
  Object.assign(db.bookings.find((b) => b.id === "b1"), { overstay: true, return_at: iso(addDays(TONIGHT, -1), "21:00") });
  db.sheets.push({ id: "dm1", company_id: "c1", kind: "drops", day: addDays(TONIGHT, -1) });
  const page = await phone(browser, db);
  await open(page);
  for (const id of ["b1", "b2"]) {
    await page.click('.row[data-id="' + id + '"] .reg'); await page.waitForSelector("#panel[open]");
    await page.click("[data-savepanel]"); await sleep(500);
    if (await page.locator("#panel[open]").count()) await page.click("#panel [data-close]").catch(() => {});
  }
  check("Overstay and tonight's car: Save with nothing changed sends no return", !db.calls.some((x) => x.fn === "set_return"), db.calls.filter((x) => x.fn === "set_return"));
  // A driver can't change returns: no call either.
  const db2 = makeDb(); db2.me = { ...db2.me, role: "bongo" }; db2.perms = { clear: true, sent: true };
  Object.assign(db2.bookings.find((b) => b.id === "b1"), { overstay: true, return_at: iso(TOMORROW, "18:00") });
  const p2 = await phone(browser, db2);
  await open(p2);
  await p2.click('.row[data-id="b1"] .reg'); await p2.waitForSelector("#panel[open]");
  if (await p2.locator("[data-savepanel]").count()) { await p2.click("[data-savepanel]"); await sleep(500); }
  check("Staying longer: a driver's Save sends no return", !db2.calls.some((x) => x.fn === "set_return"));
}, "staylonger");
