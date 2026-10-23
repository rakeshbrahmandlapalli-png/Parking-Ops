import { check, sleep, server, addDays, TONIGHT, TOMORROW, iso, makeDb, now, keysDb, b64, phone, open, text, noSideScroll, toast, pickKind, scenario, browser } from "../harness.mjs";

// 18a. back in the app after a while (WhatsApp, a call): only what changed is
// fetched, not the whole sheet (the free plan's download allowance).
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db);
  await open(page);
  // Signal lost in the car park, then back a few minutes later.
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  // Meanwhile, on other phones: a note on b2, and b3 carried to tomorrow's sheet.
  const later = new Date(Date.now() + 5000).toISOString();
  Object.assign(db.bookings.find((x) => x.id === "b2"), { note: "CALLED BACK", updated_at: later });
  Object.assign(db.bookings.find((x) => x.id === "b3"), { sheet_id: "d1", updated_at: later });
  db.bookingGets = [];
  await sleep(500);
  await page.evaluate(() => window.dispatchEvent(new Event("online"))); await sleep(1500);
  const gets = db.bookingGets.filter((q) => q.sheet_id === "eq.d0" || (q.sheet_id || "").startsWith("neq."));
  check("signal back: the change made meanwhile shows", /CALLED BACK/.test(await text(page, '.row[data-id="b2"]')));
  check("signal back: a car moved to another sheet leaves this one", await page.locator('.row[data-id="b3"]').count() === 0);
  check("signal back: only the changes are fetched, not the whole sheet", gets.length > 0 && gets.every((q) => (q.updated_at || "").startsWith("gte.")), gets);
  check("signal back: no errors", page.__errors.length === 0, page.__errors);
});

// 18b. import on a phone: the file picker sends the app to the background; the
// file must still be taken when it comes back (it was lost to a redraw).
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db);
  await open(page);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(300);
  const input = await page.$('input[data-file="excel"]');
  const vis = (state) => page.evaluate((st) => { Object.defineProperty(document, "visibilityState", { value: st, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }, state);
  await vis("hidden"); await sleep(1500); await vis("visible");
  await input.setInputFiles({ name: "drops.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("x") });
  await sleep(400);
  check("import on a phone: the chosen file is taken after the file picker (app back from the background)", /drops\.xlsx/.test(await page.locator(".steps").innerText()) && await page.locator("[data-read]:not([disabled])").count() === 1);
});

// 18c. after an import: ✕ and Undo at the top of the "not in this file" box; Undo on the Import screen
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db, { width: 1000 });
  await open(page);
  const b64 = await page.evaluate(async (day) => {
    await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "/vendor/xlsx-0.18.5.full.min.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
    const [y, m, d] = day.split("-").map(Number);
    const serial = (dd, h, mi) => (Date.UTC(y, m - 1, dd, h, mi) - Date.UTC(1899, 11, 30)) / 864e5;
    const ws = XLSX.utils.aoa_to_sheet([["Ref", "Name", "Vehicle", "Booking From", "Booking To"], ["X1", "ONE", "FORD FIESTA AB12CDE", 0, 0]]);
    ws.D2 = { t: "n", v: serial(d, 13, 20), z: "dd/mm/yyyy hh:mm" }; ws.E2 = { t: "n", v: serial(d + 3, 1, 0), z: "dd/mm/yyyy hh:mm" };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "S");
    return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  }, TONIGHT);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(300);
  await page.click('[data-impkind="picks"]'); await sleep(200);
  await page.setInputFiles('input[data-file="excel"]', { name: "picks.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(b64, "base64") });
  await sleep(200); await page.click("[data-read]"); await page.waitForSelector("[data-create]", { timeout: 8000 });
  await page.click("[data-create]"); await sleep(900);
  check("after import: the 'not in this file' box has a ✕ and Undo this import at the top", await page.locator("#panelBody .pclose").count() === 1 && await page.locator("#panelBody .pbtns.top [data-undoimport]").count() === 1);
  await page.click("#panelBody .pclose"); await sleep(300);
  check("after import: ✕ closes the box and removes nothing", !(await page.evaluate(() => document.getElementById("panel").open)) && !db.calls.some((c) => c.fn === "remove_booking"));
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(600);
  check("Import screen lists the import with an Undo button", await page.locator(".bi-recent [data-undoimport]").count() === 1, await page.locator(".bi-recent").innerText().catch(() => ""));
  await page.click(".bi-recent [data-undoimport]"); await sleep(800);
  check("Undo asks, then undoes that import on the server", db.calls.some((c) => c.fn === "undo_import" && c.args.p_id === 70) && /Import undone/.test(await toast(page)), await toast(page));
  check("undo: no errors", page.__errors.length === 0, page.__errors);
});

// 19. the office adds a car by hand; takes an overstay payment; removes a car and puts it back
await scenario(async () => {
  const db = makeDb(); db.company.overstay_rate = 30;
  db.bookings.find((x) => x.id === "b3").return_at = iso(addDays(TONIGHT, -3), "22:15");
  const page = await phone(browser, db, { width: 800 });
  await open(page);
  // Add a car: a time after midnight on the sheet's own date is the next morning.
  await page.click("#menuBtn"); await sleep(300); await page.click("#menu [data-addcar]"); await sleep(300);
  await page.fill("#acReg", "zz12 new");
  await page.click("#acGo"); await sleep(300);
  check("add a car: DROPS without a BACK time is refused", /date and the time/.test(await toast(page)) && !db.calls.some((c) => c.fn === "add_booking"));
  await page.fill("#acRetT", "0130"); await page.click("#acGo"); await sleep(600);
  const add = db.calls.find((c) => c.fn === "add_booking");
  check("add a car: 01:30 on the sheet's date is saved as the next morning", !!add && add.args.p.return_local === addDays(TONIGHT, 1) + " 01:30", add && add.args.p);
  // A car added to PICKS that comes back the same day: asked, then put on DROPS too.
  await page.selectOption("#sheetPick", "p0"); await sleep(600);
  await page.click("#menuBtn"); await sleep(300); await page.click("#menu [data-addcar]"); await sleep(300);
  await page.fill("#acReg", "ZZ28SDR"); await page.fill("#acName", "Same Day"); await page.fill("#acDropT", "0800");
  await page.fill("#acRetD", TONIGHT); await page.fill("#acRetT", "1900"); await page.click("#acGo"); await sleep(1200);
  const ask = page.__dialogs.find((m) => /ZZ28SDR/.test(m)) || "";
  check("same-day PICKS car: the app asks to add it to DROPS", /DROPS/.test(ask) && /Add this car/.test(ask), page.__dialogs);
  const tw = db.calls.find((c) => c.fn === "add_pick_to_drops");
  check("same-day PICKS car: said yes, it's added to DROPS", !!tw && db.bookings.some((x) => x.kind === "drops" && x.sheet_id === "d0" && x.reg === "ZZ28SDR"));
  await page.click("#menuBtn"); await sleep(300); await page.click("#menu [data-addcar]"); await sleep(300);
  await page.fill("#acReg", "ZZ28LTR"); await page.fill("#acDropT", "0900");
  await page.fill("#acRetD", addDays(TONIGHT, 5)); await page.fill("#acRetT", "1900"); await page.click("#acGo"); await sleep(1200);
  check("PICKS car back on a day with no DROPS sheet yet: not asked", !page.__dialogs.some((m) => /ZZ28LTR/.test(m)));
  await page.selectOption("#sheetPick", "d0"); await sleep(600);
  // A charge on a car that isn't an overstay (e.g. return date changed, £30).
  await page.click('.row[data-id="b1"] .reg'); await sleep(400);
  check("add charge: offered on a DROPS car with nothing due", await page.locator("[data-chargeadd]").count() === 1 && await page.locator(".chgbox").count() === 0);
  await page.click("[data-chargeadd]"); await sleep(300);
  await page.fill("#chgAmount", "30"); await page.fill("#chgReason", "return date changed"); await page.click('[data-chargeagreed="set"]'); await sleep(500);
  const ac = db.calls.filter((c) => c.fn === "set_overstay_agreed").pop();
  check("add charge: saves the amount and the reason", !!ac && ac.args.p_amount === 30 && ac.args.p_reason === "return date changed", ac && ac.args);
  const acBox = await page.locator(".chgbox").innerText().catch(() => "");
  check("add charge: the panel shows £30 due and why, with CASH / CARD / WAIVE", /£30 due/.test(acBox) && /return date changed/.test(acBox) && await page.locator('[data-charge="cash"]').count() === 1, acBox);
  if (await page.locator("#panel[open]").count()) await page.click("[data-close]").catch(() => {});
  await sleep(300);
  check("add charge: the board shows £30 due", /Overstay \/ charge £30 · Due/.test(await text(page, '.row[data-id="b1"] .bpay-row')));
  // Overstay payment
  await page.click('.row[data-id="b3"] .reg'); await sleep(400);
  const due = await page.locator(".chgbox").innerText().catch(() => "");
  check("overstay: the panel shows what's due", /£\d+ due/.test(due), due);
  await page.fill("#chgAmount", "40"); await page.click('[data-chargeagreed="set"]'); await sleep(500);
  const agr = db.calls.find((c) => c.fn === "set_overstay_agreed" && c.args.p_booking === "b3");
  check("overstay: SET AS DUE saves the amount typed", !!agr && agr.args.p_amount === 40, agr && agr.args);
  const agreedBox = await page.locator(".chgbox").innerText().catch(() => "");
  check("overstay: the panel shows the agreed amount and what it was", /£40 due/.test(agreedBox) && /agreed · was £\d+/.test(agreedBox), agreedBox);
  check("overstay: the board shows the agreed amount due", /Overstay \/ charge £40 · Due/.test(await text(page, '.row[data-id="b3"] .bpay-row')));
  await page.click('.chgbox [data-chargeagreed=""]'); await sleep(500);
  check("overstay: Undo puts back the daily-rate sum", db.calls.some((c) => c.fn === "set_overstay_agreed" && c.args.p_amount === null) && !/agreed/.test(await page.locator(".chgbox").innerText().catch(() => "")));
  await page.fill("#chgAmount", "85"); await page.click('[data-charge="cash"]'); await sleep(500);
  const pay = db.calls.find((c) => c.fn === "set_overstay_paid");
  check("overstay: CASH records the amount typed", !!pay && pay.args.p_amount === 85 && pay.args.p_method === "cash", pay && pay.args);
  if (await page.locator("#panel[open]").count()) await page.click("[data-close]").catch(() => {});
  await sleep(300);
  check("overstay: the board shows the recorded £85 collection", /Overstay \/ charge £85 · Collected/.test(await text(page, '.row[data-id="b3"] .bpay-row')));
  // Remove and put back
  await page.click('.row[data-id="b2"] .reg'); await sleep(400);
  await page.click("[data-removecar]"); await sleep(300);
  const reasonBtn = page.locator("[data-removewhy]").first();
  if (await reasonBtn.count()) { await reasonBtn.click(); await sleep(500); }
  check("remove: the car leaves the board", db.calls.some((c) => c.fn === "remove_booking") && await page.locator('.row[data-id="b2"]').count() === 0);
  await page.click("#menuBtn"); await sleep(300); await page.click("#menu [data-removedlist]"); await sleep(300);
  await page.click('[data-restore="b2"]'); await sleep(500);
  await page.click("[data-close]").catch(() => {}); await sleep(300);
  check("put back: the car is on the board again, once", await page.locator('.row[data-id="b2"]').count() === 1);
  // Customer rang: coming back another day
  await page.click('.row[data-id="b1"] .reg'); await sleep(400);
  check("return by hand: the panel shows the booked date and time", (await page.inputValue("#retD")) === TONIGHT && /^\d\d:\d\d$/.test(await page.inputValue("#retT")));
  await page.fill("#retD", addDays(TONIGHT, 2)); await page.fill("#retT", "2330"); await page.click("[data-savepanel]"); await sleep(600);
  const sr = db.calls.find((c) => c.fn === "set_return");
  check("return by hand: Save sends the new date and time", !!sr && sr.args.p_return_local === addDays(TONIGHT, 2) + " 23:30", sr && sr.args);
  check("return by hand: the row shows WAS and the first day", /WAS/.test(await text(page, '.row[data-id="b1"]')), await text(page, '.row[data-id="b1"]'));
  // Changed to tomorrow, whose sheet is already in: the car goes there and leaves tonight's board.
  await page.click('.row[data-id="b2"] .reg'); await sleep(400);
  await page.fill("#retD", TOMORROW); await page.fill("#retT", "1800"); await page.click("[data-savepanel]"); await sleep(800);
  check("return by hand to a day whose sheet is in: the car leaves tonight's board", await page.locator('.row[data-id="b2"]').count() === 0 && db.bookings.find((x) => x.id === "b2").sheet_id === "d1");
});

// 19b. the return flight given at drop-off: typed on the PICKS car (setup 78), every look
for (const theme of ["", "stdplus", "ops", "premium", "board"]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  db.me = { ...db.me, role: "terminal" }; db.perms = { clear: true, picksinfo: true, note: true, intake: true };
  const page = await phone(browser, db);
  const look = theme || "standard";
  await open(page); await pickKind(page, "picks");
  const top = await page.locator("#main .row").first().evaluate((e) => e.getBoundingClientRect().top);
  await page.click('.row[data-id="p1"] .reg'); await page.waitForSelector("#panel[open]");
  check("Return flight (" + look + "): the PICKS car has a Return flight box", await page.isVisible("#pickFlightText"));
  await page.fill("#pickFlightText", "ls 1234"); await page.click("[data-savepanel]"); await sleep(600);
  const c = db.calls.filter((x) => x.fn === "set_pick_flight").pop();
  check("Return flight (" + look + "): Save sends it, tidied", c && c.args.p_booking === "p1" && c.args.p_flight === "LS1234", c);
  check("Return flight (" + look + "): the row shows it after the drop time", /LS1234/.test(await text(page, '.row[data-id="p1"]')), await text(page, '.row[data-id="p1"]'));
  check("Return flight (" + look + "): the note is left alone", !db.calls.some((x) => x.fn === "set_note"));
  check("Return flight (" + look + "): the rows don't move", Math.abs(top - await page.locator("#main .row").first().evaluate((e) => e.getBoundingClientRect().top)) < 1);
  await page.click('.row[data-id="p1"] .reg'); await page.waitForSelector("#panel[open]");
  check("Return flight (" + look + "): the box shows the saved flight", await page.inputValue("#pickFlightText") === "LS1234");
  await page.fill("#pickFlightText", "LS1234"); await page.click("[data-savepanel]"); await sleep(400);
  check("Return flight (" + look + "): unchanged sends nothing", db.calls.filter((x) => x.fn === "set_pick_flight").length === 1);
});
await scenario(async () => {
  const db = makeDb(); db.me = { ...db.me, role: "view" }; db.perms = {};
  const page = await phone(browser, db);
  await open(page); await pickKind(page, "picks");
  await page.click('.row[data-id="p1"] .reg'); await page.waitForSelector("#panel[open]");
  check("Return flight: view-only has no box", !(await page.isVisible("#pickFlightText")));
});
// The office changes a PICKS car's return time (the customer rang), instead of a note.
for (const theme of ["", "ops"]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  const page = await phone(browser, db);
  const look = theme || "standard";
  await open(page); await pickKind(page, "picks");
  await page.click('.row[data-id="p1"] .reg'); await page.waitForSelector("#panel[open]");
  check("PICKS return (" + look + "): the office gets the return date and time boxes", await page.isVisible("#retD") && await page.isVisible("#retT"));
  check("PICKS return (" + look + "): they show the booked return", await page.inputValue("#retD") === addDays(TONIGHT, 1) && await page.inputValue("#retT") === new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(new Date(iso(addDays(TONIGHT, 1), "09:00"))), [await page.inputValue("#retD"), await page.inputValue("#retT")]);
  await page.fill("#retT", "0715"); await page.click("[data-savepanel]"); await sleep(600);
  const c = db.calls.filter((x) => x.fn === "set_pick_return").pop();
  check("PICKS return (" + look + "): Save sends the new time", c && c.args.p_booking === "p1" && c.args.p_return_local === addDays(TONIGHT, 1) + " 07:15", c);
  check("PICKS return (" + look + "): no note needed", !db.calls.some((x) => x.fn === "set_note" || x.fn === "set_return"));
  await page.click('.row[data-id="p1"] .reg'); await page.waitForSelector("#panel[open]");
  check("PICKS return (" + look + "): the car shows the new time", await page.inputValue("#retT") === "07:15" && /07:15/.test(await page.locator("#panelBody .det").innerText()));
});
await scenario(async () => {
  const db = makeDb(); db.me = { ...db.me, role: "terminal" }; db.perms = { clear: true, picksinfo: true, note: true, intake: true };
  const page = await phone(browser, db);
  await open(page); await pickKind(page, "picks");
  await page.click('.row[data-id="p1"] .reg'); await page.waitForSelector("#panel[open]");
  check("PICKS return: terminal staff don't get the boxes", !(await page.isVisible("#retD")));
});

// 20. a big night: 400 cars on one sheet stays quick
await scenario(async () => {
  const db = makeDb();
  for (let i = 0; i < 400; i++) {
    const h = 18 + Math.floor(i / 40), m = (i * 7) % 60;
    db.bookings.push({ id: "big" + i, company_id: "c1", sheet_id: "d0", kind: "drops", ref: "BIG" + i, reg: "BG" + String(i).padStart(2, "0") + "XYZ", num: 10 + i,
      name: "CUSTOMER " + i, make: "FORD", flight: "U2" + (2000 + i), return_at: iso(h < 24 ? TONIGHT : addDays(TONIGHT, 1), String(h % 24).padStart(2, "0") + ":" + String(m).padStart(2, "0")), note: i % 9 ? "" : "NOTE " + i, yard: ["NB", "S", ""][i % 3] });
  }
  const page = await phone(browser, db);
  let t0 = Date.now(); await open(page); await page.waitForSelector('.row[data-id="big399"]', { state: "attached" }); const tOpen = Date.now() - t0;
  const ms = await page.evaluate(async () => {
    const btn = document.querySelector('.row[data-id="big200"] [data-act="sent"]');
    const t = performance.now(); btn.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t;
  });
  t0 = Date.now(); await page.fill("#q", "BG25"); await page.waitForFunction(() => document.querySelectorAll("#main .row").length < 20); const tSearch = Date.now() - t0;
  console.log("      400 cars: open " + tOpen + " ms, SENT tap on screen " + Math.round(ms) + " ms, search " + tSearch + " ms");
  check("400 cars: the board opens in under 3 s", tOpen < 3000, tOpen);
  check("400 cars: a tap shows in under 250 ms", ms < 250, ms);
  check("400 cars: search answers in under 1.5 s", tSearch < 1500, tSearch);
  check("400 cars: no sideways scrolling", await noSideScroll(page));
});

// 21. small Android phone width
await scenario(async () => {
  const page = await phone(browser, makeDb(), { width: 360, ua: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36" });
  await open(page);
  check("360 px wide phone: no sideways scrolling on the board", await noSideScroll(page));
});


// 22. Shared key checks: real UI against a shared mock server.
for (const theme of ["ops", ""]) await scenario(async () => {
  const name = "Shared keys (" + (theme || "Standard") + "): ";
  const db = keysDb(theme), page = await phone(browser, db, { width: 360 });
  await open(page);
  check(name + "off initially", await page.isVisible("#keyBtn") && !(await page.locator(".kbox").count()));
  // Old phone-local ticks must never become shared physical confirmations.
  await page.evaluate(() => localStorage.setItem('takeoff_keys', JSON.stringify({d0:{k3:Date.now()}})));
  await page.click('#keyBtn'); await page.waitForSelector('[data-keystart]');
  await page.click('[data-keystart]'); await page.waitForSelector('.kc-row');
  check(name + "all 17 cabinet keys start unchecked", await page.locator('.kc-row').count() === 17 && /0\/17/.test(await text(page,'#keyBtn')) && !(await page.locator('.kbox.on').count()));
  check(name + "delivery actions are outside key mode", !(await page.locator('#main [data-act]').count()));
  // The board's flight, customer and ref ride along; the yard is the same picker as the board's.
  check(name + "rows show flight, customer and ref", await page.locator('.row[data-id="k3"] .kc-fl').innerText().then(t=>/W43602/.test(t)) && /NIKOLLI/i.test(await page.locator('.row[data-id="k3"] .kc-cu').textContent()) && /K2/.test(await page.locator('.row[data-id="k3"] .kc-cu').textContent()));
  check(name + "yard is a picker, not greyed", await page.locator('.row[data-id="k3"] .kc-yard select[data-yard]').count()===1 && !(await page.locator('.kc-yard .kgrey').count()));
  await page.selectOption('.row[data-id="k1"] .kc-yard select[data-yard]','NY');await sleep(250);
  check(name + "changing the yard saves like the board", db.calls.some(c=>c.fn==='set_yard'&&c.args.p_booking==='k1'&&c.args.p_yard==='NY') && db.bookings.find(b=>b.id==='k1').yard==='NY' && db.keyChecks.d0.entries.find(e=>e.booking_id==='k1').state==='unchecked' && await page.locator('.kc').count()===1);
  await page.locator('.row[data-id="k3"] .kc-fl [data-addflight]').click();
  check(name + "flight number opens the flight box", await page.isVisible('#panel'));
  await page.keyboard.press('Escape');await sleep(150);
  await page.click('[data-keytick="k3"]'); await page.waitForSelector('[data-keytick="k3"].on');
  check(name + "confirmation stores staff, time and server state", db.keyChecks.d0.entries.find(e=>e.booking_id==='k3').state === 'found' && /RAKESH/.test(await page.locator('.row[data-id="k3"] .kc-person').textContent()));
  check(name + "found keys move below unchecked", await page.locator('.kc-row').first().getAttribute('data-id') === 'k1');
  await page.click('[data-keymissing="k4"]'); await page.waitForSelector('.kc-row-missing');
  await page.click('[data-keyfilter="missing"]');
  check(name + "missing filter shows only reported keys", await page.locator('.kc-row').count()===1 && await page.locator('.kc-row').getAttribute('data-id')==='k4');
  await page.click('[data-keytick="k4"]'); await page.waitForFunction(()=>!document.querySelector('.kc-row'));
  await page.click('[data-keyfilter="all"]');
  await page.selectOption('#keyYard','CP');
  check(name + "yard filter applies to key rows", await page.locator('.kc-row').count()===6);
  await page.selectOption('#keyYard','');
  await page.click('[data-keyfinish]');
  check(name + "cannot finish with unchecked keys", !db.calls.some(c=>c.fn==='key_check_finish') && db.keyChecks.d0.session.status==='active');
  await page.click('[data-keyfilter="all"]');
  // Another browser context reads the same server state, not localStorage.
  const teammate = await phone(browser, db, { width: 1024 }); await open(teammate);await teammate.click('#keyBtn');
  await teammate.waitForSelector('[data-keytick="k3"].on');
  check(name + "a second device sees checked keys", /2\/17/.test(await text(teammate,'#keyBtn')));
  // Change on another device while this page is still stale.
  await teammate.click('[data-keytick="k3"]'); await teammate.waitForSelector('[data-keytick="k3"]:not(.on)');
  await page.click('[data-keytick="k3"]'); await sleep(250);
  check(name + "stale device cannot overwrite newer status", db.keyChecks.d0.entries.find(e=>e.booking_id==='k3').state==='unchecked' && /Someone updated/.test(await toast(page)));
  await page.reload(); await page.waitForSelector('.kc-row');
  check(name + "reload restores current shared state", !await page.locator('[data-keytick="k3"]').evaluate(e=>e.classList.contains('on')) && /1\/17/.test(await text(page,'#keyBtn')));
  // Imported cars join unchecked; SENT cars are accounted for separately.
  db.bookings.find(b=>b.id==='k5').sent_at=now();db.bookings.find(b=>b.id==='k5').sent_by='s2';
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await sleep(350);
  await page.reload();await page.waitForSelector('.kc-row-driver');
  check(name + "with driver is separate from cabinet count", /1\/16/.test(await text(page,'#keyBtn')) && await page.locator('.kc-row-driver .kbox').count()===0);
  for(const width of [320,360,736,1024,1440]) { await page.setViewportSize({width,height:900});await sleep(100);check(name+'fits '+width+'px',await noSideScroll(page),await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,id:e.id,cls:e.className,width:e.getBoundingClientRect().width})))); }
  await page.setViewportSize({width:360,height:844});
  // On failure, no optimistic success and no offline mutation queue.
  const before = db.keyChecks.d0.entries.find(e=>e.booking_id==='k1').state;
  db.keyGate=fn=>fn==='key_check_set'?'Test save refused':null;
  await page.click('[data-keytick="k1"]');await sleep(250);
  check(name+'failed save does not confirm a key',db.keyChecks.d0.entries.find(e=>e.booking_id==='k1').state===before && !(await page.locator('[data-keytick="k1"].on').count()));
  db.keyGate=null;
  const saves=db.calls.filter(c=>c.fn==='key_check_set').length;
  await page.context().setOffline(true);await page.waitForSelector('.kc-warning');
  check(name+'offline checks are disabled',await page.locator('.kbox:not([disabled])').count()===0&&db.calls.filter(c=>c.fn==='key_check_set').length===saves);
  await page.context().setOffline(false);await page.waitForFunction(()=>!document.querySelector('.kc-warning'));
  await page.click('[data-keynew]');await sleep(250);
  check(name+'new check asks and resets shared ticks',page.__dialogs.some(d=>/new shared key check/.test(d))&&db.keyChecks.d0.entries.every(e=>e.state==='unchecked'));
  // Confirm the remaining cabinet keys and finish through the UI.
  while(await page.locator('.kc-row:not(.kc-row-driver) .kbox:not(.on)').count()) {
    await page.locator('.kc-row:not(.kc-row-driver) .kbox:not(.on)').first().click();
    await page.waitForFunction(()=>!document.querySelector('.kc-shared')?.textContent.includes('Saving'));
  }
  await page.click('[data-keyfinish]');await page.waitForSelector('.kc-completed');
  check(name+'completed check is read-only',db.keyChecks.d0.session.status==='completed'&&await page.locator('.kbox:not([disabled])').count()===0);
  await page.click('#tabAll');await page.waitForSelector('.row .acts');
  check(name+'All returns to delivery actions',!(await page.locator('.kc').count())&&await page.locator('.row .acts').count()>0);
  await page.click('#keyBtn');await page.waitForSelector('.kc-completed');
  await pickKind(page,'picks');check(name+'no key mode on picks',!await page.isVisible('#keyBtn')&&!(await page.locator('.kc').count()));
  check(name+'no runtime errors',page.__errors.length===0,page.__errors);
  await page.context().close();await teammate.context().close();
}, 'keys');
await scenario(async()=>{
  const db=keysDb('ops');db.me.role='view';const page=await phone(browser,db);await open(page);
  check('Shared keys: view-only has no Key check',!await page.isVisible('#keyBtn'));await page.context().close();
},'keys');
await scenario(async()=>{
  const db=keysDb('ops');db.keyGate=()=> 'Function not found';const page=await phone(browser,db);await open(page);await page.click('#keyBtn');await page.waitForSelector('[data-keyretry]');
  check('Shared keys: unavailable setup fails clearly without local ticks',await page.locator('.kbox').count()===0&&/Speak to the office/.test(await text(page,'#main')));await page.context().close();
},'keys');


await scenario(async()=>{
  const db=keysDb('ops'), page=await phone(browser,db);await open(page);await page.click('#keyBtn');await page.waitForSelector('[data-keystart]');await page.click('[data-keystart]');await page.waitForSelector('.kc-row');
  await page.click('[data-keytick="k3"]');await page.waitForSelector('[data-keytick="k3"].on');
  let release; const gate=new Promise(resolve=>release=resolve);
  db.keyGate=async(fn,args)=>{if(fn==='key_check_get'&&args.p_sheet==='d0')await gate;return null;};
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await sleep(100);
  await page.selectOption('#sheetPick','d1');await page.waitForSelector('[data-keystart]');
  release();await sleep(250);
  check('Shared keys: late old-shift response cannot carry ticks to new shift',await page.locator('.kbox.on').count()===0&&await page.locator('[data-keystart]').count()===1);
  await page.click('[data-keystart]');await page.waitForSelector('.kc-row');
  check('Shared keys: next shift has its own unchecked session',db.keyChecks.d1.session.id!==db.keyChecks.d0.session.id&&db.keyChecks.d1.entries.every(e=>e.state==='unchecked'));
  await page.context().close();
},'keys');
