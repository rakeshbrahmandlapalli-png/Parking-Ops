import { check, sleep, makeDb, phone, open, scenario, browser, noSideScroll, dashData, dashSheets } from "../harness.mjs";

// The dashboard's "What needs doing?" (27 Oct, from the user's Action desk mockup): Priority work from live
// figures, Coming up by hour, Site status against capacity, the handover note. Operations looks only.
const txt = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
const goDash = async (page) => { await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300); await page.click('#menuBody [data-view="dashboard"]'); await sleep(800); };
for (const theme of ["stdplus", "ops", "ops-refined"]) await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff", picks_yard: true }; db.company.capacity = 40;
  db.dash = dashData(); dashSheets(db);
  const q1 = db.bookings.find((b) => b.id === "q1"); q1.desk_at = new Date(Date.now() - 300000).toISOString();
  db.bookings.push({ id: "pin1", sheet_id: "p0", kind: "picks", ref: "IN1", reg: "INYARD1", num: 11, name: "IN MR", drop_at: new Date(Date.now() - 3600000).toISOString(), return_at: new Date(Date.now() + 86400000 * 3).toISOString(), intake: "Collected", intake_at: new Date().toISOString(), pt_at: new Date().toISOString(), yard: "", note: "" },
    { id: "pin2", sheet_id: "p0", kind: "picks", ref: "IN2", reg: "INYARD2", num: 12, name: "IN TWO", drop_at: new Date(Date.now() - 3600000).toISOString(), return_at: new Date(Date.now() + 86400000 * 3).toISOString(), intake: "Collected", intake_at: new Date().toISOString(), pt_at: new Date().toISOString(), yard: "NB", note: "" },
    { id: "pcome", sheet_id: "p0", kind: "picks", ref: "C1", reg: "COMING1", num: 13, name: "COMING MR", drop_at: new Date(Date.now() + 3600000).toISOString(), return_at: new Date(Date.now() + 86400000 * 3).toISOString(), intake: "", note: "" });
  const noYard = db.bookings.filter((b) => b.sheet_id === "p0" && b.intake === "Collected" && !b.yard && !b.removed_at).map((b) => b.id);
  const page = await phone(browser, db); await page.setViewportSize({ width: 390, height: 844 });
  await open(page); await sleep(400); await goDash(page);
  const tasks = await page.locator(".od-task").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  check("Dashboard desk (" + theme + "): a customer at the desk comes first", /^01 Send 1 car for a customer at the desk .* Open →$/.test(tasks[0]), tasks);
  check("Dashboard desk (" + theme + "): with locations on PICKS, Assign counts today's cars taken in with no yard", tasks.some((t) => new RegExp("Assign " + noYard.length + " cars? to a yard Taken in today with no yard set\\. Assign →").test(t)), tasks);
  const site = await txt(page, ".od-site");
  check("Dashboard desk (" + theme + "): Site status, parked, spaces free and occupancy", /^Site status 30 parked 10 spaces free Occupancy 75% of 40 Returning today 8 Tomorrow 0 2 past their return$/.test(site) && await page.locator(".od-site .od-bar i").evaluate((e) => e.style.width === "75%"), site);
  const cup = await page.locator(".od-cuprow").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  check("Dashboard desk (" + theme + "): Coming up counts a PICKS car still to arrive", cup.reduce((n, c) => n + +(c.match(/(\d+) arrivals?/) || [0, 0])[1], 0) >= 1, cup);
  check("Dashboard desk (" + theme + "): phone, no sideways scrolling", await noSideScroll(page));
  await page.click('.od-tasks [data-dashqueue="desk"]'); await sleep(700);
  check("Dashboard desk (" + theme + "): Open shows the car at the desk on the board", await page.locator('.row[data-id]').evaluateAll((els) => els.map((e) => e.dataset.id).join()) === "q1" && /At the desk, not sent · 1/.test(await page.locator(".queuebar").innerText()));
  await goDash(page);
  await page.click('.od-tasks [data-dashqueue="noyard"]'); await sleep(700);
  const nyRows = await page.locator('.row[data-id]').evaluateAll((els) => els.map((e) => e.dataset.id).sort().join());
  check("Dashboard desk (" + theme + "): Assign opens today's PICKS on the cars with no yard", nyRows === noYard.slice().sort().join() && /Taken in, no yard · /.test(await page.locator(".queuebar").innerText()), [nyRows, noYard, await page.locator(".queuebar").innerText().catch(() => "")]);
  await goDash(page);
  await page.click(".od-boardlink"); await sleep(500);
  check("Dashboard desk (" + theme + "): Open operations board goes to the board", await page.evaluate(() => document.getElementById("main").dataset.view === "board"));
  await goDash(page);
  await page.setViewportSize({ width: 1440, height: 1000 }); await sleep(300);
  check("Dashboard desk (" + theme + "): desktop, Site status and Handover beside Priority work", await page.evaluate(() => { const m = document.querySelector(".od-dmain").getBoundingClientRect(), s = document.querySelector(".od-dside").getBoundingClientRect(); return Math.abs(m.top - s.top) < 2 && s.left >= m.right - 1 && s.width > 300; }) && await noSideScroll(page));
  db.dash.handover = { note: "", at: null, by: "" }; await page.click("[data-dashreload]"); await sleep(800);
  check("Dashboard desk (" + theme + "): no note yet says so, with Write a note", /No note for the next shift\./.test(await txt(page, ".od-desk .od-handover")) && await txt(page, "[data-handoveredit]") === "Write a note");
  check("Dashboard desk (" + theme + "): no errors", page.__errors.length === 0, page.__errors);
}, "dashdesk");
