import { path, check, sleep, server, addDays, TONIGHT, iso, makeDb, phone, open, text, toast, scenario, browser, failed, apbDb } from "../harness.mjs";

// ── switching sheets: the old cars never stay tappable under the new date ──
await scenario(async () => {
  const gate = () => { let go; const p = new Promise((r) => { go = r; }); const f = () => p; f.go = go; return f; };
  const rowIds = (page) => page.evaluate(() => [...document.querySelectorAll("#main .row")].map((r) => r.dataset.id));
  const db = makeDb(), page = await phone(browser, db);
  db.sheets.push({ id: "d9", company_id: "c1", kind: "drops", day: addDays(TONIGHT, -40), archived_at: iso(addDays(TONIGHT, -30), "10:00") });
  db.bookings.push({ id: "ar1", company_id: "c1", sheet_id: "d9", kind: "drops", ref: "AR1", reg: "OLD9CAR", num: 1, name: "ARCHIVED MR", flight: "", return_at: iso(addDays(TONIGHT, -40), "23:00"), note: "" });
  db.sheetGate = {};
  await open(page);
  const pick = (id) => page.evaluate((v) => { const e = document.getElementById("sheetPick"); e.value = v; e.dispatchEvent(new Event("change", { bubbles: true })); }, id);
  // 1. a delayed load: a loading line, no old cars, and the old car's panel is shut
  await page.click('.row[data-id="b1"] .reg'); await sleep(300);
  check("switch: a car is open on tonight", await page.locator("#panel[open]").count() === 1);
  db.sheetGate.d1 = gate(); const callsBefore = db.calls.length;
  await pick("d1"); await sleep(200);
  check("switch: the car dialog from the old sheet is closed", await page.locator("#panel[open]").count() === 0);
  check("switch: shows Loading and the picker names the requested day", /Loading/.test(await text(page, "#main")) && (await page.locator("#sheetPick").inputValue()) === "d1", await text(page, "#main"));
  check("switch: no old cars or buttons while loading", (await rowIds(page)).length === 0 && await page.locator("#main [data-act]").count() === 0);
  check("switch: old counts are hidden while loading", !(await page.isVisible("#boardHead")));
  let blocked = false; try { await page.click('[data-act="sent"]', { timeout: 500 }); } catch (e) { blocked = true; }
  check("switch: a tap on an old row is impossible and nothing is sent", blocked && !db.calls.slice(callsBefore).some((c) => c.fn === "tap_drop"));
  db.sheetGate.d1.go();
  await page.waitForSelector('.row[data-id="b5"]'); await sleep(200);
  check("switch: new rows, date and counts arrive together", (await rowIds(page)).includes("b5") && !(await rowIds(page)).includes("b1") && /Loading/.test(await text(page, "#main")) === false && await page.isVisible("#boardHead") && (await page.locator("#sheetPick").inputValue()) === "d1", await rowIds(page));
  // 2. a failed load restores the old sheet, with a retry
  db.sheetGate.d0 = () => Promise.resolve("fail"); await pick("d0"); await sleep(400);
  check("switch: a failed load says so and offers Try again and Back", /Couldn't load/.test(await text(page, "#main")) && await page.locator("[data-sheetretry]").count() === 1 && await page.locator("#main .row").count() === 0, await text(page, "#main"));
  await page.click("[data-sheetback]"); await sleep(300);
  check("switch: Back restores the previous sheet's date and cars", (await rowIds(page)).includes("b5") && !(await rowIds(page)).includes("b1") && (await page.locator("#sheetPick").inputValue()) === "d1", await rowIds(page));
  await pick("d0"); await sleep(300); db.sheetGate.d0 = null;
  await page.click("[data-sheetretry]"); await page.waitForSelector('.row[data-id="b1"]');
  check("switch: Try again loads it once the server answers", (await page.locator("#sheetPick").inputValue()) === "d0" && (await rowIds(page)).includes("b1"));
  // 3. rapid changes, answers out of order: only the last choice shows
  const g1 = gate(), g2 = gate(); db.sheetGate.d1 = g1; db.sheetGate.p0 = g2;
  await pick("d1"); await pick("p0"); await sleep(150);
  g2.go(); await page.waitForSelector('.row[data-id="p1"]'); g1.go(); await sleep(500);
  check("switch: a late answer for an older choice never overwrites the latest", (await rowIds(page)).includes("p1") && !(await rowIds(page)).includes("b5") && (await page.locator("#sheetPick").inputValue()) === "p0", await rowIds(page));
  db.sheetGate = {};
  // 4. archive: opened, then left
  db.sheetGate.d9 = gate();
  await page.evaluate(() => { const b = document.createElement("button"); b.dataset.archopen = "d9"; b.id = "fakeArch"; b.textContent = "x"; document.body.appendChild(b); b.click(); });
  await sleep(250);
  check("archive: shows Loading while the old day opens, no cars of the sheet before", /Loading/.test(await text(page, "#main")) && (await rowIds(page)).length === 0);
  db.sheetGate.d9.go(); await page.waitForSelector('.row[data-id="ar1"]');
  check("archive: the archived day shows with its own cars and a picker entry", (await page.locator("#sheetPick").inputValue()) === "d9" && await page.locator("#sheetPick optgroup[label='OPENED FROM ARCHIVE']").count() === 1);
  await pick("d0"); await page.waitForSelector('.row[data-id="b1"]'); await sleep(200);
  check("archive: leaving it drops the archive entry and shows tonight", await page.locator("#sheetPick optgroup[label='OPENED FROM ARCHIVE']").count() === 0 && !(await rowIds(page)).includes("ar1"));
  check("switch: no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
});
// Drops | Picks on the Operations look, and a delayed load on a card look
await scenario(async () => {
  const gate = () => { let go; const p = new Promise((r) => { go = r; }); const f = () => p; f.go = go; return f; };
  for (const theme of ["ops", "premium", "cards"]) {
    const db = makeDb(); db.company.brand = { colour: "#F9A01B", ink: "#1A1A1A", short: "TakeOff", theme }; db.sheetGate = {};
    const page = await phone(browser, db); await open(page);
    db.sheetGate.p0 = gate();
    const sel = (await page.locator("#kindBar [data-kind=picks]:visible").count()) ? "#kindBar [data-kind=picks]" : "#kindSeg [data-kind=picks]";
    await page.click(sel); await sleep(250);
    check(theme + ": Drops/Picks switch shows Loading and no old cars", /Loading/.test(await text(page, "#main")) && await page.locator("#main .row").count() === 0 && await page.locator("#main [data-act]").count() === 0);
    check(theme + ": the Picks button is already marked", (await page.locator(sel).getAttribute("aria-pressed")) === "true");
    db.sheetGate.p0.go(); await page.waitForSelector('.row[data-id="p1"]'); await sleep(200);
    check(theme + ": Picks cars arrive and Loading is gone", !/Loading/.test(await text(page, "#main")) && await page.locator('.row[data-id="b1"]').count() === 0);
    check(theme + ": no errors", page.__errors.length === 0, page.__errors);
    await page.context().close();
  }
});

// Fill times and Check flights (12 Oct 2026): owners, managers and the office
// any time; drivers and terminal staff 2 an hour between both buttons, with
// what's left shown by the buttons; view-only gets neither.
for (const [look, role] of [["Standard", "bongo"], ["Operations", "terminal"], ["Operations", "office"], ["Standard", "view"]]) await scenario(async () => {
  const db = look === "Operations" ? apbDb("ops") : makeDb(); db.me = { ...db.me, role };
  if (role === "bongo") db.perms = { sent: true, rtc: true, note: true, intake: true };
  if (role === "terminal") db.perms = { clear: true, picksinfo: true, note: true, intake: true };
  if (role === "view") db.perms = {};
  if (role === "bongo" || role === "terminal") db.checksUsed = 0;
  const page = await phone(browser, db, { width: 390 });
  await open(page); await sleep(300);
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300);
  await page.click('#menuBody [data-view="flights"]'); await sleep(500);
  const left = () => page.evaluate(() => (document.querySelector("#main .checks-left") || {}).textContent || "");
  const btns = await page.locator("#main [data-filltimes], #main [data-checkflights]").count();
  if (role === "view") return check("Flight checks (" + look + ", view-only): no Fill times or Check flights", btns === 0);
  if (role === "office" && process.env.PREVIEW) await page.screenshot({ path: process.env.PREVIEW + "/checks-office-" + look + ".png" });
  if (role === "office") return check("Flight checks (" + look + ", office): both buttons, no limit shown", btns === 2 && await left() === "");
  if (process.env.PREVIEW) await page.screenshot({ path: process.env.PREVIEW + "/checks-2-left-" + look + "-" + role + ".png" });
  check("Flight checks (" + look + ", " + role + "): both buttons, 2 of 2 left this hour", btns === 2 && await left() === "2 of 2 checks left this hour", { btns, left: await left() });
  await page.click("#main [data-filltimes]"); await sleep(700);
  check("Flight checks (" + look + ", " + role + "): after Fill times, 1 of 2 left", await left() === "1 of 2 checks left this hour", await left());
  await page.click("#main [data-checkflights]"); await sleep(700);
  check("Flight checks (" + look + ", " + role + "): after Check flights, 0 of 2 left", await left() === "0 of 2 checks left this hour", await left());
  if (process.env.PREVIEW) await page.screenshot({ path: process.env.PREVIEW + "/checks-0-left-" + look + "-" + role + ".png" });
  await page.click("#main [data-checkflights]"); await sleep(700);
  const t = await toast(page);
  check("Flight checks (" + look + ", " + role + "): a third is refused with when the next one is", /2 flight checks this hour\. Next one in 40 min/.test(t) && db.checksUsed === 2, t);
  check("Flight checks (" + look + ", " + role + "): no errors", page.__errors.length === 0, page.__errors);
});

// Flights: Check flights asks for live positions only; the timetable (AeroData,
// a paid monthly allowance) is its own clearly named button; Settings no longer
// offers a timetable timer.
for (const [look, mk] of [["Standard", () => makeDb()], ["Operations", () => apbDb("ops")]]) await scenario(async () => {
  const db = mk(), page = await phone(browser, db, { width: 390 });
  await open(page); await sleep(300);
  const go = async (v) => { await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.querySelector("#cHead:not(.hidden)") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300); await page.click('#menuBody [data-view="' + v + '"]'); await sleep(400); };
  await go("flights");
  const b = await page.evaluate(() => ({ fill: (document.querySelector("#main [data-filltimes]") || {}).textContent, check: (document.querySelector("#main [data-checkflights]") || {}).textContent }));
  check(look + " Flights: Fill times says it uses AeroData; Check flights doesn't", /AeroData/.test(b.fill || "") && b.check && !/AeroData/.test(b.check), b);
  await page.click("#main [data-checkflights]"); await sleep(600);
  const t = await toast(page);
  check(look + " Flights: Check flights asks for live positions only and says what it found", db.flightCalls.length === 1 && db.flightCalls[0].action === "check" && /1 live ETAs · 1 landed/.test(t) && !/timetable/i.test(t), { calls: db.flightCalls, t });
  await page.click("#main [data-filltimes]"); await sleep(600);
  check(look + " Flights: Fill times asks for that sheet's timetable", db.flightCalls.length === 2 && db.flightCalls[1].action === "timetable" && /^\d{4}-\d{2}-\d{2}$/.test(db.flightCalls[1].day), db.flightCalls);
  await go("settings");
  check(look + " Settings: no timetable timer (AeroData runs only from Fill times)", await page.evaluate(() => !document.querySelector('[data-setting="schedule_every_hours"]') && !/AeroDataBox/.test(document.querySelector(".fchecks").textContent)));
  await page.selectOption('[data-setting="active_from"]', "0"); await page.selectOption('[data-setting="before_min"]', "240"); await page.selectOption('[data-setting="live_every_min"]', "10"); await sleep(200);
  if (process.env.PREVIEW) await page.evaluate(() => document.querySelector(".fchecks").scrollIntoView()), await page.screenshot({ path: process.env.PREVIEW + "/settings-24h-" + look + ".png" });
  check(look + " Settings: 24 hours of flight checks shows no FlightRadar24 credits warning", await page.evaluate(() => !/credits/i.test(document.querySelector(".fchecks").textContent) && !document.querySelector(".fchecks .alert")));
  check(look + " Flights and Settings: no errors", page.__errors.length === 0, page.__errors);
});
