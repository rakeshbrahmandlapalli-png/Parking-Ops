import { check, sleep, makeDb, phone, open, toast, scenario, browser, dashData } from "../harness.mjs";

// Remove a car: WHY has No show, Cancelled, Duplicate, RTC and Early return (setup 109), every look, on the smallest phone.
for (const theme of ["", "pro", "cards", "premium", "board", "stdplus", "ops", "ops-refined"]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  const look = theme || "standard";
  const page = await phone(browser, db);
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page);
  await page.click('.row[data-id="b2"] .reg'); await page.waitForSelector("#panel[open]");
  await page.click("[data-removecar]"); await sleep(300);
  const why = await page.locator("[data-removewhy]").evaluateAll((els) => els.map((e) => e.innerText.trim()));
  check("Remove reasons (" + look + "): five reasons, RTC and Early return last", why.join("|") === "NO SHOW|CANCELLED|DUPLICATE|RTC|EARLY RETURN", why);
  const fits = await page.locator("[data-removewhy]").evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= window.innerWidth));
  check("Remove reasons (" + look + "): every button fits a 360 px phone", fits);
  await page.click('[data-removewhy="Early return"]'); await sleep(500);
  const c = db.calls.filter((x) => x.fn === "remove_booking").pop();
  check("Remove reasons (" + look + "): Early return sends that reason and the car leaves the board", c && c.args.p_reason === "Early return" && await page.locator('.row[data-id="b2"]').count() === 0 && /removed: Early return/.test(await toast(page)), c && c.args);
  if (theme === "" || theme === "ops") {
    await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
    await page.click("[data-removecar]"); await sleep(300); await page.click('[data-removewhy="RTC"]'); await sleep(500);
    check("Remove reasons (" + look + "): RTC sends that reason", db.calls.filter((x) => x.fn === "remove_booking").pop().args.p_reason === "RTC");
    await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300);
    await page.click("#menu [data-removedlist]"); await sleep(300);
    const list = (await page.locator(".rmlist").innerText()).replace(/\s+/g, " ");
    check("Remove reasons (" + look + "): Removed cars shows each reason and can put them back", /RTC/.test(list) && /Early return/.test(list) && await page.locator("[data-restore]").count() === 2, list);
  }
  check("Remove reasons (" + look + "): no errors", page.__errors.length === 0, page.__errors);
}, "remove");

// The dashboard counts RTC and Early return removals (from the list; the database totals have no such keys yet).
await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "stdplus", colour: "#F9A01B", ink: "#172536", short: "TakeOff" }; db.dash = dashData();
  const r0 = db.dash.removed[0];
  db.dash.removed.push({ ...r0, id: "r2", reg: "RTC1", removed_reason: "RTC" }, { ...r0, id: "r3", reg: "EARLY1", removed_reason: "Early return" }, { ...r0, id: "r4", reg: "EARLY2", removed_reason: "Early return" });
  const page = await phone(browser, db);
  await open(page); await sleep(400);
  await page.evaluate(() => (document.querySelector("#cHead:not(.hidden)") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300);
  await page.click('#menuBody [data-view="dashboard"]'); await sleep(700);
  const desk = await page.locator('[data-fold="desk"] .od-line').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  check("Remove reasons: the dashboard counts RTC and early returns", desk[1] === "Removed 1 no show · 1 RTC · 2 early return 4", desk);
  check("Remove reasons (dashboard): no errors", page.__errors.length === 0, page.__errors);
}, "remove");
