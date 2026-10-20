import { path, check, cspBlocked, sleep, BASE, TONIGHT, iso, makeDb, now, R2, phone, open, text, noSideScroll, scenario, browser, failed } from "../harness.mjs";

// 7. PT three ways
// A phone that refuses createImageBitmap (like the iPhone did): copies still small.
async function ptNoBitmap() {
  const { db, page } = await ptRun("photos", 3, { noBitmap: true });
  await page.click("[data-ptreg]"); await sleep(700);
  await page.click("[data-ptshare]"); await sleep(2500);
  check("PT on a phone that refuses createImageBitmap: sharing works, copies made small (marked 3601)", (await page.evaluate(() => window.__shares.length)) >= 1 && (db.uploadMarks || []).length === 3 && db.uploadMarks.every((m) => m === "3601"), db.uploadMarks);
}
async function ptRun(method, shots, opts = {}) {
  const db = makeDb({ ptMethod: method, ptMethodIos: opts.ios, ptStore: opts.store }), page = await phone(browser, db, opts);
  await open(page);
  await page.selectOption("#sheetPick", "p0"); await sleep(700);
  await page.click('.row[data-id="p1"] [data-pt]');
  await page.waitForFunction(() => document.getElementById("camVideo") && document.getElementById("camVideo").videoWidth > 0, null, { timeout: 8000 });
  for (let i = 0; i < shots; i++) await page.click("[data-shutter]");
  await sleep(500); await page.click("[data-camdone]");
  // Each tap keeps the sharpest of a few frames, so Done waits for the last ones.
  await page.waitForFunction(() => !document.getElementById("camVideo"), null, { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  return { db, page };
}
await scenario(async () => {
  const { db, page } = await ptRun("photos", 12);
  check("PT (photos): the camera took 12 photos", await page.locator(".ptthumbs img").count() === 12);
  check("PT (photos): no sideways scrolling on the PT screen", await noSideScroll(page));
  await sleep(1500);
  check("PT (photos): no copy is made while PT's photos are still to send", db.uploads.length === 0, db.uploads.length);
  await page.click("[data-ptreg]"); await sleep(700);
  await page.click("[data-ptshare]"); await sleep(500);
  await page.click("[data-ptshare]"); await sleep(800);
  const sh = await page.evaluate(() => window.__shares);
  check("PT (photos): photos go 10 then 2, as photos only (no text)", sh.length === 2 && sh[0].n === 10 && sh[1].n === 2 && !sh[0].text, sh);
  check("PT (photos): PT gets ticked", db.calls.some((c) => c.fn === "tap_pick" && c.args.p_key === "pt"));
  await sleep(1500);
  const nums = db.uploads.map((u) => +u.match(/(\d+)\.jpg$/)[1]).sort((a, b) => a - b);
  check("PT (photos): the app keeps 10 of the 12, first to last, saved as one set", db.uploads.length === 10 && nums[0] === 1 && nums[9] === 12 && db.ptLinks.length === 1 && db.ptLinks[0].paths.length === 10, { up: nums, links: db.ptLinks.map((l) => l.paths.length) });
  check("PT (photos): the copies are made small (marked 3600)", (db.uploadMarks || []).length === 10 && db.uploadMarks.every((m) => m === "3600"), db.uploadMarks);
  check("PT (photos): no errors", page.__errors.length === 0, page.__errors);
});
await scenario(ptNoBitmap);
// Copies in Cloudflare R2: every photo, small, after PT's photos are sent.
await scenario(async () => {
  const { db, page } = await ptRun("photos", 12, { store: "r2" });
  await sleep(1500);
  check("PT (R2): no copy is made while PT's photos are still to send", !(db.r2Puts || []).length && !(db.r2Asks || []).length && !db.uploads.length);
  await page.click("[data-ptreg]"); await sleep(700);
  await page.click("[data-ptshare]"); await sleep(500);
  await page.click("[data-ptshare]"); await sleep(3000);
  const puts = db.r2Puts || [], nums = puts.map((x) => +x.key.match(/(\d+)\.jpg$/)[1]).sort((a, b) => a - b);
  check("PT (R2): all 12 photos go to Cloudflare, none to Supabase's store", puts.length === 12 && nums.join() === "1,2,3,4,5,6,7,8,9,10,11,12" && db.uploads.length === 0, { puts: nums, sb: db.uploads.length });
  check("PT (R2): upload addresses asked for once for the car, signed in", (db.r2Asks || []).length === 1 && db.r2Asks[0].action === "upload" && db.r2Asks[0].booking === "p1" && db.r2Asks[0].names.length === 12 && /^Bearer /.test(db.r2Asks[0].auth), db.r2Asks);
  check("PT (R2): copies are JPEGs made smaller than PT's photos", puts.every((x) => x.type === "image/jpeg" && x.size > 0 && x.size < 400000), puts.map((x) => x.size));
  const l = db.ptLinks[0] || { paths: [] };
  check("PT (R2): saved as one set of 12, each marked r2:", db.ptLinks.length === 1 && l.paths.length === 12 && l.paths.every((x) => /^r2:c1\/p1\/[A-Za-z0-9_-]+\/\d\d\.jpg$/.test(x)), l.paths);
  check("PT (R2): the browser's security rules let the uploads through", !cspBlocked.length, cspBlocked);
  check("PT (R2): no errors", page.__errors.length === 0, page.__errors);
  // The car's panel lists the set.
  await page.click('.row[data-id="p1"] .reg'); await sleep(800);
  check("PT (R2): the car's panel shows the 12 photos", /12 photos/.test(await text(page, "#ptPhotos")), await text(page, "#ptPhotos"));
});
// The car's panel shows its history: who did what, and when.
await scenario(async () => {
  const db = makeDb();
  db.activity = [
    { at: iso(TONIGHT, "07:57"), action: "RETURN CHANGED", value: "was 28 Sep 17:00, now 02 Oct 17:00 (changed by hand)", staff_name: "OFFICE", booking_id: "b1" },
    { at: iso(TONIGHT, "07:58"), action: "NOTE", value: "<img src=x onerror=alert(1)>RTN DATE", staff_name: "SAM", booking_id: "b1" },
    { at: iso(TONIGHT, "06:00"), action: "YARD", value: "NB", staff_name: "WASIM", booking_id: "b2" },
  ];
  const page = await phone(browser, db);
  await open(page);
  await page.click('.row[data-id="b1"] .reg'); await sleep(800);
  const h = await text(page, "#carHist");
  check("car history: shows who did what, newest first", /HISTORY/.test(h) && /SAM · NOTE/.test(h) && /OFFICE · RETURN CHANGED/.test(h) && h.indexOf("SAM") < h.indexOf("OFFICE") && /changed by hand/.test(h), h);
  check("car history: only this car's entries", !/WASIM/.test(h));
  check("car history: notes are shown as text, never run", /<img src=x/.test(h) && page.__errors.length === 0, page.__errors);
});
// The PT checklist on the camera screen: shown, folds away, remembered.
await scenario(async () => {
  const db = makeDb({ ptMethod: "pdf" }), page = await phone(browser, db);
  await open(page);
  await page.selectOption("#sheetPick", "p0"); await sleep(700);
  await page.click('.row[data-id="p1"] [data-pt]');
  await page.waitForFunction(() => document.getElementById("camVideo") && document.getElementById("camVideo").videoWidth > 0, null, { timeout: 8000 });
  const tips = await text(page, "#camTips");
  check("camera: the PT checklist is shown", /PT checklist/.test(tips) && /Crouch to door height/.test(tips) && /Close-up of every mark/.test(tips), tips);
  await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + "/cam-tips.png" : "/dev/null" }).catch(() => {});
  await page.click('[data-camtips="off"]'); await sleep(300);
  check("camera: ✕ folds the checklist to a small button", await page.locator("#camTips").count() === 0 && await page.locator('[data-camtips="on"]').count() === 1);
  await page.click("[data-shutter]"); await sleep(600);
  await page.click("[data-camdone]"); await sleep(1500);
  await page.click("[data-close]").catch(() => {}); await sleep(300);
  await page.click('.row[data-id="p1"] [data-pt]').catch(() => {}); await sleep(300);
  await page.click("[data-ptcam]").catch(() => {});
  await page.waitForFunction(() => document.getElementById("camVideo") && document.getElementById("camVideo").videoWidth > 0, null, { timeout: 8000 }).catch(() => {});
  check("camera: stays folded next time (remembered)", await page.locator("#camTips").count() === 0 && await page.locator('[data-camtips="on"]').count() === 1);
  await page.click('[data-camtips="on"]'); await sleep(300);
  check("camera: the button opens it again", await page.locator("#camTips").count() === 1);
  check("camera: no errors", page.__errors.length === 0, page.__errors);
});
// Android: real photos from the camera, with the sharpest-frame way to fall back on.
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
await scenario(async () => {
  const { page } = await ptRun("photos", 3, { ua: ANDROID, still: "ok" });
  check("PT (Android): real photos are off (they crashed phones), each tap still kept", await page.evaluate(() => window.__stills) === 0 && await page.locator(".ptthumbs img").count() === 3);
  check("PT (Android): no errors", page.__errors.length === 0, page.__errors);
});
await scenario(async () => {
  const { page } = await ptRun("photos", 2, { ua: ANDROID, still: "side" });
  const dims = await page.evaluate(() => [...document.querySelectorAll(".ptthumbs img")].map((i) => [i.naturalWidth, i.naturalHeight]));
  check("PT (Android): photos come out the right way round", dims.length === 2 && dims.every(([w, h]) => w > h), dims);
});
await scenario(async () => {
  const { db, page } = await ptRun("photos", 4, { ua: ANDROID, still: "fail" });
  check("PT (Android): a camera that won't take photos falls back, every tap still kept", await page.locator(".ptthumbs img").count() === 4);
  check("PT (Android): the camera is never asked for a real photo", await page.evaluate(() => window.__stills) === 0, await page.evaluate(() => window.__stills));
});
// Separate ways: photos on Android, PDF on iPhones.
await scenario(async () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const { page } = await ptRun("photos", 2, { ios: "pdf", ua: IPHONE });
  await page.waitForSelector("[data-ptpdf]", { timeout: 8000 });
  check("PT (iPhone): uses the iPhone choice (PDF), not Android's (photos)", await page.locator("[data-ptpdf]").count() === 1 && await page.locator("[data-ptreg]").count() === 0);
});
await scenario(async () => {
  const { page } = await ptRun("photos", 2, { ios: "pdf" });
  await sleep(1500);
  check("PT (Android): uses the Android choice (photos)", await page.locator("[data-ptreg]").count() === 1 && await page.locator("[data-ptpdf]").count() === 0);
});
// The iPhone way (no createImageBitmap) with R2: sharing still works, copies still small.
await scenario(async () => {
  const { db, page } = await ptRun("photos", 3, { store: "r2", noBitmap: true });
  await page.click("[data-ptreg]"); await sleep(700);
  await page.click("[data-ptshare]"); await sleep(2500);
  const puts = db.r2Puts || [];
  check("PT (R2, iPhone-like): sharing works and 3 small copies go to Cloudflare", (await page.evaluate(() => window.__shares.length)) >= 1 && puts.length === 3 && puts.every((x) => x.size < 120000) && db.ptLinks.length === 1, puts);
  check("PT (R2, iPhone-like): PT ticked, no errors", db.calls.some((c) => c.fn === "tap_pick" && c.args.p_key === "pt") && page.__errors.length === 0, page.__errors);
});
// The switch reaches a phone that's already open (no reload): read again when PT starts.
await scenario(async () => {
  const db = makeDb(), page = await phone(browser, db);
  await open(page);
  await page.selectOption("#sheetPick", "p0"); await sleep(700);
  db.company.pt_copy_store = "r2";
  await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 120000; });
  await page.click('.row[data-id="p1"] [data-pt]');
  await page.waitForFunction(() => document.getElementById("camVideo") && document.getElementById("camVideo").videoWidth > 0, null, { timeout: 8000 });
  for (let i = 0; i < 3; i++) await page.click("[data-shutter]");
  await sleep(500); await page.click("[data-camdone]"); await sleep(1500);
  await page.click("[data-ptreg]"); await sleep(700);
  await page.click("[data-ptshare]"); await sleep(2500);
  check("switching the copies to Cloudflare reaches an open phone without a reload", (db.r2Puts || []).length === 3 && db.uploads.length === 0, { r2: (db.r2Puts || []).length, sb: db.uploads.length });
});
// Staff screen: only the buttons the server would allow.
async function staffScreen(role) {
  const db = makeDb();
  db.me.role = role; db.me.id = "s2"; db.me.name = "SUGU";
  db.staff = [{ id: "s1", name: "RAKESH", role: "owner", active: true }, { id: "s2", name: "SUGU", role, active: true },
    { id: "s3", name: "MANNY", role: "manager", active: true }, { id: "s4", name: "BONGO BOB", role: "bongo", active: true }];
  const page = await phone(browser, db);
  await open(page);
  await page.click("#menuBtn"); await sleep(300);
  await page.click('#menuBody [data-view="staff"]'); await sleep(500);
  const btns = async (id) => page.locator(`[data-reset="${id}"], [data-onoff="${id}"]`).count();
  return { page, owner: await btns("s1"), manager: await btns("s3"), bongo: await btns("s4"), me: await btns("s2") };
}
await scenario(async () => {
  const o = await staffScreen("office");
  check("staff (office): can give a bongo a new link or switch them off", o.bongo === 2, o);
  check("staff (office): no New link / Switch off on the owner or a manager", o.owner === 0 && o.manager === 0, o);
  check("staff (office): not on their own name either", o.me === 0, o);
  check("staff screen: no errors, no sideways scrolling", o.page.__errors.length === 0 && await noSideScroll(o.page), o.page.__errors);
});
await scenario(async () => {
  const m = await staffScreen("manager");
  check("staff (manager): buttons on a bongo, not on the owner", m.bongo === 2 && m.owner === 0, m);
});
// "Tick PT without sending photos" is reported, so a car with no copy has a reason.
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db);
  await open(page);
  await page.selectOption("#sheetPick", "p0"); await sleep(700);
  await page.click('.row[data-id="p2"] [data-pt]');
  await page.waitForSelector("[data-camdone]", { timeout: 8000 }); await sleep(400);
  await page.click("[data-camdone]"); await page.waitForSelector("[data-ptmark]", { timeout: 5000 });
  await page.click("[data-ptmark]");
  await sleep(500);
  const ask = await text(page, "#panelBody");
  check("PT without photos: asks first (open camera, or a reason), not ticked yet", /No photos in the app/.test(ask) && await page.locator("[data-ptcamgo]").count() === 1 &&
    await page.locator("[data-ptwhy]").count() === 4 && !db.calls.some((c) => c.fn === "tap_pick" && c.args.p_booking === "p2" && c.args.p_key === "pt"), ask);
  await page.click('[data-ptwhy="Camera not working"]'); await sleep(800);
  const hasBtn = await page.locator("[data-ptmark]").count();
  check("PT ticked without photos: ticked, and the reason reported", db.calls.some((c) => c.fn === "tap_pick" && c.args.p_booking === "p2" && c.args.p_key === "pt") &&
    (db.reports || []).some((x) => x.p_booking === "p2" && /ticked without photos in the app: Camera not working/.test(x.p_detail)), { hasBtn, reports: db.reports, taps: db.calls.filter((c) => c.fn === "tap_pick").map((c) => c.args) });
});
// Photos taken in the app, then "Tick PT without sending": no question, the copy is still saved.
await scenario(async () => {
  const { db, page } = await ptRun("photos", 2);
  await page.click("[data-ptmark]"); await sleep(3000);
  check("PT tick without sending, photos taken: ticked, no reason asked", db.calls.some((c) => c.fn === "tap_pick" && c.args.p_booking === "p1" && c.args.p_key === "pt") && await page.locator("[data-ptwhy]").count() === 0);
  check("PT tick without sending, photos taken: the app still saves its copy", db.ptLinks.length === 1 && db.ptLinks[0].paths.length === 2, db.ptLinks.map((l) => l.paths.length));
});
// The office sees PT NOT SAVED on a car whose PT photos aren't in the app.
await scenario(async () => {
  const db = makeDb(); db.bookings.find((x) => x.id === "p1").pt_at = new Date(Date.now() - 3 * 3600000).toISOString(); db.ptUnsaved = ["p1"];
  const page = await phone(browser, db);
  await open(page);
  await page.selectOption("#sheetPick", "p0"); await sleep(1000);
  check("office: PT NOT SAVED shows on the car's row", /PT NOT SAVED/.test(await text(page, '.row[data-id="p1"]')) && !/PT NOT SAVED/.test(await text(page, '.row[data-id="p2"]')));
});
// Cloudflare's side down: PT itself is untouched, nothing crashes.
await scenario(async () => {
  const { db, page } = await ptRun("photos", 3, { store: "r2" });
  db.r2Down = true;
  await page.click("[data-ptreg]"); await sleep(700);
  await page.click("[data-ptshare]"); await sleep(2500);
  check("PT (R2 down): sharing and the PT tick still work", (await page.evaluate(() => window.__shares.length)) >= 1 && db.calls.some((c) => c.fn === "tap_pick" && c.args.p_key === "pt"));
  check("PT (R2 down): no copies saved, no errors", db.ptLinks.length === 0 && !(db.r2Puts || []).length && page.__errors.length === 0, page.__errors);
  await sleep(30000);   // three tries (5 s, then 15 s): the office is told it's late
  const rep = (db.reports || []).find((x) => x.p_booking === "p1");
  check("PT (R2 down): the phone reports it's still trying, and why", !!rep && /copy delayed, still trying: Photo store not set up yet/.test(rep.p_detail) && /Android|computer|iPhone/.test(rep.p_detail), db.reports);
  check("PT (R2 down): no 'copy failed' yet, it hasn't given up", !(db.reports || []).some((x) => /copy failed/.test(x.p_detail)), db.reports);
  // The connection comes back: it tries again at once and the set is saved.
  db.r2Down = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online"))); await sleep(6000);
  check("PT (R2 down): connection back, photos saved without reopening the app", db.ptLinks.length === 1 && db.ptLinks[0].paths.length === 3, db.ptLinks.map((l) => l.paths.length));
});
await scenario(async () => {
  // Parking Ops: open a client's board, see Usage, and come back.
  const db = makeDb();
  db.clientCompany = db.company;
  db.company = { id: "c0", name: "Parking Ops", slug: "platform", yards: [], drops_day_end: "06:00:00", brand: {}, time_zone: "Europe/London" };
  db.me = { ...db.me, company_id: "c0" };
  const page = await phone(browser, db);
  await page.goto(BASE + "/"); await page.waitForSelector("[data-clientopen]", { timeout: 8000 });
  check("Parking Ops: no CONNECTING on the Clients page", (await page.textContent("#sync")) === "");
  check("Parking Ops: each client has Open board", await page.locator('[data-clientopen="c1"]').count() === 1);
  await page.click("[data-usage]"); await page.waitForSelector("table.usage", { timeout: 5000 });
  const use = await page.textContent("#panelBody");
  check("Parking Ops: Usage shows the database, PT photos, FR24 and AeroDataBox", /24\.5 MB of 8 GB/.test(use) && /134 \/ 4277/.test(use) && /46 · about 1,794 credits/.test(use) && /AeroDataBox now\s*working/.test(use), use.slice(0, 400));
  await page.click("#panelBody [data-close]");
  check("Parking Ops: each client card says which look it has", /Standard/.test(await text(page, ".client")));
  await page.click('[data-clientedit="c1"]'); await page.waitForSelector("#clLook");
  check("Parking Ops: the client editor offers the seven looks", (await page.locator("#clLook option").allInnerTexts()).join("|") === "Standard|Airport Parking Bay UI|Cards (light and dark)|Premium UI|Premium Board|Standard with features|Operations");
  await page.selectOption("#clLook", "premium"); await page.click("#clGo"); await sleep(400);
  check("Parking Ops: choosing Premium UI saves theme premium", (db.clientSaves || []).some((x) => x.id === "c1" && x.brand.theme === "premium"), db.clientSaves);
  await page.click('[data-clientedit="c1"]'); await page.waitForSelector("#clLook");
  await page.selectOption("#clLook", "board"); await page.click("#clGo"); await sleep(400);
  check("Parking Ops: choosing Premium Board saves theme board", (db.clientSaves || []).some((x) => x.id === "c1" && x.brand.theme === "board"), db.clientSaves);
  await page.click('[data-clientedit="c1"]'); await page.waitForSelector("#clLook");
  await page.selectOption("#clLook", "stdplus"); await page.click("#clGo"); await sleep(400);
  check("Parking Ops: choosing Standard with features saves theme stdplus", (db.clientSaves || []).some((x) => x.id === "c1" && x.brand.theme === "stdplus"), db.clientSaves);
  await page.click('[data-clientedit="c1"]'); await page.waitForSelector("#clLook");
  await page.selectOption("#clLook", "ops"); await page.click("#clGo"); await sleep(400);
  check("Parking Ops: choosing Operations saves theme ops", (db.clientSaves || []).some((x) => x.id === "c1" && x.brand.theme === "ops"), db.clientSaves);
  await page.click('[data-clientedit="c1"]'); await page.waitForSelector("#clLook");
  await page.selectOption("#clLook", "pro"); await page.click("#clGo"); await sleep(400);
  check("Parking Ops: choosing Airport Parking Bay UI saves theme pro", (db.clientSaves || []).some((x) => x.id === "c1" && x.brand.theme === "pro"), db.clientSaves);
  await page.click('[data-clientedit="c1"]'); await page.waitForSelector("#clPicksYard");
  check("Parking Ops: Location on PICKS is off until ticked", !(await page.isChecked("#clPicksYard")));
  await page.check("#clPicksYard"); await page.click("#clGo"); await sleep(400);
  check("Parking Ops: ticking Location on PICKS saves picks_yard on", db.clientSaves[db.clientSaves.length - 1].brand.picks_yard === true, db.clientSaves[db.clientSaves.length - 1]);
  await page.click('[data-clientedit="c1"]'); await page.waitForSelector("#clLook");
  await page.selectOption("#clLook", "cards"); await page.click("#clGo"); await sleep(400);
  check("Parking Ops: choosing Cards saves theme cards", (db.clientSaves || []).slice(-1)[0].brand.theme === "cards");
  await page.click('[data-clientedit="c1"]'); await page.waitForSelector("#clLook");
  await page.selectOption("#clLook", ""); await page.click("#clGo"); await sleep(400);
  check("Parking Ops: back to Standard saves no theme", (db.clientSaves || []).slice(-1)[0].brand.theme === "");
  await page.click('[data-clientopen="c1"]');
  await page.waitForSelector("#main .row", { timeout: 8000 });
  check("Parking Ops: Open board opens the client's board as their owner", (db.staffCalls || []).some((x) => x.action === "client_open" && x.company_id === "c1") && await page.locator('.row[data-id="b1"]').count() === 1);
  check("Parking Ops: the way back is in the top bar", await page.isVisible("#homeBtn"));
  db.company = { id: "c0", name: "Parking Ops", slug: "platform", yards: [], drops_day_end: "06:00:00", brand: {}, time_zone: "Europe/London" };
  db.me = { ...db.me, company_id: "c0", name: "RAKESH" };
  await page.click("#homeBtn");
  await page.waitForSelector("[data-clientopen]", { timeout: 8000 });
  check("Parking Ops: back on the Clients page, no way-back button left", !(await page.isVisible("#homeBtn")) && (await page.evaluate(() => localStorage.getItem("po_home"))) === null);
  check("Parking Ops: no errors", page.__errors.length === 0, page.__errors);
});
await scenario(async () => {
  const { db, page } = await ptRun("pdf", 8, { pdfLabels: true });
  await page.waitForSelector("[data-ptpdf]:not([disabled])", { timeout: 8000 });
  const labels = await page.evaluate(() => window.__pdfLabels);
  check("PT (PDF): while it's made, the button counts the photos (x of 8)", new Set(labels.filter((l) => /^Making the PDF… \d of 8$/.test(l))).size >= 3 && labels.every((l) => !/Making/.test(l) || /\d of 8$/.test(l)), labels);
  check("PT (PDF): only the PDF button is offered", await page.locator("[data-ptreg]").count() === 0);
  await page.click("[data-ptpdf]"); await sleep(800);
  const sh = await page.evaluate(() => window.__shares);
  check("PT (PDF): one share, one PDF named after the reg, reg as the message", sh.length === 1 && sh[0].n === 1 && sh[0].types[0] === "application/pdf" && /^DY16MYO-PT-8-photos\.pdf$/.test(sh[0].names[0]) && sh[0].text === "DY16MYO", sh);
  check("PT (PDF): PT gets ticked", db.calls.some((c) => c.fn === "tap_pick" && c.args.p_key === "pt"));
});
// Android's stuck toBlob: PT still finishes on its own, no switching apps needed.
await scenario(async () => {
  const { page } = await ptRun("pdf", 4, { stuckBlob: true });
  check("PT (toBlob never answers): Done still closes the camera with every photo", await page.locator("#camVideo").count() === 0 && await page.locator(".ptthumbs img").count() === 4, await page.locator(".ptthumbs img").count());
  await page.waitForSelector("[data-ptpdf]:not([disabled])", { timeout: 15000 }).catch(() => {});
  check("PT (toBlob never answers): the PDF is still made", await page.locator("[data-ptpdf]:not([disabled])").count() === 1);
  check("PT (toBlob never answers): it gave up waiting on toBlob once, then used the plain way", (await page.evaluate(() => window.__toBlobs)) === 1, await page.evaluate(() => window.__toBlobs));
  await page.click("[data-ptpdf]").catch(() => {}); await sleep(800);
  const sh = await page.evaluate(() => window.__shares);
  check("PT (toBlob never answers): one PDF of 4 photos shared", sh.length === 1 && /^DY16MYO-PT-4-photos\.pdf$/.test(sh[0].names[0]) && sh[0].sizes[0] > 4000, sh);
  check("PT (toBlob never answers): no errors", page.__errors.length === 0, page.__errors);
});
await scenario(async () => {
  const { db, page } = await ptRun("link", 5, { stuckBlob: true });
  await page.waitForSelector("[data-ptlink]", { timeout: 15000 }).catch(() => {});
  check("PT link (toBlob never answers): photos still upload and the link is saved", db.uploads.length === 5 && db.ptLinks.length === 1 && db.ptLinks[0].paths.length === 5, { up: db.uploads.length, links: db.ptLinks.length });
});
await scenario(async () => {
  const { db, page } = await ptRun("link", 5);
  await page.waitForSelector("[data-ptlink]", { timeout: 10000 });
  const href = await page.getAttribute("[data-ptlink]", "href");
  check("PT (link): photos uploaded and saved as one link", db.uploads.length === 5 && db.ptLinks.length === 1 && db.ptLinks[0].paths.length === 5);
  check("PT (link): WhatsApp opens on the PT number with the reg and the link", /^https:\/\/wa\.me\/447900000000\?text=DY16MYO.*%2Fp%2F[A-Za-z0-9_-]{24}/.test(href), href);
  await page.click("[data-ptlink]"); await sleep(700);
  check("PT (link): PT gets ticked", db.calls.some((c) => c.fn === "tap_pick" && c.args.p_key === "pt"));
  // PT's page from the link
  const token = db.ptLinks[0].token, viewer = await phone(browser, db, { signedIn: false });
  await viewer.goto(BASE + "/p/" + token); await viewer.waitForSelector(".grid a", { timeout: 8000 });
  check("PT's link page shows every photo", await viewer.locator(".grid a").count() === 5);
  await viewer.goto(BASE + "/p/NOPEnopeNOPEnopeNOPEnope"); await sleep(1500);
  check("a wrong link says so instead of a blank page", /expired|isn't right/.test(await viewer.locator("#grid").innerText()));
  // the car's panel lists the photos, on PICKS and on its DROPS row
  await page.click('.row[data-id="p1"] .reg'); await sleep(800);
  check("the car's panel lists its PT photos", /5 photos/.test(await page.locator("#ptPhotos").innerText()));
});
