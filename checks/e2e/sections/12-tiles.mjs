import { check, sleep, deskDb, phone, open, pickKind, scenario, browser, noSideScroll } from "../harness.mjs";

// The numbers on Summary, Hourly stats and Flights open their cars when tapped (they
// looked like buttons and did nothing), and Mark as in the car shows what is marked.
const LOOKS = ["", "pro", "cards", "premium", "board", "stdplus", "ops", "ops-refined"];
const name = (t) => t || "standard";
// Open the menu the way each look shows it (top button, bottom bar or the brand), then the page.
async function goView(page, v) {
  await page.evaluate(() => { const vis = (x) => x && x.offsetParent; const b = [document.getElementById("menuBtn"), document.querySelector('#bnav [data-bn="menuBtn"]'), document.getElementById("cHead")].filter(vis)[0]; b.click(); });
  await page.waitForSelector("#menu[open]"); await page.click('#menuBody [data-view="' + v + '"]'); await sleep(350);
}
const regs = (page) => page.evaluate(() => [...document.querySelectorAll("#main .row[data-id]")].map((r) => r.dataset.id).sort().join(","));
const bar = (page) => page.evaluate(() => { const q = document.querySelector("#main .queuebar"); return q ? q.innerText.replace(/\s+/g, " ") : ""; });

// Summary, every look: On the way / Overstays / Complaints (DROPS), Still to come / No shows / RTC (PICKS).
for (const t of LOOKS) await scenario(async () => {
  const page = await phone(browser, deskDb(t), { width: 390 }); await open(page); await sleep(300);
  await goView(page, "summary");
  const tiles = await page.evaluate(() => [...document.querySelectorAll("#main [data-tileq]")].map((x) => x.dataset.tileq).join(","));
  check("Tiles (" + name(t) + "): Summary DROPS numbers are tappable", tiles === "way,over,comp", tiles);
  await page.click('#main [data-tileq="way"]'); await sleep(350);
  check("Tiles (" + name(t) + "): On the way opens the board with the cars sent and not back", (await regs(page)) === "w6" && /On the way · 1/.test(await bar(page)), [await regs(page), await bar(page)]);
  await page.click("#main [data-queueclear]"); await sleep(250);
  check("Tiles (" + name(t) + "): Show all brings the whole board back", (await regs(page)).split(",").length > 5);
  await goView(page, "summary"); await page.click('#main [data-tileq="over"]'); await sleep(350);
  check("Tiles (" + name(t) + "): Overstays opens the overstay cars", (await regs(page)) === "w16", await regs(page));
  await goView(page, "summary"); await page.click('#main [data-tileq="comp"]'); await sleep(350);
  check("Tiles (" + name(t) + "): Complaints opens the complaint cars", (await regs(page)) === "w12", await regs(page));
  await pickKind(page, "picks"); await sleep(300); await goView(page, "summary");
  await page.click('#main [data-tileq="noshow"]'); await sleep(350);
  check("Tiles (" + name(t) + "): No shows opens the no-show cars on PICKS", (await regs(page)) === "pk4" && /No shows · 1/.test(await bar(page)), [await regs(page), await bar(page)]);
  await goView(page, "summary"); await page.click('#main [data-tileq="come"]'); await sleep(350);
  check("Tiles (" + name(t) + "): Still to come opens the cars not in yet", (await regs(page)) === "pk3,pk7,pk8", await regs(page));
  check("Tiles (" + name(t) + "): no sideways scrolling, no errors", (await noSideScroll(page)) && page.__errors.length === 0, page.__errors);
  await page.context().close();
});

// Flights, every look: the numbers filter the list (tap again for all).
for (const t of LOOKS) await scenario(async () => {
  const page = await phone(browser, deskDb(t), { width: 390 }); await open(page); await sleep(300);
  await goView(page, "flights");
  const list = () => page.evaluate(() => [...document.querySelectorAll("#main .frow[data-id], #main .ops-fl[data-id]")].map((r) => r.dataset.id).sort().join(","));
  const all = await list();
  await page.click('#main [data-fltile="landed"]'); await sleep(300);
  check("Tiles (" + name(t) + "): Flights · Landed shows only the landed flight, marked as chosen", (await list()) === "w6" && await page.evaluate(() => document.querySelector('#main [data-fltile="landed"]').getAttribute("aria-pressed") === "true"), await list());
  await page.click('#main [data-fltile="delayed"]'); await sleep(300);
  check("Tiles (" + name(t) + "): Flights · Delayed shows delayed and running-late flights", (await list()) === "w1,w15,w3,w4", await list());
  await page.click('#main [data-fltile="cancelled"]'); await sleep(300);
  check("Tiles (" + name(t) + "): Flights · Cancelled shows the cancelled flight", (await list()) === "w10", await list());
  await page.click('#main [data-fltile="cancelled"]'); await sleep(300);
  check("Tiles (" + name(t) + "): tapping it again shows every flight", (await list()) === all && all.split(",").length > 5, [all, await list()]);
  check("Tiles (" + name(t) + "): Flights, no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
});

// Hourly stats (the Operations looks' page): Due back / Sent / Collected / Still to collect and the overstay money lines.
for (const t of ["ops", "ops-refined"]) await scenario(async () => {
  const db = deskDb(t); db.company.overstay_rate = 10;
  const page = await phone(browser, db, { width: 390 }); await open(page); await sleep(300);
  await page.click('#bnav [data-bn="psBtn"]'); await sleep(350);
  const tiles = await page.evaluate(() => [...document.querySelectorAll("#main [data-tileq]")].map((x) => x.dataset.tileq).join(","));
  check("Tiles (" + t + "): Hourly stats numbers and overstay money lines are tappable", tiles === ",sentall,back,left,owed,cash,card,waived", tiles);
  await page.click('#main .ops-strip [data-tileq="back"]'); await sleep(350);
  check("Tiles (" + t + "): Collected opens the cars handed back", (await regs(page)) === "w13" && /Collected · 1/.test(await bar(page)), [await regs(page), await bar(page)]);
  await page.click('#bnav [data-bn="psBtn"]'); await sleep(350); await page.click('#main [data-tileq="sentall"]'); await sleep(350);
  check("Tiles (" + t + "): Sent opens the cars sent", (await regs(page)) === "w13,w6", await regs(page));
  await page.click('#bnav [data-bn="psBtn"]'); await sleep(350); await page.click('#main [data-tileq="left"]'); await sleep(350);
  check("Tiles (" + t + "): Still to collect opens the cars not back", (await regs(page)).split(",").length === 15, await regs(page));
  await page.click('#bnav [data-bn="psBtn"]'); await sleep(350); await page.click('#main [data-tileq=""]'); await sleep(350);
  check("Tiles (" + t + "): Due back opens the whole sheet (All)", (await regs(page)).split(",").length === 16 && !(await bar(page)) && await page.evaluate(() => document.getElementById("tabAll").classList.contains("on")), await regs(page));
  await page.click('#bnav [data-bn="psBtn"]'); await sleep(350); await page.click('#main [data-tileq="owed"]'); await sleep(350);
  check("Tiles (" + t + "): Overstay still owed opens a board queue", /Overstay still owed/.test(await bar(page)), await bar(page));
  await page.click('#bnav [data-bn="psBtn"]'); await sleep(350);
  await page.focus('#main [data-tileq="back"]'); await page.keyboard.press("Enter"); await sleep(350);
  check("Tiles (" + t + "): Enter on a focused number opens it too", (await regs(page)) === "w13", await regs(page));
  check("Tiles (" + t + "): Hourly stats, no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
});

// Mark as: a car already marked No show / Called / New booking shows that button filled, every look.
for (const t of LOOKS) await scenario(async () => {
  const db = deskDb(t); db.bookings.find((b) => b.id === "pk7").pick_called = "Called";
  const page = await phone(browser, db, { width: 390 }); await open(page); await pickKind(page, "picks"); await sleep(300);
  await page.click("#tabAll"); await sleep(250);
  const look = async (id) => {
    await page.evaluate((id) => document.querySelector('#main .row[data-id="' + id + '"] [data-open]').click(), id); await sleep(400);
    const r = await page.evaluate(() => { const b = (sel) => { const x = document.querySelector("#panelBody " + sel); if (!x) return null; const s = getComputedStyle(x); return { on: x.classList.contains("on"), pressed: x.getAttribute("aria-pressed"), bg: s.backgroundColor, ink: s.color }; };
      return { noshow: b("[data-pnoshow]"), called: b('[data-pcall="Called"]'), nb: b('[data-pcall="New Booking"]') }; });
    await page.evaluate(() => document.getElementById("panel").close()); await sleep(150); return r;
  };
  const ns = await look("pk4"), cl = await look("pk7"), nb = await look("pk6");
  const lit = (x, off) => x && x.on && x.bg !== off.bg;
  check("Tiles (" + name(t) + "): No show marked → the No show button is filled", lit(ns.noshow, ns.called), ns);
  check("Tiles (" + name(t) + "): Called marked → the Called button is filled", lit(cl.called, cl.nb), cl);
  check("Tiles (" + name(t) + "): New booking marked → the New booking button is filled", lit(nb.nb, nb.called), nb);
  if (t === "ops-refined") check("Tiles (ops-refined): the marked button says so to a screen reader (aria-pressed)", ns.noshow.pressed === "true" && ns.called.pressed === "false", ns);
  await page.context().close();
});
