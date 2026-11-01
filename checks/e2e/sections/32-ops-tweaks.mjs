import { check, sleep, makeDb, phone, open, scenario, browser, noSideScroll, now } from "../harness.mjs";

// 1 Nov (user's screenshots): Yards on Activity, Attendance in the Menu, Collections "Not recorded", calmer Operations Refined.
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const build = (theme, attendance = true) => {
  const db = makeDb(); db.company.brand = { theme, colour: "#1560BD", ink: "#fff", short: "APB", attendance, collections: true };
  db.company.exit_fee = 10; db.company.yards = ["T", "GS", "MY"];
  db.aero = { manager: false, sites: [], open: { id: "sh1", clock_in_at: ago(60), worksite_id: "w1" }, shifts: [] };
  const [a, b, c] = db.bookings, sh = a.sheet_id;
  Object.assign(a, { exit_method: "card", exit_amount: 10, exit_at: now(), exit_photo: "", sent: true, cleared: true });
  Object.assign(b, { sent: true, sent_at: now(), cleared: true, cleared_at: now() });
  Object.assign(c, { sent: false, cleared: false });
  const act = (m, action, value, sheet = sh) => ({ id: "a" + m, at: ago(m), reg: "EJ71FJO", action, value, staff_name: "KAMU", sheet_id: sheet, booking_id: c.id });
  db.activity = [act(2, "CALLED", "Called"), act(4, "YARD", "MY"), act(6, "KEY CHECK", "found · k1"), act(8, "LANE MOVE", "A · 1 → B · 2"), act(9, "KEY CHECK START", "k1"), act(10, "STAFF", "x", null)];
  return db;
};
const menu = async (p) => { await p.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await p.waitForSelector("#menu[open]"); await sleep(900); };

for (const theme of ["ops-refined", "ops", "stdplus", "premium"]) await scenario(async () => {
  const tag = "Tweaks (" + theme + ")", db = build(theme), p = await phone(browser, db, { width: 390 });
  await open(p); await p.waitForSelector("#boardPayments:not(.hidden)");
  const f = await p.locator(".bpay-filters").innerText();
  check(tag + ": Collections says Not recorded, not Needs checking", /Not recorded/.test(f) && !/Needs checking/.test(f), f);
  await p.click("#tabAll").catch(() => {}); await sleep(200);
  await p.click('[data-payfilter="check"]'); await sleep(200);
  const ids = await p.locator("#main .row[data-id]").evaluateAll((r) => r.map((x) => x.dataset.id));
  check(tag + ": Not recorded lists the car handed back unpaid and the paid one without a photo", ids.length === 2 && ids.includes("b1") && ids.includes("b2"), ids);
  check(tag + ": the rows say which", /No payment photo/.test(await p.locator('[data-paydetails="b1"]').innerText()) && /Not recorded/.test(await p.locator('[data-paydetails="b2"]').innerText()));
  await menu(p);
  check(tag + ": Attendance is in the Menu", await p.locator('#menuBody [data-attendance="staff"]').count() === 1);
  await p.click('#menuBody [data-view="summary"]'); await sleep(1500);
  await p.click('[data-actf="yards"]'); await sleep(300);
  const t = await p.locator("#actList").innerText();
  check(tag + ": Yards shows yard, key check and Yard planner lines only", /Yard/i.test(t) && /Key check/i.test(t) && /Lane move/i.test(t) && /Key check start/i.test(t) && !/Called/i.test(t) && !/KAMU · x/.test(t), t);
  check(tag + ": no sideways scrolling", await noSideScroll(p));
  check(tag + ": no errors", p.__errors.length === 0, p.__errors);
}, "tweaks");

await scenario(async () => {
  const p = await phone(browser, build("ops-refined", false), { width: 390 });
  await open(p); await menu(p);
  check("Tweaks: no Attendance in the Menu without the add-on", await p.locator('#menuBody [data-attendance]').count() === 0);
}, "tweaks");

await scenario(async () => {
  const p = await phone(browser, build("ops-refined"), { width: 390 });
  await open(p); await menu(p); await p.click('#menuBody [data-view="summary"]'); await sleep(1500);
  const s = await p.locator(".actrow strong").first().innerHTML().catch(() => "");
  check("Tweaks (ops-refined): activity reads reg then the action in plain words", /EJ71FJO <span class="aw">Called<\/span>/.test(s), s);
  check("Tweaks (ops-refined): the top bar keeps its refresh button", await p.locator("#refreshBtn").isVisible());
}, "tweaks");
