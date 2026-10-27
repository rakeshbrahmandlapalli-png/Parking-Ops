import { path, ROOT, check, sleep, addDays, TONIGHT, iso, makeDb, now, phone, open, text, noSideScroll, toast, scenario, browser, apbDb, dashData, dashExit, dashSheets } from "../harness.mjs";

// 18a3. the menu says which app version this phone runs, and offers a newer one
for (const theme of ["", "board"]) await scenario(async () => {
  const db = theme ? apbDb(theme) : makeDb();
  let tag = '"6bf99e0ff1194dbd"';
  const page = await phone(browser, db);
  await page.route("**/app.js", (route) => route.request().method() === "HEAD" ? route.fulfill({ status: 200, headers: { etag: tag } }) : route.continue());
  await open(page); await sleep(400);
  const openMenu = async () => { await page.evaluate(() => (document.querySelector("#cHead:not(.hidden)") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(400); };
  await openMenu();
  const look = theme || "standard";
  check("App version (" + look + "): the menu shows this phone's version, up to date", /App version 6bf99e0 · up to date/.test(await page.locator("#menuBody .appver").innerText()));
  await page.keyboard.press("Escape"); await sleep(200);
  await page.evaluate(() => { window.__stillHere = true; });
  tag = '"9a1b2c3d4e5f"';
  await openMenu();
  check("App version (" + look + "): after a release, the menu offers the new version", /New version ready/.test(await page.locator("#menuBody .appver").innerText()) && await page.evaluate(() => window.__stillHere === true));
  await page.click("[data-appupdate]"); await sleep(1500);
  check("App version (" + look + "): Update now reloads into the new version", !(await page.evaluate(() => window.__stillHere === true)));
});

// 18a3b. Menu → Tutorials: everyone has it; terminal and bongo see their own videos, others all 7
for (const [theme, role, want] of [["", "owner", 7], ["stdplus", "terminal", 3], ["stdplus", "bongo", 3], ["board", "office", 7]]) await scenario(async () => {
  const db = theme ? apbDb(theme) : makeDb(); db.me = { ...db.me, role };
  const page = await phone(browser, db);
  await open(page); await sleep(400);
  await page.evaluate(() => (document.querySelector("#cHead:not(.hidden)") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300);
  const look = (theme || "standard") + ", " + role;
  check("Tutorials (" + look + "): the menu has a Tutorials button", await page.locator("#menuBody [data-tutorials]").count() === 1);
  await page.click("#menuBody [data-tutorials]"); await sleep(300);
  const names = await page.locator("#panelBody [data-tutorial]").evaluateAll((b) => b.map((x) => x.dataset.tutorial));
  const ownOnly = role === "terminal" || role === "bongo" ? names.every((n) => n.includes(role)) : true;
  check("Tutorials (" + look + "): the list shows " + want + " videos for this role", names.length === want && ownOnly && !(await page.evaluate(() => document.getElementById("menu").open)), names.join(","));
  await page.click("#panelBody [data-tutorial]"); await sleep(600);
  const src = await page.locator("#panelBody video").getAttribute("src");
  check("Tutorials (" + look + "): tapping one plays it in the app", src === "/tutorials/" + names[0] + ".mp4" && await page.evaluate(() => document.querySelector("#panelBody video").controls));
  const head = await page.evaluate(async (u) => (await fetch(u, { method: "HEAD" })).status, src);
  check("Tutorials (" + look + "): the video file is there", head === 200, String(head));
  await page.click('#panelBody [data-tutorials]'); await sleep(300);
  check("Tutorials (" + look + "): All videos goes back to the list", await page.locator("#panelBody [data-tutorial]").count() === want);
  await page.click("#panelBody [data-tutorial]"); await sleep(400);
  await page.keyboard.press("Escape"); await sleep(300);
  check("Tutorials (" + look + "): closing stops the video", await page.evaluate(() => { const v = document.querySelector("#panelBody video"); return !v || v.paused; }));
});

// 18a3c. Menu → Dashboard (owner, managers): cars added at the desk, money taken and owed, removed cars, complaints
for (const theme of ["", "stdplus"]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" }; db.company.overstay_rate = 30; db.dash = dashData();
  if (theme) { db.company.exit_fee = 10; db.dash.exit = dashExit(); dashSheets(db); }
  const page = await phone(browser, db);
  await open(page); await sleep(400);
  const look = theme || "standard";
  await page.evaluate(() => (document.querySelector("#cHead:not(.hidden)") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300);
  check("Dashboard (" + look + "): the owner's menu has Dashboard", await page.locator('#menuBody [data-view="dashboard"]').count() === 1);
  await page.click('#menuBody [data-view="dashboard"]'); await sleep(700);
  const tiles = await page.locator("#main .dstats .stat").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  const tile = (name) => tiles.find((t) => t.startsWith(name)) || "";
  if (theme === "stdplus") {
    const txt = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
    check("Dashboard: fits a phone", await noSideScroll(page));
    check("Dashboard: plain heading, update time, the three periods", await page.locator(".od-head h1").innerText() === "Dashboard" && /^Updated \d{2}:\d{2}$/.test(await txt(".od-updated")) && await page.locator(".od [data-dashp]").count() === 3);
    check("Dashboard: What needs doing?, today's date and the role", /^What needs doing\? \w+day \d+ \w+ · Owner$/.test(await txt(".od-dhead")), await txt(".od-dhead"));
    const tasks = await page.locator(".od-task").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    check("Dashboard: Priority work, numbered, most urgent first, each with its button", tasks.length === 5 && /^01 Check 2 overdue cars Past their return .* Open →$/.test(tasks[0]) && /^02 Assign 12 cars to a yard Parked with no yard set\. Assign →$/.test(tasks[1]) && /^03 Review 1 unpaid return £\d+ owed, .* Review →$/.test(tasks[2]) && /^04 Check 3 exit fees .* Review →$/.test(tasks[3]) && /^05 Photograph 1 docket .* Open →$/.test(tasks[4]) && /5 open tasks/.test(await txt(".od-dmain .od-sechead")), tasks);
    check("Dashboard: the first task is marked", await page.locator(".od-task.first").count() === 1 && await page.locator(".od-task").first().evaluate((e) => e.classList.contains("first")));
    const cup = await page.locator(".od-cuprow").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    check("Dashboard: Coming up, tonight's DROPS still to go out by hour", cup.length >= 1 && cup.every((c) => /^\d\d:00 – \d\d:00 \d+ arrivals? · \d+ returns?$/.test(c)) && cup.reduce((n, c) => n + +c.match(/(\d+) returns?$/)[1], 0) === 2, cup);
    const site = await txt(".od-site");
    check("Dashboard: Site status, parked and (no capacity set) past their return, returns today and tomorrow", /^Site status 30 parked 2 past their return Returning today 8 Tomorrow 0$/.test(site) && await page.locator(".od-site .od-bar").count() === 0, site);
    const work = await page.locator(".od-work .od-line").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    check("Dashboard: Upcoming workload, today and tomorrow, returns and arrivals", work.length === 2 && work[0] === "Today 6 returning · 4 arriving 10" && work[1] === "Tomorrow 7 returning · 5 arriving 12", work);
    const pay = await page.locator(".od-pay .od-tr:not(.od-th)").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    check("Dashboard: Payments, exit fees row (collected, cash, card, to check)", /^Exit fees £10 a car Collected £180 · 18 cars Cash £60 Card £120 To check 3 cars$/.test(pay[0]), pay[0]);
    check("Dashboard: Payments, overstay and charges row with what was left unpaid", /^Overstay and charges Money taken at the desk Collected £70 · 2 cars Cash £20 Card £50 Left unpaid £\d+ · 1 car$/.test(pay[1]), pay[1]);
    check("Dashboard: Payments footer, paid and exempt, owed now and waived", /18 exit fees paid · 5 exempt · Owed now £40 \(1 car here\) · Waived £30/.test(await txt(".od-foot")), await txt(".od-foot"));
    check("Dashboard: on a phone the payments table becomes labelled blocks", !(await page.locator(".od-th").isVisible()) && await page.locator(".od-pay .od-c:not(.od-name) > small").first().isVisible());
    const queues = await page.locator(".od-queues .od-line").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    check("Dashboard: Live queues from tonight's DROPS", queues.length === 3 && /^Called, not sent 1 Open queue/.test(queues[0]) && /^Sent, not handed back 1 Open queue/.test(queues[1]) && /^Due in the next 2 hours, not sent 2 Open queue/.test(queues[2]), queues);
    const checks = await page.locator(".od-checks .od-line").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    check("Dashboard: Checks, cars with no yard, PT photos not taken, the shift summary", /^Parked with no yard 12 Yards/.test(checks[0]) && /^PT photos not taken PICKS .* 1 Open PICKS/.test(checks[1]) && /^Desk bookings with no docket photo PICKS .* 1 Open PICKS/.test(checks[2]) && /^Shift summary and activity log Open/.test(checks[3]), checks);
    check("Dashboard: the handover note shows as text with who wrote it and when", await txt(".od-hnote") === "Gate 2 key is in the safe" && /^SUGU · \d\d:\d\d$/.test(await txt(".od-desk .od-hrow small")) && await page.locator("#handoverText").count() === 0);
    await page.click("[data-handoveredit]"); await sleep(200);
    check("Dashboard: Edit opens the note in a box, Cancel closes it unchanged", await page.inputValue("#handoverText") === "Gate 2 key is in the safe");
    await page.fill("#handoverText", "not this"); await page.click("[data-handovercancel]"); await sleep(200);
    check("Dashboard: Cancel keeps the saved note", await page.locator("#handoverText").count() === 0 && await txt(".od-hnote") === "Gate 2 key is in the safe" && !db.calls.some((c) => c.fn === "set_handover_note"));
    await page.click("[data-handoveredit]"); await sleep(200);
    await page.fill("#handoverText", "Keys moved to cabinet 2"); await page.click("[data-savehandover]"); await sleep(500);
    check("Dashboard: Save note sends the handover note and shows it", db.calls.some((c) => c.fn === "set_handover_note" && c.args.p_note === "Keys moved to cabinet 2") && await txt(".od-hnote") === "Keys moved to cabinet 2");
    await page.click("[data-handoveredit]"); await sleep(200);
    await page.fill("#handoverText", "typed, not saved"); await page.click("[data-dashdates]"); await sleep(150); await page.click("[data-dashdates]"); await sleep(150);
    check("Dashboard: a typed handover note survives the dashboard redrawing", await page.inputValue("#handoverText") === "typed, not saved");
    await page.evaluate(() => document.querySelector('[data-dashjump="exitpaid"]').click()); await sleep(200);
    const paidTxt = (await page.locator("#dash-exitpaid").innerText()).replace(/\s+/g, " ");
    check("Dashboard: paid exit fees list each payment (reg, method, photo, who, amount)", /Exit fees paid \(18\)/.test(paidTxt) && /PAID001 · MR PAID CARD · photo kept · SUGU · FHR-9 £10/.test(paidTxt) && /PAID002 · MRS PAID CASH · no photo · TERRY £10/.test(paidTxt) && /Showing the latest 2 of 18/.test(paidTxt), paidTxt);
    const desk = await page.locator('[data-fold="desk"] .od-line').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    check("Dashboard: Desk activity, added, removed, complaints, early returns", desk[0] === "Added at the desk 1 added · 1 NEW BOOKING 2" && desk[1] === "Removed 1 no show 1" && desk[2] === "Complaints 1" && desk[3] === "Early returns 3 return changes 2", desk);
    check("Dashboard: nothing on it is emoji or a gradient", await page.evaluate(() => !/\p{Extended_Pictographic}/u.test(document.querySelector(".od").innerText) && ![...document.querySelectorAll(".od, .od *")].some((e) => /gradient/.test(getComputedStyle(e).backgroundImage))));
    if (process.env.SHOT_DIR) {
      await page.screenshot({ path: process.env.SHOT_DIR + "/dashboard-mobile.png", fullPage: false });
      await page.setViewportSize({ width: 1440, height: 1000 });
      check("Dashboard: fits desktop", await noSideScroll(page));
      await page.screenshot({ path: process.env.SHOT_DIR + "/dashboard-desktop.png", fullPage: false });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.setViewportSize({ width: 1280, height: 900 }); await sleep(150);
    check("Dashboard: on a wide screen Site status sits beside Priority work, Upcoming workload beside Live queues, the table has its header", await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(), m = r(".od-dmain"), a = r(".od-dside"), w = r(".od-work"), q = r(".od-queues"); return Math.abs(m.top - a.top) < 2 && a.left >= m.right - 1 && Math.abs(w.top - q.top) < 2 && q.left > w.right; }) && await page.locator(".od-th").isVisible() && !(await page.locator(".od-pay .od-c:not(.od-name) > small").first().isVisible()));
    check("Dashboard: wide screen, no sideways scrolling", await noSideScroll(page));
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(150);
    const calls = db.dashCalls.length;
    await page.click('.od-tasks [data-dashjump="unpaid"]');
    check("Dashboard: Left unpaid opens its records", await page.locator('#dash-unpaid').getAttribute('open') !== null && /LEFT01/.test(await page.locator('#dash-unpaid').innerText()) && db.dashCalls.length === calls);
    await page.click('.od-tasks [data-dashjump="late"]');
    check("Dashboard: overdue cars opens the cars past their return, by level", await page.locator('#dash-late').evaluate((e) => e.open && e.querySelector("summary") === document.activeElement) && /LATE1[\s\S]*2 days/.test(await page.locator('#dash-late').innerText()));
    await page.click('.od-tasks [data-dashjump="exit"]');
    const exitTxt = (await page.locator('#dash-exit').innerText()).replace(/\s+/g, " ");
    check("Dashboard: exit fees to check lists cars handed back with none recorded, and those with no photo", /Exit fees to check \(3\)/.test(exitTxt) && /NOEXIT1 · MR LEFT Handed back, no exit fee recorded · FHR-1/.test(exitTxt) && /NOPHOTO · MR CASH CASH, no photo · SUGU/.test(exitTxt), exitTxt);
    await page.click('.od-pay [data-dashjump="records"]');

    check("Dashboard: Payment records goes to the records", await page.locator('#dash-records').evaluate((e) => e === document.activeElement));
    await page.click('.od-checks [data-dashjump="yards"]');
    check("Dashboard: Parked with no yard goes to the yards", await page.locator('#dash-yards').evaluate((e) => e === document.activeElement));
    await page.click('#main').catch(() => {}); await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.click('.od-tasks [data-dashjump="yards"]');
    check("Dashboard: Assign (no locations on PICKS) goes to the yards", await page.locator('#dash-yards').evaluate((e) => e === document.activeElement));
  }
  if (!theme) check("Dashboard (" + look + "): cars added at the desk, by hand and NEW BOOKING", /^Added at the desk 2 1 added · 1 NEW BOOKING/.test(tile("Added at the desk")), tile("Added at the desk"));
  if (!theme) check("Dashboard (" + look + "): money taken, cash and card", /Money taken £70 cash £20 · card £50/.test(tile("Money taken")), tile("Money taken"));
  if (!theme) check("Dashboard (" + look + "): owed now only counts cars still here that owe something", /Owed now £40 1 car here/.test(tile("Owed now")), tile("Owed now"));
  if (!theme) check("Dashboard (" + look + "): a car that left with no payment recorded shows red", /^Left unpaid £(\d+) 1 car/.test(tile("Left unpaid")) && +tile("Left unpaid").match(/£(\d+)/)[1] >= 60 && await page.locator("#main .dstats .stat.warn").count() === 1, tile("Left unpaid"));
  if (!theme) check("Dashboard (" + look + "): waived, removed, complaints, early returns", /Waived £30 1 car/.test(tile("Waived")) && /Removed 1 1 no show/.test(tile("Removed")) && /Complaints 1/.test(tile("Complaints")) && /Early returns 2 3 return changes/.test(tile("Early returns")), tiles.join(" | "));
  if (theme === "stdplus") await page.locator('.ops-record').evaluateAll((els) => els.forEach((e) => { e.open = true; }));
  const body = await page.locator("#main").innerText();
  check("Dashboard (" + look + "): the lists name the cars and who did it", /Left with no payment recorded \(1\)[\s\S]*LEFT01/i.test(body) && /AB12CDE[\s\S]*Added to DROPS · SUGU/.test(body) && /XY34ZZZ[\s\S]*Marked NEW BOOKING · TERRY/.test(body) && /CARD01[\s\S]*CARD · return date changed · SUGU/.test(body) && !/ZERO01/.test(body), body.slice(0, 400));
  if (!theme) check("Dashboard (" + look + "): Parked now counts the cars in, with those past their return", /^Parked now 30 2 past their return/.test(tile("Parked now")), tile("Parked now"));
  check("Dashboard (" + look + "): parked cars by yard, yards first, no yard last", /Parked now, by yard\s*NB\s*\S*\s*\w{3},? \d+ \w{3} 18\s*18\s*No yard yet\s*past return 2 · Today 10\s*12/i.test(body), (body.match(/Parked now, by yard[\s\S]{0,160}/i) || [""])[0]);
  if (!theme) check("Dashboard (" + look + "): no capacity set, no spaces shown", !/ free|\/ \d/.test(tile("Parked now")) && await page.locator(".ops-capbar").count() === 0);
  if (!theme) check("Dashboard (" + look + "): parked cars by return day, past return first", /Parked now, by return day\s*Past their return[\s\S]*?2\s*Today\s*8\s*\w{3},? \d+ \w{3}\s*20/i.test(body), body.slice(0, 160));
  await page.evaluate(() => { const d = document.querySelector("#main details.latebox, #dash-late"); if (d) d.open = true; }); await sleep(150);
  const lateTxt = await page.locator("#main details.latebox, #dash-late").first().innerText().catch(() => "");
  check("Dashboard (" + look + "): Past their return opens to list the cars by level", /LATE1/.test(lateTxt) && /LATE2/.test(lateTxt) && /2 days/.test(lateTxt) && /Less than a day/.test(lateTxt), lateTxt);
  const bookedTxt = (await page.locator("#main .booked").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  check("Dashboard (" + look + "): cars on site per day shows the days counted by the app", /Busiest: Tomorrow 45/.test(bookedTxt) && /Today\s*38/.test(bookedTxt) && /\+5 in · 7 out/.test(bookedTxt), bookedTxt);
  check("Dashboard (" + look + "): no paste box, nothing to copy from another site", await page.locator("#bookedText, [data-savebooked]").count() === 0);
  const first = new Date(db.dashCalls[0]).getTime();
  check("Dashboard (" + look + "): opens on the last 7 days", Math.abs(Date.now() - first - 7 * 86400000) < 600000);
  await page.click('#main [data-dashp="30"]'); await sleep(600);
  const last = new Date(db.dashCalls[db.dashCalls.length - 1]).getTime();
  check("Dashboard (" + look + "): 30 days reads again from 30 days back", Math.abs(Date.now() - last - 30 * 86400000) < 600000 && await page.locator('#main [data-dashp="30"].on').count() === 1);
  if (theme === "stdplus") {
    check("Dashboard: period label follows the filter", /Last 30 days/.test(await page.locator('.od-pay .od-cardhead').innerText()));
    const calls = db.dashCalls.length;
    await page.click('.od-work [data-dashdates]');
    check("Dashboard: Open schedule shows every day without a new request", await page.locator('.od-work .od-line').count() === 4 && await page.locator('[data-dashdates]').getAttribute('aria-expanded') === 'true' && db.dashCalls.length === calls);
    await page.click('[data-dashdates]');
    check("Dashboard: the schedule closes again and keeps the focus on its button", await page.locator('.od-work .od-line').count() === 2 && await page.locator('[data-dashdates]').evaluate((e) => e === document.activeElement));
    const foldTxt = async (id) => (await page.locator('[data-fold="' + id + '"] > summary').innerText()).replace(/\s+/g, " ");
    check("Dashboard: Desk activity and Cars on site fold and start open", (await page.locator('details.ops-fold[open]').count()) === 2);
    await page.click('[data-fold="onsite"] > summary'); await sleep(150);
    check("Dashboard: Cars on site folds with a one-line summary", /Tonight 38/.test(await foldTxt("onsite")) && !(await page.locator('[data-fold="onsite"] .booked-row').first().isVisible()), await foldTxt("onsite"));
    await page.click('[data-dashreload]'); await sleep(650);
    check("Dashboard: Refresh reads again and the fold stays as left", db.dashCalls.length === calls + 1 && (await page.locator('details.ops-fold[open]').count()) === 1);
    await page.click('[data-fold="onsite"] > summary'); await sleep(150);
    await page.click('.od-queues [data-dashsheet]'); await sleep(700);
    check("Dashboard: Open queue shows only that queue (not the whole To Do board)", await page.locator('.row[data-id]').evaluateAll((els) => els.map((e) => e.dataset.id).join()) === "q1" && /Showing Called, not sent · 1/.test(await page.locator(".queuebar").innerText()));
    await page.click("[data-queueclear]"); await sleep(300);
    check("Dashboard: Show all brings the board back", await page.locator(".queuebar").count() === 0 && await page.locator('.row[data-id]').count() > 3);
    check("Dashboard: Open queue opens tonight's DROPS on TO DO", await page.evaluate(() => document.getElementById("main").dataset.view === "board") && await page.locator('#tabTodo.on').count() === 1 && await page.locator('.row[data-id="q1"]').count() === 1);
    await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300);
    await page.click('#menuBody [data-view="dashboard"]'); await sleep(700);
    await page.click('.od-checks [data-view="summary"]'); await sleep(500);
    check("Dashboard: the shift summary row opens Summary", await page.evaluate(() => document.getElementById("main").dataset.view === "summary"));
    await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300);
    delete db.dash.exit; db.company.exit_fee = 0;
    await page.click('#menuBody [data-view="dashboard"]'); await sleep(700);
    check("Dashboard: no exit fee data, no exit fee row, alert or record", await page.locator('.od-pay .od-tr:not(.od-th)').count() === 1 && await page.locator('[data-dashjump="exit"], #dash-exit').count() === 0 && !/exit fee/i.test(await page.locator('.od-foot').innerText()));
    db.dash = { parked: { total: 0, late: 0, days: [], yards: [] } }; db.bookings = [];
    await page.click('[data-dashreload]'); await sleep(650);
    check("Dashboard: empty data says so, no false alerts or dead controls", /Nothing needs doing right now/.test(await page.locator('.od-dmain').innerText()) && /0 open tasks/.test(await page.locator('.od-dmain').innerText()) && /No sheets for today yet|Nothing due in the next 4 hours/.test(await page.locator('.od-cup').innerText()) && await page.locator('.od-task, [data-dashdates]').count() === 0 && /No bookings ahead yet/.test(await page.locator('.od-work').innerText()) && /Called, not sent\s*0/.test(await page.locator('.od-queues').innerText()));
    await page.setViewportSize({ width: 360, height: 800 });
    check("Dashboard: smallest phone fits", await noSideScroll(page));
    check("Dashboard: no errors", page.__errors.length === 0, page.__errors);
  }
});
// Dashboard totals are the database's true counts, not the length of a capped list (part 85); early returns are counted per car.
await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "stdplus", colour: "#F9A01B", ink: "#172536", short: "TakeOff" }; db.company.overstay_rate = 30; db.dash = dashData();
  db.dash.totals = { added: 412, added_desk: 400, taken_n: 350, cash: 9000, card: 12000, waived_n: 7, waived: 210, removed: 325, no_show: 300, cancelled: 20, duplicate: 5, complaints: 301, owed_n: 3 };
  const page = await phone(browser, db);
  await open(page); await sleep(400);
  await page.evaluate(() => (document.querySelector("#cHead:not(.hidden)") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300);
  await page.click('#menuBody [data-view="dashboard"]'); await sleep(700);
  const txt = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
  const desk = await page.locator('[data-fold="desk"] .od-line').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  check("Totals: Desk activity uses the true counts", desk[0] === "Added at the desk 400 added · 12 NEW BOOKING 412" && /^Removed 300 no show · 20 cancelled · 5 duplicate 325$/.test(desk[1]) && desk[2] === "Complaints 301", desk);
  const pay = await page.locator(".od-pay .od-tr:not(.od-th)").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  check("Totals: money taken uses the true sums and count", /Collected £21000 · 350 cars Cash £9000 Card £12000/.test(pay[0]) && /Waived £210/.test(await txt(".od-foot")), pay);
  await page.evaluate(() => document.querySelector('[data-dashjump="added"]').click()); await sleep(150);
  check("Totals: a record list says it shows the latest rows of the true total", /Added at the desk \(412\)/.test(await txt("#dash-added")) && /Showing the latest 2 of 412/.test(await txt("#dash-added")), await txt("#dash-added"));
  check("Totals: no errors", page.__errors.length === 0, page.__errors);
});
// Booking Save checks every field before it queues anything.
await scenario(async () => {
  const db = makeDb(); db.me = { ...db.me, role: "owner" };
  const page = await phone(browser, db);
  await open(page); await page.selectOption("#sheetPick", "p0"); await sleep(700);
  await page.click('.row[data-id="p1"] .reg'); await page.waitForSelector("#panel[open]");
  await page.fill("#pickFlightText", "LS1234"); await page.fill("#regText", "AB12-CDE"); await page.click("[data-savepanel]"); await sleep(400);
  check("Booking Save: an invalid reg queues nothing, not even the flight", /letters and numbers/.test(await toast(page)) && !db.calls.some((c) => ["set_pick_flight", "set_reg", "set_note"].includes(c.fn)) && await page.locator("#panel[open]").count() === 1, db.calls.map((c) => c.fn));
  await page.fill("#regText", "AB12 CDE"); await page.fill("#retT", "99:99"); await page.click("[data-savepanel]"); await sleep(400);
  check("Booking Save: an invalid time queues nothing either", !db.calls.some((c) => ["set_pick_flight", "set_reg", "set_pick_return"].includes(c.fn)), db.calls.map((c) => c.fn));
  await page.fill("#retT", ""); await page.evaluate(() => { document.getElementById("retT").value = "0900"; }); await page.click("[data-savepanel]"); await sleep(600);
  check("Booking Save: fixed, the flight and the reg are saved", db.calls.some((c) => c.fn === "set_pick_flight" && c.args.p_flight === "LS1234") && db.calls.some((c) => c.fn === "set_reg" && c.args.p_reg === "AB12 CDE"), db.calls.map((c) => c.fn));
});
// Capacity (Settings, part 71) against Parked now: spaces free or over, per yard too
for (const theme of ["", "stdplus"]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" }; db.dash = dashData();
  db.company.capacity = 40; db.company.yard_capacity = { NB: 15 };
  const page = await phone(browser, db);
  await open(page); await sleep(400);
  const look = theme || "standard";
  await page.evaluate(() => (document.querySelector("#cHead:not(.hidden)") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300);
  await page.click('#menuBody [data-view="dashboard"]'); await sleep(700);
  const parked = (await page.locator("#main .k-parked").innerText()).replace(/\s+/g, " ");
  check("Capacity (" + look + "): Parked now shows the spaces free", (theme ? /^Site status 30 parked 10 spaces free Occupancy 75% of 40 .*2 past their return/ : /30 of 40 · 10 free/).test(parked), parked);
  const onsiteTxt = (await page.locator("#main .booked").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  check("Capacity (" + look + "): cars on site shows spaces free and over each day", /Today\s*38\s*2 free/.test(onsiteTxt) && /Tomorrow\s*45\s*5 over/.test(onsiteTxt) && await page.locator(".booked-row.over").count() === 1, onsiteTxt);
  const yard = (await page.locator("#main").innerText()).match(/NB[\s\S]{0,80}/)[0].replace(/\s+/g, " ");
  check("Capacity (" + look + "): a yard over its spaces shows red", /18 \/ 15/.test(yard) && await page.locator("#main strong.num.late").count() === 1, yard);
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/capacity-dashboard-" + look + ".png", fullPage: true });
  if (theme === "stdplus") check("Capacity: occupancy bar three quarters full", await page.locator(".ops-capbar i").evaluate((e) => e.style.width) === "75%");
  db.dash.parked.total = 45; await page.click("[data-dashreload]"); await sleep(650);
  const over = (await page.locator("#main .k-parked").innerText()).replace(/\s+/g, " ");
  check("Capacity (" + look + "): over capacity says how many", (theme ? /^Site status 45 parked 5 over capacity Occupancy 113% of 40/ : /45 of 40 · 5 over/).test(over) && (!theme || await page.locator(".od-bar.over").count() === 1), over);
  check("Capacity (" + look + "): fits a phone", await noSideScroll(page));
});
await scenario(async () => {
  const db = makeDb(); db.me.role = "office";
  db.perms = Object.fromEntries(["sent", "called", "clear", "yard", "summary", "log", "flights", "rtc", "picksinfo", "import", "staff", "note", "intake"].map((k) => [k, true]));
  const page = await phone(browser, db);
  await open(page); await sleep(400);
  await page.click("#menuBtn"); await sleep(300);
  check("Dashboard: office staff don't get it", await page.locator('#menuBody [data-view="dashboard"]').count() === 0 && await page.locator('#menuBody [data-view="archive"]').count() === 1);
});

// 18a3d. Location on PICKS (brand.picks_yard): the row's NO SHOW becomes the location, NO SHOW is in the panel, yards counted
for (const [theme, role] of [["", "owner"], ["stdplus", "terminal"]]) await scenario(async () => {
  const db = theme ? apbDb(theme) : makeDb(); db.company.brand = { ...db.company.brand, picks_yard: true }; db.me = { ...db.me, role };
  if (role === "terminal") db.perms = { clear: true, picksinfo: true, note: true, intake: true };
  const yards = db.company.yards;
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  if (await page.locator("#kindSeg:not(.hidden)").count()) await page.click("#kindSeg [data-kind=picks]"); else await page.selectOption("#sheetPick", "p0");
  await page.waitForSelector('.row[data-id="p1"]');
  const look = (theme || "standard") + ", " + role;
  const row = '.row[data-id="p1"]';
  check("Location on PICKS (" + look + "): the row has a location button, not NO SHOW", await page.locator(row + ' [data-pick="No Show"]').count() === 0 && await page.locator(row + " .pyard select[data-yard]").count() === 1
    && (await page.locator(row + " .pyard select option").allInnerTexts()).length === yards.length + 1);
  const yardCounts = async () => page.locator("#tally .tyards button").evaluateAll((b) => b.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
  const before = await yardCounts();
  check("Location on PICKS (" + look + "): the column heading says YARD", /COLL\s*YARD\s*RTC/.test(await page.locator("#colHead").innerText()));
  check("Location on PICKS (" + look + "): the numbers count cars per yard on their own line", before.length >= yards.length && /^\S+.* 0$/.test(before[0]), before);
  await page.selectOption(row + " .pyard select", yards[1]); await sleep(500);
  const call = db.calls.filter((c) => c.fn === "set_yard").pop();
  check("Location on PICKS (" + look + "): choosing a location saves it", call && call.args.p_booking === "p1" && call.args.p_yard === yards[1], call);
  check("Location on PICKS (" + look + "): the button then shows the location", (await page.locator(row + " .pyard.on span").innerText()).length > 0);
  const after = await yardCounts();
  check("Location on PICKS (" + look + "): that yard's count goes up", after[1] && / 1$/.test(after[1]), after);
  await page.click(row + " .reg"); await page.waitForSelector("#panel[open]");
  check("Location on PICKS (" + look + "): NO SHOW is in the car's panel", await page.locator("#panelBody [data-pnoshow]").count() === 1);
  await page.click("#panelBody [data-pnoshow]"); await sleep(500);
  const tp = db.calls.filter((c) => c.fn === "tap_pick").pop();
  check("Location on PICKS (" + look + "): NO SHOW from the panel marks the car", tp && tp.args.p_booking === "p1" && tp.args.p_key === "intake" && tp.args.p_value === "No Show", tp);
});
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  if (await page.locator("#kindSeg:not(.hidden)").count()) await page.click("#kindSeg [data-kind=picks]"); else await page.selectOption("#sheetPick", "p0");
  await page.waitForSelector('.row[data-id="p1"]');
  check("Location on PICKS: switched off, rows keep NO SHOW and no yard counts", await page.locator('.row[data-id="p1"] [data-pick="No Show"]').count() === 1 && await page.locator(".pyard").count() === 0 && await page.locator("#tally .tyards").count() === 0);
});

// 18a3d2. Exit fee (companies.exit_fee / exit_free, database part 76): exempt references are explicit on DROPS; the car says the fee.
for (const theme of ["", "stdplus", "ops", "premium", "board", "cards", "pro"]) await scenario(async () => {
  const db = theme ? apbDb(theme) : makeDb(); db.company.exit_fee = 10; db.company.exit_free = ["CPD", "VIPAPB1147"];
  const drops = db.bookings.filter((x) => x.kind === "drops" && x.sheet_id === db.bookings[0].sheet_id);
  drops[0].ref = "Cpd - 19-660374"; drops[1].ref = "CAP-18-554625"; if (drops[2]) drops[2].ref = "vip apb-1147";
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  const look = theme || "standard";
  const r0 = '.row[data-id="' + drops[0].id + '"]', r1 = '.row[data-id="' + drops[1].id + '"]';
  await page.waitForSelector(r0);
  check("Exit fee (" + look + "): a listed reference start shows Exempt, any case or spacing", (await page.locator(r0 + ' .bpay-row .bpay-status').first().innerText()) === "Exit · Exempt");
  if (drops[2]) check("Exit fee (" + look + "): a whole listed reference shows Exempt", (await page.locator('.row[data-id="' + drops[2].id + '"] .bpay-row .bpay-status').first().innerText()) === "Exit · Exempt");
  check("Exit fee (" + look + "): other references show no tag", !/EXIT FEE/.test(await page.locator(r1).innerText()));
  await page.click(r0 + " .reg"); await page.waitForSelector("#panel[open]");
  check("Exit fee (" + look + "): the car says no exit fee", /EXIT FEE\s*None for this booking/i.test(await page.locator("#panelBody .det").innerText()));
  await page.click("#panelBody [data-close]"); await sleep(200);
  await page.click(r1 + " .reg"); await page.waitForSelector("#panel[open]");
  check("Exit fee (" + look + "): the car says the fee", /EXIT FEE\s*£10\b/i.test(await page.locator("#panelBody .det").innerText()));
});
await scenario(async () => {
  const db = makeDb(); db.company.exit_free = ["R"];
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  await page.waitForSelector('.row[data-id="b1"]');
  check("Exit fee: no fee set, no tag and nothing in the car", !/EXIT FEE/.test(await page.locator("#main").innerText()));
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  check("Exit fee: no fee set, the car doesn't mention it", !/EXIT FEE/i.test(await page.locator("#panelBody").innerText()));
});
// Exit fee: paid by cash or card with a photo; Undo; without a photo.
for (const theme of ["", "ops"]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  db.company.exit_fee = 10; db.company.exit_free = ["CAP"]; db.me = { ...db.me, role: "terminal" }; db.perms = { clear: true, picksinfo: true, note: true, intake: true };
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  const look = theme || "standard";
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  check("Exit fee paid (" + look + "): the car shows £10 due with CASH and CARD", /£10 due/.test(await page.locator("#panelBody").innerText()) && await page.locator("[data-exitshot]").count() === 2);
  await page.evaluate(() => { document.getElementById("exitFile").click = () => {}; }); await page.click('[data-exitshot="card"]');
  await page.setInputFiles("#exitFile", path.join(ROOT, "icons/icon-512.png"));
  await sleep(1500);
  const call = db.calls.filter((c) => c.fn === "set_exit_paid").pop();
  check("Exit fee paid (" + look + "): CARD with a photo uploads it and marks the car", call && call.args.p_method === "card" && /^c1\/docs\/b1\/x\d+\.jpg$/.test(call.args.p_photo) && db.uploads.some((u) => u === call.args.p_photo), { call, up: db.uploads });
  check("Exit fee paid (" + look + "): the car says paid by card, with the photo", /£10 paid by card/.test(await page.locator("#panelBody").innerText()) && await page.locator("#exitImg").count() === 1);
  await page.keyboard.press("Escape"); await sleep(300);
  check("Exit fee paid (" + look + "): terminal keeps its operational fee tag without collection-review controls", (await page.locator('.row[data-id="b1"]').innerText()).includes("EXIT £10 CARD") && !await page.locator("#boardPayments").isVisible() && await page.locator(".bpay-row").count() === 0);
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  await page.click("[data-exitundo]"); await sleep(600);
  check("Exit fee paid (" + look + "): Undo clears it", db.calls.filter((c) => c.fn === "set_exit_paid").pop().args.p_method === "" && /£10 due/.test(await page.locator("#panelBody").innerText()));
  await page.click('[data-exitnophoto="cash"]'); await sleep(600);
  const c2 = db.calls.filter((c) => c.fn === "set_exit_paid").pop();
  check("Exit fee paid (" + look + "): cash without a photo is marked too", c2.args.p_method === "cash" && c2.args.p_photo === "" && /No photo of the payment/.test(await page.locator("#panelBody").innerText()));
});
// Exit fee in Settings: owners only.
for (const role of ["owner", "manager"]) await scenario(async () => {
  const db = makeDb(); db.me = { ...db.me, role };
  if (role === "manager") db.perms = Object.fromEntries(["sent", "called", "clear", "yard", "summary", "log", "flights", "rtc", "picksinfo", "import", "staff", "note", "intake", "settings"].map((k) => [k, true]));
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menuBody [data-view="settings"]'); await sleep(400);
  if (role === "manager") return check("Exit fee settings: a manager doesn't get them", await page.locator("[data-saveexit]").count() === 0 && await page.locator("[data-saverate]").count() === 1);
  check("Exit fee settings: the owner gets them, off to start", await page.locator("[data-saveexit]").count() === 1 && await page.inputValue("#exitFee") === "");
  await page.fill("#exitFee", "10"); await page.fill("#exitFree", "cap, APD, VIP APB-1147"); await page.click("[data-saveexit]"); await sleep(500);
  const c = db.calls.filter((x) => x.fn === "set_exit_fee").pop();
  check("Exit fee settings: saving sends the fee and the references", c && c.args.p_fee === 10 && JSON.stringify(c.args.p_free) === JSON.stringify(["cap", "APD", "VIP APB-1147"]), c);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menuBody [data-view="board"]').catch(() => {}); await sleep(300);
});

// Booking website login in Settings (database part 101): owners only; the password is never shown back.
for (const role of ["owner", "manager"]) await scenario(async () => {
  const db = makeDb(); db.me = { ...db.me, role };
  if (role === "manager") db.perms = Object.fromEntries(["sent", "called", "clear", "yard", "summary", "log", "flights", "rtc", "picksinfo", "import", "staff", "note", "intake", "settings"].map((k) => [k, true]));
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menuBody [data-view="settings"]'); await sleep(500);
  if (role === "manager") return check("Booking website: a manager doesn't get it", await page.locator("[data-bssave]").count() === 0 && !db.calls.some((c) => c.fn === "booking_site_status"));
  check("Booking website: the owner gets it, not set to start", await page.locator("[data-bssave]").count() === 1 && await page.locator("[data-bsclear]").count() === 0 && /not set/.test(await page.locator("#bsPass").evaluate((e) => e.parentElement.innerText)));
  await page.fill("#bsUrl", "https://bookings.example.co.uk/admin"); await page.fill("#bsLogin", "apb.office"); await page.fill("#bsPass", "s3cret!"); await page.click("[data-bssave]"); await sleep(500);
  const c = db.calls.filter((x) => x.fn === "booking_site_set").pop();
  check("Booking website: saving sends the address, login and password", c && c.args.p_url === "https://bookings.example.co.uk/admin" && c.args.p_login === "apb.office" && c.args.p_password === "s3cret!", c);
  check("Booking website: after saving the password box is empty and says saved", await page.inputValue("#bsPass") === "" && /✓ saved/.test(await page.locator("#bsPass").evaluate((e) => e.parentElement.innerText)) && await page.inputValue("#bsLogin") === "apb.office");
  check("Booking website: the password is nowhere on the page", !(await page.content()).includes("s3cret!"));
  await page.fill("#bsLogin", "apb.desk"); await page.click("[data-bssave]"); await sleep(500);
  const c2 = db.calls.filter((x) => x.fn === "booking_site_set").pop();
  check("Booking website: an empty password box keeps the saved one", c2.args.p_password === null && c2.args.p_login === "apb.desk");
  await page.click("[data-bsclear]"); await sleep(500);
  const c3 = db.calls.filter((x) => x.fn === "booking_site_set").pop();
  check("Booking website: Remove login clears all three", c3.args.p_url === "" && c3.args.p_login === "" && c3.args.p_password === "" && await page.locator("[data-bsclear]").count() === 0);
});

// 18a3d3. Yard colours (companies.yard_colours, database part 77): each yard's tag on DROPS, the PICKS location button and the car's yard buttons
const YC = { MY: "#2E7D32", GS: "#EF6C00", T: "#FBC02D" };
const rgb = (h) => "rgb(" + [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ") + ")";
for (const theme of ["", "stdplus", "ops", "premium", "board", "cards", "pro"]) await scenario(async () => {
  const db = apbDb(theme || "standard"); if (!theme) db.company.brand = { ...db.company.brand, theme: undefined };
  db.company.brand = { ...db.company.brand, picks_yard: true }; db.company.yard_colours = YC;
  const sid = db.bookings[0].sheet_id, drops = db.bookings.filter((x) => x.kind === "drops" && x.sheet_id === sid);
  drops[0].yard = "MY"; drops[1].yard = "GS"; if (drops[2]) drops[2].yard = "T";
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  const look = theme || "standard";
  const bg = (sel) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);
  await page.waitForSelector('.row[data-id="' + drops[0].id + '"] .code');
  check("Yard colours (" + look + "): MY's tag on DROPS is green", await bg('.row[data-id="' + drops[0].id + '"] .code') === rgb(YC.MY));
  check("Yard colours (" + look + "): GS's tag on DROPS is orange", await bg('.row[data-id="' + drops[1].id + '"] .code') === rgb(YC.GS));
  if (drops[2]) check("Yard colours (" + look + "): T's tag on DROPS is yellow, with dark text", await bg('.row[data-id="' + drops[2].id + '"] .code') === rgb(YC.T)
    && await page.locator('.row[data-id="' + drops[2].id + '"] .code').evaluate((e) => getComputedStyle(e).color) === "rgb(31, 26, 0)");
  await page.click('.row[data-id="' + drops[0].id + '"] .reg'); await page.waitForSelector("#panel[open]");
  check("Yard colours (" + look + "): the car's chosen yard button is green", await bg('#panelBody [data-setyard="MY"]') === rgb(YC.MY));
  await page.click("#panelBody [data-close]"); await sleep(300);
  if (await page.locator("#kindBar [data-kind=picks]:visible").count()) await page.click("#kindBar [data-kind=picks]"); else if (await page.locator("#kindSeg:not(.hidden)").count()) await page.click("#kindSeg [data-kind=picks]"); else await page.selectOption("#sheetPick", "p0");
  await page.waitForSelector('.row[data-id="p1"] .pyard');
  await page.selectOption('.row[data-id="p1"] .pyard select', "GS"); await sleep(500);
  check("Yard colours (" + look + "): the PICKS location button is orange for GS", await bg('.row[data-id="p1"] .pyard.on') === rgb(YC.GS));
});
await scenario(async () => {
  const db = apbDb("ops"), plain = apbDb("ops");
  const sid = db.bookings[0].sheet_id, d0 = db.bookings.filter((x) => x.kind === "drops" && x.sheet_id === sid)[0];
  d0.yard = "T"; plain.bookings.find((x) => x.id === d0.id).yard = "T";
  db.company.yard_colours = { MY: "#2E7D32" };
  const a = await phone(browser, db), b = await phone(browser, plain);
  await open(a); await open(b); await sleep(300);
  const sel = '.row[data-id="' + d0.id + '"] .code';
  await a.waitForSelector(sel); await b.waitForSelector(sel);
  const st = (p) => p.locator(sel).evaluate((e) => { const c = getComputedStyle(e); return c.backgroundColor + c.color; });
  check("Yard colours: a yard with no colour keeps the look's own", await st(a) === await st(b));
});
// Yard colours in Settings: owners only.
for (const role of ["owner", "manager"]) await scenario(async () => {
  const db = apbDb("ops"); db.me = { ...db.me, role }; db.company.yard_colours = { MY: "#2E7D32" };
  if (role === "manager") db.perms = Object.fromEntries(["sent", "called", "clear", "yard", "summary", "log", "flights", "rtc", "picksinfo", "import", "staff", "note", "intake", "settings"].map((k) => [k, true]));
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menuBody [data-view="settings"]'); await sleep(400);
  if (role === "manager") return check("Yard colours settings: a manager doesn't get them", await page.locator("[data-saveycol]").count() === 0 && await page.locator("[data-savecap]").count() === 1);
  await page.click('[data-setsec="ycol"]'); await sleep(200);
  check("Yard colours settings: the owner gets a colour per yard", await page.locator("[data-ycol]").count() === 3 && await page.inputValue('[data-ycol="MY"]') === "#2e7d32");
  await page.locator('[data-ycol="GS"]').evaluate((e) => { e.value = "#ef6c00"; e.dispatchEvent(new Event("input", { bubbles: true })); });
  check("Yard colours settings: the tag shows the colour as it's chosen", await page.locator('.ycol:has([data-ycol="GS"]) .code').evaluate((e) => getComputedStyle(e).backgroundColor) === rgb("#EF6C00"));
  await page.click('[data-ycoff="MY"]');
  await page.click("[data-saveycol]"); await sleep(500);
  const c = db.calls.filter((x) => x.fn === "set_yard_colours").pop();
  check("Yard colours settings: saving sends each yard's colour, blank for none", c && c.args.p_colours.GS === "#ef6c00" && c.args.p_colours.MY === "" && c.args.p_colours.T === "", c);
  check("Yard colours settings: saved colours apply at once", await page.locator('.ycol:has([data-ycol="GS"]) .code').evaluate((e) => getComputedStyle(e).backgroundColor) === rgb("#EF6C00")
    && await page.locator('[data-ycol="MY"][data-off]').count() === 1);
});

// 18a3e. PICKS: a new booking at the desk, with a photo of the docket (database part 69)
for (const [theme, role] of [["", "office"], ["stdplus", "terminal"]]) await scenario(async () => {
  const db = theme ? apbDb(theme) : makeDb(); db.me = { ...db.me, role }; db.company.brand = { ...db.company.brand, picks_yard: true };
  if (role === "terminal") db.perms = { clear: true, picksinfo: true, note: true, intake: true };
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  const look = (theme || "standard") + ", " + role;
  check("Desk booking (" + look + "): no button on DROPS", await page.locator("[data-deskbook]").count() === 0);
  if (await page.locator("#kindSeg:not(.hidden)").count()) await page.click("#kindSeg [data-kind=picks]"); else await page.selectOption("#sheetPick", "p0");
  await page.waitForSelector('.row[data-id="p1"]');
  check("Desk booking (" + look + "): PICKS has the + New booking button", await page.locator("[data-deskbook]").count() === 1);
  await page.click("[data-deskbook]"); await page.waitForSelector("#deskForm");
  await page.setInputFiles("[data-deskfile]", path.join(ROOT, "icons/icon-512.png")); await sleep(200);
  check("Desk booking (" + look + "): the docket photo shows as taken", /Docket photo taken/.test(await page.textContent("#dkShot")));
  await page.fill("#dkReg", "bu15dde"); await page.fill("#dkName", "MR DESK"); await page.fill("#dkRetD", addDays(TONIGHT, 4)); await page.fill("#dkRetT", "05:15");
  await page.click('#dkYard [data-dkyard="' + db.company.yards[0] + '"]');
  check("Desk booking (" + look + "): Car taken in now is ticked to start with", await page.isChecked("#dkIn"));
  await page.click("#dkGo"); await sleep(1500);
  const call = db.calls.find((c) => c.fn === "add_booking");
  check("Desk booking (" + look + "): saved as a desk booking, taken in, with its location", call && call.args.p_sheet === "p0" && call.args.p.desk === true && call.args.p.taken_in === true && call.args.p.yard === db.company.yards[0] && call.args.p.return_local === addDays(TONIGHT, 4) + " 05:15", call && call.args);
  const doc = db.calls.find((c) => c.fn === "set_doc");
  const up = db.uploads.find((u) => /\/docs\//.test(u));
  check("Desk booking (" + look + "): the docket photo is uploaded and kept with the car", doc && up && new RegExp("^" + db.company.id + "/docs/" + doc.args.p_booking + "/\\d+\\.jpg$").test(doc.args.p_path) && up === doc.args.p_path, { doc: doc && doc.args, up });
  await page.click("#tabAll"); await sleep(300);
  check("Desk booking (" + look + "): the car is on the board, NEW BOOKING", /BU15DDE/.test(await page.textContent("#main")) && /NEW BOOKING/.test(await page.textContent("#main")));
  const nb = db.bookings.find((b) => b.reg === "BU15DDE");
  await page.click('.row[data-id="' + nb.id + '"] .reg'); await page.waitForSelector("#panel[open]"); await sleep(600);
  const src = await page.locator("#docImg img").getAttribute("src").catch(() => "");
  check("Desk booking (" + look + "): the car's panel shows the docket photo", /object\/sign\/pt-photos\/.*docs/.test(src || ""), src);
});
await scenario(async () => {
  const db = makeDb(); db.me = { ...db.me, role: "view" }; db.perms = { };
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  await page.selectOption("#sheetPick", "p0"); await page.waitForSelector('.row[data-id="p1"]');
  check("Desk booking: view-only staff don't get the button", await page.locator("[data-deskbook]").count() === 0);
});

// 18a3f. Me → Copy my link: this phone's own personal link
for (const theme of ["", "stdplus"]) await scenario(async () => {
  const db = theme ? apbDb(theme) : makeDb();
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  await page.evaluate(() => { window.__copied = []; navigator.clipboard.writeText = async (x) => { window.__copied.push(x); }; });
  await page.evaluate(() => (document.querySelector("#cHead:not(.hidden)") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(200);
  await page.click('#menuBody [data-view="me"]'); await sleep(400);
  const look = theme || "standard";
  check("Copy my link (" + look + "): Me has the button", await page.locator(".mylink [data-copy]").count() === 1);
  await page.click(".mylink [data-copy]"); await sleep(300);
  const want = await page.evaluate(() => location.origin + "/#t=" + localStorage.getItem("takeoff_link"));
  const got = await page.evaluate(() => window.__copied[0]);
  check("Copy my link (" + look + "): copies this phone's link", got === want && /#t=[A-Za-z0-9_-]{32,64}$/.test(got), { got, want });
});

// 18a4. a new version of the app is picked up without anyone reloading
await scenario(async () => {
  const db = makeDb();
  let tag = '"v1"';
  const page = await phone(browser, db);
  await page.route("**/app.js", (route) => route.request().method() === "HEAD" ? route.fulfill({ status: 200, headers: { etag: tag } }) : route.continue());
  await open(page);
  await sleep(500);
  await page.evaluate(() => { window.__stillHere = true; });
  tag = '"v2"';
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await sleep(2500);
  check("a new app version reloads the app by itself when nothing is in progress", !(await page.evaluate(() => window.__stillHere === true)));
  await page.waitForSelector("#main .row, #main .msg", { timeout: 8000 });
  check("after the update the board is back", await page.locator("#main .row").count() > 0);
});

// A flight not in the day's timetable reads CHECK MANUALLY (it may still fly); a
// flight landing far from the booked time still reads CHECK FLIGHT NO.
await scenario(async () => {
  const db = makeDb();
  Object.assign(db.bookings.find((x) => x.id === "b2"), { flight: "U22330", flight_note: "Not in the timetable · check the flight number" });
  Object.assign(db.bookings.find((x) => x.id === "b1"), { sched_time: "11:25", flight_status: "scheduled", flight_note: "Lands 11:25, over 6 h from the booked time · check the flight number" });
  const page = await phone(browser, db);
  await open(page); await page.waitForSelector('.row[data-id="b2"] .reg');
  const t2 = await page.textContent('.row[data-id="b2"]'), t1 = await page.textContent('.row[data-id="b1"]');
  check("not in the timetable: CHECK MANUALLY, no time made up", /CHECK MANUALLY/.test(t2) && !/CHECK FLIGHT NO/.test(t2), t2);
  check("far from the booked time: shows the flight's time and warns with the booked time", /11:25/.test(t1) && /CHECK FLIGHT · BOOKED \d\d:\d\d/.test(t1), t1);
});

// A car with several tags (CHECK FLIGHT NO., OVERSTAY, £ DUE) on a phone: every tag stays
// clear of the buttons (on 28 Sept they ran under SENT and hid the money due).
await scenario(async () => {
  const db = makeDb(), b3 = db.bookings.find((x) => x.id === "b3");
  db.company.overstay_rate = 30;
  Object.assign(db.bookings.find((x) => x.id === "b1"), { make: "VOLKSWAGEN GOLF", flight: "U22334", sched_time: "23:50", est_time: "00:12", flight_status: "landed", sent_at: iso(TONIGHT, "23:41"), sent_by: "s2" });
  Object.assign(b3, { flight: "TBC", overstay: true, called_word: "Called", called_at: iso(TONIGHT, "22:51"), sent_at: iso(TONIGHT, "22:58"), sent_by: "s2", return_at: iso(addDays(TONIGHT, -2), "23:00") });   // two days back: £ due whatever the time of day
  const page = await phone(browser, db, { width: 390 });
  await open(page); await page.waitForSelector('.row[data-id="b3"] .reg');
  const r = await page.evaluate(() => {
    const row = document.querySelector('.row[data-id="b3"]'), acts = row.querySelector(".acts").getBoundingClientRect();
    return [...row.querySelectorAll(".l2 .tag")].map((t) => { const b = t.getBoundingClientRect(); return { t: t.textContent, right: Math.round(b.right), acts: Math.round(acts.left) }; });
  });
  check("row tags: flight warning, overstay and the separate amount due all shown", /CHECK FLIGHT/.test(JSON.stringify(r)) && /OVERSTAY/.test(JSON.stringify(r)) && /Overstay \/ charge £\d+ · Due/.test(await page.locator('.row[data-id="b3"] .bpay-row').innerText()), r);
  check("row tags: none runs under the buttons", r.length > 0 && r.every((x) => x.right <= x.acts), r);
  // An ordinary landed car keeps flight and times on one line (28 Sept: they wrapped).
  const one = await page.evaluate(() => {
    const row = document.querySelector('.row[data-id="b1"]'); if (!row) return null;
    const a = row.querySelector(".l2a").getBoundingClientRect(), b = row.querySelector(".l2b").getBoundingClientRect(), acts = row.querySelector(".acts").getBoundingClientRect();
    return { same: Math.abs(a.top - b.top) < 4, right: Math.round(b.right), acts: Math.round(acts.left), text: row.querySelector(".l2").textContent };
  });
  check("row: flight and landing times stay on one line, clear of the buttons", !!one && one.same && one.right <= one.acts && /LANDED/.test(one.text), one);
  await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + "/row-tags.png" : "/dev/null", clip: { x: 0, y: 0, width: 390, height: 700 } }).catch(() => {});
});
