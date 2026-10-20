import { check, sleep, server, addDays, TONIGHT, TOMORROW, iso, makeDb, phone, open, text, noSideScroll, toast, scenario, browser } from "../harness.mjs";

// 2. DROPS board
await scenario(async () => {
  const db = makeDb(), page = await phone(browser, db);
  await open(page);
  check("board opens on tonight's DROPS sheet", (await page.locator("#sheetPick option:checked").innerText()).includes("DROPS"));
  check("tonight's cars are listed", await page.locator(".row").count() === 3, await page.locator(".row").count());
  check("SENT shows the time and the first name of who pressed it", /SENT\s*\d\d:\d\d\s*SUGU/.test(await text(page, '.row[data-id="b3"] [data-act="sent"]')), await text(page, '.row[data-id="b3"] [data-act="sent"]'));
  await page.click('.row[data-id="b1"] [data-act="sent"]'); await sleep(400);
  check("tapping SENT reaches the server", db.calls.some((c) => c.fn === "tap_drop" && c.args.p_action === "sent" && c.args.p_booking === "b1"));
  check("tapping SENT marks the button with my name", /RAKESH/.test(await text(page, '.row[data-id="b1"] [data-act="sent"]')));
  await page.click('.row[data-id="b2"] [data-act="called"]'); await sleep(400);
  check("CALLED moves the car into NEXT IN QUEUE", /NEXT IN QUEUE/.test(await page.locator("#main").innerText()) && (await page.locator("#main").innerText()).indexOf("CF75VLN") < (await page.locator("#main").innerText()).indexOf("COMING UP"));
  await page.click('.row[data-id="b2"] [data-act="clear"]'); await sleep(400);
  check("CLEAR alone keeps the car in TO DO (a car is done when SENT and CLEAR)", await page.locator('.row[data-id="b2"]').count() === 1);
  await page.click('.row[data-id="b2"] [data-act="sent"]'); await sleep(400);
  check("SENT + CLEAR takes the car out of TO DO", !(await page.locator('.row[data-id="b2"]').count()));
  await page.click("#tabAll"); await sleep(200);
  check("ALL still shows the cleared car", await page.locator('.row[data-id="b2"]').count() === 1);
  check("no sideways scrolling on the board at phone width", await noSideScroll(page));
  check("no errors on the board", page.__errors.length === 0, page.__errors);
});

// 3. search
await scenario(async () => {
  const db = makeDb(), page = await phone(browser, db);
  await open(page);
  await page.fill("#q", "EK14"); await sleep(600);
  check("search finds a car on this sheet", await page.locator(".row").count() === 1 && /EK14JPV/.test(await page.locator("#main").innerText()));
  await page.fill("#q", "EN11KOO"); await sleep(900);
  check("search finds a car on another day", /ON OTHER DAYS/.test(await page.locator("#main").innerText()) && /EN11KOO/.test(await page.locator("#main").innerText()));
  await page.click(".otherhit"); await sleep(800);
  check("tapping the other-day result opens that sheet", (await page.locator("#sheetPick option:checked").innerText()).includes(TOMORROW.slice(8, 10).replace(/^0/, "")) && await page.locator('.row[data-id="b5"]').count() === 1);
  await page.fill("#q", "ZZ99NOPE"); await sleep(900);
  check("search for a car nowhere says so", /Not found on any sheet|Not on this sheet/.test(await page.locator("#main").innerText()));
});

// 4. car panel
await scenario(async () => {
  const db = makeDb(), page = await phone(browser, db);
  await open(page);
  await page.click('.row[data-id="b2"] .reg'); await sleep(300);
  check("tapping the reg opens the car's panel", await page.isVisible("#panel"));
  const tel = await page.getAttribute("#panelBody a.tel", "href").catch(() => "");
  check("Call uses the first number when a booking has it twice", tel === "tel:07868615571", tel);
  await page.fill("#noteText", "KEYS IN OFFICE"); await page.click("[data-savepanel]"); await sleep(500);
  check("saving a note reaches the server", db.calls.some((c) => c.fn === "set_note" && c.args.p_note === "KEYS IN OFFICE"));
  check("the note shows on the row", /KEYS IN OFFICE/.test(await text(page, '.row[data-id="b2"]')));
  await page.click('.row[data-id="b1"] .reg'); await sleep(300);
  await page.fill("#schedText", "1320"); await page.click("[data-savepanel]"); await sleep(500);
  check("scheduled landing is typed: '1320' saves as 13:20", db.calls.some((c) => c.fn === "set_sched_time" && c.args.p_time === "13:20"), db.calls.filter((c) => c.fn === "set_sched_time"));
  await page.click('.row[data-id="b1"] .reg'); await sleep(300);
  await page.fill("#schedText", "2575"); await page.click("[data-savepanel]"); await sleep(400);
  check("a time that isn't one is refused with a message", /13:20/.test(await toast(page)) && db.calls.filter((c) => c.fn === "set_sched_time").length === 1);
  await page.click("[data-close]").catch(() => {}); await sleep(200);
  await page.click('.row[data-id="b1"] .reg'); await sleep(300);
  check("no sideways scrolling in the car panel", await noSideScroll(page));
});

// 4b. a typed landing time after midnight goes to the end of the night
await scenario(async () => {
  const db = makeDb();
  db.bookings.find((b) => b.id === "b1").return_at = iso(TONIGHT, "12:00");
  db.schedEcho = false;   // the board keeps the time the app worked out (the database does the same, part 83)
  const page = await phone(browser, db);
  await open(page);
  await page.click("#tabAll"); await sleep(200);
  await page.click('.row[data-id="b1"] .reg'); await sleep(300);
  await page.fill("#schedText", "00:22"); await page.click("[data-savepanel]"); await sleep(500);
  const order = await page.locator('#main .row[data-id^="b"]').evaluateAll((els) => els.map((e) => e.dataset.id));
  check("00:22 typed on a car booked for 12:00 sorts after the late-evening cars", order[order.length - 1] === "b1" && order.indexOf("b2") < order.indexOf("b1"), order);
  check("and shows 00:22 on the row", /00:22/.test(await text(page, '.row[data-id="b1"]')));
});

// 5. early return
await scenario(async () => {
  const db = makeDb(), page = await phone(browser, db);
  await open(page);
  await page.selectOption("#sheetPick", "d1"); await sleep(700);
  await page.click('.row[data-id="b4"] [data-act="called"]'); await sleep(1500);
  check("CALLED on tomorrow's car offers the early return and OK moves it", db.calls.some((c) => c.fn === "early_return"));
  check("the app follows the car to tonight's sheet", (await page.locator("#sheetPick").inputValue()) === "d0");
  check("the early car shows 'EARLY · booked …' on its own line", /EARLY · booked/.test(await text(page, '.row[data-id="b4"]')));
  check("the flight number still shows on the early car", /W95393/.test(await text(page, '.row[data-id="b4"]')));
  await page.click('.row[data-id="b4"] .reg'); await sleep(300);
  check("the panel offers Undo", await page.locator("[data-undoearly]").count() === 1);
  await page.click("[data-undoearly]"); await sleep(1200);
  check("Undo puts it back on its booked day", db.calls.some((c) => c.fn === "undo_early_return") && (await page.locator("#sheetPick").inputValue()) === "d1");
});

// 5b. early return from the PICKS car (part 74): no DROPS row for its booked day yet
await scenario(async () => {
  const db = makeDb(), page = await phone(browser, db);
  await open(page);
  await page.selectOption("#sheetPick", "p0"); await sleep(700);
  await page.click('.row[data-id="p1"] .reg'); await sleep(300);
  check("a PICKS car not taken in has no EARLY RETURN", await page.locator("[data-pearly]").count() === 0);
  await page.click("[data-close]").catch(() => {}); await sleep(200);
  await page.click('.row[data-id="p4"] .reg'); await sleep(300);
  check("a PICKS car taken in, booked back later, offers EARLY RETURN to tonight's DROPS", /EARLY RETURN · add to/.test(await page.locator("[data-pearly]").innerText().catch(() => "")));
  await page.click("[data-pearly]"); await sleep(1500);
  check("EARLY RETURN on PICKS calls early_return_from_picks", db.calls.some((c) => c.fn === "early_return_from_picks" && c.args.p_picks === "p4"));
  check("the app follows the car to tonight's DROPS sheet", (await page.locator("#sheetPick").inputValue()) === "d0");
  const de = db.bookings.find((b) => b.kind === "drops" && b.reg === "HJ12PGK");
  check("the new DROPS car shows 'EARLY · booked …'", !!de && /EARLY · booked/.test(await text(page, '.row[data-id="' + de.id + '"]')));
  db.perms = Object.fromEntries(["sent", "clear", "summary", "intake"].map((k) => [k, true]));
  await open(page);
  await page.selectOption("#sheetPick", "p0"); await sleep(700);
  await page.click('.row[data-id="p4"] .reg'); await sleep(300);
  check("without CALLED rights there is no EARLY RETURN on PICKS", await page.locator("[data-pearly]").count() === 0);
});

// 5c. EARLY RETURN on a night picked (part 75): booked back in 9 days, coming in 3
await scenario(async () => {
  const db = makeDb(); db.bookings.find((b) => b.id === "p3").intake = "Collected";
  const page = await phone(browser, db);
  await open(page);
  await page.selectOption("#sheetPick", "p0"); await sleep(700);
  await page.click('.row[data-id="p3"] .reg'); await sleep(300);
  const box = page.locator("#earlyDay");
  check("EARLY RETURN has a night picker starting tonight", (await box.inputValue()) === TONIGHT && (await box.getAttribute("min")) === TONIGHT);
  check("the picker stops the night before the booked day", (await box.getAttribute("max")) === addDays(TONIGHT, 8));
  const night = addDays(TONIGHT, 3), before = await page.locator("#earlyTo").innerText();
  await box.fill(night); await box.dispatchEvent("change"); await sleep(200);
  const after = await page.locator("#earlyTo").innerText();
  check("the button names the night picked", after !== before && after.includes(String(+night.slice(8))), [before, after]);
  await page.click("[data-pearly]"); await sleep(1500);
  check("the night picked goes to the server", db.calls.some((c) => c.fn === "early_return_from_picks" && c.args.p_picks === "p3" && c.args.p_day === night), db.calls.filter((c) => /early/.test(c.fn)));
  const sh = db.sheets.find((x) => x.kind === "drops" && x.day === night);
  check("the app follows the car to that night's DROPS sheet", !!sh && (await page.locator("#sheetPick").inputValue()) === sh.id);
  check("it shows there marked EARLY", /EARLY · booked/.test(await text(page, "#main")));
  check("the toast names the night", (await toast(page)).includes(after.replace("EARLY RETURN · add to ", "")), await toast(page));
  // DROPS car on a later sheet: the picker there too, tonight by default
  await page.selectOption("#sheetPick", "d1"); await sleep(700);
  await page.click('.row[data-id="b5"] .reg'); await sleep(300);
  check("a DROPS car on a later sheet offers the picker, up to the night before its sheet", (await page.locator("#earlyDay").getAttribute("max")) === TONIGHT && (await page.locator("[data-early]").count()) === 1);
  await page.click("[data-early]"); await sleep(1500);
  check("tonight from the DROPS car sends tonight's day", db.calls.some((c) => c.fn === "early_return" && c.args.p_booking === "b5" && c.args.p_day === TONIGHT));
});

// 6. PICKS board
await scenario(async () => {
  const db = makeDb(), page = await phone(browser, db);
  await open(page);
  await page.selectOption("#sheetPick", "p0"); await sleep(700);
  const tiles = await page.locator("#catTally").innerText();
  check("PICKS shows SHORT LEFT and LONG LEFT", /SHORT LEFT/.test(tiles) && /LONG LEFT/.test(tiles), tiles);
  check("SHORT LEFT counts only short cars still LEFT (2)", /SHORT LEFT\s*2/.test(tiles), tiles);
  check("LONG LEFT counts long cars still LEFT (1)", /LONG LEFT\s*1/.test(tiles), tiles);
  await page.click('.row[data-id="p2"] [data-pick="Collected"]'); await sleep(400);
  check("COLL reaches the server and shows my name", db.calls.some((c) => c.fn === "tap_pick" && c.args.p_value === "Collected") && /RAKESH/.test(await text(page, '.row[data-id="p2"] [data-pick="Collected"]')));
  check("COLL lowers SHORT LEFT to 1", /SHORT LEFT\s*1/.test(await page.locator("#catTally").innerText()));
  check("no sideways scrolling on PICKS", await noSideScroll(page));
});
