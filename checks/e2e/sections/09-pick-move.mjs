import { check, sleep, TONIGHT, TOMORROW, iso, addDays, L, makeDb, phone, open, toast, pickKind, scenario, browser } from "../harness.mjs";

// The booking site moved a PICKS drop-off to another day (CN25VCF, 22 Oct): the office moves the car (setup 102).
for (const theme of ["", "ops"]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  db.sheets.push({ id: "p1s", company_id: "c1", kind: "picks", day: TOMORROW });
  const look = theme || "standard";
  const page = await phone(browser, db);
  await open(page); await pickKind(page, "picks");
  await page.click('.row[data-id="p2"] .reg'); await page.waitForSelector("#panel[open]");
  check("PICKS move (" + look + "): the office gets the drop-off date and time boxes", await page.isVisible("#dropD") && await page.isVisible("#dropT"));
  check("PICKS move (" + look + "): they show the booked drop-off", await page.inputValue("#dropD") === TONIGHT && /^\d\d:\d\d$/.test(await page.inputValue("#dropT")), [await page.inputValue("#dropD"), await page.inputValue("#dropT")]);
  await page.fill("#dropD", TOMORROW); await page.fill("#dropT", "0500"); await page.click("[data-savepanel]"); await sleep(800);
  const c = db.calls.filter((x) => x.fn === "move_pick").pop();
  check("PICKS move (" + look + "): it asks first", page.__dialogs.some((d) => /Move AF63WWH to PICKS/.test(d)), page.__dialogs);
  check("PICKS move (" + look + "): Save sends the new drop-off", c && c.args.p_booking === "p2" && c.args.p_drop_local === TOMORROW + " 05:00", c);
  check("PICKS move (" + look + "): nothing else is changed", !db.calls.some((x) => ["set_note", "set_pick_return", "set_reg"].includes(x.fn)));
  check("PICKS move (" + look + "): the car leaves this day's board", await page.locator('.row[data-id="p2"]').count() === 0 && /moved to/i.test(await toast(page)), await toast(page));
  check("PICKS move (" + look + "): no errors", page.__errors.length === 0, page.__errors);
}, "held");

// A time change on the same day keeps the car where it is.
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db);
  await open(page); await pickKind(page, "picks");
  await page.click('.row[data-id="p2"] .reg'); await page.waitForSelector("#panel[open]");
  await page.fill("#dropT", "1630"); await page.click("[data-savepanel]"); await sleep(700);
  const c = db.calls.filter((x) => x.fn === "move_pick").pop();
  check("PICKS move: a new time on the same day saves without asking", c && c.args.p_drop_local === TONIGHT + " 16:30" && !page.__dialogs.length, [c, page.__dialogs]);
  check("PICKS move: and the car stays on the board", await page.locator('.row[data-id="p2"]').count() === 1);
}, "held");

// A day whose PICKS sheet isn't in yet: the office is told, the car stays.
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db);
  await open(page); await pickKind(page, "picks");
  await page.click('.row[data-id="p2"] .reg'); await page.waitForSelector("#panel[open]");
  await page.fill("#dropD", TOMORROW); await page.fill("#dropT", "0500"); await page.click("[data-savepanel]"); await sleep(900);
  check("PICKS move: a day not imported yet is refused with the reason", /not in yet/.test(await toast(page)), await toast(page));
  check("PICKS move: and the car stays on its day", await page.locator('.row[data-id="p2"]').count() === 1 && db.bookings.find((b) => b.id === "p2").sheet_id === "p0");
}, "held");

// Only the office: drivers and terminal staff don't get the boxes.
await scenario(async () => {
  const db = makeDb(); db.me = { ...db.me, role: "terminal" }; db.perms = { clear: true, picksinfo: true, note: true, intake: true };
  const page = await phone(browser, db);
  await open(page); await pickKind(page, "picks");
  await page.click('.row[data-id="p1"] .reg'); await page.waitForSelector("#panel[open]");
  check("PICKS move: terminal staff don't get the drop-off boxes", !(await page.isVisible("#dropD")));
}, "held");

// Booking import: a PICKS car the booking site moved gets Move in Needs review and in Held for the office.
await scenario(async () => {
  const db = makeDb();
  db.sheets.push({ id: "p1s", company_id: "c1", kind: "picks", day: TOMORROW });
  db.autoImport = { available: true, running: false, open_reviews: 2 };
  const why = "moved from sheet " + TONIGHT + " to " + TOMORROW + "; the app can't move it safely";
  db.reviews = [
    { id: 11, ref: "P2", kind: "conflict", detail: { kind: "picks", why, changes: [{ field: "drop", from: TONIGHT + " 15:00", to: TOMORROW + " 05:00" }] } },
    { id: 12, ref: "P4", kind: "conflict", detail: { kind: "picks", why, changes: [] } },
  ];
  db.preview = { hash: "h3", window: {}, counts: { new: 0, changed: 0, unchanged: 0, review: 1, invalid: 0 }, can_apply: true,
    items: [{ kind: "picks", day: TOMORROW, ref: "P2", reg: "AF63WWH", status: "review", changes: [{ field: "drop", from: TONIGHT + " 15:00", to: TOMORROW + " 05:00" }] }],
    reviews: [{ ref: "P2", kind: "conflict", detail: { kind: "picks", why, changes: [{ field: "drop", from: TONIGHT + " 15:00", to: TOMORROW + " 05:00" }] } }], invalid: [] };
  const page = await phone(browser, db, { width: 390 });
  await open(page);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(400);
  await page.waitForSelector("[data-autoreviews] [data-rvopen]", { timeout: 6000 });
  const rowOf = (ref) => page.locator("[data-autoreviews] .bi-hr", { hasText: ref + " ·" });
  check("held PICKS: a moved drop-off offers Move to its day", await rowOf("P2").locator("[data-rvmove]").count() === 1 && /Move to \d+[A-Z]{2} [A-Z]{3}/.test(await rowOf("P2").locator("[data-rvmove]").innerText()), await rowOf("P2").innerText());
  check("held PICKS: without the new drop-off time it offers Open only", await rowOf("P4").locator("[data-rvmove]").count() === 0 && await rowOf("P4").locator("[data-rvopen]").count() === 1);
  await page.click("[data-autopreview]"); await sleep(700);
  await page.click('[data-birow="picks|P2"]'); await sleep(200);
  const pr = page.locator(".bi-row", { hasText: "P2" });
  check("review PICKS: the check's Needs review row has Move and Open", await pr.locator("[data-rvmove]").count() === 1 && await pr.locator("[data-rvopen]").count() === 1, await pr.innerText());
  if (process.env.HELD_SHOTS) { await pr.evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 120)); await sleep(200); await page.screenshot({ path: process.env.HELD_SHOTS + "/picks-review-row-phone.png" }); }
  await rowOf("P2").locator("[data-rvmove]").click(); await sleep(800);
  check("held PICKS: Move confirms with the new drop-off, then moves the car", page.__dialogs.some((d) => /Move AF63WWH to PICKS .*drop-off/.test(d)) && db.calls.some((c) => c.fn === "move_pick" && c.args.p_booking === "p2" && c.args.p_drop_local === TOMORROW + " 05:00"), page.__dialogs);
  check("held PICKS: the moved booking leaves the list", db.calls.some((c) => c.fn === "swift_review_resolve" && c.args.p_id === 11));
  check("held PICKS: no errors", page.__errors.length === 0, page.__errors);
}, "held");

// AF14BDU (24 Oct): a desk booking landed on the next day's PICKS sheet with its drop-off on the day
// before. Its drop-off is unchanged, yet Save moves it to its own day's sheet (part 114).
for (const theme of ["", "ops"]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  db.sheets.push({ id: "p1s", company_id: "c1", kind: "picks", day: TOMORROW });
  const look = theme || "standard", b = db.bookings.find((x) => x.id === "p2");
  b.drop_at = iso(addDays(TONIGHT, -1), "10:28");
  db.sheets.push({ id: "pm1", company_id: "c1", kind: "picks", day: addDays(TONIGHT, -1) });
  const page = await phone(browser, db);
  await open(page); await pickKind(page, "picks");
  await page.click('.row[data-id="p2"] .reg'); await page.waitForSelector("#panel[open]");
  if (process.env.WRONG_SHOTS) await page.screenshot({ path: process.env.WRONG_SHOTS + "/car-wrong-sheet-" + look + ".png" });
  check("PICKS wrong sheet (" + look + "): the car says it's on another day's sheet", await page.isVisible("#dropDay") && /sheet\. Save moves it to/.test(await page.textContent("#dropDay")), await page.textContent("#dropDay").catch(() => ""));
  await page.click("[data-savepanel]"); await sleep(800);
  const c = db.calls.filter((x) => x.fn === "move_pick").pop();
  check("PICKS wrong sheet (" + look + "): Save asks, then moves it with its drop-off unchanged", page.__dialogs.some((d) => /Move AF63WWH to PICKS/.test(d)) && c && c.args.p_drop_local.slice(0, 10) === addDays(TONIGHT, -1), [c, page.__dialogs]);
  check("PICKS wrong sheet (" + look + "): the car leaves this board", await page.locator('.row[data-id="p2"]').count() === 0 && db.bookings.find((x) => x.id === "p2").sheet_id === "pm1");
  check("PICKS wrong sheet (" + look + "): no errors", page.__errors.length === 0, page.__errors);
}, "held");

// A car on its own day's sheet says nothing and Save leaves it.
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db);
  await open(page); await pickKind(page, "picks");
  await page.click('.row[data-id="p2"] .reg'); await page.waitForSelector("#panel[open]");
  check("PICKS right sheet: no wrong-sheet line", await page.locator("#dropDay").count() === 0);
  await page.click("[data-savepanel]"); await sleep(600);
  check("PICKS right sheet: Save doesn't move it", !db.calls.some((x) => x.fn === "move_pick") && !page.__dialogs.length, page.__dialogs);
}, "held");

// The desk form on a sheet that isn't today's warns, and offers today's sheet.
const TODAY = L.year + "-" + L.month + "-" + L.day;
for (const theme of ["", "ops"]) for (const useToday of [true, false]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  db.sheets = db.sheets.filter((x) => !(x.kind === "picks" && x.day === addDays(TODAY, 1)));
  if (TODAY !== TONIGHT) db.sheets.push({ id: "ptoday", company_id: "c1", kind: "picks", day: TODAY });
  db.sheets.push({ id: "pnext", company_id: "c1", kind: "picks", day: addDays(TODAY, 1) });
  const todayId = TODAY === TONIGHT ? "p0" : "ptoday", look = (theme || "standard") + (useToday ? ", today's sheet" : ", kept");
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  await pickKind(page, "picks");
  await page.selectOption("#sheetPick", "pnext"); await sleep(700);
  await page.click("[data-deskbook]"); await page.waitForSelector("#deskForm"); await sleep(200);
  if (process.env.WRONG_SHOTS && useToday) await page.screenshot({ path: process.env.WRONG_SHOTS + "/desk-form-" + (theme || "standard") + ".png" });
  check("Desk booking on another day (" + look + "): the form warns it isn't today's sheet", await page.isVisible("#dkWarn") && /not today/.test(await page.textContent("#dkWarn")), await page.textContent("#dkWarn").catch(() => ""));
  if (useToday) { await page.click("[data-dktoday]"); await sleep(200); check("Desk booking on another day (" + look + "): today's sheet takes the warning away", await page.locator("#dkWarn").count() === 0); }
  await page.fill("#dkReg", "af14bdu"); await page.fill("#dkRetD", addDays(TODAY, 1)); await page.fill("#dkRetT", "13:00");
  await page.click("#dkGo"); await sleep(1200);
  const call = db.calls.find((c) => c.fn === "add_booking");
  if (useToday) check("Desk booking on another day (" + look + "): added to today's sheet without asking", call && call.args.p_sheet === todayId && !page.__dialogs.some((d) => /to PICKS/.test(d)), [call && call.args.p_sheet, page.__dialogs]);
  else check("Desk booking on another day (" + look + "): taken in now asks before adding to the other day", page.__dialogs.some((d) => /Add AF14BDU to PICKS .*taken in today/.test(d)) && call && call.args.p_sheet === "pnext", [call && call.args.p_sheet, page.__dialogs]);
  check("Desk booking on another day (" + look + "): no errors", page.__errors.length === 0, page.__errors);
}, "held");

// Today's sheet: no warning.
await scenario(async () => {
  const db = makeDb();
  if (TODAY !== TONIGHT) return;
  const page = await phone(browser, db);
  await open(page); await sleep(300);
  await page.selectOption("#sheetPick", "p0"); await page.waitForSelector('.row[data-id="p1"]');
  await page.click("[data-deskbook]"); await page.waitForSelector("#deskForm");
  check("Desk booking today: no warning", await page.locator("#dkWarn").count() === 0);
}, "held");
