import { healthData, BASE, fs, path, ROOT, check, sleep, addDays, TONIGHT, iso, makeDb, deskDb, keysDb, phone, open, text, pickKind, browser, apbDb, biDb, dashData, dashExit, dashSheets } from "./harness.mjs";

// ── previews (SHOTS=dir) ─────────────────────────────────────────────────
export async function shots(dir) {
  fs.mkdirSync(dir, { recursive: true });
  // SHOTS_ONLY=import: the Booking import page on TakeOff's look, desktop and phone, with sample data only.
  if (process.env.SHOTS_ONLY === "import") {
    for (const [width, height, name] of [[1440, 1000, "desktop"], [390, 844, "phone"]]) {
      const db = biDb(process.env.SHOTS_THEME || "ops");
      db.autoImport.schedule = { on: true, times: ["06:00", "12:00", "18:00"], by: "RAKESH", last: { outcome: "held", slot: "2026-10-14 12:00", why: "2 bookings need a decision" } };
      const page = await phone(browser, db, { width }); await page.setViewportSize({ width, height });
      const snap = async (n, full) => { await sleep(400); if (full) await page.setViewportSize({ width, height: Math.min(2400, await page.evaluate(() => document.documentElement.scrollHeight)) }); await page.screenshot({ path: path.join(dir, "import-" + name + "-" + n + ".png") }); if (full) await page.setViewportSize({ width, height }); };
      await open(page); await sleep(300);
      await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300);
      await page.click('#menuBody [data-view="import"]'); await sleep(700);
      await snap("1-before-check", true);
      await page.click("[data-autopreview]"); await sleep(900);
      await snap("2-checked", true);
      if (name === "phone") { await page.evaluate(() => window.scrollTo(0, 520)); await snap("2b-scrolled", false); await page.evaluate(() => window.scrollTo(0, 0)); }
      if (name === "phone") { await page.locator(".bi-row.s-review").first().locator(".bi-hd").click(); await page.locator(".bi-row.s-changed").first().locator(".bi-hd").click(); await snap("3-expanded", true); }
      await page.click('[data-bifilter="review"]'); await sleep(300); await snap("4-needs-review", false);
      await page.evaluate(() => { const d = document.querySelector("[data-bisched]"); if (d) { d.open = true; d.scrollIntoView(); } }); await snap("6-schedule", false);
      await page.click('[data-bitab="manual"]'); await sleep(400); await snap("5-manual", true);
      await page.context().close();
    }
    return;
  }
  // SHOTS_ONLY=audit: every page of the Operations look at desktop and phone width (sample data only).
  if (process.env.SHOTS_ONLY === "audit") {
    const AW = process.env.AUDIT_W ? process.env.AUDIT_W.split(",").map((w) => [+w, w > 1100 ? 1000 : 844, w >= 1200 ? "desktop" : w >= 900 ? "tablet" : "phone"]) : [[1440, 1000, "desktop"], [390, 844, "phone"]];
    const AP = process.env.AUDIT_P ? process.env.AUDIT_P.split(",") : null, want = (n) => !AP || AP.includes(n);
    for (const [width, height, name] of AW) {
      const db = deskDb(); { const bi = biDb("ops"); Object.assign(db, { autoImport: bi.autoImport, reviews: bi.reviews, preview: bi.preview, imports: bi.imports }); } db.company.overstay_rate = 30; db.company.exit_fee = 10; db.company.exit_free = ["CAP"]; db.company.capacity = 40; db.dash = dashData(); db.dash.exit = dashExit();
      db.staff.push({ id: "s3", name: "TERRY JONES", role: "terminal", active: true }, { id: "s4", name: "ALI KHAN", role: "bongo", active: true }, { id: "s5", name: "OLD DRIVER", role: "bongo", active: false });
      db.seen = [{ id: "s2", seen_at: new Date(Date.now() - 120000).toISOString() }, { id: "s3", seen_at: new Date(Date.now() - 3 * 3600000).toISOString() }, { id: "s4", acted_at: new Date(Date.now() - 2 * 86400000).toISOString() }];
      db.activity = [{ at: new Date(Date.now() - 600000).toISOString(), action: "SENT", value: "", reg: "KL12PQR", staff_id: "s2", booking_id: "w6" }, { at: new Date(Date.now() - 3600000).toISOString(), action: "CALLED", value: "", reg: "CD34EFG", staff_id: "s2", booking_id: "w2" }];
      const page = await phone(browser, db, { width }); await page.setViewportSize({ width, height });
      const snap = async (n) => { await sleep(600); const h = Math.min(2600, await page.evaluate(() => Math.max(document.documentElement.scrollHeight, innerHeight))); await page.setViewportSize({ width, height: h }); await sleep(250); await page.screenshot({ path: path.join(dir, name + "-" + n + ".png") }); await page.setViewportSize({ width, height }); };
      const menu = async () => { await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300); };
      await open(page); await sleep(400);
      await menu(); if (want("menu")) await page.screenshot({ path: path.join(dir, name + "-menu.png") });
      for (const v of ["stats", "summary", "dashboard", "import", "archive", "staff", "settings", "me"]) { if (!want(v)) continue; if (!(await page.$("#menu[open]"))) await menu(); const b = await page.$('#menuBody [data-view="' + v + '"]'); if (!b) continue; await b.click(); await snap(v);
        if (v === "import" && await page.$("[data-autopreview]")) { await page.click("[data-autopreview]"); await sleep(800); await snap("import-checked"); }
        if (v === "archive") { await page.fill("#archQ", "CD34"); await page.click("#archGo"); await snap("archive-found"); } }
      if (await page.$("#menu[open]")) await page.keyboard.press("Escape");
      await page.click("#bnBoard"); await sleep(300);
      if (want("car")) { await page.click('.row[data-id="w6"] .reg'); await sleep(500); await page.screenshot({ path: path.join(dir, name + "-car.png") }); await page.keyboard.press("Escape"); await sleep(300); }
      if (want("removed")) { await menu(); await page.click("#menuBody [data-removedlist]"); await sleep(600); await page.screenshot({ path: path.join(dir, name + "-removed.png") }); await page.keyboard.press("Escape"); await sleep(300); }
      if (want("tutorials")) { await menu(); await page.click("#menuBody [data-tutorials]"); await sleep(600); await page.screenshot({ path: path.join(dir, name + "-tutorials.png") }); await page.keyboard.press("Escape"); await sleep(300); }
      await page.context().close();
    }
    return;
  }
  // SHOTS_ONLY=flightcol: the DROPS board's Flight and Status columns, desktop, tablet and phone, and the flight opened from the row (sample data only).
  if (process.env.SHOTS_ONLY === "flightcol") {
    for (const [width, height, name] of [[1440, 900, "desktop"], [1024, 900, "tablet"], [390, 844, "phone"]]) {
      const page = await phone(browser, deskDb(), { width }); await page.setViewportSize({ width, height });
      await open(page); await sleep(500); await page.click("#tabAll"); await sleep(400);
      await page.screenshot({ path: path.join(dir, "drops-" + name + ".png") });
      if (name === "desktop" && await page.locator('.row[data-id="w2"] .flno').count()) {
        await page.click('.row[data-id="w2"] .flno'); await sleep(800); await page.screenshot({ path: path.join(dir, "flight-edit-desktop.png") });
      }
      await page.context().close();
    }
    return;
  }
  // SHOTS_ONLY=desk: the Operations board and Flights on a desktop, a tablet and a phone (sample data only).
  if (process.env.SHOTS_ONLY === "desk") {
    for (const [width, height, name] of [[1440, 1000, "desktop"], [1024, 900, "tablet"], [390, 844, "phone"]]) {
      const db = deskDb(process.env.SHOTS_THEME || "ops");
      const page = await phone(browser, db, { width }); await page.setViewportSize({ width, height });
      await open(page); await sleep(500);
      await page.screenshot({ path: path.join(dir, "board-" + name + ".png") });
      await page.click("#tabAll"); await sleep(300);
      await page.setViewportSize({ width, height: Math.min(2600, await page.evaluate(() => document.documentElement.scrollHeight)) }); await sleep(300);
      await page.screenshot({ path: path.join(dir, "board-" + name + "-all.png") }); await page.setViewportSize({ width, height });
      await page.click('#bnav [data-bn="flBtn"]'); await sleep(600);
      await page.setViewportSize({ width, height: Math.min(2600, await page.evaluate(() => document.documentElement.scrollHeight)) }); await sleep(300);
      await page.screenshot({ path: path.join(dir, "flights-" + name + ".png") });
      if (name === "desktop") {
        await page.setViewportSize({ width, height });
        await page.fill("#flQ", "zz99"); await sleep(200); await page.screenshot({ path: path.join(dir, "flights-desktop-nomatch.png") }); await page.fill("#flQ", "");
        await page.click("#bnBoard"); await sleep(300); await page.fill("#q", "ZZ99ZZZ"); await sleep(400); await page.screenshot({ path: path.join(dir, "board-desktop-nomatch.png") }); await page.fill("#q", ""); await sleep(300);
        await page.click('.row[data-id="w2"] .reg'); await sleep(500); await page.screenshot({ path: path.join(dir, "car-desktop.png") }); await page.keyboard.press("Escape"); await sleep(300);
        await page.click('#bnav [data-bn="menuBtn"]'); await sleep(400); await page.screenshot({ path: path.join(dir, "menu-desktop.png") }); await page.keyboard.press("Escape"); await sleep(300);
        await page.click('#kindBar [data-kind="picks"]'); await sleep(600); await page.screenshot({ path: path.join(dir, "picks-desktop.png") });
        await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await sleep(200); await page.screenshot({ path: path.join(dir, "picks-desktop-end.png") });
        await page.setViewportSize({ width: 1024, height: 800 }); await sleep(400); await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(dir, "picks-tablet.png") });
        await page.setViewportSize({ width: 390, height: 844 }); await sleep(400); await page.screenshot({ path: path.join(dir, "picks-phone.png") });
      }
      await page.context().close();
    }
    return;
  }
  // SHOTS_ONLY=dash: the dashboard on the Operations look, Airport Parking Bay and TakeOff, phone and desktop.
  if (process.env.SHOTS_ONLY === "dash") {
    for (const who of ["parkingbay", "takeoff"]) {
      const db = makeDb(); db.company.brand = who === "takeoff" ? { colour: "#F9A01B", ink: "#1A1A1A", short: "TakeOff", theme: "ops" } : { colour: "#1560BD", ink: "#FFFFFF", soft: "#E8F0FB", text: "#0E3F7E", short: "Parking Bay", theme: "ops", chrome: "#0E3F7E", mark: "P" };
      if (who === "parkingbay") { db.company.name = "Airport Parking Bay"; db.company.yards = ["GS", "MY", "T"]; }
      db.company.overstay_rate = 30; db.company.capacity = 40; db.dash = dashData(); dashSheets(db);
      if (who === "parkingbay") { db.company.exit_fee = 10; db.dash.exit = dashExit(); db.dash.parked.yards[1].yard = "MY"; }
      for (const [width, height, name] of [[390, 844, "phone"], [1440, 1000, "desktop"]]) {
        const page = await phone(browser, db, { width }); await page.setViewportSize({ width, height });
        await open(page); await sleep(300);
        await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300);
        await page.click('#menuBody [data-view="dashboard"]'); await sleep(900);
        await page.setViewportSize({ width, height: await page.evaluate(() => document.documentElement.scrollHeight) }); await sleep(300);
        await page.screenshot({ path: path.join(dir, who + "-" + name + ".png") });
        await page.context().close();
      }
    }
    return;
  }
  // SHOTS_ONLY=exit: the exit fee on Airport Parking Bay's look (part 76).
  // SHOTS_ONLY=health: Clients and Clients → Health on the platform page (part 100), desktop and phone, sample data.
  if (process.env.SHOTS_ONLY === "health") {
    for (const [width, height, name] of [[1280, 900, "desktop"], [390, 844, "phone"]]) {
      const db = makeDb();
      db.clientCompany = db.company;
      db.company = { id: "c0", name: "Parking Ops", slug: "platform", yards: [], drops_day_end: "06:00:00", brand: {}, time_zone: "Europe/London" };
      db.me = { ...db.me, company_id: "c0", name: "Rakesh" };
      const page = await phone(browser, db, { width }); await page.setViewportSize({ width, height });
      await page.goto(BASE + "/"); await page.waitForSelector("[data-clientopen]", { timeout: 8000 }); await sleep(400);
      await page.screenshot({ path: path.join(dir, "clients-" + name + ".png") });
      await page.click(".hwarnline"); await page.waitForSelector("table.usage.health"); await sleep(300);
      await page.screenshot({ path: path.join(dir, "health-" + name + ".png") });
      await page.click("#panelBody details.herr summary"); await page.locator("#panelBody details.herr").scrollIntoViewIfNeeded(); await sleep(300);
      await page.screenshot({ path: path.join(dir, "health-errors-" + name + ".png") });
      await page.context().close();
    }
    return;
  }
  if (process.env.SHOTS_ONLY === "exit") {
    // apbDb is defined after the SHOTS exit, so it's built here.
    const apbDb = (theme) => { const d = makeDb(); d.company = { ...d.company, name: "Airport Parking Bay", slug: "airport-parking-bay", yards: ["GS", "MY", "T"],
      brand: { colour: "#1560BD", ink: "#FFFFFF", soft: "#E8F0FB", text: "#0E3F7E", short: "Parking Bay", theme, chrome: "#0E3F7E", mark: "P" } }; return d; };
    const db = apbDb(process.env.SHOTS_THEME || "premium"); db.company.exit_fee = 10; db.company.exit_free = ["CAP", "APD", "VIPAPB1147"];
    db.bookings.find((x) => x.id === "b1").ref = "CAP-18-554625"; db.bookings.find((x) => x.id === "b2").ref = "CPD-19-612731"; db.bookings.find((x) => x.id === "b3").ref = "FHR-1427016249";
    Object.assign(db.bookings.find((x) => x.id === "b3"), { exit_method: "cash", exit_amount: 10, exit_at: new Date().toISOString(), exit_by: "s2", exit_photo: "c1/docs/b3/x1.jpg" });
    const page = await phone(browser, db, { width: 390 });
    await page.route("**/object/sign/pt-photos/**", (route) => /token=t/.test(route.request().url()) ? route.fulfill({ path: path.join(ROOT, "icons/icon-512.png"), contentType: "image/png" }) : route.fallback());
    const snap = async (name) => { await sleep(400); await page.screenshot({ path: path.join(dir, name + ".png"), fullPage: true }); };
    await open(page); await snap("exit-drops");
    const car = async (id, name) => { await page.click('.row[data-id="' + id + '"] .reg'); await sleep(500); await page.locator("#panelBody .exitbox, #panelBody .det").last().scrollIntoViewIfNeeded(); await sleep(300); await page.screenshot({ path: path.join(dir, name + ".png") }); await page.keyboard.press("Escape"); await sleep(200); };
    await car("b2", "exit-car-due"); await car("b3", "exit-car-paid"); await car("b1", "exit-car-free");
    await page.click("#bnav [data-bn=menuBtn]"); await sleep(300); await page.click('#menuBody [data-view="settings"]'); await sleep(400);
    await page.locator("[data-saveexit]").scrollIntoViewIfNeeded(); await sleep(300); await page.screenshot({ path: path.join(dir, "exit-settings.png") });
    await page.context().close();
    return;
  }
  // SHOTS_ONLY=bnav: the end of a long DROPS list above the bottom bar, on an
  // iPhone (390) and an Android (412) sized phone; SHOTS_ZOOM=1.3 shows it zoomed in.
  if (process.env.SHOTS_ONLY === "bnav") {
    for (const [width, height, name] of [[390, 844, "iphone"], [412, 915, "android"]]) {
      const db = makeDb(); db.company.brand = { colour: "#F9A01B", ink: "#1A1A1A", short: "TakeOff", theme: process.env.SHOTS_THEME || "ops" };
      for (let i = 0; i < 30; i++) db.bookings.push({ id: "x" + i, sheet_id: "d0", kind: "drops", ref: "X" + i, reg: "KN25NT" + String.fromCharCode(65 + i % 26), num: 40 + i, name: "MCANENY MRS", make: "BMW", flight: "EZY2338", return_at: iso(TONIGHT, "23:" + String(10 + i).padStart(2, "0")), note: "" });
      const page = await phone(browser, db, { width, touch: true }); await page.setViewportSize({ width, height });
      await open(page);
      const zoom = Number(process.env.SHOTS_ZOOM || 0);
      if (zoom) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: zoom }); }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(500);
      const m = await page.evaluate(() => { const rows = document.querySelectorAll("#main .row"), last = rows[rows.length - 1].getBoundingClientRect(), nav = document.getElementById("bnav").getBoundingClientRect(); return { lastBottom: Math.round(last.bottom), navTop: Math.round(nav.top), navBottom: Math.round(nav.bottom), vv: Math.round(visualViewport.height), scale: visualViewport.scale }; });
      console.log(name, JSON.stringify(m));
      await page.screenshot({ path: path.join(dir, "bottom-" + name + (zoom ? "-zoomed" : "") + ".png") });
      await page.context().close();
    }
    return;
  }
  // SHOTS_ONLY=keysdesk: the key check with flight, customer and yard picker at desktop, tablet and phone width.
  if (process.env.SHOTS_ONLY === "keysdesk") {
    for (const [width, height, name] of [[1440, 1000, "desktop"], [1024, 900, "tablet"], [390, 1000, "phone"]]) {
      const db = keysDb(process.env.SHOTS_THEME || "ops"), makes = ["KIA NIRO GREY", "TOYOTA COROLLA ICON", "CITROEN DS3 RED", "VAUXHALL ZAFIRA BLACK"];
      db.bookings.forEach((b, i) => { b.make = makes[i % makes.length]; });
      const page = await phone(browser, db, { width }); await page.setViewportSize({ width, height });
      await open(page); await page.click("#keyBtn"); await page.waitForSelector("[data-keystart]"); await page.click("[data-keystart]"); await page.waitForSelector(".kc-row");
      for (const id of ["k3", "k5"]) await page.click('.row[data-id="' + id + '"] .kbox');
      await sleep(500); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(dir, "keycheck-" + name + ".png") });
      await page.context().close();
    }
    return;
  }
  // SHOTS_ONLY=keys: key check on TakeOff's board.
  if (process.env.SHOTS_ONLY === "keys") {
    const page = await phone(browser, keysDb(process.env.SHOTS_THEME || "ops"), { width: 390 }); await page.setViewportSize({ width: 390, height: 1000 });
    const snap = async (name) => { await sleep(400); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(dir, name + ".png") }); };
    await open(page); await snap("keys-off");
    await page.click("#keyBtn"); await page.waitForSelector("[data-keystart]"); await page.click("[data-keystart]"); await page.waitForSelector(".kc-row"); await snap("keys-on");
    for (const id of ["k3", "k5", "k6", "k8", "k11"]) await page.click('.row[data-id="' + id + '"] .kbox');
    await snap("keys-some-ticked");
    await page.click("#keyBtn"); await snap("keys-k-off-still-grey"); await page.click("#keyBtn");
    await page.setViewportSize({ width: 1280, height: 900 }); await snap("keys-desktop");
    await page.context().close();
    return;
  }
  // SHOTS_ONLY=flight: the return flight typed on a PICKS car (part 78), TakeOff's look.
  if (process.env.SHOTS_ONLY === "flight") {
    const db = makeDb(); db.company.brand = { colour: "#F9A01B", ink: "#1A1A1A", short: "TakeOff", theme: process.env.SHOTS_THEME || "stdplus" };
    const page = await phone(browser, db, { width: 390 });
    const snap = async (name) => { await sleep(400); await page.screenshot({ path: path.join(dir, name + ".png") }); };
    await open(page); await pickKind(page, "picks");
    await page.click('.row[data-id="p1"] .reg'); await sleep(500); await page.fill("#pickFlightText", "LS1234");
    await page.locator("#pickFlightText").scrollIntoViewIfNeeded(); await snap("flight-picks-car");
    await page.click("[data-savepanel]"); await sleep(600); await snap("flight-picks-row");
    await page.context().close();
    return;
  }
  // SHOTS_ONLY=yards: yard colours on Airport Parking Bay's look (part 77).
  if (process.env.SHOTS_ONLY === "yards") {
    const d = makeDb(); d.company = { ...d.company, name: "Airport Parking Bay", slug: "airport-parking-bay", yards: ["GS", "MY", "T"], yard_colours: { MY: "#2E7D32", GS: "#EF6C00", T: "#FBC02D" },
      brand: { colour: "#1560BD", ink: "#FFFFFF", soft: "#E8F0FB", text: "#0E3F7E", short: "Parking Bay", theme: process.env.SHOTS_THEME || "ops", chrome: "#0E3F7E", mark: "P", picks_yard: true } };
    const ys = ["MY", "GS", "T", "MY", "GS", "MY"];
    d.bookings.filter((x) => x.kind === "drops").forEach((x, i) => { x.yard = ys[i % ys.length]; });
    d.bookings.filter((x) => x.kind === "picks").forEach((x, i) => { if (i < 4) { x.intake = "Collected"; x.yard = ys[i]; } });
    const page = await phone(browser, d, { width: 390 });
    const snap = async (name) => { await sleep(400); await page.screenshot({ path: path.join(dir, name + ".png") }); };
    await open(page); await snap("yards-drops");
    await page.click('.row[data-id="b1"] .reg'); await sleep(500); await page.locator("#panelBody [data-setyard]").first().scrollIntoViewIfNeeded(); await snap("yards-car");
    await page.click("#panelBody [data-close]"); await sleep(300);
    if (await page.locator("#kindBar [data-kind=picks]:visible").count()) await page.click("#kindBar [data-kind=picks]"); else if (await page.locator("#kindSeg:not(.hidden)").count()) await page.click("#kindSeg [data-kind=picks]"); else await page.selectOption("#sheetPick", "p0");
    await snap("yards-picks");
    await page.click("#bnav [data-bn=menuBtn]"); await sleep(300); await page.click('#menuBody [data-view="settings"]'); await sleep(400);
    await page.locator("[data-saveycol]").scrollIntoViewIfNeeded(); await snap("yards-settings");
    await page.context().close();
    return;
  }
  const toDb = () => { const db = makeDb(); db.company.brand = { colour: "#F9A01B", ink: "#1A1A1A", short: "TakeOff", theme: process.env.SHOTS_THEME || "ops" }; db.bookings.find((b) => b.id === "p3").intake = "Collected"; return db; };
  for (const width of [390, 1280]) {
    const page = await phone(browser, toDb(), { width });
    await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
    const snap = async (name) => { await sleep(350); await page.screenshot({ path: path.join(dir, name + "-" + width + ".png"), fullPage: true }); };
    await open(page); await snap("drops");
    await pickKind(page, "picks"); await snap("picks");
    await pickKind(page, "drops");
    await page.click('#bnav [data-bn="menuBtn"]'); await sleep(300); await page.screenshot({ path: path.join(dir, "menu-board-" + width + ".png") }); await page.click('#bnav [data-bn="menuBtn"]', { force: true }).catch(() => {}); await page.keyboard.press("Escape"); await sleep(200);
    await page.locator("#main .row .reg").first().click(); await sleep(300); await page.screenshot({ path: path.join(dir, "car-" + width + ".png") }); await page.keyboard.press("Escape"); await sleep(200);
    for (const [bn, name] of [["logBtn", "summary"], ["flBtn", "flights"], ["psBtn", "stats"]]) { await page.click('#bnav [data-bn="' + bn + '"]'); await snap(name); await page.keyboard.press("Escape"); await sleep(150); }
    await page.click('#bnav [data-bn="menuBtn"]'); await sleep(300); await page.screenshot({ path: path.join(dir, "menu-" + width + ".png") });
    for (const v of ["settings", "staff", "dashboard"]) { if (!(await page.locator("#menu").evaluate((m) => m.open))) await page.click('#bnav [data-bn="menuBtn"]'); await sleep(200); await page.click('#menuBody [data-view="' + v + '"]'); await snap(v); if (v === "staff" && (await page.locator("#main .ops-dd summary").count())) { await page.click("#main .ops-dd summary"); await page.screenshot({ path: path.join(dir, "staff-actions-" + width + ".png") }); await page.keyboard.press("Escape"); } }
    // EARLY RETURN from a PICKS car (part 74), then the car on tonight's DROPS.
    await open(page); await pickKind(page, "picks");
    await page.click('.row[data-id="p3"] .reg'); await sleep(300);
    const night = addDays(TONIGHT, 3); await page.locator("#earlyDay").fill(night); await page.locator("#earlyDay").dispatchEvent("change"); await sleep(200);
    await page.locator("#earlyTo").scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(dir, "picks-early-" + width + ".png") });
    await page.click("[data-pearly]"); await sleep(1500); await snap("drops-early");
    await page.context().close();
  }
}
