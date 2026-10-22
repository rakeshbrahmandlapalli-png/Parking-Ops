import { browser, makeDb, phone, open, sleep, check, scenario, noSideScroll, pickKind, now, fs, path } from "../harness.mjs";

// Synthetic collections. The £20 charge settles a £30 calculated/agreed
// charge under the existing discount rule; a waived £40 is not money taken.
function collectionsDb(theme) {
  const db = makeDb();
  db.company.brand = { theme, colour: "#F9A01B", ink: "#1A1A1A", short: "TakeOff" };
  db.company.exit_fee = 10; db.company.exit_free = ["VIP"];
  db.company.overstay_rate = 30; db.company.yards = ["NY", "S", "CP", "T"];
  const [a, b, c] = db.bookings;
  Object.assign(a, { reg: "AB12CDE", make: "KIA NIRO", name: "TAYLOR MRS", yard: "NY", exit_method: "card", exit_amount: 10, exit_by: "s2", exit_at: now(), exit_photo: "c1/docs/b1/exit.jpg", charge_agreed: 30, charge_amount: 20, charge_method: "cash", charge_at: now(), charge_by: "s2", by_name: { charge_by: "OFFICE TEST" } });
  Object.assign(b, { reg: "CD34EFG", make: "LAND ROVER", name: "PATEL MR", yard: "S", charge_agreed: 30, charge_reason: "Extra parking" });
  Object.assign(c, { reg: "EF56GHI", make: "NISSAN QASHQAI", name: "JONES MS", yard: "CP", ref: "VIP-003", charge_method: "waived", charge_amount: 40, charge_by: "s2", charge_at: now() });
  db.bookings.push({ ...a, id: "b6", num: 6, reg: "GH78JKL", name: "SMITH DR", make: "MERCEDES A CLASS", ref: "R6", yard: "T", exit_photo: "", charge_agreed: 0, charge_amount: null, charge_method: null, charge_by: null, charge_at: null, by_name: {} });
  return db;
}

for (const theme of ["", "stdplus", "ops", "ops-refined", "pro", "cards", "premium", "board"]) await scenario(async () => {
  const db = collectionsDb(theme), page = await phone(browser, db, { width: 390 }), look = theme || "standard";
  await open(page); await page.waitForSelector("#boardPayments:not(.hidden)");
  const totals = () => page.locator(".bpay-totals b").allTextContents();
  check("Collections (" + look + "): exit and charge receipts stay separate; waiver excluded; discount settles", JSON.stringify(await totals()) === JSON.stringify(["£20", "£20", "£40"]), await totals());
  check("Collections (" + look + "): each visible car has one details button", await page.locator("#main .bpay-row").count() === 4);
  check("Collections (" + look + "): exempt and waived are explicit", /Exempt/.test(await page.locator('[data-paydetails="b3"]').innerText()) && /Waived/.test(await page.locator('[data-paydetails="b3"]').innerText()));
  check("Collections (" + look + "): missing proof is flagged separately from unpaid", /Needs checking/.test(await page.locator('[data-paydetails="b6"]').innerText()) && !/Due/.test(await page.locator('[data-paydetails="b6"]').innerText()));
  const todo = await page.locator("#tabTodo").innerText();
  await page.click('[data-payfilter="due"]');
  check("Collections (" + look + "): outstanding filter and totals match the shown cars", await page.locator("#main .row").count() === 1 && await page.locator('[data-paydetails="b2"]').count() === 1 && JSON.stringify(await totals()) === JSON.stringify(["£0", "£0", "£40"]));
  check("Collections (" + look + "): payment filter does not change TO DO's operational count", await page.locator("#tabTodo").innerText() === todo);
  await page.click('[data-payfilter="check"]');
  check("Collections (" + look + "): needs-checking filter finds the collected exit fee without proof", await page.locator("#main .row").count() === 1 && await page.locator('[data-paydetails="b6"]').count() === 1);
  await page.click('[data-payfilter="paid"]');
  check("Collections (" + look + "): collected filter excludes waivers", await page.locator("#main .row").count() === 2 && !await page.locator('[data-paydetails="b3"]').count());
  await page.click('[data-payfilter=""]');
  await page.fill("#q", "AB12CDE");
  check("Collections (" + look + "): search updates the scoped collection totals", JSON.stringify(await totals()) === JSON.stringify(["£10", "£20", "£0"]), await totals());
  await page.fill("#q", "");
  await page.click('[data-paydetails="b1"]'); await page.waitForSelector("#panel.payment-sheet[open]");
  check("Collections (" + look + "): detail shows method, collector, shared-login name and timestamp", /Card[\s\S]*SUGU/.test(await page.locator(".bpay-sheet").innerText()) && /OFFICE TEST/.test(await page.locator(".bpay-sheet").innerText()) && await page.locator(".bpay-kv dt:text-is('Recorded')").count() === 2);
  check("Collections (" + look + "): detail is read-only and does not invent a verification record", await page.locator(".bpay-sheet input,.bpay-sheet [data-charge],.bpay-sheet [data-exitshot]").count() === 0 && !/Checked by/.test(await page.locator(".bpay-sheet").innerText()));
  await page.waitForSelector("#boardPayProof a");
  check("Collections (" + look + "): proof uses the existing signed private-storage link", /\/object\/sign\/pt-photos\/c1\/docs\/b1\/exit.jpg/.test(await page.locator("#boardPayProof a").getAttribute("href")));
  await page.click(".bpay-footer [data-close]"); await page.waitForSelector("#panel:not([open])", { state: "attached" });
  for (const width of [360, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await sleep(120);
    check("Collections (" + look + "): " + width + " px has no sideways scroll", await noSideScroll(page));
    check("Collections (" + look + "): " + width + " px, fee controls stay below the operational actions", await page.locator("#main .row.with-payments").evaluateAll((rows) => rows.every((r) => { const p = r.querySelector(".bpay-row").getBoundingClientRect(), a = r.querySelector(".acts")?.getBoundingClientRect(); return !a || p.top >= a.bottom - 1; })));
  }
  await pickKind(page, "picks");
  check("Collections (" + look + "): PICKS does not show return-day fees or retain their filter", !await page.locator("#boardPayments").isVisible() && await page.locator("#main .bpay-row").count() === 0);
}, "payments");

await scenario(async () => {
  const db = collectionsDb("ops"), page = await phone(browser, db);
  await open(page); await page.click('[data-paydetails="b6"]');
  check("Collections: missing payment proof is explicit and detail has no write controls", await page.locator("#panel.payment-sheet[open]").count() === 1 && /no payment photo recorded/.test(await page.locator(".bpay-sheet").innerText()) && await page.locator(".bpay-sheet input,.bpay-sheet [data-charge],.bpay-sheet [data-exitshot]").count() === 0);
  await page.click(".bpay-footer [data-close]");
  await page.click('[data-payfilter="due"]');
  await page.selectOption("#sheetPick", "d1"); await page.waitForSelector('[data-paydetails="b4"]');
  check("Collections: a different sheet resets the payment filter", await page.locator('[data-payfilter=""]').getAttribute("aria-pressed") === "true");
}, "payments");

// Visibility follows the saved permission, not a hard-coded role or unrelated
// operational access. Unknown/missing permission keys fail closed.
for (const theme of ["", "stdplus", "ops", "ops-refined", "pro", "cards", "premium", "board"]) {
  for (const role of ["owner", "manager", "office", "bongo", "terminal", "view"]) await scenario(async () => {
    const db = collectionsDb(theme), allowed = ["owner", "manager", "office"].includes(role);
    db.me.role = role;
    db.perms = allowed ? {} : { sent: true, called: true, clear: true, settings: true, staff: true };
    const page = await phone(browser, db), label = (theme || "standard") + "/" + role;
    await open(page);
    check("Collections access (" + label + "): role default", await page.locator("#boardPayments").isVisible() === allowed && await page.locator(".bpay-row").count() === (allowed ? 4 : 0));
    if (allowed) {
      await page.click('[data-paydetails="b1"]'); await page.waitForSelector("#boardPayProof a");
      check("Collections access (" + label + "): allowed default opens read-only details and proof", await page.locator("#panel.payment-sheet[open]").count() === 1 && await page.locator(".bpay-sheet [data-charge],.bpay-sheet [data-exitshot]").count() === 0);
    } else {
      await page.evaluate(() => {
        for (const [name, value] of [["payfilter", "due"], ["paydetails", "b1"], ["payproof", "b1"], ["paybooking", "b1"]]) {
          const b = document.createElement("button"); b.dataset[name] = value; document.body.append(b); b.click(); b.remove();
        }
      });
      check("Collections access (" + label + "): hidden UI has no totals and injected payment actions are ignored", await page.locator("#boardPayments").innerHTML() === "" && await page.locator("#panel[open]").count() === 0 && await page.locator("#main .row").count() === 4);
    }
  }, "payments");
}

for (const role of ["owner", "manager", "office", "bongo", "terminal", "view"]) await scenario(async () => {
  const db = collectionsDb("ops"), byDefault = ["owner", "manager", "office"].includes(role);
  db.me.role = role; db.me.extra = [byDefault ? "-collections" : "collections"];
  db.perms = {};
  const page = await phone(browser, db); await open(page);
  check("Collections access (" + role + "): explicit " + (byDefault ? "removal" : "grant") + " overrides role default", await page.locator("#boardPayments").isVisible() === !byDefault && await page.locator(".bpay-row").count() === (byDefault ? 0 : 4));
  if (!byDefault) {
    await page.click('[data-paydetails="b1"]'); await page.waitForSelector("#boardPayProof a");
    check("Collections access (" + role + "): granted read access opens details without granting collection writes", await page.locator("#panel.payment-sheet[open]").count() === 1 && !db.calls.some((c) => c.fn === "set_exit_paid" || c.fn === "set_overstay_paid"));
  }
}, "payments");

await scenario(async () => {
  const db = collectionsDb("ops"); db.me.extra = ["collections", "-collections"];
  const page = await phone(browser, db); await open(page);
  check("Collections access: an explicit removal wins over a grant", !await page.locator("#boardPayments").isVisible() && !await page.locator(".bpay-row").count());
}, "payments");

await scenario(async () => {
  const db = collectionsDb("ops"); db.perms = { collections: undefined };
  const page = await phone(browser, db); await open(page);
  check("Collections access: missing backend permission key fails closed even for the owner", !await page.locator("#boardPayments").isVisible() && !await page.locator(".bpay-row").count());
}, "payments");

// Exercise the actual Staff & access controls, save, and re-open as the target.
for (const role of ["office", "manager", "bongo", "terminal", "view"]) await scenario(async () => {
  const db = collectionsDb("ops"), byDefault = ["office", "manager"].includes(role);
  const target = db.staff.find((p) => p.id === "s2"); target.role = role; target.extra = [];
  const page = await phone(browser, db); await open(page);
  await page.click('#bnav [data-bn="menuBtn"]'); await page.click('#menuBody [data-view="staff"]');
  await page.click("#main .ops-dd summary"); await page.click('[data-manage="s2"]');
  const access = page.locator('[data-perm="collections"]');
  check("Collections access editor (" + role + "): default is labelled and selected correctly", await access.isChecked() === byDefault && /View board collections/.test(await access.locator("..").innerText()) && (await access.locator("..").innerText()).includes("default: " + (byDefault ? "yes" : "no")));
  await access.setChecked(!byDefault); await page.click("[data-saveaccess]");
  await page.waitForFunction(() => !!document.querySelector('[data-saveaccess]:not([disabled])'));
  check("Collections access editor (" + role + "): save persists the grant or removal", JSON.stringify(target.extra) === JSON.stringify([byDefault ? "-collections" : "collections"]));
  const owner = db.me; db.me = { ...target, company_id: "c1" }; db.perms = {};
  const staffPage = await phone(browser, db); await open(staffPage);
  check("Collections access editor (" + role + "): saved choice applies on the person's next app open", await staffPage.locator("#boardPayments").isVisible() === !byDefault);
  await staffPage.context().close(); db.me = owner; delete db.perms;
  await page.click("[data-roledefault]");
  check("Collections access editor (" + role + "): Role defaults restores the checkbox", await access.isChecked() === byDefault);
  await page.click("[data-saveaccess]"); await page.waitForFunction(() => !!document.querySelector('[data-saveaccess]:not([disabled])'));
  check("Collections access editor (" + role + "): saving role defaults removes the override", target.extra.length === 0);
}, "payments");

await scenario(async () => {
  const db = collectionsDb("ops"), page = await phone(browser, db);
  db.bookings[0].exit_photo = "other-company/docs/b1/exit.jpg";
  await open(page); await page.click('[data-paydetails="b1"]');
  check("Collections: a proof path outside the current company cannot produce a link", await page.locator("#boardPayProof").innerText() === "Payment proof unavailable." && await page.locator("#boardPayProof a").count() === 0);
}, "payments");

await scenario(async () => {
  const db = collectionsDb("ops"), page = await phone(browser, db);
  await open(page); await page.click('[data-paydetails="b2"]'); await page.click('[data-paybooking="b2"]');
  await page.waitForSelector("#panel.ops-car[open]");
  await page.click('[data-exitnophoto="cash"]'); await sleep(400);
  await page.fill("#chgAmount", "30"); await page.click('[data-charge="card"]'); await sleep(400);
  await page.click("#panelBody [data-close]");
  check("Collections: existing authorised collection actions update the board and its totals", JSON.stringify(await page.locator(".bpay-totals b").allTextContents()) === JSON.stringify(["£30", "£50", "£0"]));
  check("Collections: collection updates use only the existing payment RPCs", db.calls.some((c) => c.fn === "set_exit_paid" && c.args.p_booking === "b2") && db.calls.some((c) => c.fn === "set_overstay_paid" && c.args.p_booking === "b2"));
}, "payments");

for (const theme of ["cards", "premium", "board"]) await scenario(async () => {
  const db = collectionsDb(theme), page = await phone(browser, db, { width: 360 });
  await page.emulateMedia({ colorScheme: "dark" }); await open(page);
  check("Collections (" + theme + "): dark theme keeps its own background and readable state colours", await page.evaluate(() => document.documentElement.classList.contains("dark") && getComputedStyle(document.querySelector(".bpay-head")).backgroundColor === getComputedStyle(document.querySelector(".row")).backgroundColor && getComputedStyle(document.querySelector(".bpay-status.paid")).color !== getComputedStyle(document.querySelector(".bpay-head")).backgroundColor) && await noSideScroll(page));
}, "payments");

await scenario(async () => {
  const db = collectionsDb("ops"), page = await phone(browser, db);
  db.bookings[0].charge_amount = 0.1; db.bookings.find((r) => r.id === "b6").charge_method = "cash"; db.bookings.find((r) => r.id === "b6").charge_amount = 0.2;
  await open(page);
  check("Collections: decimal receipts are summed in pence", (await page.locator(".bpay-totals b").allTextContents())[1] === "£0.30");
  await page.click("#keyBtn");
  check("Collections: key check keeps its own board and hides payment filters", !await page.locator("#boardPayments").isVisible() && !await page.locator("#main .bpay-row").count());
}, "payments");

if (process.env.PAYMENT_SHOTS) await scenario(async () => {
  const out = process.env.PAYMENT_SHOTS; fs.mkdirSync(out, { recursive: true });
  const db = collectionsDb("ops"), page = await phone(browser, db);
  await open(page); await page.waitForSelector("#boardPayments:not(.hidden)"); await sleep(250);
  await page.screenshot({ path: path.join(out, "Operations-board-payments.png"), fullPage: false });
  await page.click('[data-paydetails="b1"]'); await page.waitForSelector("#boardPayProof a");
  await page.screenshot({ path: path.join(out, "Operations-payment-details.png"), fullPage: false });
  await page.click(".bpay-footer [data-close]"); await page.setViewportSize({ width: 1440, height: 960 }); await sleep(180);
  await page.screenshot({ path: path.join(out, "Operations-desktop-payments.png"), fullPage: false });
}, "payments");
