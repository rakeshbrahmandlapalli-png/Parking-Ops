import { path, check, sleep, server, addDays, TONIGHT, iso, makeDb, now, phone, open, text, noSideScroll, toast, scenario, browser } from "../harness.mjs";

// 8. Settings
await scenario(async () => {
  const db = makeDb(), page = await phone(browser, db);
  await open(page);
  await page.click("#menuBtn"); await sleep(300);
  await page.click('#menuBody [data-view="settings"]'); await sleep(500);
  const opts = await page.locator('select[data-ptmethod=""] option').allInnerTexts();
  check("Settings offers the three PT ways", opts.length === 3 && /PDF/.test(opts.join()) && /link/.test(opts.join()), opts);
  check("Settings has a separate PT choice for iPhones", await page.locator('[data-ptmethod="ios"] option').count() === 3);
  await page.selectOption('select[data-ptmethod=""]', "pdf"); await sleep(500);
  check("choosing PDF saves it", db.company.pt_method === "pdf" && db.calls.some((c) => c.fn === "set_pt_method"));
  await page.selectOption('[data-ptmethod="ios"]', "link"); await sleep(500);
  check("the iPhone choice saves on its own", db.company.pt_method_ios === "link" && db.company.pt_method === "pdf" && db.calls.some((c) => c.fn === "set_pt_method_ios"));
  check("no sideways scrolling in Settings", await noSideScroll(page));
  check("Settings: capacity first, with a field per yard", /Car park capacity[\s\S]*not set/.test(await page.locator("#main .box").first().innerText()) && await page.locator("[data-capyard]").count() === 2);
  await page.fill("#capTotal", "40"); await page.fill('[data-capyard="NB"]', "20");
  await page.click("[data-savecap]"); await sleep(500);
  check("Settings: capacity saves in all and per yard", db.company.capacity === 40 && JSON.stringify(db.company.yard_capacity) === '{"NB":20}' && /Now: 40 cars/.test(await page.locator("#main .box").first().innerText()));
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/capacity-settings.png" });
  await page.fill("#capTotal", "-5"); await page.click("[data-savecap]"); await sleep(300);
  check("Settings: capacity refuses a negative number", db.company.capacity === 40);
  await page.fill("#capTotal", ""); await page.fill('[data-capyard="NB"]', ""); await page.click("[data-savecap]"); await sleep(500);
  check("Settings: clearing capacity switches it off", db.company.capacity === null && JSON.stringify(db.company.yard_capacity) === "{}");
});

// 9. Supabase down
await scenario(async () => {
  const db = makeDb(), page = await phone(browser, db);
  await open(page); await sleep(2500);   // the board is kept on the phone
  db.down = true;
  await page.reload(); await sleep(3000);
  check("server down: the app opens the last board instead of signing out", await page.isVisible("#app") && await page.locator(".row").count() === 3);
  check("server down: the top bar says OFFLINE", /OFFLINE/.test(await text(page, "#sync")));
  await page.click('.row[data-id="b1"] [data-act="sent"]'); await sleep(800);
  check("server down: a tap still shows and waits to be sent", /TO SEND/.test(await text(page, "#sync")) && /SENT/.test(await text(page, '.row[data-id="b1"] [data-act="sent"]')));
  db.down = false; await sleep(20000);
  check("server back: the waiting tap reaches the server", db.calls.some((c) => c.fn === "tap_drop" && c.args.p_booking === "b1"));
  check("server back: OFFLINE goes away", !/OFFLINE/.test(await text(page, "#sync")));
});

// 10. an unexpected error never kills the app
await scenario(async () => {
  const page = await phone(browser, makeDb());
  await open(page);
  await page.evaluate(() => setTimeout(() => { throw new Error("test boom"); }, 0)); await sleep(500);
  check("an unexpected error shows a short message", /didn't work/.test(await toast(page)));
  await page.click("#tabAll"); await sleep(200);
  check("…and the app keeps working afterwards", await page.locator(".row").count() === 3);
});

// 11. hostile booking data never runs as code (names, notes, regs come from outside)
await scenario(async () => {
  const db = makeDb(), bad = '<img src=x onerror="window.__xss=1">';
  db.bookings.push({ id: "bx", company_id: "c1", sheet_id: "d0", kind: "drops", ref: "RX" + bad, reg: "XS55" + bad, num: 9, name: "EVIL" + bad, make: bad, flight: "U21234", return_at: iso(TONIGHT, "23:00"), phone: bad, note: "!" + bad });
  db.bookings.push({ id: "px", company_id: "c1", sheet_id: "p0", kind: "picks", ref: "PX", reg: "XS66" + bad, num: 9, name: "EVIL" + bad, drop_at: iso(TONIGHT, "21:00"), return_at: iso(addDays(TONIGHT, 1), "10:00"), intake: "", note: bad });
  db.staff.push({ id: "sx", name: "STAFF" + bad, role: "office", active: true });
  db.bookings.find((b) => b.id === "b1").sent_by = "sx"; db.bookings.find((b) => b.id === "b1").sent_at = iso(TONIGHT, "20:00");
  const page = await phone(browser, db);
  await open(page);
  await page.click('.row[data-id="bx"] .reg'); await sleep(400); await page.click("[data-close]");
  await page.fill("#q", "EVIL"); await sleep(900); await page.fill("#q", "");
  await page.selectOption("#sheetPick", "p0"); await sleep(700);
  await page.click('.row[data-id="px"] .l2'); await sleep(400);
  check("hostile names/notes/regs are shown as text, never run as code", await page.evaluate(() => window.__xss === undefined) && /EVIL/.test(await page.locator("#main").innerText()));
});

// 12. the DROPS car panel: meet date shown, no hint text, a mouse drag doesn't close it
await scenario(async () => {
  const db = makeDb();
  db.bookings.find((b) => b.id === "b5").drop_at = iso(addDays(TONIGHT, -5), "07:30");
  const page = await phone(browser, db, { width: 1280 });
  await open(page);
  await page.selectOption("#sheetPick", "d1"); await sleep(700);
  await page.click('.row[data-id="b5"] .reg'); await sleep(400);
  const body = await page.locator("#panelBody").innerText();
  check("DROPS panel shows the meet date and time", /MEET\n.*\d+ \w+ \d\d:\d\d\nBACK/.test(body));
  check("DROPS panel has no \"use this when they ring\" text", !/ring/i.test(body) && await page.locator("[data-early]").count() === 1);
  await page.locator("#noteText").scrollIntoViewIfNeeded();
  const box = await page.locator("#noteText").boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
  await page.mouse.move(5, box.y + 10, { steps: 5 }); await page.mouse.up(); await sleep(200);
  check("selecting text and letting go outside keeps the panel open", await page.evaluate(() => document.getElementById("panel").open));
  await page.mouse.click(5, 5); await sleep(200);
  check("a click outside still closes it", await page.evaluate(() => !document.getElementById("panel").open));
});

// 13. DROPS rows tag SAME DAY / NEXT DAY from the meet date
await scenario(async () => {
  const db = makeDb(), b = (id) => db.bookings.find((x) => x.id === id);
  b("b1").drop_at = iso(TONIGHT, "05:30"); b("b2").drop_at = iso(addDays(TONIGHT, -1), "09:00"); b("b3").drop_at = iso(addDays(TONIGHT, -4), "09:00");
  const page = await phone(browser, db);
  await open(page);
  const tag = (id) => page.locator('.row[data-id="' + id + '"] .cat').allInnerTexts().then((t) => t.join(""));
  check("DROPS: met today shows SAME", /SAME/.test(await tag("b1")));
  check("DROPS: met yesterday shows NEXT", /NEXT/.test(await tag("b2")));
  check("DROPS: met earlier shows no day tag", (await tag("b3")) === "");
});

// 14. return changed to a later day: WAS tag, charge from the first date; overstay block label
await scenario(async () => {
  const db = makeDb(), b = (id) => db.bookings.find((x) => x.id === id);
  db.company.overstay_rate = 30;
  b("b1").orig_return_at = iso(addDays(TONIGHT, -3), "23:00");
  Object.assign(b("b2"), { called_word: "Overstay", called_at: iso(TONIGHT, "18:28"), overstay: true });
  const page = await phone(browser, db);
  await open(page);
  await page.waitForSelector('.row[data-id="b1"] .reg', { timeout: 8000 }).catch(() => {});
  const row1 = await page.locator('.row[data-id="b1"]').innerText();
  check("changed return shows WAS and the day first booked", new RegExp("WAS " + String(+addDays(TONIGHT, -3).slice(8, 10)).padStart(2, "0")).test(row1));
  check("changed return is charged from the first date", /£\d+ DUE/.test(row1), row1);
  check("marked OVERSTAY today: the block says staying longer", /staying longer/i.test(await page.locator("#main").innerText()) && !/earlier days/i.test(await page.locator("#main").innerText()));
  await page.click('.row[data-id="b1"] .reg'); await sleep(400);
  check("the car panel shows the first booked return", /BACK\n.*was /.test(await page.locator("#panelBody").innerText()));
});

// 14b. OVERSTAY pressed by mistake and pressed again: the car is no longer an overstay (part 95),
// but a car carried from an earlier day stays one.
await scenario(async () => {
  const db = makeDb(), b = (id) => db.bookings.find((x) => x.id === id);
  Object.assign(b("b2"), { called_word: "Overstay", called_at: iso(TONIGHT, "18:28"), overstay: true });
  Object.assign(b("b3"), { return_at: iso(addDays(TONIGHT, -2), "22:15"), sent_at: null, sent_by: null, yard: "", called_word: "Overstay", called_at: iso(TONIGHT, "18:30"), overstay: true });
  const page = await phone(browser, db);
  await open(page);
  await page.waitForSelector('.row[data-id="b2"] .reg', { timeout: 8000 }).catch(() => {});
  for (const id of ["b2", "b3"]) {
    await page.click('.row[data-id="' + id + '"] .reg'); await sleep(400);
    await page.click('#panelBody [data-word="called:Overstay"]'); await sleep(500);
    await page.keyboard.press("Escape"); await sleep(300);
  }
  check("Overstay undo: OVERSTAY off on a car due tonight clears the overstay", b("b2").overstay === false && b("b2").called_word === "", b("b2"));
  check("Overstay undo: a car carried from an earlier day stays an overstay", b("b3").overstay === true && b("b3").called_word === "", b("b3"));
  const main = await page.locator("#main").innerText();
  check("Overstay undo: the board shows only the carried car as an overstay", /earlier days/i.test(main) && !/staying longer/i.test(main), main.slice(0, 400));
});

// 15. a booking with no reg: the reg is typed in the car's panel
await scenario(async () => {
  const db = makeDb();
  db.bookings.find((x) => x.id === "p1").reg = "";
  const page = await phone(browser, db);
  await open(page);
  await page.selectOption("#sheetPick", "p0"); await sleep(700);
  check("a car with no reg says NO REG", /NO REG/.test(await text(page, '.row[data-id="p1"] .reg')));
  await page.click('.row[data-id="p1"] .reg'); await sleep(400);
  await page.fill("#regText", "ab12  cde"); await page.click("[data-savepanel]"); await sleep(600);
  check("the typed reg reaches the server, tidied", db.calls.some((c) => c.fn === "set_reg" && c.args.p_reg === "AB12 CDE"));
  check("the row shows the new reg", /AB12 CDE/.test(await text(page, '.row[data-id="p1"] .reg')));
  await page.click('.row[data-id="p1"] .reg'); await sleep(400);
  await page.fill("#regText", "AB12-CDE"); await page.click("[data-savepanel]"); await sleep(300);
  check("a reg with odd characters is refused with a message", /letters and numbers/.test(await toast(page)) && !db.calls.some((c) => c.fn === "set_reg" && c.args.p_reg === "AB12-CDE"));
});

// 16. the owner is reminded weekly to keep their own copy of the data
await scenario(async () => {
  const db = makeDb(); db.lastDownload = new Date(Date.now() - 9 * 864e5).toISOString();
  const page = await phone(browser, db);
  await open(page); await sleep(500);
  check("backup reminder: shows when the last download was 9 days ago", /last downloaded 9 days ago/.test(await text(page, ".nudge")));
  await page.click(".nudge [data-backup]"); await sleep(500);
  check("backup reminder: Download now fetches the data and the reminder goes", db.calls.some((c) => c.fn === "download_my_company") && await page.locator(".nudge").count() === 0);
  const db2 = makeDb(); db2.me.role = "office"; db2.lastDownload = null;
  const page2 = await phone(browser, db2);
  await open(page2); await sleep(500);
  check("backup reminder: only the owner sees it", await page2.locator(".nudge").count() === 0);
});

// 17. a PICKS car added by a re-import shows NEW BOOKING
await scenario(async () => {
  const db = makeDb();
  Object.assign(db.bookings.find((x) => x.id === "p2"), { pick_called: "New Booking", pick_called_at: iso(TONIGHT, "16:05") });
  const page = await phone(browser, db);
  await open(page);
  await page.selectOption("#sheetPick", "p0"); await sleep(700);
  const tag = page.locator('.row[data-id="p2"] .tag.nb');
  check("re-imported PICKS car: NEW BOOKING tag on the row", await tag.count() === 1 && /NEW BOOKING/.test(await tag.innerText()));
  check("other PICKS cars have no NEW BOOKING tag", await page.locator('.row[data-id="p1"] .tag.nb').count() === 0);
});
