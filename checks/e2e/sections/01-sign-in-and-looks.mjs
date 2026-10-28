import { path, check, sleep, BASE, TONIGHT, TOMORROW, iso, makeDb, now, deskDb, phone, open, text, noSideScroll, toast, pickKind, scenario, browser, failed, apbDb, dashData, dashExit } from "../harness.mjs";

// 1. first open, sign-in states
await scenario(async () => {
  const page = await phone(browser, makeDb(), { signedIn: false });
  await page.goto(BASE + "/"); await sleep(800);
  check("no personal link: shows the 'ask for your link' screen", await page.isVisible("#noLink"));
});

// 1-names. One office login, several people (20 Oct): Switch name shows who's working (RAKESH.O).
await scenario(async () => {
  const db = makeDb(); db.company.brand = { colour: "#F9A01B", ink: "#1A1A1A", short: "TakeOff", theme: "ops" };
  db.me = { id: "s3", name: "OFFICE", role: "manager", company_id: "c1", desk_names: ["RAKESH.O", "SUGU.O", "AMY.O"], acting: "" };
  db.staff.push({ id: "s3", name: "OFFICE", role: "manager", active: true, desk_names: db.me.desk_names });
  const page = await phone(browser, db, { width: 1280 });
  await open(page);
  check("names: the bar shows the login's name until someone picks theirs", (await page.locator("#who").innerText()) === "OFFICE" && await page.locator("#who.can-switch").count() === 1);
  await page.click("#who"); await sleep(300);
  check("names: tapping the name lists the names on this login", await page.locator("#panel [data-acting]").count() === 3 && /Who's working\?/.test(await page.locator("#panelTitle").innerText()));
  if (process.env.HELD_SHOTS) await page.screenshot({ path: process.env.HELD_SHOTS + "/switch-desktop.png" });
  await page.click('#panel [data-acting="RAKESH.O"]'); await sleep(500);
  check("names: picking a name switches without signing out", db.calls.some((c) => c.fn === "set_acting" && c.args.p_name === "RAKESH.O") && (await page.locator("#who").innerText()) === "RAKESH.O" && !(await page.locator("#panel").evaluate((d) => d.open)));
  await page.click("#menuBtn"); await sleep(300);
  check("names: the menu shows the name working and Switch name", /RAKESH\.O/.test(await page.locator("#menu .sub").first().innerText()) && await page.locator("#menu [data-switchname]").count() === 1);
  if (process.env.HELD_SHOTS) await page.screenshot({ path: process.env.HELD_SHOTS + "/switch-menu-desktop.png" });
  await page.click("#menu [data-switchname]"); await sleep(300);
  check("names: the name working now is marked", await page.locator('#panel [data-acting="RAKESH.O"][aria-pressed="true"]').count() === 1);
  await page.click('#panel [data-acting="SUGU.O"]'); await sleep(500);
  check("names: switching again", (await page.locator("#who").innerText()) === "SUGU.O");
  // part 98: the button stamps carry the picked name, not the login's.
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(300);
  await page.click('[data-id="b1"] [data-act="sent"]'); await sleep(500);
  check("names: SENT stamps the picked name, not the login's", (await page.locator('[data-id="b1"] [data-act="sent"] .by').innerText()).trim() === "SUGU.O" && db.bookings.find((b) => b.id === "b1").by_name.sent_by === "SUGU.O",
    await page.locator('[data-id="b1"] [data-act="sent"]').innerText());
  if (process.env.HELD_SHOTS) await page.screenshot({ path: process.env.HELD_SHOTS + "/stamp-phone.png" });
  await page.click('[data-id="b1"] [data-act="called"]'); await sleep(500);
  check("names: CALLED stamps it too", /SUGU\.O/.test(await page.locator('[data-id="b1"] [data-act="called"]').innerText()));
  await page.click('[data-id="b1"] [data-act="sent"]'); await sleep(500);
  check("names: undoing SENT clears its name", !db.bookings.find((b) => b.id === "b1").by_name.sent_by);
  await page.setViewportSize({ width: 1280, height: 800 }); await sleep(300);
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(300);
  await page.click('#bnav [data-bn="menuBtn"]'); await sleep(300);
  check("names: on a phone Switch name is in the menu", await page.locator("#menu [data-switchname]").isVisible());
  await page.click("#menu [data-switchname]"); await sleep(300);
  if (process.env.HELD_SHOTS) await page.screenshot({ path: process.env.HELD_SHOTS + "/switch-phone.png" });
  check("names: no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
  // A person on their own login sees no switcher.
  const solo = await phone(browser, makeDb());
  await open(solo);
  await solo.click("#menuBtn"); await sleep(300);
  check("names: no Switch name on a personal login", await solo.locator("#menu [data-switchname]").count() === 0 && await solo.locator("#who.can-switch").count() === 0);
  await solo.context().close();
  // The owner sets the names on the office login.
  const odb = makeDb(); odb.staff.push({ id: "s3", name: "OFFICE", role: "manager", active: true, desk_names: [] });
  const own = await phone(browser, odb, { width: 1280 });
  await open(own);
  await own.click("#menuBtn"); await sleep(300); await own.click('#menu [data-view="staff"]'); await sleep(400);
  await own.click('[data-manage="s3"]'); await sleep(300);
  await own.fill("#spNames", "RAKESH.O\nSUGU.O, AMY.O"); await own.click("[data-savenames]"); await sleep(400);
  const sn = odb.calls.find((c) => c.fn === "set_desk_names");
  check("names: the owner saves the names on a login", sn && sn.args.p_staff === "s3" && sn.args.p_names.join() === "RAKESH.O,SUGU.O,AMY.O", sn);
  if (process.env.HELD_SHOTS) { await own.locator("#spNames").scrollIntoViewIfNeeded(); await own.screenshot({ path: process.env.HELD_SHOTS + "/names-staff-desktop.png" }); }
  check("names: owner page no errors", own.__errors.length === 0, own.__errors);
  await own.context().close();
}, 'held');

// 1a. iPhone: the page can't zoom in (Safari zooms on a search box under 16px and
// stays zoomed, which slid the bottom bar over the last cars, 13 Oct), and the
// last car scrolls clear of the bottom bar.
await scenario(async () => {
  const db = makeDb(); db.company.brand = { colour: "#F9A01B", ink: "#1A1A1A", short: "TakeOff", theme: "ops" };
  for (let i = 0; i < 20; i++) db.bookings.push({ id: "z" + i, sheet_id: "d0", kind: "drops", ref: "Z" + i, reg: "KN25NT" + String.fromCharCode(65 + i), num: 40 + i, name: "MCANENY MRS", flight: "EZY2338", return_at: iso(TONIGHT, "23:" + String(10 + i).padStart(2, "0")), note: "" });
  const page = await phone(browser, db, { touch: true });
  await open(page);
  check("iPhone: the page doesn't zoom in", /maximum-scale=1\b/.test(await page.getAttribute('meta[name="viewport"]', "content")));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(300);
  check("iPhone: the last car scrolls clear of the bottom bar", await page.evaluate(() => { const r = document.querySelectorAll("#main .row"), nav = document.getElementById("bnav").getBoundingClientRect(); return nav.height > 0 && r[r.length - 1].getBoundingClientRect().bottom <= nav.top; }));
});

// 1b. the looks: Standard, Airport Parking Bay UI ("pro") and Cards ("cards"), each only by brand
await scenario(async () => {
  const plain = await phone(browser, makeDb());
  await open(plain);
  check("Standard: no pro or cards look", await plain.evaluate(() => !document.documentElement.classList.contains("pro") && !document.documentElement.classList.contains("cards")));
  check("Standard: no cards, bottom bar or display setting", await plain.evaluate(() => getComputedStyle(document.querySelector(".row .rt")).display === "none" && getComputedStyle(document.getElementById("bnav")).display === "none" && /SENT/.test(document.querySelector('.row [data-act="sent"]').textContent)));

  const page = await phone(browser, apbDb("pro"), { width: 360 });
  await open(page); await sleep(300);
  const look = await page.evaluate(async () => {
    await document.fonts.ready;
    const reg = getComputedStyle(document.querySelector(".row .reg")), bar = getComputedStyle(document.querySelector(".top"));
    return { pro: document.documentElement.classList.contains("pro"), cards: document.documentElement.classList.contains("cards"), premium: document.documentElement.classList.contains("premium"), plate: reg.backgroundColor, bar: bar.backgroundColor, mark: document.querySelector(".tobrand").dataset.mark,
      font: document.fonts.check("700 16px 'Barlow Semi Condensed'"), theme: document.querySelector('meta[name="theme-color"]').content,
      rt: getComputedStyle(document.querySelector(".row .rt")).display, nav: getComputedStyle(document.getElementById("bnav")).display, word: document.querySelector('.row [data-act="sent"]').textContent };
  });
  check("Airport Parking Bay UI: switched on by the company's brand, and only that look", look.pro && !look.cards && !look.premium, look);
  check("Airport Parking Bay UI: regs are yellow number plates", look.plate === "rgb(247, 209, 23)", look.plate);
  check("Airport Parking Bay UI: the bar wears the brand's dark colour", look.bar === "rgb(14, 63, 126)" && look.theme === "#0E3F7E", look);
  check("Airport Parking Bay UI: the mark letter and the Barlow fonts load (CSP allows them)", look.mark === "P" && look.font, look);
  check("Airport Parking Bay UI: one line a car as before (no cards, no bottom bar)", look.rt === "none" && look.nav === "none" && /SENT/.test(look.word), look);
  check("Airport Parking Bay UI: no sideways scrolling on a 360 px phone", await noSideScroll(page));
  check("Airport Parking Bay UI: no errors", page.__errors.length === 0, page.__errors);
});
await scenario(async () => {
  const page = await phone(browser, apbDb("cards"), { width: 360 });
  await open(page); await sleep(300);
  const look = await page.evaluate(async () => {
    await document.fonts.ready;
    return { pro: document.documentElement.classList.contains("pro"), cards: document.documentElement.classList.contains("cards"), premium: document.documentElement.classList.contains("premium"), plate: getComputedStyle(document.querySelector(".row .reg")).backgroundColor,
      bar: getComputedStyle(document.querySelector(".bar")).backgroundColor, font: document.fonts.check("700 16px 'Barlow Semi Condensed'") };
  });
  check("Cards: switched on by the company's brand, and only that look", look.cards && !look.pro && !look.premium, look);
  check("Cards: yellow plates, the brand's dark bar, Barlow loads", look.plate === "rgb(255, 212, 59)" && look.bar === "rgb(14, 63, 126)" && look.font, look);
  check("Cards: no sideways scrolling on a 360 px phone", await noSideScroll(page));
  const card = await page.evaluate(() => ({ reg: document.querySelector('.row[data-id="b1"] .reg').textContent, name: document.querySelector('.row[data-id="b1"] .pin').textContent,
    noTimeCol: !document.querySelector('.row[data-id="b1"] .rt'),
    word: document.querySelector('.row[data-id="b3"] [data-act="sent"] .w').textContent, nav: getComputedStyle(document.getElementById("bnav")).display, tabs: document.getElementById("tabTodo").textContent }));
  check("Cards: the reg is the hero, the name reads as written, buttons have words, no time column", card.reg === "EK14JPV" && /Senior Miss/.test(card.name) && card.noTimeCol && card.word === "Sent", card);
  check("Cards: the tab reads 'N Waiting for action'", /^\d+ Waiting for action$/.test(card.tabs), card.tabs);
  check("Cards: the bottom bar is there", card.nav === "flex", card);
  check("Cards: no fold control (that is Premium only)", !(await page.isVisible("#tallyFold")));
  check("Cards: the buttons stay under the car (big cards)", await page.evaluate(() => { const row = document.querySelector('.row[data-id="b1"]'); return row.querySelector(".acts").getBoundingClientRect().top >= row.querySelector(".left").getBoundingClientRect().bottom - 1; }));
  await page.click('#bnav [data-bn="menuBtn"]'); await page.waitForSelector('[data-mode="dark"]');
  await page.click('[data-mode="dark"]'); await sleep(200);
  const dark = await page.evaluate(() => ({ on: document.documentElement.classList.contains("dark"), bg: getComputedStyle(document.body).backgroundColor, kept: localStorage.getItem("takeoff_mode") }));
  check("Cards: Dark in the menu turns the app dark and is remembered on the phone", dark.on && dark.bg === "rgb(10, 17, 29)" && dark.kept === "dark", dark);
  await page.click('[data-mode="light"]'); await sleep(200);
  check("Cards: Light turns it back", !(await page.evaluate(() => document.documentElement.classList.contains("dark"))));
  await page.keyboard.press("Escape"); await sleep(300);
  check("Cards: the shift header replaces the day dropdown", await page.isVisible("#shiftBtn") && !(await page.isVisible("#sheetPick")) && /CURRENT NIGHT SHIFT|TODAY/.test(await page.locator("#shiftBtn").innerText()));
  await page.click("#shiftBtn"); await page.waitForSelector("[data-pickshift]");
  check("Cards: Choose shift lists the sheets", /Choose shift/i.test(await page.locator("#shiftBody").innerText()) && (await page.locator("[data-pickshift]").count()) >= 2);
  const other = await page.locator("[data-pickshift]").nth(1).getAttribute("data-pickshift");
  await page.click('[data-pickshift="' + other + '"]'); await sleep(500);
  check("Cards: picking a shift opens it and closes the sheet", !(await page.isVisible("#shiftPick")) && (await page.locator("#sheetPick").inputValue()) === other);
  check("Cards: no errors", page.__errors.length === 0, page.__errors);
});

// Premium UI: the Cards look with a title bar, underline DROPS/PICKS, a white shift row and white tiles.
await scenario(async () => {
  const page = await phone(browser, apbDb("premium"), { width: 360 });
  await open(page); await sleep(300);
  const look = await page.evaluate(() => ({ cards: document.documentElement.classList.contains("cards"), premium: document.documentElement.classList.contains("premium"), board: document.documentElement.classList.contains("pboard"),
    pro: document.documentElement.classList.contains("pro"), head: document.getElementById("cHead").innerText, shiftBtn: !document.getElementById("shiftBtn").classList.contains("hidden"),
    tile: getComputedStyle(document.querySelector("#tally button")).backgroundColor, num: getComputedStyle(document.querySelector("#tally b")).color,
    underline: getComputedStyle(document.querySelector('#kindSeg [aria-pressed="true"]')).borderBottomColor, bar: getComputedStyle(document.querySelector(".bar")).backgroundColor, tabs: document.getElementById("tabTodo").textContent }));
  check("Premium: switched on by the brand, its own look only (not Cards, not Airport Parking Bay UI)", look.premium && !look.cards && !look.pro && !look.board, look);
  check("Premium: the title bar names the company, who is on and when it updated", /Parking Bay/.test(look.head) && /RAKESH · Owner/.test(look.head) && !/Operations/i.test(look.head) && /Updated \d\d:\d\d/.test(look.head), look.head);
  check("Premium: a navy title bar whatever the brand's text colour", look.bar === "rgb(14, 63, 126)", look.bar);
  check("Premium: white tiles with dark figures, brand-blue active tab underline", look.tile === "rgba(0, 0, 0, 0)" && look.num === "rgb(17, 24, 39)" && look.underline === "rgb(21, 96, 189)", look);
  check("Premium: the tab reads 'TO DO (N)' and the navy shift button is gone", /^TO DO \(\d+\)$/.test(look.tabs) && !look.shiftBtn, look);
  check("Premium: no sideways scrolling on a 360 px phone", await noSideScroll(page));
  check("Premium: the white shift row replaces the day dropdown", await page.isVisible("#cShift") && !(await page.isVisible("#sheetPick")) && /(Drops|Picks) · [\s\S]*change sheet/.test(await page.locator("#cShift").innerText()));
  await page.click("#cShift"); await page.waitForSelector("[data-pickshift]");
  check("Premium: the shift row opens Choose shift", /Choose shift/i.test(await page.locator("#shiftBody").innerText()));
  await page.click("[data-closeshift]"); await sleep(200);
  await page.click("#cHead"); await sleep(300);
  check("Premium: tapping the title opens the menu", await page.isVisible("#menu"));
  await page.keyboard.press("Escape"); await sleep(300);
  const lay = await page.evaluate(() => ({ tile: getComputedStyle(document.querySelector("#tally button")).alignItems, name: getComputedStyle(document.querySelector('.row[data-id="b1"] .pin')).textAlign }));
  check("Premium: the numbers sit centred and the name reads from the left", lay.tile === "center" && lay.name === "left", lay);
  const box = await page.evaluate(() => { const row = document.querySelector('.row[data-id="b1"]'), l = row.querySelector(".left").getBoundingClientRect(), a = row.querySelector(".acts").getBoundingClientRect();
    return { beside: a.top < l.bottom - 1, h: Math.round(row.getBoundingClientRect().height) }; });
  check("Premium: big cards, the buttons under the car (Premium Board has the dense rows)", !box.beside && box.h > 110, box);
  check("Premium: a Hide numbers control under the tiles", /Hide numbers/.test(await page.locator("#tallyFold").innerText()) && await page.isVisible("#tally"));
  await page.click("#tallyFold"); await sleep(300);
  const fold = await page.evaluate(() => ({ tally: getComputedStyle(document.getElementById("tally")).display, sum: document.getElementById("tallyFold").innerText, kept: localStorage.getItem("takeoff_tally_folded"), exp: document.getElementById("tallyFold").getAttribute("aria-expanded") }));
  check("Premium: folding hides the tiles and leaves a one-line summary", fold.tally === "none" && /2\s*no yard/i.test(fold.sum) && /Show/.test(fold.sum) && fold.kept === "1" && fold.exp === "false", fold);
  check("Premium: no sideways scrolling with the numbers folded", await noSideScroll(page));
  await page.reload(); await page.waitForSelector("#main .row"); await sleep(300);
  check("Premium: the fold is remembered on the phone", await page.evaluate(() => document.body.classList.contains("tfolded")));
  await page.click("#tallyFold"); await sleep(300);
  check("Premium: tapping the summary brings the numbers back", await page.isVisible("#tally") && await page.evaluate(() => localStorage.getItem("takeoff_tally_folded") === null));
  check("Premium: no errors", page.__errors.length === 0, page.__errors);
});

// Premium menu and summary: sections with icons, delete on its own, progress bar, activity by day with chips and search.
await scenario(async () => {
  const db = apbDb("premium");
  db.bookings.find((b) => b.id === "b1").cleared_at = now();
  db.activity = [
    { at: now(), staff_name: "SUGU", sheet_id: "d0", booking_id: "b3", reg: "DV59ACF", action: "SENT", value: "" },
    { at: now(), staff_name: "SUGU", sheet_id: "p0", booking_id: "p4", reg: "HJ12PGK", action: "INTAKE", value: "Collected" },
    { at: new Date(Date.now() - 2 * 864e5).toISOString(), staff_name: "RAKESH", action: "STAFF", value: "PIN changed for Jasnu" },
    { at: new Date(Date.now() - 2 * 864e5 - 6e4).toISOString(), staff_name: "SARFARAZ", action: "SIGN IN", value: "Tried to sign in, access is off" },
  ];
  const page = await phone(browser, db, { width: 360 });
  await open(page); await sleep(300);
  await page.click("#cHead"); await page.waitForSelector("#menu[open]");
  const menu = await page.evaluate(() => ({ labels: [...document.querySelectorAll("#menuBody > label")].map((l) => l.textContent), icons: document.querySelectorAll("#menuBody .menu-list .mi").length,
    lastList: [...document.querySelectorAll("#menuBody .menu-list")].pop().textContent, danger: !!document.querySelector("#menuBody .menu-danger [data-deletesheet]"),
    dangerInList: !!document.querySelector("#menuBody .menu-list [data-deletesheet]") }));
  check("Premium menu: sections Today, Office, This sheet, Display, You, with icons", ["TODAY", "OFFICE"].every((x) => menu.labels.includes(x)) && menu.labels.some((x) => /^THIS SHEET/.test(x)) && menu.labels.includes("DISPLAY") && menu.labels.includes("YOU") && menu.icons >= 8, menu);
  check("Premium menu: Delete this sheet sits alone at the bottom, not among the everyday buttons", menu.danger && !menu.dangerInList && /sign out/.test(menu.lastList), menu);
  await page.click('#menuBody [data-view="summary"]'); await page.waitForSelector(".actrow");
  const sum = await page.evaluate(() => ({ bar: document.querySelector(".stat.big .pbar i").style.width, pc: document.querySelector(".pbar-pc").textContent, days: [...document.querySelectorAll(".actday")].map((d) => d.textContent), rows: document.querySelectorAll(".actrow").length }));
  check("Premium summary: Cars back with a progress bar", sum.bar === "33%" && /33% done/.test(sum.pc), sum);
  check("Premium activity: grouped by day", sum.days.length === 2 && sum.rows === 4, sum);
  check("Premium activity: a coloured dot per line (Sent green, Intake Collected green, Staff grey)", await page.evaluate(() => [...document.querySelectorAll(".actrow .adot")].map((d) => d.className.replace("adot ", "")).join(",") === "d-s,d-s,d-x,d-x"));
  await page.click('[data-actf="picks"]'); await sleep(200);
  check("Premium activity: the Picks chip shows only picks work", await page.evaluate(() => document.querySelectorAll(".actrow").length === 1 && /HJ12PGK/.test(document.getElementById("actList").textContent)));
  await page.click('[data-actf="staff"]'); await sleep(200);
  check("Premium activity: the Staff chip shows staff changes and sign-ins", await page.evaluate(() => document.querySelectorAll(".actrow").length === 2 && /SARFARAZ · Tried to sign in, access is off/.test(document.getElementById("actList").textContent)));
  await page.click('[data-actf="all"]'); await sleep(200);
  await page.fill("#actQ", "dv59"); await sleep(200);
  check("Premium activity: search finds by reg and keeps the keyboard up", await page.evaluate(() => document.querySelectorAll(".actrow").length === 1 && document.activeElement && document.activeElement.id === "actQ"));
  await page.click('[data-view="board"]').catch(() => {}); await page.click("#kindSeg [data-kind=picks]"); await page.waitForSelector('.row[data-id="p1"]');
  await page.click('#bnav [data-bn="logBtn"]'); await page.waitForSelector(".hbars");
  const hb = await page.evaluate(() => [...document.querySelectorAll(".hbar")].map((h) => ({ hh: h.querySelector(".hh").textContent, n: h.querySelector("b").textContent, top: h.classList.contains("top") })));
  check("Premium picks summary: cars in by hour as bars, the busiest hour marked", hb.length >= 1 && hb.some((h) => h.top && h.n === "1"), hb);
    check("Premium menu and summary: no sideways scrolling, no errors", (await noSideScroll(page)) && page.__errors.length === 0, page.__errors);
});

// Premium: Flights, Staff, Settings and Archive restyled.
await scenario(async () => {
  const db = apbDb("premium");
  Object.assign(db.bookings.find((b) => b.id === "b1"), { flight_status: "landed", est_time: "22:31" });
  const page = await phone(browser, db, { width: 360 });
  await open(page); await sleep(300);
  const go = async (v) => { await page.click("#cHead"); await page.waitForSelector("#menu[open]"); await page.click('#menuBody [data-view="' + v + '"]'); await sleep(500); };
  await go("flights");
  const fl = await page.evaluate(() => { const r = document.querySelector('.row.frow[data-id="b1"]'); return r && { h: Math.round(r.getBoundingClientRect().height), chip: r.querySelector(".l2a").textContent, chipBg: getComputedStyle(r.querySelector(".l2a")).backgroundColor, name: r.querySelector(".pin").textContent, time: r.querySelector(".l2b").textContent }; });
  check("Premium Flights: a tidy row per flight with a status chip and the times", fl && fl.h <= 80 && /Landed/i.test(fl.chip) && fl.chipBg !== "rgba(0, 0, 0, 0)" && /Senior Miss/.test(fl.name) && /^\d\d:\d\d/.test(fl.time.trim()), fl);
  await go("staff");
  const st = await page.evaluate(() => { const row = [...document.querySelectorAll(".staffbox .rowline")].find((r) => r.querySelector(".sbtns")); if (!row) return null;
    const name = row.querySelector(".grow").getBoundingClientRect(), btns = row.querySelector(".sbtns").getBoundingClientRect();
    return { below: btns.top >= name.bottom - 1, initial: getComputedStyle(row, "::before").content, oneRow: new Set([...row.querySelectorAll(".sbtns .btn")].map((b) => Math.round(b.getBoundingClientRect().top))).size === 1 }; });
  check("Premium Staff: the buttons sit under the name (never over it), on one row, with the person's initial", st && st.below && st.oneRow && /"S"/.test(st.initial), st);
  await go("settings");
  await page.click('[data-setsec="flights"]'); await sleep(200);
  check("Premium Settings: From and Until side by side", await page.evaluate(() => { const p = document.querySelector(".pair"); if (!p) return false; const f = p.querySelectorAll(".field"); return f.length === 2 && Math.abs(f[0].getBoundingClientRect().top - f[1].getBoundingClientRect().top) < 2; }));
  check("Premium screens: no sideways scrolling, no errors", (await noSideScroll(page)) && page.__errors.length === 0, page.__errors);
});

// Premium looks: swipe right on a drop marks this person's step; pull down refreshes.
{
  const touch = (cdp, type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const drag = async (cdp, x0, y0, x1, y1, end = true) => {
    await touch(cdp, "touchStart", x0, y0);
    for (let i = 1; i <= 8; i++) { await touch(cdp, "touchMove", x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8); await sleep(16); }
    if (end) await touch(cdp, "touchEnd");
  };
  const swipeRow = async (page, cdp, id, dist = 130) => { const b = await page.locator('.row[data-id="' + id + '"]').boundingBox(); await drag(cdp, 25, b.y + b.height / 2, 25 + dist, b.y + b.height / 2); await sleep(400); };
  for (const [role, act] of [["bongo", "sent"], ["office", "called"], ["terminal", "clear"]]) {
    await scenario(async () => {
      const db = apbDb("board"); db.me = { ...db.me, role };
      const page = await phone(browser, db); await open(page); const cdp = await page.context().newCDPSession(page);
      await swipeRow(page, cdp, "b1");
      check("Swipe: a " + role + " swiping a drop right marks it " + act.toUpperCase(), db.calls.some((c) => c.fn === "tap_drop" && c.args.p_booking === "b1" && c.args.p_action === act && c.args.p_on === true), db.calls.filter((c) => c.fn === "tap_drop"));
      if (role === "bongo") {
        const n = db.calls.length;
        await swipeRow(page, cdp, "b3");   // already SENT
        check("Swipe: a car already marked is left alone (only marks, never unmarks)", !db.calls.slice(n).some((c) => c.fn === "tap_drop"), db.calls.slice(n));
        const n2 = db.calls.length;
        await swipeRow(page, cdp, "b2", 50);   // a short swipe does nothing
        check("Swipe: a short swipe does nothing", !db.calls.slice(n2).some((c) => c.fn === "tap_drop"));
        await page.click("#kindSeg [data-kind=picks]"); await page.waitForSelector('.row[data-id="p1"]');
        const n3 = db.calls.length;
        await swipeRow(page, cdp, "p1");
        check("Swipe: picks don't swipe", !db.calls.slice(n3).some((c) => /tap_/.test(c.fn)), db.calls.slice(n3));
      }
      check("Swipe (" + role + "): no errors", page.__errors.length === 0, page.__errors);
    });
  }
  // "Show buttons on drops" off works in every look that has swipe (it didn't on Standard with features).
  for (const theme of ["stdplus", "board", "premium"]) await scenario(async () => {
    const db = apbDb(theme); db.me = { ...db.me, role: "office" };
    const page = await phone(browser, db); await page.addInitScript(() => { localStorage.setItem("takeoff_swipe", "called"); localStorage.setItem("takeoff_swipe_only", "1"); }); await open(page);
    const r = await page.evaluate(() => ({ btns: document.querySelectorAll("#main .row [data-act]").length, steps: document.querySelectorAll("#main .row .acts.steps").length, rows: document.querySelectorAll("#main .row[data-id]").length }));
    check("Show buttons off (" + theme + "): no SENT / CALLED / CLEAR buttons on the drops, what's done instead", r.btns === 0 && r.steps === r.rows && r.rows > 0, r);
    await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
    check("Show buttons off (" + theme + "): tapping the reg still has the buttons", (await page.locator("#panel .pacts [data-act]").count()) === 3);
    check("Show buttons off (" + theme + "): no errors", page.__errors.length === 0, page.__errors);
  });
  // Swipe left: a second step, Off to start.
  await scenario(async () => {
    const db = apbDb("board"); db.me = { ...db.me, role: "office" };
    const page = await phone(browser, db); await open(page); const cdp = await page.context().newCDPSession(page);
    const b = await page.locator('.row[data-id="b1"]').boundingBox(), y = b.y + b.height / 2;
    await drag(cdp, 330, y, 200, y); await sleep(400);
    check("Swipe left: does nothing until someone picks a step for it", !db.calls.some((c) => c.fn === "tap_drop"));
    await page.click("#cHead"); await page.waitForSelector("#menu[open]");
    check("Swipe left: its own choice in the menu, Off to start", await page.evaluate(() => (document.querySelector("[data-swipeleft].on") || {}).textContent === "Off"));
    await page.click('[data-swipeleft="clear"]'); await sleep(200); await page.keyboard.press("Escape"); await sleep(300);
    await drag(cdp, 330, y, 200, y); await sleep(400);
    check("Swipe left: an office worker who picked Clear swipes left to mark CLEAR", db.calls.some((c) => c.fn === "tap_drop" && c.args.p_booking === "b1" && c.args.p_action === "clear"), db.calls.filter((c) => c.fn === "tap_drop"));
    const b2 = await page.locator('.row[data-id="b2"]').boundingBox();
    await drag(cdp, 25, b2.y + b2.height / 2, 155, b2.y + b2.height / 2); await sleep(400);
    check("Swipe left: swipe right still marks the office's own step (CALLED)", db.calls.some((c) => c.fn === "tap_drop" && c.args.p_booking === "b2" && c.args.p_action === "called"));
    check("Swipe left: no errors", page.__errors.length === 0, page.__errors);
  });
  // Standard with features gets the same working features.
  await scenario(async () => {
    const db = apbDb("stdplus"); db.me = { ...db.me, role: "bongo" };
    db.bookings.find((b) => b.id === "b1").cleared_at = now();
    const page = await phone(browser, db); await open(page); const cdp = await page.context().newCDPSession(page);
    await swipeRow(page, cdp, "b2");
    check("Standard with features: a bongo driver swipes a drop to SENT", db.calls.some((c) => c.fn === "tap_drop" && c.args.p_booking === "b2" && c.args.p_action === "sent"), db.calls.filter((c) => c.fn === "tap_drop"));
    const before = (db.bookingGets || []).length;
    const top = (await page.locator(".row").first().boundingBox()).y + 10;
    await drag(cdp, 200, top, 200, top + 180); await sleep(900);
    check("Standard with features: pull down to refresh", (db.bookingGets || []).length > before);
    await page.click("#tallyFold"); await sleep(300);
    check("Standard with features: Hide numbers folds the tiles to one line", await page.evaluate(() => getComputedStyle(document.getElementById("tally")).display === "none" && /Show/.test(document.getElementById("tallyFold").textContent)));
    await page.click('#bnav [data-bn="menuBtn"]'); await page.waitForSelector("#menu[open]");
    const m = await page.evaluate(() => ({ labels: [...document.querySelectorAll("#menuBody > label")].map((l) => l.textContent), swipe: (document.querySelector("[data-swipestep].on") || {}).textContent, danger: !!document.querySelector(".menu-danger [data-deletesheet]") }));
    check("Standard with features: the menu in sections, swipe choices, Delete on its own", m.labels.includes("TODAY") && m.labels.includes("SWIPE RIGHT ON DROPS") && m.swipe === "Sent" && m.danger, m);
    await page.click('#menuBody [data-view="summary"]'); await page.waitForSelector(".actbar");
    check("Standard with features: Summary has the progress bar and activity chips", await page.evaluate(() => !!document.querySelector(".stat.big .pbar i") && document.querySelectorAll(".actbar [data-actf]").length === 5));
    check("Standard with features (features): no errors", page.__errors.length === 0, page.__errors);
  });
  // Each person: Menu → Display → their swipe step, and buttons shown or hidden.
  await scenario(async () => {
    const db = apbDb("board"); db.me = { ...db.me, role: "owner" };
    const page = await phone(browser, db); await open(page); const cdp = await page.context().newCDPSession(page);
    await page.click("#cHead"); await page.waitForSelector("#menu[open]");
    const m = await page.evaluate(() => ({ steps: [...document.querySelectorAll("[data-swipestep]")].map((b) => b.textContent), on: (document.querySelector("[data-swipestep].on") || {}).textContent, btns: !!document.querySelector("[data-swipeonlyme]") }));
    check("Swipe choice: the menu offers Off / Sent / Called / Clear, an owner starts Off", m.steps.join("|") === "Off|Sent|Called|Clear" && m.on === "Off" && !m.btns, m);
    await page.click('[data-swipestep="clear"]'); await sleep(200);
    check("Swipe choice: once a step is picked, the buttons choice appears", await page.isVisible("[data-swipeonlyme]") && await page.evaluate(() => localStorage.getItem("takeoff_swipe") === "clear"));
    await page.keyboard.press("Escape"); await sleep(300);
    await swipeRow(page, cdp, "b1");
    check("Swipe choice: an owner who picked Clear swipes to mark CLEAR", db.calls.some((c) => c.fn === "tap_drop" && c.args.p_booking === "b1" && c.args.p_action === "clear"), db.calls.filter((c) => c.fn === "tap_drop"));
    check("Swipe choice: the buttons stay until this person hides them", (await page.locator('.row[data-id="b2"] [data-act="sent"]').count()) === 1);
    check("Swipe choice (owner): no errors", page.__errors.length === 0, page.__errors);
  });
  await scenario(async () => {
    const db = apbDb("board"); db.me = { ...db.me, role: "bongo" };
    const page = await phone(browser, db); await open(page); const cdp = await page.context().newCDPSession(page);
    await page.click("#cHead"); await page.waitForSelector("#menu[open]");
    check("Swipe choice: a bongo driver starts on Sent", await page.evaluate(() => (document.querySelector("[data-swipestep].on") || {}).textContent === "Sent"));
    check("Swipe choice: the buttons switch starts on (buttons shown)", await page.evaluate(() => document.querySelector("[data-swipeonlyme]").getAttribute("aria-checked") === "true"));
    await page.click("[data-swipeonlyme]"); await sleep(200);
    check("Swipe choice: tapping the switch turns the buttons off", await page.evaluate(() => document.querySelector("[data-swipeonlyme]").getAttribute("aria-checked") === "false"));
    await page.keyboard.press("Escape"); await sleep(300);
    const row = await page.evaluate(() => ({ btns: document.querySelectorAll('#main .row [data-act]').length, b3: (document.querySelector('.row[data-id="b3"] .acts.steps') || {}).textContent || "", b1: (document.querySelector('.row[data-id="b1"] .acts.steps') || {}).textContent || "" }));
    check("Swipe only (own choice): no buttons on drops, just what's done", row.btns === 0 && /Sent/i.test(row.b3) && /Swipe/.test(row.b1), row);
    await swipeRow(page, cdp, "b1");
    check("Swipe only: swiping still marks SENT", db.calls.some((c) => c.fn === "tap_drop" && c.args.p_booking === "b1" && c.args.p_action === "sent"));
    await page.click('.row[data-id="b2"] .reg'); await page.waitForSelector("#panel[open]");
    check("Swipe only: the car's panel has the buttons, to undo or fix", (await page.locator("#panel .pacts [data-act]").count()) === 3);
    await page.click('#panel .pacts [data-act="sent"]'); await sleep(400);
    check("Swipe only: a step tapped in the panel marks it and closes the panel", db.calls.some((c) => c.fn === "tap_drop" && c.args.p_booking === "b2" && c.args.p_action === "sent") && !(await page.isVisible("#panel")));
    await page.click("#kindSeg [data-kind=picks]"); await page.waitForSelector('.row[data-id="p1"]');
    check("Swipe only: picks keep their buttons", (await page.locator('.row[data-id="p1"] [data-pick]').count()) >= 3);
    check("Swipe only (bongo): no errors", page.__errors.length === 0, page.__errors);
  });
  await scenario(async () => {
    const db = apbDb("board"); db.me = { ...db.me, role: "owner" };
    const page = await phone(browser, db); await open(page); const cdp = await page.context().newCDPSession(page);
    await swipeRow(page, cdp, "b1");
    check("Swipe: owners and managers tap as before (no swipe)", !db.calls.some((c) => c.fn === "tap_drop"));
    const before = (db.bookingGets || []).length;
    const top = (await page.locator(".row").first().boundingBox()).y + 10;
    await drag(cdp, 200, top, 200, top + 180); await sleep(900);
    check("Pull down to refresh reloads the board", (db.bookingGets || []).length > before, { before, after: (db.bookingGets || []).length });
    check("Pull to refresh: no errors", page.__errors.length === 0, page.__errors);
  });
}

// Standard with features: the Standard look plus the bottom bar.
await scenario(async () => {
  const page = await phone(browser, apbDb("stdplus"), { width: 360 });
  await open(page); await sleep(300);
  const look = await page.evaluate(() => { const c = document.documentElement.classList;
    return { stdplus: c.contains("stdplus"), others: ["pro", "cards", "premium", "pboard"].filter((x) => c.contains(x)), nav: getComputedStyle(document.getElementById("bnav")).display,
      topIcons: ["logBtn", "flBtn", "psBtn"].map((id) => getComputedStyle(document.getElementById(id)).display), picker: getComputedStyle(document.getElementById("sheetPick")).display,
      oneLine: getComputedStyle(document.querySelector(".row")).display, head: !!document.querySelector("#cHead:not(.hidden)") }; });
  check("Standard with features: Standard's look, nothing else", look.stdplus && !look.others.length && !look.head && look.oneLine === "flex" && look.picker !== "none", look);
  check("Standard with features: the bottom bar is there, the top icons moved into it", look.nav === "flex" && look.topIcons.every((d) => d === "none"), look);
  check("Standard with features: no sideways scrolling on a 360 px phone", await noSideScroll(page));
  await page.click('#bnav [data-bn="logBtn"]'); await sleep(400);
  check("Standard with features: Summary in the bottom bar opens Summary", await page.evaluate(() => /Summary/i.test(document.getElementById("viewTitle").textContent)));
  await page.click("#bnBoard"); await sleep(300);
  check("Standard with features: Board brings the board back", await page.isVisible("#boardHead"));
  check("Standard with features: no errors", page.__errors.length === 0, page.__errors);
});
// Operations (theme ops): Standard with features in new chrome, the job rows exactly as Standard's.
await scenario(async () => {
  const rowLook = async (page, kind) => {
    if (kind === "picks") { await pickKind(page, "picks"); await sleep(200); }
    return page.evaluate(() => {
      const pick = (el, keys) => { const cs = getComputedStyle(el); return keys.map((k) => cs[k]).join("|"); };
      const rows = [...document.querySelectorAll("#main .row")].map((r) => [r.getBoundingClientRect().width, r.getBoundingClientRect().height,
        pick(r, ["backgroundColor", "fontSize", "padding", "borderBottom", "display"]), pick(r.querySelector(".reg"), ["fontSize", "fontWeight", "color"]),
        [...r.querySelectorAll(".acts button")].map((b) => { const q = b.getBoundingClientRect(); return [q.width, q.height, pick(b, ["backgroundColor", "color", "fontSize", "borderRadius", "border"])].join("/"); }).join(";")].join(" "));
      const sec = document.querySelector("#main .sec"), head = document.getElementById("colHead");
      return { rows, sec: sec ? pick(sec, ["backgroundColor", "fontSize", "padding"]) + sec.getBoundingClientRect().width : "", head: pick(head, ["backgroundColor", "fontSize"]) + head.getBoundingClientRect().width };
    });
  };
  const td = (theme) => { const db = makeDb(); db.company.brand = { colour: "#F9A01B", ink: "#1A1A1A", short: "TakeOff", theme }; return db; };
  const opsDb = td("ops"), std = await phone(browser, makeDb()), plus = await phone(browser, opsDb), feat = await phone(browser, td("stdplus"));
  await open(feat);
  check("Standard with features doesn't wear Operations", await feat.evaluate(() => !document.documentElement.classList.contains("ops") && getComputedStyle(document.body).backgroundColor === "rgb(255, 255, 255)"));
  await open(std); await open(plus); await sleep(300);
  for (const kind of ["drops", "picks"]) {
    const a = await rowLook(std, kind), b = await rowLook(plus, kind);
    check("Operations: " + kind + " rows exactly as Standard's (size, colours, buttons)", a.rows.length > 2 && JSON.stringify(a.rows) === JSON.stringify(b.rows), { std: a.rows[0], plus: b.rows[0] });
    check("Operations: " + kind + " group bar and column head as Standard's", a.sec === b.sec && a.head === b.head, { a, b });
  }
  const chrome = await plus.evaluate(() => ({ tab: getComputedStyle(document.querySelector("#boardHead .tabs button.on")).backgroundColor, bg: getComputedStyle(document.body).backgroundColor,
    who: getComputedStyle(document.getElementById("who"), "::after").content, tally: getComputedStyle(document.getElementById("tally")).borderRadius }));
  check("Operations: navy TO DO, grey page, numbers in a panel", chrome.tab === "rgb(24, 40, 59)" && chrome.bg === "rgb(245, 247, 250)" && chrome.tally === "6px", chrome);
  check("Operations: Standard itself keeps its own chrome", await std.evaluate(() => getComputedStyle(document.body).backgroundColor === "rgb(255, 255, 255)" && getComputedStyle(document.querySelector(".tabs button.on")).backgroundColor === "rgb(255, 255, 255)"));
  await plus.setViewportSize({ width: 1280, height: 900 }); await sleep(200);
  check("Operations: wide screen, PICKS gets the table too", await plus.evaluate(() => document.body.classList.contains("picks") && !!document.querySelector("#main .row.drow .dc-b") && Math.round(document.getElementById("main").getBoundingClientRect().width) === document.documentElement.clientWidth));
  await pickKind(plus, "drops"); await sleep(200);
  { const w = await plus.evaluate(() => ({ main: Math.round(document.getElementById("main").getBoundingClientRect().width), page: document.documentElement.clientWidth, desk: document.body.classList.contains("ops-desk"), drow: !!document.querySelector("#main .row.drow") }));
  check("Operations: wide screen, the board uses the width (the table layout)", w.main === w.page && w.desk && w.drow, w); }
  check("Operations: no errors", plus.__errors.length === 0, plus.__errors);
  // As many jobs on the screen as Standard with features: the first row starts no lower.
  await plus.setViewportSize({ width: 390, height: 844 }); await sleep(150);
  const firstTop = (page) => page.evaluate(() => Math.round(document.querySelector("#main .row").getBoundingClientRect().top));
  for (const kind of ["picks", "drops"]) {
    for (const pg of [plus, feat]) await pickKind(pg, kind);
    await sleep(250);
    const [o, f] = [await firstTop(plus), await firstTop(feat)];
    check("Operations: " + kind + " jobs start no lower than in Standard with features", o <= f, { ops: o, stdplus: f }); console.log("   first row top (" + kind + ") ops " + o + " / stdplus " + f);
  }
  for (const pg of [plus, feat]) { await pg.click("#tallyFold"); }
  await sleep(250);
  { const [o, f] = [await firstTop(plus), await firstTop(feat)]; check("Operations: numbers folded, jobs still start no lower", o <= f, { ops: o, stdplus: f }); console.log("   first row top (folded) ops " + o + " / stdplus " + f); }
  for (const pg of [plus, feat]) { await pg.click("#tallyFold"); }
  check("Operations: Drops | Picks in the top bar, the open one pressed", await plus.evaluate(() => !document.getElementById("kindBar").classList.contains("hidden") && document.querySelector('#kindBar [data-kind="drops"]').getAttribute("aria-pressed") === "true"));
  await plus.click('#kindBar [data-kind="picks"]'); await plus.waitForSelector("body.picks"); await sleep(200);
  check("Operations: tapping Picks opens the PICKS sheet", await plus.evaluate(() => document.body.classList.contains("picks") && document.querySelector('#kindBar [data-kind="picks"]').getAttribute("aria-pressed") === "true"));
  check("Operations: the day picker lists only PICKS days, without the word", await plus.evaluate(() => { const o = [...document.querySelectorAll("#sheetPick option")]; return o.length === 1 && !/PICKS|DROPS/.test(o[0].textContent) && /today/.test(o[0].textContent); }), await plus.evaluate(() => [...document.querySelectorAll("#sheetPick option")].map((x) => x.textContent)));
  check("Operations: no sideways scrolling on a phone", await noSideScroll(plus));
  check("Standard with features: no Drops | Picks in the bar", await feat.evaluate(() => getComputedStyle(document.getElementById("kindBar")).display === "none"));
  // Hourly stats and Shift summary are pages in Operations.
  await pickKind(plus, "drops");
  await plus.click('#bnav [data-bn="psBtn"]'); await sleep(300);
  const stats = await plus.evaluate(() => ({ title: document.getElementById("viewTitle").textContent, panel: document.getElementById("panel").open, on: document.querySelector('#bnav [data-bn="psBtn"]').classList.contains("on"),
    strip: [...document.querySelectorAll("#main .ops-strip > div")].map((d) => d.innerText.replace(/\s+/g, " ")).join(" | "), cards: [...document.querySelectorAll("#main .ops-card header strong")].map((x) => x.textContent) }));
  check("Operations: Stats opens the Hourly stats page, marked in the bottom bar", stats.title === "Hourly stats" && !stats.panel && stats.on && stats.cards.includes("Returns by booked hour") && stats.cards.includes("Shift breakdown"), stats);
  check("Operations: Hourly stats numbers (drops)", stats.strip === "Due back 3 | Sent 1 | Collected 0 | Still to collect 3", stats.strip);
  await plus.click('#main [data-copy="stats"]'); await sleep(200);
  check("Operations: Copy stats copies", /Copied/.test(await toast(plus)), await toast(plus));
  await plus.click('#kindBar [data-kind="picks"]'); await plus.waitForSelector("body.picks"); await sleep(300);
  const pstats = await plus.evaluate(() => ({ view: document.getElementById("viewTitle").textContent, strip: [...document.querySelectorAll("#main .ops-strip > div")].map((d) => d.innerText.replace(/\s+/g, " ")).join(" | ") }));
  check("Operations: Picks from Hourly stats stays on Hourly stats", pstats.view === "Hourly stats" && pstats.strip === "Scheduled 4 | Completed 1 | Last 30 min 0 | Last 60 min 0", pstats);
  await plus.click('#bnav [data-bn="logBtn"]'); await sleep(300);
  const sum = await plus.evaluate(() => ({ title: document.getElementById("viewTitle").textContent, big: !!document.querySelector("#main .stat.big"), strip: [...document.querySelectorAll("#main .ops-strip span")].map((x) => x.textContent).join("|"), card: (document.querySelector("#main .ops-card header strong") || {}).textContent }));
  check("Operations: Shift summary page (picks): headline, numbers in a strip, cars in by hour", sum.title === "Shift summary" && sum.big && sum.strip === "Still to come|No shows|RTC" && sum.card === "Cars in by collection hour", sum);
  await feat.click('#bnav [data-bn="psBtn"]'); await sleep(300);
  check("Standard with features: Stats still opens the sheet from the bottom", await feat.evaluate(() => document.getElementById("panel").open && !document.querySelector("#main .ops-strip")));
  await feat.keyboard.press("Escape");
  check("Operations: no errors on the stats and summary pages", plus.__errors.length === 0, plus.__errors);
  await plus.click("#bnBoard"); await sleep(200);
  check("Operations: bottom bar and stdplus class on", await plus.evaluate(() => document.documentElement.classList.contains("stdplus") && document.documentElement.classList.contains("ops") && getComputedStyle(document.getElementById("bnav")).display === "flex"));
  // Menu, Flights, booking details, Staff & access and Settings: pages in the same design.
  await pickKind(plus, "drops");
  await plus.click('#bnav [data-bn="menuBtn"]'); await sleep(300);
  const menu = await plus.evaluate(() => { const m = document.getElementById("menu"), r = m.getBoundingClientRect(); return { open: m.open, title: m.querySelector("h2").textContent, groups: [...m.querySelectorAll("#menuBody > label")].map((x) => x.childNodes[0].textContent),
    items: [...m.querySelectorAll(".menu-list [data-view]")].map((x) => x.textContent), top: Math.round(r.top) === Math.round(document.querySelector(".bar").getBoundingClientRect().bottom), bottom: Math.round(r.bottom) === Math.round(document.getElementById("bnav").getBoundingClientRect().top),
    on: document.querySelector('#bnav [data-bn="menuBtn"]').classList.contains("on"), board: document.getElementById("bnBoard").classList.contains("on") }; });
  check("Operations: Menu is a page between the top and bottom bars, marked in the bottom bar", menu.open && menu.title === "Menu" && menu.top && menu.bottom && menu.on && !menu.board, menu);
  check("Operations: Menu sections in plain words", menu.groups.slice(0, 2).join("|") === "Operations|Office" && menu.items.includes("Operations board") && menu.items.includes("Hourly stats") && menu.items.includes("Staff & access"), menu);
  await plus.mouse.click(Math.round(390 * 0.3), 844 - 20); await sleep(300);
  const fl = await plus.evaluate(() => ({ menu: document.getElementById("menu").open, title: document.getElementById("viewTitle").textContent, on: document.querySelector('#bnav [data-bn="flBtn"]').classList.contains("on"),
    strip: [...document.querySelectorAll("#main .ops-strip > div")].map((d) => d.innerText.replace(/\s+/g, " ")).join(" | "), rows: document.querySelectorAll("#main .ops-fl").length, badge: (document.querySelector("#main .ops-fl .ops-badge") || {}).textContent, card: (document.querySelector("#main .ops-card header strong") || {}).textContent }));
  check("Operations: Flights in the bottom bar works from the Menu page and opens the Flights page", !fl.menu && fl.title === "Flights" && fl.on, fl);
  check("Operations: Flights page: numbers in a strip, each flight with its status", fl.strip === "Flights 3 | Landed 0 | Delayed 0 | Cancelled 0" && fl.rows === 3 && fl.badge === "Not checked yet" && fl.card === "Flight status", fl);
  await plus.click("#main .ops-fl [data-open]"); await sleep(300);
  const car = await plus.evaluate(() => { const p = document.getElementById("panel"), f = p.querySelector(".ops-foot2").getBoundingClientRect(); return { open: p.open, title: p.querySelector("h2").textContent, sub: p.querySelector(".sub").textContent,
    secs: [...p.querySelectorAll(".ops-psec")].map((x) => x.textContent), reg: (p.querySelector('label[for="regText"]') || {}).textContent, half: (() => { const a = p.querySelector("#flightText").getBoundingClientRect(), b = p.querySelector("#schedText").getBoundingClientRect(); return Math.round(a.top) === Math.round(b.top) && a.right < b.left; })(),
    foot: f.bottom <= p.getBoundingClientRect().bottom + 1 && f.top < innerHeight, save: p.querySelector("[data-savepanel]").textContent }; });
  check("Operations: tapping a flight opens Booking details, the reg under the title", car.open && car.title === "Booking details" && /^EK14JPV/.test(car.sub), car);
  check("Operations: Booking details in sections, flight number and landing side by side, Save always in view", car.secs.join("|") === "Customer & vehicle|Return & parking|Notes & status" && car.reg === "Registration" && car.half && car.foot && car.save === "Save changes", car);
  await plus.fill("#noteText", "ops note"); await plus.click("[data-savepanel]"); await sleep(300);
  check("Operations: Save changes saves the note and closes", !(await plus.evaluate(() => document.getElementById("panel").open)) && opsDb.calls.some((c) => c.fn === "set_note" && c.args.p_note === "ops note"));
  opsDb.seen = [{ id: "s2", seen_at: new Date(Date.now() - 9 * 60000).toISOString() }];
  await plus.click('#bnav [data-bn="menuBtn"]'); await sleep(200); await plus.click('#menuBody [data-view="staff"]'); await sleep(300);
  const seen = await plus.evaluate(() => [...document.querySelectorAll("#main .ops-person .seen")].map((x) => x.className + ":" + x.textContent).join("|"));
  check("Operations: Staff & access shows you Online (green) and someone last seen 9 minutes ago Offline with the time", /^seen on:Online\|seen:Offline · \d\d:\d\d$/.test(seen) && opsDb.hereCalls >= 1, { seen, here: opsDb.hereCalls });
  opsDb.seen = [{ id: "s2", seen_at: new Date(Date.now() - 4 * 60000).toISOString() }];
  await plus.evaluate(() => { const real = Date.now; Date.now = () => real() + 31000; });
  await plus.click('#bnav [data-bn="menuBtn"]'); await sleep(200); await plus.click('#menuBody [data-view="staff"]'); await sleep(400);
  const seen2 = await plus.evaluate(() => [...document.querySelectorAll("#main .ops-person .seen")].map((x) => x.className + ":" + x.textContent).join("|"));
  check("Operations: someone seen 4 minutes ago is Online", seen2 === "seen on:Online|seen on:Online", seen2);
  const st = await plus.evaluate(() => ({ title: document.getElementById("viewTitle").textContent, head: document.querySelector("#main .ops-card header").innerText.replace(/\s+/g, " "), people: document.querySelectorAll("#main .ops-person").length,
    badges: [...document.querySelectorAll("#main .ops-person em")].map((x) => x.textContent).join("|"), you: document.querySelector("#main .ops-person small").textContent }));
  check("Operations: Staff & access page: team in one panel, each Active or Inactive", st.title === "Staff & access" && /^Team members \d+ people$/.test(st.head) && st.people >= 2 && /Active/.test(st.badges) && st.you === "Your account", st);
  await plus.click("#main .ops-dd summary"); await sleep(150);
  check("Operations: a person's Actions menu holds PIN and access, New link, Switch off", (await plus.locator("#main .ops-dd[open] button").allInnerTexts()).join("|") === "PIN and access|New link|Switch off", await plus.locator("#main .ops-dd[open] button").allInnerTexts());
  await plus.click("#main .ops-dd[open] [data-manage]"); await sleep(300);
  check("Operations: PIN and access from the Actions menu opens the person", await plus.evaluate(() => document.getElementById("panel").open && !document.querySelector("#main .ops-dd[open]")));
  await plus.keyboard.press("Escape"); await sleep(200);
  await plus.click("#main [data-addperson]"); await sleep(200);
  check("Operations: Add person opens the form", await plus.evaluate(() => !!document.querySelector("#main form#addStaff #newName") && document.activeElement.id === "newName"));
  await plus.click('#bnav [data-bn="menuBtn"]'); await sleep(200); await plus.click('#menuBody [data-view="settings"]'); await sleep(300);
  await plus.click('[data-setsec="flights"]'); await sleep(200);
  const se = await plus.evaluate(() => { const a = document.querySelector('[data-setting="enabled"]').getBoundingClientRect(), b = document.querySelector('[data-setting="live_every_min"]').getBoundingClientRect(), h = document.querySelector(".fchecks > .sethead");
    return { side: Math.round(a.top) === Math.round(b.top) && a.right < b.left, head: h.innerText.replace(/\s+/g, " "), unsaved: !!document.querySelector(".ops-unsaved:not([hidden])") }; });
  check("Operations: Settings in panels, Flight checks two boxes a line, what it's set to by the title", se.side && se.head === "Flight checks Automatic checks on" && !se.unsaved, se);
  await plus.selectOption('[data-setting="live_every_min"]', "60"); await sleep(200);
  check("Operations: Settings says when there are unsaved changes", await plus.evaluate(() => /Unsaved changes/.test((document.querySelector(".ops-unsaved") || {}).textContent || "")));
  check("Operations: no errors on Menu, Flights, Booking details, Staff and Settings", plus.__errors.length === 0, plus.__errors);
  check("Operations: no sideways scrolling on Settings", await noSideScroll(plus));
  // Standard with features keeps its menu sheet, flight rows, car panel and staff buttons.
  await feat.click('#bnav [data-bn="menuBtn"]'); await sleep(250);
  const fm = await feat.evaluate(() => ({ title: document.querySelector("#menuBody h2").textContent, items: [...document.querySelectorAll("#menuBody .menu-list [data-view]")].map((x) => x.textContent), bottom: Math.round(document.getElementById("menu").getBoundingClientRect().bottom) === innerHeight }));
  check("Standard with features: menu still a sheet from the bottom, in its own words", fm.bottom && fm.title !== "Menu" && fm.items.includes("Board") && !fm.items.includes("Operations board"), fm);
  await feat.click('#menuBody [data-view="staff"]'); await sleep(300);
  check("Standard with features: Staff unchanged (buttons on each person)", await feat.evaluate(() => !document.querySelector("#main .ops-person") && !!document.querySelector("#main .staffbox .rowline [data-reset]")));
  await feat.click('#bnav [data-bn="menuBtn"]'); await sleep(200); await feat.click('#menuBody [data-view="flights"]'); await sleep(300);
  check("Standard with features: Flights unchanged", await feat.evaluate(() => !document.querySelector("#main .ops-fl") && document.querySelectorAll("#main .frow").length === 3));
  await feat.click("#main .frow [data-open]"); await sleep(300);
  check("Standard with features: car panel titled by the reg, no sections", await feat.evaluate(() => /^EK14JPV/.test(document.getElementById("panelTitle").textContent) && !document.querySelector("#panel .ops-psec") && !document.getElementById("panel").classList.contains("ops-car")));
  await feat.keyboard.press("Escape");
  await std.context().close(); await plus.context().close(); await feat.context().close();
});
// Operations on a wide screen: the flight number on a DROPS row is a button
// for anyone who can change flights; the times sit in Status.
await scenario(async () => {
  const db = deskDb(), page = await phone(browser, db, { width: 1440 }); await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page); await sleep(400); await page.click("#tabAll"); await sleep(300);
  const cell = (id, c) => page.evaluate(([id, c]) => { const e = document.querySelector('.row[data-id="' + id + '"] .' + c); return e ? e.innerText.replace(/\s+/g, " ").trim() : null; }, [id, c]);
  // The flight number on the row changes the flight, starting from what's there.
  await page.click('.row[data-id="w2"] .dc-f .flno'); await sleep(400);
  const qf = await page.evaluate(() => ({ open: document.getElementById("panel").open, f: (document.getElementById("quickFlight") || {}).value, s: (document.getElementById("quickSched") || {}).value }));
  check("Ops wide: tapping the flight number opens the flight, filled in", qf.open && qf.f === "FR2002" && qf.s === "12:05", qf);
  db.calls.length = 0;
  await page.fill("#quickFlight", "FR2009"); await page.click("#quickForm .save"); await sleep(400);
  check("Ops wide: a new flight number saved, the old flight's time not carried over", db.calls.some((c) => c.fn === "set_flight" && c.args.p_booking === "w2" && c.args.p_flight === "FR2009") && !db.calls.some((c) => c.fn === "set_sched_time") && !(await page.evaluate(() => document.getElementById("panel").open)), db.calls.map((c) => c.fn));
  check("Ops wide: the row shows the new flight, its old times gone", (await cell("w2", "dc-f")) === "FR2009" && !/Sch 12:05/.test(await cell("w2", "dc-s")), [await cell("w2", "dc-f"), await cell("w2", "dc-s")]);
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(400);
  check("Ops phone: no flight button on the rows", await page.evaluate(() => !document.querySelector("#main .flno")));
  await page.context().close();
});
// Operations on a wide screen: the DROPS board as a table and Flights as tables;
// a phone and every other look keep their rows.
await scenario(async () => {
  const db = deskDb(), page = await phone(browser, db, { width: 1440 }); await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page); await sleep(400);
  const lay = await page.evaluate(() => { const nav = document.getElementById("bnav"), bar = document.querySelector(".top .bar");
    return { desk: document.body.classList.contains("ops-desk"), navUnder: nav.previousElementSibling === bar && nav.getBoundingClientRect().top >= bar.getBoundingClientRect().bottom - 1, pos: getComputedStyle(nav).position,
      tabs: [...nav.querySelectorAll("button")].filter((b) => b.offsetParent).map((b) => b.textContent.trim()), on: [...nav.querySelectorAll("button[aria-current=page]")].map((b) => b.textContent.trim()),
      head: document.getElementById("opsHead").innerText.replace(/\s+/g, " "), cols: [...document.querySelectorAll("#colHead.dhead > span")].map((x) => x.textContent), side: document.documentElement.scrollWidth <= innerWidth + 1 }; });
  check("Ops wide: the bottom bar is the tabs under the top bar", lay.desk && lay.navUnder && lay.pos !== "fixed", lay);
  check("Ops wide: tabs map to existing pages (owner sees Dashboard and Settings), Board marked", lay.tabs.join("|") === "Board|Flights|Stats|Summary|Dashboard|Settings|Menu" && lay.on.join() === "Board", lay.tabs);
  const night = new Date(TONIGHT + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }), wd = (k) => new Date(k + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  check("Ops wide: title, the sheet, its full date and the shift's hours", lay.head === "Operations board DROPS · " + night + " · 06:00 " + wd(TONIGHT) + " to 05:59 " + wd(TOMORROW) + " Current shift", lay.head);
  check("Ops wide: column heads", lay.cols.join("|") === "Return|Registration · vehicle|Flight|Customer · ref|Yard|Status|Actions", lay.cols);
  check("Ops wide: no sideways scrolling", lay.side);
  await page.click("#tabAll"); await sleep(300);
  const cell = (id, c) => page.evaluate(([id, c]) => { const e = document.querySelector('.row[data-id="' + id + '"] .' + c); return e ? e.innerText.replace(/\s+/g, " ").trim() : null; }, [id, c]);
  check("Ops wide: booked return, timetable and estimate kept apart", (await cell("w2", "dc-t")) === "12:05" && (await cell("w2", "dc-f")) === "FR2002" && /Sch 12:05 · Est 12:03$/.test(await cell("w2", "dc-s")), [await cell("w2", "dc-t"), await cell("w2", "dc-f"), await cell("w2", "dc-s")]);
  check("Ops wide: the flight's times in Status, landed with its time", /^Sent \d\d:\d\d Landed \d\d:\d\d/.test(await cell("w6", "dc-s")) && !/Landed/.test(await cell("w6", "dc-f")), [await cell("w6", "dc-s"), await cell("w6", "dc-f")]);
  check("Ops wide: no flight number: the collection time staff typed, named", (await cell("w9", "dc-t")) === "14:10 Collect 14:30" && (await cell("w9", "dc-f")) === "No flight", [await cell("w9", "dc-t"), await cell("w9", "dc-f")]);
  check("Ops wide: overnight car keeps its own time (00:40), estimate after midnight", (await cell("w15", "dc-t")) === "00:40" && /Delayed \+45 min/.test(await cell("w15", "dc-s")), await cell("w15", "dc-s"));
  check("Ops wide: customer and long reference in their column", (await cell("w5", "dc-c")) === "BROWN AGENT-REF-PARK-AND-RIDE-0000001046-LONG" && (await cell("w5", "dc-r")) === "IJ90MNO #5 No vehicle details", [await cell("w5", "dc-c"), await cell("w5", "dc-r")]);
  check("Ops wide: status in words (called and waiting, sent, cleared, overstay, not called)", /^Called \d\d:\d\d waiting 1[45] min Sch 12:05 · Est 12:03$/.test(await cell("w2", "dc-s")) && /^Sent \d\d:\d\d Landed 12:41 Sch 12:40$/.test(await cell("w6", "dc-s")) && /^Cleared \d\d:\d\d$/.test(await cell("w13", "dc-s")) && /^Overstay/.test(await cell("w16", "dc-s")) && /^Not called( |$)/.test(await cell("w14", "dc-s")),
    [await cell("w2", "dc-s"), await cell("w6", "dc-s"), await cell("w13", "dc-s"), await cell("w16", "dc-s"), await cell("w14", "dc-s")]);
  check("Ops wide: flight problems on the row", (await cell("w4", "dc-s")) === "Not called Delayed Sch 12:20" && /^Not called Flight cancelled/.test(await cell("w10", "dc-s")) && /CHECK FLIGHT NO\./.test(await cell("w7", "dc-s")) && /CHECK MANUALLY/.test(await cell("w8", "dc-s")), [await cell("w4", "dc-s"), await cell("w7", "dc-s"), await cell("w10", "dc-s")]);
  const yc = await page.evaluate(() => getComputedStyle(document.querySelector('.row[data-id="w2"] .dc-y .code')).backgroundColor);
  check("Ops wide: the yard tag in the company's own colour", yc === "rgb(47, 158, 68)", yc);
  const btn = await page.evaluate(() => { const r = document.querySelector('.row[data-id="w6"]'); return [...r.querySelectorAll(".acts button")].map((b) => b.className + (b.disabled ? " dis" : "")); });
  check("Ops wide: SENT, CALLED, CLEAR with their pressed states", btn.length === 3 && /\bs on\b/.test(btn[0]) && /\bc on\b/.test(btn[1]) && !/on/.test(btn[2]), btn);
  await page.click('.row[data-id="w1"] .acts [data-act="called"]'); await sleep(300);
  check("Ops wide: CALLED works as before", db.calls.some((c) => c.fn === "tap_drop" && c.args.p_booking === "w1" && c.args.p_action === "called" && c.args.p_on === true));
  const k = await page.evaluate(() => ({ t: document.getElementById("keyBtn").innerText.trim(), title: document.getElementById("keyBtn").title }));
  check("Ops wide: K says Key check, with what it does", k.t === "Key check" && /key is found in the cabinet/.test(k.title), k);
  await page.click("#keyBtn"); await page.waitForSelector("[data-keystart]"); await page.click("[data-keystart]"); await page.waitForSelector(".kc-row");
  check("Ops wide: Key check on: a tick box on each row, the count on the button", await page.evaluate(() => document.querySelectorAll("#main .kc-row .kbox").length > 10 && /^Key check\s+\d+\/\d+$/.test(document.getElementById("keyBtn").innerText.trim())));
  await page.click("#keyBtn"); await sleep(250);
  await page.fill("#q", "ZZ99ZZZ"); await sleep(400);
  check("Ops wide: a search with no match says so", await page.evaluate(() => /Not (found|on this sheet)/.test(document.querySelector("#main .msg").textContent)));
  await page.fill("#q", ""); await sleep(300);
  await page.click('.row[data-id="w2"] .dc-c'); await sleep(400);
  check("Ops wide: a row opens Booking details", await page.evaluate(() => document.getElementById("panel").open && /CD34EFG/.test(document.querySelector("#panel .sub").textContent)));
  await page.keyboard.press("Escape"); await sleep(250);
  // tablet: the customer under the car, still one line of columns, no sideways scroll
  await page.setViewportSize({ width: 1024, height: 800 }); await sleep(300);
  const tab = await page.evaluate(() => { const r = document.querySelector('.row[data-id="w2"]'), a = r.querySelector(".dc-r").getBoundingClientRect(), c = r.querySelector(".dc-c").getBoundingClientRect();
    return { under: c.top >= a.bottom - 2 && Math.abs(c.left - a.left) < 2, side: document.documentElement.scrollWidth <= innerWidth + 1, acts: r.querySelectorAll(".acts button").length, head4: getComputedStyle(document.querySelector("#colHead.dhead > span:nth-child(4)")).display }; });
  check("Ops tablet: customer under the car, all three buttons, no sideways scroll", tab.under && tab.acts === 3 && tab.side && tab.head4 === "none", tab);
  // phone: the rows and the bottom bar as before
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(400);
  const ph = await page.evaluate(() => ({ desk: document.body.classList.contains("ops-desk"), drow: !!document.querySelector("#main .drow"), row: !!document.querySelector('#main .row[data-id="w2"] .acts'), nav: getComputedStyle(document.getElementById("bnav")).position, after: document.getElementById("bnav").previousElementSibling.id, dash: document.getElementById("bnDash").offsetParent === null, key: document.getElementById("keyBtn").innerText.trim(), head: document.getElementById("opsHead").offsetParent === null }));
  check("Ops phone after a wide screen: rows, K and the bottom bar back as they were", !ph.desk && !ph.drow && ph.row && ph.nav === "fixed" && ph.after === "main" && ph.dash && /^K/.test(ph.key) && ph.head, ph);
  // Flights on a wide screen
  await page.setViewportSize({ width: 1440, height: 1000 }); await sleep(300);
  await page.click('#bnav [data-bn="flBtn"]'); await sleep(500);
  const fl = await page.evaluate(() => ({ strip: [...document.querySelectorAll("#main .fd-strip > div")].map((d) => d.innerText.replace(/\s+/g, " ")).join(" | "), check: document.querySelector("#main .fd-check p").textContent,
    att: [...document.querySelectorAll("#main .fd-a[data-id]")].map((r) => r.innerText.replace(/\s+/g, " ")), st: document.querySelectorAll("#main .fd-s[data-id]").length, tabs: [...document.querySelectorAll("[data-flfilter]")].map((b) => b.textContent).join("|"), on: document.querySelector('#bnav [data-bn="flBtn"]').getAttribute("aria-current") }));
  check("Flights wide: numbers say what they count", fl.strip === "With a flight number 14 bookings | Different flights 13 flights | No flight number 1 bookings | Need checking 3 bookings | Delayed 4 bookings | Landed 1 bookings | Cancelled 1 bookings", fl.strip);
  check("Flights wide: each check with its own time", /^Timetable checked today \d\d:\d\d · Live positions checked today \d\d:\d\d$/.test(fl.check) && fl.on === "page", fl);
  check("Flights wide: missing, invalid, failed lookup and far-off time told apart", fl.att.length === 4 && /IJ90MNO.*No flight number recorded Missing Add flight/.test(fl.att[0]) && /TBC Not a valid flight number Invalid Edit flight/.test(fl.att[1]) && /U22007 Not found in the timetable Lookup failed Edit flight/.test(fl.att[2]) && /over 6 h from the booked time Check time/.test(fl.att[3]), fl.att);
  check("Flights wide: filters with real counts", fl.tabs === "All 16|Needs attention 4|Scheduled 4|Delayed 4|Landed 1|Cancelled 1|Not checked 1" && fl.st === 12, fl);
  const st = await page.evaluate(() => [...document.querySelectorAll("#main .fd-s[data-id]")].map((r) => r.innerText.replace(/\s+/g, " ")));
  check("Flights wide: scheduled and estimated apart, no timetable time made up from the booking", st.some((x) => /^12:20 GH78JKL .* W94004 12:20 Delayed Delayed View$/.test(x)) && st.some((x) => /^14:10 QR78YZA .* — — Collect 14:30 No flight number View$/.test(x)) && st.some((x) => /^19:45 YZ56CDE .* U22931 — — Not checked yet View$/.test(x)), st);
  await page.click('[data-flfilter="delayed"]'); await sleep(250);
  check("Flights wide: Delayed shows only delayed", await page.evaluate(() => document.querySelectorAll("#main .fd-s[data-id]").length === 4 && !document.querySelector("#main .fd-a")));
  await page.click('[data-flfilter="all"]'); await sleep(250);
  await page.fill("#flQ", "FR2002"); await sleep(200);
  check("Flights wide: search narrows the tables and keeps the box", await page.evaluate(() => document.querySelectorAll("#main .fd-s[data-id]").length === 1 && document.activeElement.id === "flQ"));
  await page.fill("#flQ", ""); await sleep(200);
  await page.click('.fd-a[data-id="w5"] [data-addflight]'); await sleep(300);
  check("Flights wide: Add flight opens the flight number form", await page.evaluate(() => document.getElementById("panel").open && !!document.getElementById("quickFlight")));
  await page.keyboard.press("Escape"); await sleep(250);
  await page.click('#bnav [data-bn="menuBtn"]'); await sleep(300);
  check("Ops wide: Menu opens under the tabs", await page.evaluate(() => Math.round(document.getElementById("menu").getBoundingClientRect().top) === Math.round(document.getElementById("bnav").getBoundingClientRect().bottom)));
  await page.keyboard.press("Escape"); await sleep(250);
  // PICKS on a wide screen: its own columns and its own buttons
  await page.click('#bnav [data-view="board"]'); await sleep(300);
  await pickKind(page, "picks"); await sleep(400);
  if (await page.evaluate(() => !!document.getElementById("tabAll"))) { await page.click("#tabAll"); await sleep(300); }
  const pk = await page.evaluate(() => ({ cols: [...document.querySelectorAll("#colHead.dhead > span")].map((x) => x.textContent).join("|"), rows: document.querySelectorAll("#main .row.drow.prow").length,
    head: document.getElementById("opsHead").innerText.replace(/\s+/g, " "), foot: (document.querySelector("#main .ops-bfoot") || {}).textContent, side: document.documentElement.scrollWidth <= innerWidth + 1,
    drops: document.querySelectorAll('#main .prow [data-act="sent"],#main .prow [data-act="called"],#main .prow [data-act="clear"]').length }));
  const pc = (id, c) => cell(id, c);
  check("Ops wide PICKS: column heads for arrivals", pk.cols === "Arrival|Registration · vehicle|Customer · ref|Return|Return flight|Status|Actions", pk.cols);
  check("Ops wide PICKS: every car a table row, no sideways scroll, no SENT / CALLED / CLEAR", pk.rows === 8 && pk.side && pk.drops === 0, pk);
  check("Ops wide PICKS: title says PICKS with the full date", /^Operations board PICKS · \w+day \d+ \w+/.test(pk.head), pk.head);
  check("Ops wide PICKS: footer counts by intake", pk.foot === "3 not in yet · 3 taken in · 1 no show · 1 RTC · 8 cars · All times Europe/London", pk.foot);
  check("Ops wide PICKS: arrival, car, customer, return and return flight", (await pc("pk2", "dc-t")) === "08:15" && /^PB22BBB #2 AUDI A4 AVANT S LINE$/i.test(await pc("pk2", "dc-r")) && /^BAKER MR TKO-2026-2002$/i.test(await pc("pk2", "dc-c")) && /^\w{3} \d+ \w{3} 09:05 NEXT$/.test(await pc("pk2", "dc-b")) && (await pc("pk2", "dc-f")) === "FR1188" && (await pc("pk3", "dc-f")) === "Not given",
    [await pc("pk2", "dc-t"), await pc("pk2", "dc-r"), await pc("pk2", "dc-c"), await pc("pk2", "dc-b"), await pc("pk3", "dc-f")]);
  check("Ops wide PICKS: intake in words (not in, taken in with PT, no show, RTC, desk booking with docket)", (await pc("pk3", "dc-s")) === "Not in yet" && /^Taken in \d\d:\d\d PT done \d\d:\d\d/.test(await pc("pk1", "dc-s")) && /^Taken in \d\d:\d\d PT photos to take$/.test(await pc("pk2", "dc-s")) && (await pc("pk4", "dc-s")) === "No show" && (await pc("pk5", "dc-s")) === "RTC" && /NEW BOOKING Docket photo/.test(await pc("pk6", "dc-s")),
    [await pc("pk1", "dc-s"), await pc("pk2", "dc-s"), await pc("pk6", "dc-s")]);
  check("Ops wide PICKS: the note on its own line", /Customer rang, flight moved/.test(await pc("pk5", "dc-n")));
  const deskActs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#main .prow")].map((r) => [r.dataset.id, r.querySelector(".acts").outerHTML])));
  const yb = await page.evaluate(() => { const b = document.querySelector('.prow[data-id="pk2"] .acts .pyard'); return b ? { t: b.querySelector("span").textContent.trim(), bg: getComputedStyle(b).backgroundColor } : null; });
  check("Ops wide PICKS: the location button shows the yard in its colour", yb && yb.t === "CP" && yb.bg === "rgb(232, 89, 12)", yb);
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(400);
  const phActs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#main .row[data-id^=pk]")].map((r) => [r.dataset.id, (r.querySelector(".acts") || {}).outerHTML])));
  check("Ops wide PICKS: the same buttons as on the phone (COLL, location or NO SHOW, RTC, PT)", Object.keys(deskActs).length === 8 && Object.keys(deskActs).every((k) => deskActs[k] === phActs[k]), { desk: deskActs.pk1, phone: phActs.pk1 });
  check("Ops phone PICKS: rows as before", await page.evaluate(() => !document.querySelector("#main .drow") && !!document.querySelector('#main .row[data-id="pk1"] .acts')));
  await page.setViewportSize({ width: 1024, height: 800 }); await sleep(400);
  check("Ops tablet PICKS: customer under the car, no sideways scroll", await page.evaluate(() => { const r = document.querySelector('.prow[data-id="pk2"]'), a = r.querySelector(".dc-r").getBoundingClientRect(), c = r.querySelector(".dc-c").getBoundingClientRect();
    return c.top >= a.bottom - 2 && document.documentElement.scrollWidth <= innerWidth + 1 && getComputedStyle(document.querySelector("#colHead.dhead > span:nth-child(3)")).display === "none"; }));
  await page.setViewportSize({ width: 1440, height: 1000 }); await sleep(400);
  await page.click('.prow[data-id="pk3"] .acts [data-pick="Collected"]'); await sleep(400);
  check("Ops wide PICKS: COLL still asks or saves as before", db.calls.some((c) => /intake|pick/.test(c.fn) && JSON.stringify(c.args).includes("pk3")) || await page.evaluate(() => document.getElementById("panel").open || !!document.querySelector(".confirm,.ask")), db.calls.slice(-3));
  await page.keyboard.press("Escape").catch(() => {}); await sleep(200);
  check("Ops wide PICKS: the New booking button sits below the last row", await page.evaluate(() => { const b = document.querySelector(".deskbtn"); if (!b) return true; scrollTo(0, document.body.scrollHeight); const rows = [...document.querySelectorAll("#main .prow")], l = rows[rows.length - 1].getBoundingClientRect(), x = b.getBoundingClientRect(); return x.top >= l.bottom - 1 || x.bottom <= l.top; }));
  check("Ops wide: no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
  // A driver: no Dashboard or Settings tab; view-only: buttons off.
  const drv = deskDb(); drv.me = { ...drv.me, role: "bongo" }; drv.perms = { sent: true, called: true, note: true, intake: true };
  const p2 = await phone(browser, drv, { width: 1440 }); await open(p2); await sleep(300);
  check("Ops wide: a driver gets no Dashboard or Settings tab", await p2.evaluate(() => document.getElementById("bnDash").offsetParent === null && document.getElementById("bnSet").offsetParent === null && !!document.querySelector("#main .drow")));
  await p2.context().close();
  const vw = deskDb(); vw.me = { ...vw.me, role: "view" }; vw.perms = {};
  const p3 = await phone(browser, vw, { width: 1440 }); await open(p3); await sleep(300);
  check("Ops wide: view-only: SENT / CALLED / CLEAR disabled, no Key check", await p3.evaluate(() => [...document.querySelectorAll("#main .drow .acts button")].every((b) => b.disabled) && document.getElementById("keyBtn").offsetParent === null));
  check("Ops wide: view-only: the flight number is plain text, not a button", await p3.evaluate(() => !document.querySelector("#main .drow .flno") && /FR2002/.test(document.querySelector('#main .row[data-id="w2"] .dc-f').textContent)));
  await p3.context().close();
  // Standard with features on a wide screen: unchanged.
  const p4 = await phone(browser, deskDb("stdplus"), { width: 1440 }); await open(p4); await sleep(300);
  check("Standard with features on a wide screen: its own rows and bottom bar", await p4.evaluate(() => !document.body.classList.contains("ops-desk") && !document.querySelector("#main .drow") && getComputedStyle(document.getElementById("bnav")).position === "fixed" && document.getElementById("bnav").previousElementSibling.id === "main"));
  await p4.click('#bnav [data-bn="flBtn"]').catch(() => {}); await sleep(300);
  await p4.context().close();
}, "desk");
await scenario(async () => {
  // Operations on a wide screen: the other pages (Dashboard, Settings, Booking details, Summary, Stats, Archive, Staff, Me, Menu).
  const mk = () => { const db = deskDb(); db.company.overstay_rate = 30; db.company.exit_fee = 10; db.company.exit_free = ["CAP"]; db.company.capacity = 40; db.dash = dashData(); db.dash.exit = dashExit();
    db.staff.push({ id: "s3", name: "TERRY JONES", role: "terminal", active: true }, { id: "s4", name: "ALI KHAN", role: "bongo", active: true });
    db.activity = [{ at: new Date(Date.now() - 600000).toISOString(), action: "SENT", value: "", reg: "KL12PQR", staff_id: "s2", booking_id: "w6" }]; return db; };
  const db = mk(), page = await phone(browser, db, { width: 1440 }); await page.setViewportSize({ width: 1440, height: 1000 }); await open(page); await sleep(400);
  const menu = async () => { await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300); };
  const go = async (v) => { if (!(await page.$("#menu[open]"))) await menu(); await page.click('#menuBody [data-view="' + v + '"]'); await sleep(600); };
  const ctl = () => page.evaluate(() => [...document.querySelectorAll("#main input,#main select,#main textarea,#main button")].filter((e) => !e.closest(".set-nav") && !e.classList.contains("sethead")).map((e) => e.id || [...e.attributes].filter((a) => a.name.startsWith("data-")).map((a) => a.name + "=" + a.value).join(" ") || e.textContent.trim()).sort().join("|"));
  const noSide = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  // Menu
  await menu();
  const mn = await page.evaluate(() => ({ g: [...document.querySelectorAll("#menuBody > .mgrp")].length, cols: getComputedStyle(document.getElementById("menuBody")).gridTemplateColumns.split(" ").length }));
  check("Ops wide Menu: sections side by side in three columns", mn.g >= 4 && mn.cols === 3, mn);
  // Dashboard
  await go("dashboard");
  const dsh0 = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; }, sd = r(".od-side"), a = r(".od-desk"), m = r(".od-dmain"), p = r(".od-dside");
    return sd && a && m && p && sd.right <= a.left && a.width > innerWidth - 360 && Math.abs(m.top - p.top) < 2 && m.right <= p.left + 1; });
  await page.click('[data-dashsec="workload"]'); await sleep(300);
  const dsh = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; }, w = r(".od-work"), q = r(".od-queues"), t = r(".od-tools");
    return { attnFull: true, three: w && q && Math.abs(w.top - q.top) < 2 && w.right <= q.left, tools: t && t.top > 0 && document.elementFromPoint(t.left + 10, t.top + t.height / 2).closest(".od-tools") !== null }; });
  check("Ops wide Dashboard: side list on the left, What needs doing beside it with Site status beside Priority work", dsh0);
  check("Ops wide Dashboard: Workload, Upcoming and Live queues in one row", dsh.three, dsh);
  check("Ops wide Dashboard: Refresh and the period buttons visible and clickable", dsh.tools, dsh);
  check("Ops wide Dashboard: no sideways scrolling", await noSide());
  // Settings
  await go("settings");
  const deskSet = await ctl();
  const st = await page.evaluate(() => ({ nav: [...document.querySelectorAll(".set-nav [data-setgo]")].map((b) => b.textContent).join("|"), groups: [...document.querySelectorAll(".set-group > h2.set-gh")].map((h) => h.textContent).join("|") }));
  check("Ops wide Settings: grouped with a section list", st.nav === "Parking & yards|Flight checks|Exit fees & charges|Alerts & photos|Booking website|Backup" && st.groups === st.nav, st);
  await page.click('.set-nav [data-setgo="alerts"]'); await sleep(900);
  check("Ops wide Settings: a section button scrolls to its group", await page.evaluate(() => { const t = document.getElementById("set-alerts").getBoundingClientRect().top; return scrollY > 0 && t > -5 && t < 200; }));
  check("Ops wide Settings: no sideways scrolling", await noSide());
  // Summary and Stats
  await go("summary");
  const sm = await page.evaluate(() => ({ two: !!document.querySelector(".sum-desk > .sum-l") && !!document.querySelector(".sum-desk > .sum-r .alog, .sum-desk > .sum-r"), day: (document.querySelector(".sum-r .aday, .sum-r h3, .sum-r .ops-dayhead") || {}).textContent || document.querySelector(".sum-r").innerText }));
  check("Ops wide Summary: figures left, activity right", sm.two, sm);
  check("Ops wide Summary: the day header has the full date", /Today · \w+day \d+ \w+/i.test(sm.day), sm.day);
  await go("stats");
  const sb = await page.evaluate(() => { const bars = [...document.querySelectorAll(".st-bar")].map((b) => b.querySelector(".st-n").textContent || "0"), rows = [...document.querySelectorAll(".st-main .ops-tr:not(.th):not(.tot)")].filter((r) => /^\d\d:00/.test(r.querySelector("b").textContent)).map((r) => r.querySelector("i").textContent);
    return { bars, rows, side: !!document.querySelector(".st-desk > .st-side") }; });
  check("Ops wide Stats: bars match the hourly table, panels at the side", sb.side && sb.bars.length > 0 && sb.bars.join() === sb.rows.join(), sb);
  // Archive
  await go("archive"); await page.fill("#archQ", "CD34"); await page.click("#archGo"); await sleep(600);
  const ar = await page.evaluate(() => ({ th: [...document.querySelectorAll(".arch-tbl .ot-th span")].map((s) => s.textContent).join("|"), rows: document.querySelectorAll(".arch-tbl [data-archopen]").length }));
  check("Ops wide Archive: results as a table, each opens its day", ar.th.startsWith("Registration|Customer|Reference|Board|Day|Time") && ar.rows >= 1, ar);
  // Staff
  await go("staff");
  const sf = await page.evaluate(() => ({ th: document.querySelector(".ops-person.ops-th") ? document.querySelector(".ops-person.ops-th").innerText.replace(/\s+/g, " ").trim() : "", roles: document.querySelector(".ops-team").innerText }));
  check("Ops wide Staff: a header row and each person's role", ["PERSON", "ROLE", "ACCOUNT", "STATUS", "ACTIONS"].every((w) => sf.th.toUpperCase().includes(w)) && /Bongo driver/.test(sf.roles) && /Terminal/.test(sf.roles), sf.th);
  // Me
  await go("me");
  const me = await page.evaluate(() => ({ cols: document.querySelectorAll(".me-desk > .me-col").length, tuts: document.querySelectorAll(".me-tuts [data-tutorial]").length, pin: !!document.querySelector(".me-desk #pinNew, .me-desk input[type=password]") }));
  check("Ops wide Me: three columns, the PIN form and the tutorials", me.cols === 3 && me.tuts > 0 && me.pin, me);
  // Booking details
  if (await page.$("#menu[open]")) await page.keyboard.press("Escape");
  await page.click("#bnBoard"); await sleep(300);
  const carCtl = () => page.evaluate(() => [...document.querySelectorAll("#panel input,#panel select,#panel textarea,#panel button,#panel a[data-act],#panel [data-step]")].map((e) => e.id || [...e.attributes].filter((a) => a.name.startsWith("data-")).map((a) => a.name + "=" + a.value).join(" ") || e.textContent.trim()).sort().join("|"));
  await page.click('.row[data-id="w6"] .reg'); await sleep(500);
  const car = await page.evaluate(() => ({ two: !!document.querySelector("#panel .ops-2col > .ops-sheet + .ops-carside"), status: !!document.querySelector("#panel .ops-carside") && /Status/.test(document.querySelector("#panel .ops-carside").textContent) }));
  const deskCar = await carCtl();
  check("Ops wide Booking details: details left, status and payments right", car.two && car.status, car);
  check("Ops wide Booking details: no empty Documents section when the car has no docket", await page.evaluate(() => !document.querySelector("#panel .ops-docs") && !/Documents/.test(document.querySelector("#panel .ops-carside").textContent)));
  await page.keyboard.press("Escape"); await sleep(300);
  // Back to a phone: the same controls, laid out as before.
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(400);
  await page.click('.row[data-id="w6"] .reg'); await sleep(500);
  check("Ops phone Booking details: one column as before, the same buttons and fields as wide", await page.evaluate(() => !document.querySelector("#panel .ops-2col")) && (await carCtl()) === deskCar, { desk: deskCar.slice(0, 300) });
  await page.keyboard.press("Escape"); await sleep(300);
  await go("settings");
  check("Ops phone Settings: no groups, the same fields and buttons as wide", await page.evaluate(() => !document.querySelector(".set-desk")) && (await ctl()) === deskSet);
  await go("summary"); check("Ops phone Summary: one column", await page.evaluate(() => !document.querySelector(".sum-desk")));
  await go("stats"); check("Ops phone Stats: no bars, one column", await page.evaluate(() => !document.querySelector(".st-desk") && !document.querySelector(".st-bar")));
  await go("me"); check("Ops phone Me: as before", await page.evaluate(() => !document.querySelector(".me-desk")));
  await menu(); check("Ops phone Menu: no side-by-side sections", await page.evaluate(() => !document.querySelector("#menuBody > .mgrp")));
  check("Ops wide pages: no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
  // A driver on a wide screen: no Dashboard, Settings or Staff, the Menu and Me still work.
  const drv = mk(); drv.me = { ...drv.me, role: "bongo" }; drv.perms = { sent: true, called: true, note: true, intake: true };
  const p2 = await phone(browser, drv, { width: 1440 }); await p2.setViewportSize({ width: 1440, height: 1000 }); await open(p2); await sleep(300);
  await p2.evaluate(() => document.querySelector("#bnav [data-bn=menuBtn]").click()); await p2.waitForSelector("#menu[open]"); await sleep(300);
  check("Ops wide driver: Menu has no Dashboard, Settings or Staff", await p2.evaluate(() => !document.querySelector('#menuBody [data-view="dashboard"],#menuBody [data-view="settings"],#menuBody [data-view="staff"]') && !!document.querySelector('#menuBody [data-view="me"]')));
  await p2.click('#menuBody [data-view="me"]'); await sleep(500);
  check("Ops wide driver: Me in columns", await p2.evaluate(() => document.querySelectorAll(".me-desk > .me-col").length === 3));
  await p2.context().close();
  // View-only: Booking details opens with nothing to press.
  const vw = mk(); vw.me = { ...vw.me, role: "view" }; vw.perms = {};
  const p3 = await phone(browser, vw, { width: 1440 }); await p3.setViewportSize({ width: 1440, height: 1000 }); await open(p3); await sleep(300);
  await p3.click('.row[data-id="w6"] .reg'); await sleep(500);
  check("Ops wide view-only: Booking details has no status or payment buttons", await p3.evaluate(() => document.getElementById("panel").open && !document.querySelector('#panel [data-exitshot],#panel [data-exitnophoto],#panel [data-removecar]')));
  await p3.context().close();
});
await scenario(async () => {
  const page = await phone(browser, makeDb(), { width: 360 }); await open(page);
  check("Standard: still no bottom bar", await page.evaluate(() => getComputedStyle(document.getElementById("bnav")).display === "none"));
});

// Premium Board: Premium with two-line rows like the old board.
await scenario(async () => {
  const page = await phone(browser, apbDb("board"), { width: 360 });
  await open(page); await sleep(300);
  const look = await page.evaluate(() => { const c = document.documentElement.classList, row = document.querySelector('.row[data-id="b1"]');
    const l = row.querySelector(".left").getBoundingClientRect(), a = row.querySelector(".acts").getBoundingClientRect();
    return { premium: c.contains("premium"), board: c.contains("pboard"), cards: c.contains("cards"), pro: c.contains("pro"), head: !!document.querySelector("#cHead:not(.hidden)"),
      h: Math.round(row.getBoundingClientRect().height), beside: a.left >= l.right - 1, name: row.querySelector(".pin").textContent, l1: row.querySelector(".l1").textContent, l2: row.querySelector(".l2").textContent,
      flat: getComputedStyle(row).borderRadius === "0px" && getComputedStyle(row).marginLeft === "0px", caps: getComputedStyle(row.querySelector('[data-act="sent"]')).textTransform, sec: (document.querySelector(".sec") || {}).textContent || "" }; });
  check("Premium Board: Premium's look plus the board rows, nothing else", look.premium && look.board && !look.cards && !look.pro && look.head, look);
  check("Premium Board: two-line rows like the old board, buttons beside the car", look.beside && look.h <= 80, look);
  check("Premium Board: rows like the old board: number and name on line 1, car and flight on line 2", /SENIOR MISS/.test(look.name) && !/#1/.test(look.name) && /#1/.test(look.l1) && /U22312/.test(look.l2) && !/#1/.test(look.l2), look);
  check("Premium Board: flat full-width rows, buttons in capitals, sections like COMING UP 3", look.flat && look.caps === "uppercase" && /^COMING UP\s*\d+/.test(look.sec.trim()), look);
  check("Premium Board: no sideways scrolling on a 360 px phone", await noSideScroll(page));
  await page.click("#kindSeg [data-kind=picks]"); await page.waitForSelector('.row[data-id="p1"]'); await sleep(200);
  const pk = await page.evaluate(() => { const row = document.querySelector('.row[data-id="p1"]'); return { h: Math.round(row.getBoundingClientRect().height), name: row.querySelector(".pin").textContent, l1: row.querySelector(".l1").textContent, l2: row.querySelector(".l2").textContent, coll: row.querySelector('[data-pick="Collected"]').textContent }; });
  check("Premium Board: picks like Standard: names as imported, number on line 1, drop time on line 2, COLL", pk.h <= 64 && /ATANASOV/.test(pk.name) && /#1/.test(pk.l1) && /drop \d\d:\d\d/.test(pk.l2) && pk.coll === "COLL", pk);
  check("Premium Board: no errors", page.__errors.length === 0, page.__errors);
});
