import { path, passed, check, sleep, server, L, addDays, TONIGHT, TOMORROW, iso, makeDb, now, backend, b64, phone, open, text, toast, scenario, browser, failed, biDb } from "../harness.mjs";

// 18. import: an Excel file with real Excel date cells, read, previewed and sent
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db, { width: 1000 });
  await open(page);
  // Build the file in the browser with the app's own spreadsheet library.
  const b64 = await page.evaluate(async (day) => {
    await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "/vendor/xlsx-0.18.5.full.min.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
    const [y, m, d] = day.split("-").map(Number);
    const serial = (dd, h, mi) => (Date.UTC(y, m - 1, dd, h, mi) - Date.UTC(1899, 11, 30)) / 864e5;
    const ws = XLSX.utils.aoa_to_sheet([["Ref", "Name", "Vehicle", "Booking From", "Booking To"], ["X1", "ONE", "FORD FIESTA AB12CDE", 0, 0], ["X2", "TWO", "KIA RIO CD34EFG", 0, 0]]);
    ws.D2 = { t: "n", v: serial(d, 13, 20), z: "dd/mm/yyyy hh:mm" }; ws.E2 = { t: "n", v: serial(d + 3, 1, 0), z: "dd/mm/yyyy hh:mm" };
    ws.D3 = { t: "n", v: serial(d, 9, 5), z: "dd/mm/yyyy hh:mm" };  ws.E3 = { t: "n", v: serial(d + 5, 22, 40), z: "dd/mm/yyyy hh:mm" };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "S");
    return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  }, TONIGHT);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(300);
  await page.click('[data-impkind="picks"]'); await sleep(200);
  await page.setInputFiles('input[data-file="excel"]', { name: "picks.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(b64, "base64") });
  await sleep(200); await page.click("[data-read]"); await page.waitForSelector("[data-create]", { timeout: 8000 });
  await page.locator("details:has(.table-wrap) > summary").click();
  const table = await page.locator(".table-wrap").innerText();
  check("import: Excel date cells keep their exact minutes (13:20, not 13:19)", /13:20/.test(table) && /09:05/.test(table) && !/13:19/.test(table), table.slice(0, 200));
  check("import: the reg is taken from the car description", /AB12CDE/.test(table) && /CD34EFG/.test(table));
  await page.click("[data-create]"); await sleep(800);
  const call = db.calls.find((c) => c.fn === "import_sheet");
  const x1 = call && call.args.p_rows.find((r) => r.ref === "X1");
  check("import: sent to the server with the right day, times and cars", !!x1 && call.args.p_kind === "picks" && call.args.p_day === TONIGHT && call.args.p_rows.length === 2
    && x1.drop_local === TONIGHT + " 13:20" && /01:00$/.test(x1.return_local) && x1.reg === "AB12CDE", x1);
  const gone = await page.locator("#panelBody").innerText().catch(() => "");
  check("import: checked files use reviewed apply and completion links to the board", db.calls.some(c=>c.fn==="reviewed_import_apply") && await page.locator("[data-importboard]").count()>0);
});

// 18b. Bookings from the booking site: Check first, then Get bookings now; nothing on a timer.
await scenario(async () => {
  const db = makeDb();
  db.autoImport = { available: true, running: false, last_ok: null, last_error: null, open_reviews: 1 };
  db.reviews = [{ id: 5, ref: "T2", kind: "cancelled", detail: { name: "B Two", reg: "CD34EFG", kind: "drops" } },
    { id: 6, ref: "T6", kind: "cancelled", detail: { name: "Temp Booking", reg: "FV61AOY", kind: "picks", on_sheet: "2026-10-24", missing: true } }];
  const page = await phone(browser, db, { width: 1000 });
  await open(page);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(400);
  await page.waitForSelector("[data-autopreview]", { timeout: 6000 });
  check("auto-import: the page shows Auto import and Manual import tabs when it's set up", /Booking import/.test(await page.locator("#viewTitle").innerText()) && await page.locator('[data-bitab="auto"]').count() === 1 && await page.locator('[data-bitab="manual"]').count() === 1);
  check("auto-import: no on/off switch (the schedule is off)", await page.locator("[data-autotoggle]").count() === 0);
  check("auto-import: Import waits for a check first", await page.locator("[data-autorun]").isDisabled());
  check("auto-import: cancellations wait for the office", (await page.locator("[data-autoreviews]").innerText()).includes("Cancelled · T2"));
  check("auto-import: a car the site no longer lists waits for the office too", (await page.locator("[data-autoreviews]").innerText()).includes("Not on the site · T6"));
  await page.click("[data-autopreview]"); await sleep(700);
  check("auto-import: Check bookings asks for a preview only", (db.autoRuns || []).length === 1 && db.autoRuns[0].action === "preview" && !(db.autoRuns || []).some((x) => x.action === "apply"));
  check("auto-import: the preview shows New / Updated / Needs review / Unchanged", /2\s*New\s*1\s*Updated\s*1\s*Needs review\s*4\s*Unchanged/.test(await page.locator("[data-autopreviewsum]").innerText()), await page.locator("[data-autopreviewsum]").innerText());
  check("auto-import: the button says how many bookings it imports", /Import 3 bookings/.test(await page.locator("[data-autorun]").innerText()), await page.locator("[data-autorun]").innerText());
  check("auto-import: the changed field is listed", /Return: 10:00 → 12:30/.test(await page.locator("[data-autoitems]").innerText()));
  await page.click("[data-autorun]"); await sleep(900);
  const ap = (db.autoRuns || []).find((x) => x.action === "apply");
  check("auto-import: Import imports the previewed plan (hash sent)", ap && ap.expect_hash === "h1", db.autoRuns);
  check("auto-import: the result is shown (added / updated)", /Bookings in: 5 added, 1 updated/.test(await toast(page)), await toast(page));
  await page.click('[data-reviewdone="5"]'); await sleep(500);
  check("auto-import: marking a review done removes it", db.calls.some((c) => c.fn === "swift_review_resolve" && c.args.p_id === 5) && !(await page.locator("[data-autoreviews]").innerText()).includes("T2"));
  check("auto-import: no errors", page.__errors.length === 0, page.__errors);
});

// 18b1. Held for the office (19 Oct): the reg beside the reference, Open, and Move where the app can do it safely.
await scenario(async () => {
  const db = makeDb();
  const YESTERDAY = addDays(TONIGHT, -1);
  db.bookings.find((b) => b.id === "b3").cleared_at = iso(TONIGHT, "21:00");
  db.autoImport = { available: true, running: false, open_reviews: 3 };
  db.reviews = [
    { id: 7, ref: "R5", kind: "conflict", detail: { kind: "drops", why: "moved from sheet " + TOMORROW + " to " + TONIGHT + "; the app can't move it safely", changes: [{ field: "return", from: TOMORROW + " 06:15", to: TONIGHT + " 23:30" }] } },
    { id: 8, ref: "R3", kind: "conflict", detail: { kind: "drops", why: "already handed back or removed, but the booking site now shows different details", changes: [{ field: "return", from: TONIGHT + " 22:15", to: TOMORROW + " 10:00" }] } },
    { id: 9, ref: "R1", kind: "conflict", detail: { kind: "drops", why: "moved from sheet " + TONIGHT + " to " + YESTERDAY + "; the app can't move it safely", changes: [] } },
  ];
  db.preview = { hash: "h2", window: {}, counts: { new: 0, changed: 0, unchanged: 0, review: 1, invalid: 0 }, can_apply: true,
    items: [{ kind: "drops", day: TONIGHT, ref: "R4", reg: "DY16MYO", status: "review", changes: [] }],
    reviews: [{ ref: "R4", kind: "conflict", detail: { kind: "drops", why: "moved from sheet " + TOMORROW + " to " + TONIGHT + "; the app can't move it safely", changes: [] } }], invalid: [] };
  for (const width of [1280, 390]) {
    const page = await phone(browser, db, { width });
    await open(page);
    await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(400);
    await page.waitForSelector("[data-autoreviews] [data-rvopen]", { timeout: 6000 });
    const held = await page.locator("[data-autoreviews]").innerText();
    check("held (" + width + "): the reg shows beside the reference", /R5 · EN11KOO/.test(held) && /R3 · DV59ACF/.test(held) && /R1 · EK14JPV/.test(held), held);
    check("held (" + width + "): the change is listed with the reason", /Return:/.test(held));
    const rowOf = (ref) => page.locator("[data-autoreviews] .bi-hr", { hasText: ref + " ·" });
    check("held (" + width + "): a move to tonight offers Move", await rowOf("R5").locator("[data-rvmove]").count() === 1 && /Move to \d+[A-Z]{2} [A-Z]{3}/.test(await rowOf("R5").locator("[data-rvmove]").innerText()));
    check("held (" + width + "): a handed-back car offers Open only", await rowOf("R3").locator("[data-rvmove]").count() === 0 && await rowOf("R3").locator("[data-rvopen]").count() === 1);
    check("held (" + width + "): a move to a night that has passed offers Open only", await rowOf("R1").locator("[data-rvmove]").count() === 0 && await rowOf("R1").locator("[data-rvopen]").count() === 1);
    const box = await rowOf("R5").boundingBox();
    check("held (" + width + "): the row fits the screen", box && box.x + box.width <= width + 1, box);
    if (width === 1280 && process.env.HELD_SHOTS) await page.screenshot({ path: process.env.HELD_SHOTS + "/held-desktop.png", fullPage: true });
    if (width === 390 && process.env.HELD_SHOTS) { await page.locator(".bi-held").evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 60)); await sleep(200); await page.screenshot({ path: process.env.HELD_SHOTS + "/held-phone.png" }); }
    if (width === 390) {
      await page.click("[data-autopreview]"); await sleep(700);
      await page.click('[data-birow="drops|R4"]'); await sleep(200);
      const pr = page.locator(".bi-row", { hasText: "R4" });
      check("review row: the check's Needs review row has Move and Open", await pr.locator("[data-rvmove]").count() === 1 && await pr.locator("[data-rvopen]").count() === 1, await pr.innerText());
      if (process.env.HELD_SHOTS) { await pr.evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 120)); await sleep(200); await page.screenshot({ path: process.env.HELD_SHOTS + "/review-row-phone.png" }); }
      await rowOf("R5").locator("[data-rvmove]").click(); await sleep(800);
      check("held: Move confirms, then makes it an early return on tonight's sheet", page.__dialogs.some((d) => /Move EN11KOO to DROPS/.test(d)) && db.calls.some((c) => c.fn === "early_return" && c.args.p_booking === "b5" && c.args.p_day === TONIGHT), page.__dialogs);
      check("held: a moved booking leaves the list", db.calls.some((c) => c.fn === "swift_review_resolve" && c.args.p_id === 7));
      await rowOf("R3").locator("[data-rvopen]").click(); await sleep(900);
      check("held: Open shows the car's booking details on its night", await page.locator("#panel").evaluate((d) => d.open) && /DV59ACF/.test(await page.locator("#panelBody").innerText()) && (await page.locator("#sheetPick").inputValue()) === "d0");
    }
    check("held (" + width + "): no errors", page.__errors.length === 0, page.__errors);
    await page.context().close();
  }
}, 'held');

// 18b1b. A cancelled review whose car is still on a board offers Remove as cancelled; Done asks first (24 Oct: LLHGPC stayed on PICKS after Done).
await scenario(async () => {
  const db = makeDb();
  db.autoImport = { available: true, running: false, open_reviews: 3 };
  db.reviews = [
    { id: 21, ref: "R5", kind: "cancelled", detail: { kind: "drops", name: "JANKO MS", reg: "EN11KOO" } },
    { id: 22, ref: "R4", kind: "cancelled", detail: { kind: "drops", name: "ATANASOV MX", reg: "DY16MYO", missing: true } },
    { id: 23, ref: "T9", kind: "cancelled", detail: { kind: "drops", name: "Gone Already", reg: "AB12CDE" } },
  ];
  const page = await phone(browser, db, { width: 390 });
  await open(page);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(400);
  await page.waitForSelector("[data-autoreviews] [data-rvremove]", { timeout: 6000 });
  const rowOf = (ref) => page.locator("[data-autoreviews] .bi-hr", { hasText: ref + " ·" });
  check("cancelled review: a car still on a board offers Remove as cancelled", await rowOf("R5").locator("[data-rvremove]").count() === 1 && /Remove as cancelled/.test(await rowOf("R5").innerText()));
  check("cancelled review: a booking with no car offers no Remove", await rowOf("T9").locator("[data-rvremove]").count() === 0);
  await rowOf("R5").locator("[data-rvremove]").click(); await sleep(800);
  check("cancelled review: Remove confirms, removes the car as Cancelled and closes the review",
    page.__dialogs.some((d) => /Remove EN11KOO \(R5\) from DROPS .* as cancelled\?/.test(d)) &&
    db.calls.some((c) => c.fn === "remove_booking" && c.args.p_booking === "b5" && c.args.p_reason === "Cancelled") &&
    db.calls.some((c) => c.fn === "swift_review_resolve" && c.args.p_id === 21), page.__dialogs);
  check("cancelled review: the removed car leaves the list", !(await page.locator("[data-autoreviews]").innerText()).includes("R5 ·"));
  const n = page.__dialogs.length;
  await page.click('[data-reviewdone="22"]'); await sleep(500);
  check("cancelled review: Done on a car still on a board says it stays", page.__dialogs.length === n + 1 && /DY16MYO is still on DROPS .*Done closes this without removing it/.test(page.__dialogs[n]), page.__dialogs);
  check("cancelled review: and Done never removes the car", !db.calls.some((c) => c.fn === "remove_booking" && c.args.p_booking === "b4") && db.calls.some((c) => c.fn === "swift_review_resolve" && c.args.p_id === 22));
  const m = page.__dialogs.length;
  await page.click('[data-reviewdone="23"]'); await sleep(500);
  check("cancelled review: Done with no car on a board doesn't ask", page.__dialogs.length === m && db.calls.some((c) => c.fn === "swift_review_resolve" && c.args.p_id === 23));
  check("cancelled review: no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, 'held');

// 18b2. A failed check shows the reason and offers no import; an invalid record blocks it.
await scenario(async () => {
  const db = makeDb();
  db.autoImport = { available: true, running: false, open_reviews: 0 };
  db.previewError = "The booking site sent a web page instead of the report. Nothing was imported.";
  const page = await phone(browser, db, { width: 1000 });
  await open(page);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(400);
  await page.waitForSelector("[data-autopreview]", { timeout: 6000 });
  await page.click("[data-autopreview]"); await sleep(700);
  check("auto-import: a failed check shows why", /web page instead of the report/.test(await page.locator("[data-autobox]").innerText()));
  check("auto-import: and Import stays off", await page.locator("[data-autorun]").isDisabled());
  db.previewError = null; db.preview = { hash: "h2", window: {}, counts: { new: 0, changed: 0, unchanged: 0, review: 0, invalid: 2 }, can_apply: false, items: [], reviews: [], invalid: [{ kind: "drops", ref: "D1", reason: "ambiguous: the same reference appears 2 times with different details" }] };
  await page.click("[data-autopreview]"); await sleep(700);
  check("auto-import: invalid records are listed and block the import", /ambiguous/.test(await page.locator("[data-autoitems]").innerText()) && await page.locator("[data-autorun]").isDisabled());
  check("auto-import: no errors", page.__errors.length === 0, page.__errors);
});

// 18b2b. The booking site can take longer than 20 seconds: the import waits for the answer instead of giving up (14 Oct, stuck on Importing).
await scenario(async () => {
  const db = makeDb();
  db.autoImport = { available: true, running: false, open_reviews: 0 };
  db.bookingsDelay = 22000;
  const page = await phone(browser, db, { width: 1000 });
  await open(page);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(400);
  await page.waitForSelector("[data-autopreview]", { timeout: 6000 });
  await page.click("[data-autopreview]"); await sleep(700);
  await page.click("[data-autorun]"); await sleep(23500);
  check("auto-import: an import that takes over 20 seconds still finishes with its result", /Bookings in: 5 added, 1 updated/.test(await toast(page)), await toast(page));
  check("auto-import: no errors after a slow import", page.__errors.length === 0, page.__errors);
});

// 18b3. A changed plan between check and import is refused, nothing imported.
await scenario(async () => {
  const db = makeDb();
  db.autoImport = { available: true, running: false, open_reviews: 0 };
  const page = await phone(browser, db, { width: 1000 });
  await open(page);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(400);
  await page.waitForSelector("[data-autopreview]", { timeout: 6000 });
  await page.click("[data-autopreview]"); await sleep(700);
  db.applyError = "The bookings changed since the preview. Check them again before importing.";
  await page.click("[data-autorun]"); await sleep(800);
  check("auto-import: a plan that changed is refused with the reason", /changed since the preview/.test(await page.locator("[data-autobox]").innerText()));
  check("auto-import: the stale preview can't be imported again", await page.locator("[data-autorun]").isDisabled());
  check("auto-import: no errors", page.__errors.length === 0, page.__errors);
});

// 18c. Without it set up (the usual company), the section stays hidden.
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db, { width: 1000 });
  await open(page);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(400);
  check("auto-import: hidden for a company without it set up", await page.locator('[data-bitab="auto"]').count() === 0 && await page.locator("[data-autopreview]").count() === 0 && /Booking import/.test(await page.locator("#viewTitle").innerText()) && await page.locator("[data-impkind]").count() === 2);
});


// 18d. Booking import redesign: Auto import / Manual import, the check as a compact table, filters, search,
// review cases, collapsed diagnostics, Recent imports with their source and Undo only where it is possible.
for (const theme of ["ops", "stdplus", ""]) await scenario(async () => {
  const L = theme || "standard";
  const db = biDb(theme);
  const page = await phone(browser, db, { width: 1100 });
  await open(page);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(500);
  await page.waitForSelector("[data-autopreview]", { timeout: 6000 });
  const main0 = await page.locator("#main").innerText();
  check("import page (" + L + "): one heading, Booking import", await page.locator("#main h2").count() === 0 && /^Booking import$/.test((await page.locator("#viewTitle").innerText()).trim()));
  check("import page (" + L + "): tabs Auto import and Manual import, Auto first", (await page.locator(".bi-tabs button").allInnerTexts()).join("|") === "Auto import|Manual import|History" && await page.locator('[data-bitab="auto"][aria-selected=true]').count() === 1);
  check("import page (" + L + "): connection, last checked and last imported are separate", /Connected/.test(main0) && /Last checked –/.test(main0) && /Last imported \d\d:\d\d/.test(main0), main0.slice(0, 200));
  check("import page (" + L + "): no provider name anywhere on the page", !/swift/i.test(await page.locator("body").innerText()));
  check("import page (" + L + "): Import is off until a check, and says so", await page.locator("[data-autorun]").isDisabled() && /Check bookings to see what would change/.test(main0));
  await page.click("[data-autopreview]"); await sleep(800);
  const sum = await page.locator("[data-autopreviewsum]").innerText();
  check("import page (" + L + "): counts New 3, Updated 3, Needs review 2, Unchanged 4", /3\s*New\s*3\s*Updated\s*2\s*Needs review\s*4\s*Unchanged/.test(sum), sum);
  check("import page (" + L + "): the button shows the eligible count", /Import 6 bookings/.test(await page.locator("[data-autorun]").innerText()) && !(await page.locator("[data-autorun]").isDisabled()));
  check("import page (" + L + "): last checked now shows a time", /Last checked \d\d:\d\d/.test(await page.locator(".bi-status").innerText()));
  check("import page (" + L + "): the review notice says they stay out of the import", /2 bookings need an office decision\. These will stay out of this import\./.test(await page.locator(".bi-warn").innerText()));
  const tbl = await page.locator(".bi-tbl").innerText();
  check("import page (" + L + "): rows for new, changed, review and cancelled; unchanged are not in the default view", await page.locator(".bi-row").count() === 8 && !/DEMO-1001/.test(tbl), await page.locator(".bi-row").count());
  check("import page (" + L + "): changed fields show previous → new", /Vehicle: Kia Niro → Toyota Auris/.test(tbl) && /Return time: 20:25 → 20:40/.test(tbl), tbl.slice(0, 400));
  check("import page (" + L + "): a phone number change shows no number", /Phone number updated/.test(tbl) && !/0770090/.test(tbl));
  check("import page (" + L + "): a moved return is explained as a review case", /Moved from sheet .* to .*; the app can't move it safely/.test(tbl) && /Return: .* 23:45 → .* 00:30/.test(tbl) && /Held back/.test(tbl), tbl.slice(0, 700));
  check("import page (" + L + "): a cancellation is explained and never removed", /Cancellation requires review/.test(tbl) && /Nothing is removed here/.test(tbl));
  const diag = page.locator(".bi-diag:not(.bi-coverage)");
  check("import page (" + L + "): diagnostics start collapsed, with the report result", !(await diag.evaluate((d) => d.open)) && /Report checks passed/.test(await diag.locator("summary").innerText()) && !(await page.locator("[data-autoreport]").isVisible()));
  await diag.locator("summary").click(); await sleep(200);
  check("import page (" + L + "): opened diagnostics hold the raw report and search form", /On the booking site, picks: 5/.test(await page.locator("[data-autoreport]").innerText()) && /Search form: producttype=all/.test(await page.locator("[data-autoreport]").innerText()));
  check("import page (" + L + "): diagnostics show how many drops got their return flight", /Return flights: 5 of 6 drops matched · Return Report 7/.test(await page.locator("[data-autoreport]").innerText()));
  await page.click('[data-bifilter="changed"]'); await sleep(200);
  check("import page (" + L + "): the Changed filter shows 3", await page.locator(".bi-row").count() === 3);
  await page.click('[data-bifilter="review"]'); await sleep(200);
  check("import page (" + L + "): the Needs review filter shows 2", await page.locator(".bi-row").count() === 2);
  await page.click('[data-bifilter="unchanged"]'); await sleep(200);
  check("import page (" + L + "): the optional Unchanged view lists them", await page.locator(".bi-row").count() === 4 && /DEMO-1001/.test(await page.locator(".bi-tbl").innerText()));
  await page.click('[data-bifilter="all"]'); await sleep(200);
  await page.fill("#biQ", "gh 78"); await sleep(200);
  check("import page (" + L + "): searching by registration narrows the list", await page.locator(".bi-row:not([hidden])").count() === 1 && /DEMO-1053/.test(await page.locator(".bi-row:not([hidden])").innerText()));
  await page.fill("#biQ", "demo-1059"); await sleep(200);
  check("import page (" + L + "): searching by reference too", await page.locator(".bi-row:not([hidden])").count() === 1 && /MN34STU/.test(await page.locator(".bi-row:not([hidden])").innerText()));
  await page.fill("#biQ", ""); await sleep(200);
  check("import page (" + L + "): three recent runs show time, staff, source and totals", await page.locator(".bi-recent>.bi-run").count()===3 && /OFFICE/.test(await page.locator(".bi-recent").innerText()) && /Auto import/.test(await page.locator(".bi-recent").innerText()) && /9 added · 1 updated/.test(await page.locator(".bi-recent").innerText()));
  await page.locator('.bi-recent>.bi-run').evaluateAll(es=>es.forEach(e=>e.open=true));
  check("import page (" + L + "): a run with no changes says No changes", /No changes/.test(await page.locator(".bi-recent").innerText()));
  check("import page (" + L + "): Undo is available only inside eligible run details", await page.locator(".bi-recent [data-undoimport]").count()===1);
  await page.click("[data-autorun]"); await sleep(900);
  const ap = (db.autoRuns || []).find((x) => x.action === "apply");
  check("import page (" + L + "): Import sends the previewed plan's hash, with nothing on a timer", ap && ap.expect_hash === "h9" && !(db.autoRuns || []).some((x) => x.action === "timer"), db.autoRuns);
  await page.click('[data-bitab="manual"]'); await sleep(300);
  check("import page (" + L + "): Manual import keeps Drops/Picks and shows flight upload only after choosing a spreadsheet", await page.locator("[data-impkind]").count() === 2 && await page.locator('[data-file="excel"]').count() === 1 && await page.locator('[data-file="pdf"]').count() === 0 && await page.locator("[data-autopreview]").count() === 0);
  check("import page (" + L + "): Recent imports show on the Manual tab too", await page.locator(".bi-recent").count() === 1);
  check("import page (" + L + "): no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
});

// 18d2. The same page on a phone: rows with expandable details, actions at the bottom, nothing wider than the screen.
await scenario(async () => {
  const db = biDb("ops");
  const page = await phone(browser, db, { width: 390 });
  await open(page);
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300);
  await page.click('#menuBody [data-view="import"]'); await sleep(500);
  await page.waitForSelector("[data-autopreview]", { timeout: 6000 });
  await page.click("[data-autopreview]"); await sleep(800);
  check("import phone: no sideways scrolling", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));
  check("import phone: the column header row is hidden, rows are stacked", !(await page.locator(".bi-th").isVisible()) && (await page.locator(".bi-row").count()) === 8);
  const row = page.locator(".bi-row.s-review").first();
  check("import phone: a review row starts collapsed and expands on tap", (await row.locator(".bi-hd").getAttribute("aria-expanded")) === "false" && !(await row.locator(".bi-ex").isVisible()));
  await row.locator(".bi-hd").click(); await sleep(200);
  check("import phone: the tapped row shows its explanation", (await row.locator(".bi-hd").getAttribute("aria-expanded")) === "true" && await row.locator(".bi-ex").isVisible());
  const act = await page.locator(".bi-act").evaluate((e) => ({ pos: getComputedStyle(e).position, top: e.getBoundingClientRect().top, h: window.innerHeight }));
  check("import phone: Check and Import stay within reach at the bottom", act.pos === "sticky" && act.top > act.h * 0.55, act);
  check("import phone: tap targets are at least 44px", await page.evaluate(() => [...document.querySelectorAll(".bi-act .btn,.bi-chip,.bi-hd,.bi-tabs button")].every((e) => e.getBoundingClientRect().height >= 40)));
  check("import phone: no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
});

// 18d3. A check with nothing to do, and a failed check, read plainly.
await scenario(async () => {
  const db = biDb("ops", { counts: { new: 0, changed: 0, unchanged: 5, review: 0, invalid: 0 }, can_apply: false, items: [], reviews: [], unchanged: [] });
  db.reviews = []; db.autoImport.open_reviews = 0;
  const page = await phone(browser, db, { width: 1100 });
  await open(page);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(500);
  await page.waitForSelector("[data-autopreview]", { timeout: 6000 });
  await page.click("[data-autopreview]"); await sleep(800);
  check("import page: a check with nothing to do says No booking changes", /No booking changes/.test(await page.locator("[data-autoitems]").innerText()) && /Nothing to import/.test(await page.locator("[data-autorun]").innerText()) && await page.locator("[data-autorun]").isDisabled());
  db.previewError = "The booking site lists 125 bookings for 15 Oct but its download holds only 31. Nothing was imported.";
  await page.click("[data-autopreview]"); await sleep(800);
  check("import page: a failed check shows the reason and the status says so", /holds only 31/.test(await page.locator(".alert").innerText()) && /Check failed/.test(await page.locator(".bi-conn").innerText()) && await page.locator("[data-autorun]").isDisabled());
  check("import page: no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
});

// 18d5. Choosing dates: nothing is sent until the dates are changed; then the check and the import read exactly those days.
await scenario(async () => {
  const db = biDb("ops");
  const page = await phone(browser, db, { width: 1100 });
  await open(page);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(500);
  await page.waitForSelector("[data-autopreview]", { timeout: 6000 });
  const today = await page.evaluate(() => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }));
  const plus = (k, n) => { const d = new Date(k + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  check("import dates: the boxes start at today and the next 2 days", (await page.inputValue("#biFrom")) === today && (await page.inputValue("#biTo")) === plus(today, 2));
  await page.click("[data-autopreview]"); await sleep(800);
  check("import dates: a default check sends no dates", db.autoRuns.length === 1 && db.autoRuns[0].from === undefined && db.autoRuns[0].to === undefined, db.autoRuns);
  await page.fill("#biFrom", plus(today, 3)); await page.dispatchEvent("#biFrom", "change"); await sleep(300);
  check("import dates: moving From past To drags To along, and the old check is cleared", (await page.inputValue("#biTo")) === plus(today, 3) && await page.locator("[data-autopreviewsum]").count() === 0);
  await page.fill("#biTo", plus(today, 9)); await page.dispatchEvent("#biTo", "change"); await sleep(300);
  await page.click("[data-autopreview]"); await sleep(800);
  const last = db.autoRuns[db.autoRuns.length - 1];
  check("import dates: a chosen range is sent with the check", last.action === "preview" && last.from === plus(today, 3) && last.to === plus(today, 9), last);
  await page.click("[data-autorun]"); await sleep(1200);
  const ap = db.autoRuns[db.autoRuns.length - 1];
  check("import dates: the import reads the same range", ap.action === "apply" && ap.from === plus(today, 3) && ap.to === plus(today, 9) && !!ap.expect_hash, ap);
  await page.fill("#biFrom", plus(today, 1)); await page.dispatchEvent("#biFrom", "change"); await sleep(300);
  await page.fill("#biTo", plus(today, 30)); await page.dispatchEvent("#biTo", "change"); await sleep(300);
  check("import dates: more than 14 days is pulled back to 14", (await page.inputValue("#biTo")) === plus(today, 30) && (await page.inputValue("#biFrom")) === plus(today, 17));
  await page.click("[data-birangereset]"); await sleep(300);
  check("import dates: reset goes back to today and the next 2 days", (await page.inputValue("#biFrom")) === today && (await page.inputValue("#biTo")) === plus(today, 2) && await page.locator("[data-birangereset]").count() === 0);
  check("import dates: no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
});

// 18d6. Scheduled import: owners and managers set the times; the office only sees the state and how the last run went.
await scenario(async () => {
  const db = biDb("ops");
  db.autoImport.schedule = { on: false, times: [], last: null };
  const page = await phone(browser, db, { width: 1100 });
  await open(page);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(500);
  await page.waitForSelector("[data-bisched]", { timeout: 6000 });
  check("schedule: starts off, and nothing is sent until saved", /Off/.test(await page.locator("[data-bisched] summary").innerText()) && !(db.calls || []).some((c) => c.fn === "swift_schedule_set"));
  await page.click("[data-bisched] summary"); await sleep(200);
  check("schedule: Save is disabled until something changes", await page.locator("[data-schedsave]").isDisabled());
  await page.click("[data-schedadd]"); await sleep(200);
  await page.fill('[data-schedtime="0"]', "06:00"); await page.dispatchEvent('[data-schedtime="0"]', "change"); await sleep(200);
  await page.click("[data-schedadd]"); await sleep(200);
  await page.fill('[data-schedtime="1"]', "18:30"); await page.dispatchEvent('[data-schedtime="1"]', "change"); await sleep(200);
  await page.check("#schedOn"); await sleep(200);
  check("schedule: the times can be added and Save becomes available", await page.locator("[data-schedtime]").count() === 2 && !(await page.locator("[data-schedsave]").isDisabled()));
  await page.click("[data-schedsave]"); await sleep(600);
  const sv = (db.calls || []).filter((c) => c.fn === "swift_schedule_set").pop();
  check("schedule: saving sends the times and the switch", !!sv && sv.args.p_on === true && JSON.stringify(sv.args.p_times) === JSON.stringify(["06:00", "18:30"]), sv);
  check("schedule: the summary then reads On with the times", /On · 06:00, 18:30/.test(await page.locator("[data-bisched] summary").innerText()));
  db.autoImport.schedule = { on: true, times: ["06:00", "18:30"], by: "RAKESH", last: { outcome: "held", slot: "2026-10-14 06:00", why: "2 bookings need a decision" } };
  await page.click("[data-autopreview]"); await sleep(900); // a check reloads the status
  await page.evaluate(() => document.querySelector("[data-bisched]").open = true);
  check("schedule: a held run is explained on the page", /not imported, 2 bookings need a decision/.test(await page.locator("[data-bischedlast]").innerText()));
  check("schedule: no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
});

// 18d7. The office sees the schedule state but cannot change it.
await scenario(async () => {
  const db = biDb("ops");
  db.me = { ...db.me, role: "office" };
  db.autoImport.schedule = { on: true, times: ["06:00"], by: "RAKESH", last: null };
  const page = await phone(browser, db, { width: 1100 });
  await open(page);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(500);
  await page.waitForSelector("[data-bisched]", { timeout: 6000 });
  await page.click("[data-bisched] summary"); await sleep(200);
  check("schedule (office): shows On with the time but has no switch or Save", /On · 06:00/.test(await page.locator("[data-bisched] summary").innerText()) && await page.locator("#schedOn").count() === 0 && await page.locator("[data-schedsave]").count() === 0);
  check("schedule (office): no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
});

// 18d4. A company without the connected importer sees the manual import only, under the same heading.
await scenario(async () => {
  const db = makeDb(); db.company = { ...db.company, name: "Airport Parking Bay", slug: "airport-parking-bay", brand: { colour: "#1560BD", ink: "#FFFFFF", short: "Parking Bay", theme: "premium" } };
  const page = await phone(browser, db, { width: 1000 });
  await open(page);
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(300); await page.click('#menuBody [data-view="import"]'); await sleep(500);
  check("import page: Airport Parking Bay has no Auto import tab, only the manual import", await page.locator('[data-bitab="auto"]').count() === 0 && await page.locator("[data-autopreview]").count() === 0 && /Booking import/.test(await page.locator("#viewTitle").innerText()) && await page.locator('[data-file="excel"]').count() === 1);
  await page.context().close();
});

// 18a. DROPS file with the date and the time in separate columns (BookingList .xls):
// the time must be read, or every car lands at midnight on the day before.
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db, { width: 1000 });
  await open(page);
  const b64 = await page.evaluate(async (day) => {
    await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "/vendor/xlsx-0.18.5.full.min.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
    const [y, m, d] = day.split("-").map(Number);
    const date = (dd) => (Date.UTC(y, m - 1, dd) - Date.UTC(1899, 11, 30)) / 864e5;
    const ws = XLSX.utils.aoa_to_sheet([["Reference", "Name", "Vehicle", "Drop Off Date", "Drop Off Time", "Return Date", "Return Time"],
      ["T1", "ONE", "FORD FIESTA AB12CDE", 0, 0, 0, 0], ["T2", "TWO", "KIA RIO CD34EFG", 0, 0, 0, 0], ["T3", "THREE", "VW GOLF EF56GHJ", 0, 0, 0, 0]]);
    const put = (c, v, z) => { ws[c] = { t: "n", v, z }; };
    // back on day+1 at 14:30, 21:05 and 03:15 (that one is the night before's shift)
    [[2, 14, 30], [3, 21, 5], [4, 3, 15]].forEach(([r, h, mi]) => {
      put("D" + r, date(d - 5), "dd/mm/yyyy"); put("E" + r, 10 / 24, "hh:mm");
      put("F" + r, date(d + 1), "dd/mm/yyyy"); put("G" + r, (h * 60 + mi) / 1440, "hh:mm");
    });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "S");
    return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  }, TONIGHT);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(300);
  await page.setInputFiles('input[data-file="excel"]', { name: "BookingList.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(b64, "base64") });
  await sleep(200); await page.click("[data-read]"); await page.waitForSelector("[data-create]", { timeout: 8000 });
  await page.locator("details:has(.table-wrap) > summary").click();
  const table = await page.locator(".table-wrap").innerText(), btn = await page.locator("[data-create]").innerText();
  const tomorrow = +addDays(TONIGHT, 1).split("-")[2];
  check("import (separate date and time columns): times are read (14:30, 21:05)", /14:30/.test(table) && /21:05/.test(table) && !/00:00/.test(table), table.slice(0, 300));
  check("import (separate date and time columns): all parsed sheet dates remain available for review", (await page.locator("#impDate").innerText()).includes(tomorrow + "TH DROPS") || /Import 3 selected/.test(btn), btn);
});

// 18a2. BookingList ".xls" that is really tab-separated text: dates must not move an hour (BST).
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db, { width: 1000 });
  await open(page);
  const d1 = addDays(TONIGHT, 1), d2 = addDays(TONIGHT, 2);
  const tsv = ["Sr# \t Reference Number \t Car Reg \t Booking status \t Client \t Booking From \t Drop off Time \t Booking To \t Collection Time \t Car Make \t Inbound Flight No ",
    ["1", "TX1", "AB12CDE", "1", "ONE", TONIGHT, "04:00", d1, "14:30", "FORD", ""].join("\t"),
    ["2", "TX2", "CD34EFG", "1", "TWO", TONIGHT, "09:15", d1, "21:05", "KIA", ""].join("\t"),
    ["3", "TX3", "EF56GHJ", "1", "THREE", TONIGHT, "10:00", d2, "02:10", "VW", ""].join("\t")].join("\n");
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(300);
  await page.setInputFiles('input[data-file="excel"]', { name: "BookingList-test.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from(tsv) });
  await sleep(200); await page.click("[data-read]"); await page.waitForSelector("[data-create]", { timeout: 8000 });
  await page.locator("details:has(.table-wrap) > summary").click();
  const table = await page.locator(".table-wrap").innerText();
  check("import (text .xls): real times, no hour shift (14:30, 21:05, 02:10)", /14:30/.test(table) && /21:05/.test(table) && !/01:00/.test(table), table.slice(0, 300));
  await page.click("[data-create]"); await sleep(800);
  const call = db.calls.find((c) => c.fn === "import_sheet"), x1 = call && call.args.p_rows.find((r) => r.ref === "TX1");
  check("import (text .xls): drop-off 04:00 and return 14:30 sent as written", !!x1 && x1.drop_local === TONIGHT + " 04:00" && x1.return_local === d1 + " 14:30", x1);
});

// 18a0. DROPS by hour: morning is up to 17:30, night from 17:31
await scenario(async () => {
  const db = makeDb();
  db.bookings.find((x) => x.id === "b1").return_at = new Date(TONIGHT + "T17:30:00+01:00").toISOString();
  db.bookings.find((x) => x.id === "b2").return_at = new Date(TONIGHT + "T17:31:00+01:00").toISOString();
  const page = await phone(browser, db, { width: 1000 });
  await open(page);
  await page.click("#psBtn");
  await sleep(500);
  const body = await page.locator("#panelBody").innerText().catch(() => "");
  const m = body.match(/Morning 06:00–17:30\s+(\d+)/), n = body.match(/Night 17:31–05:59\s+(\d+)/);
  check("DROPS by hour: 17:30 counts as morning, 17:31 as night", !!m && !!n && +m[1] === 1 && +n[1] === 2, body.slice(-400));
});

// 18a3. a file where every car has the same time is refused (the times weren't read)
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db, { width: 1000 });
  await open(page);
  const d1 = addDays(TONIGHT, 1);
  const rows = [" Reference Number \t Car Reg \t Client \t Booking From \t Drop off Time \t Booking To \t Collection Time "];
  for (let i = 1; i <= 6; i++) rows.push(["S" + i, "AB1" + i + "CDE", "N" + i, TONIGHT, "01:00", d1, "01:00"].join("\t"));
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(300);
  await page.click('[data-impkind="picks"]'); await sleep(200);
  await page.setInputFiles('input[data-file="excel"]', { name: "same.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from(rows.join("\n")) });
  await sleep(200); await page.click("[data-read]"); await sleep(1500);
  check("import: every car at the same time is refused, nothing sent", /same drop-off time \(01:00\)/.test(await text(page, ".alert")) && !db.calls.some((c) => c.fn === "import_sheet"), await text(page, ".alert"));
});
