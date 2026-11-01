import { check, sleep, deskDb, phone, open, scenario, browser, noSideScroll } from "../harness.mjs";

// 1 Nov (user: "the desktop version also look too toyish and ai made"): Operations Refined and Operations
// get a side bar on the left at 900 px and wider (an icon rail below 1440 px, so laptops keep the full board table), a slim top bar, plain status
// text. The menu and Booking details open beside the side bar, under the top bar; phones and other looks keep theirs.
const toView = async (page, view) => {
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click());
  await page.waitForSelector("#menu[open]"); await sleep(300);
  await page.click('#menuBody [data-view="' + view + '"]'); await sleep(900);
};
for (const theme of ["ops-refined", "ops"]) await scenario(async () => {
  for (const [width, sb] of [[1920, 224], [1680, 224], [1600, 224], [1440, 224], [1366, 64], [1280, 64], [1024, 64], [900, 64]]) {
    const tag = "Desk (" + theme + " " + width + ")";
    const page = await phone(browser, deskDb(theme), { width }); await page.setViewportSize({ width, height: 900 });
    await open(page); await sleep(500);
    const g = await page.evaluate(() => {
      const nav = document.getElementById("bnav").getBoundingClientRect(), bar = document.querySelector(".bar").getBoundingClientRect();
      const main = document.getElementById("main").getBoundingClientRect(), brand = document.getElementById("menuBtn").getBoundingClientRect();
      const rows = [...document.querySelectorAll("#main .drow")].map((r) => { const b = r.getBoundingClientRect(), a = r.querySelector(".acts").getBoundingClientRect(), last = [...r.querySelectorAll(".acts button")].pop(); return { right: b.right, actsRight: Math.max(a.right, last ? last.getBoundingClientRect().right : 0) }; });
      return { navL: nav.left, navW: Math.round(nav.width), navTop: Math.round(nav.top), navH: nav.height, barBottom: Math.round(bar.bottom), mainL: main.left, brandL: brand.left, brandW: brand.width,
        pos: getComputedStyle(document.getElementById("bnav")).position, rows, vw: innerWidth };
    });
    check(tag + ": the sections are a side bar on the left, under the top bar, " + sb + " px wide", g.pos === "fixed" && g.navL === 0 && g.navW === sb && g.navTop === g.barBottom && g.navH > 600, g);
    check(tag + ": the board starts right of the side bar; the brand sits above it", g.mainL >= sb && g.brandL < sb && g.brandW <= sb, g);
    check(tag + ": every row's buttons stay inside the row and the window", g.rows.length > 3 && g.rows.every((r) => r.actsRight <= r.right + 1 && r.right <= g.vw), g.rows);
    check(tag + ": no sideways scrolling on the board", await noSideScroll(page));
    // Booking details: beside the side bar, under the top bar, on screen
    await page.click('.drow[data-id="w2"] .reg'); await sleep(600);
    const p = await page.evaluate(() => { const r = document.getElementById("panel").getBoundingClientRect(); return { open: document.getElementById("panel").open, l: Math.round(r.left), t: Math.round(r.top), b: Math.round(r.bottom), h: innerHeight, bar: Math.round(document.querySelector(".bar").getBoundingClientRect().bottom) }; });
    check(tag + ": Booking details opens beside the side bar, under the top bar, on screen", p.open && p.l === sb && p.t === p.bar && p.b <= p.h + 1, p);
    await page.keyboard.press("Escape"); await sleep(300);
    // Menu: same place
    await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]")).click()); await page.waitForSelector("#menu[open]"); await sleep(300);
    const m = await page.evaluate(() => { const r = document.getElementById("menu").getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), b: Math.round(r.bottom), h: innerHeight, bar: Math.round(document.querySelector(".bar").getBoundingClientRect().bottom), staff: !!document.querySelector('#menuBody [data-view="staff"]') }; });
    check(tag + ": the menu opens beside the side bar, under the top bar", m.l === sb && m.t === m.bar && m.b <= m.h + 1 && m.staff, m);
    await page.click('#menuBody [data-view="staff"]'); await sleep(900);
    const s = await page.evaluate(() => {
      const t = document.getElementById("viewTitle"), r = t.getBoundingClientRect(), em = document.querySelector("#main .ops-person:not(.ops-th) .ops-side em");
      return { titleL: r.left, titleW: r.width, eyebrow: getComputedStyle(t, "::before").content, size: getComputedStyle(t).fontSize, emBg: em ? getComputedStyle(em).backgroundColor : "none" };
    });
    check(tag + ": page titles are 20 px, beside the side bar, without OPERATIONS / …", s.titleL >= sb && s.titleW > 20 && (s.eyebrow === "none" || s.eyebrow === "normal") && s.size === "20px", s);
    check(tag + ": Staff status is plain text with a dot, not a filled pill", s.emBg === "none" || s.emBg === "rgba(0, 0, 0, 0)", s);
    check(tag + ": no sideways scrolling on Staff & access", await noSideScroll(page));
    await page.context().close();
  }
  // Phones keep the bottom bar
  const page = await phone(browser, deskDb(theme), { width: 390 }); await page.setViewportSize({ width: 390, height: 844 });
  await open(page); await sleep(400);
  const n = await page.evaluate(() => { const r = document.getElementById("bnav").getBoundingClientRect(); return { bottom: Math.round(r.bottom), w: Math.round(r.width), h: innerHeight, desk: document.body.classList.contains("ops-desk") }; });
  check("Desk (" + theme + " 390): phones keep the bottom bar across the width", !n.desk && n.bottom >= n.h - 1 && n.w === 390, n);
  await page.context().close();
});
// Other looks with a wide screen keep no side bar
await scenario(async () => {
  const page = await phone(browser, deskDb("stdplus"), { width: 1440 }); await page.setViewportSize({ width: 1440, height: 900 });
  await open(page); await sleep(400);
  const r = await page.evaluate(() => { const b = document.getElementById("bnav").getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; });
  check("Desk: Standard with features at 1440 px has no side bar", !(r.w < 300 && r.h > 600), r);
  await page.context().close();
});
// 1 Nov fixes from the user's photos: the minimised Calls bar sat over the figures; open, the board's buttons ran off
// screen; buttons with a time and name pushed CLEAR / PT out; the menu kept OPERATIONS / MENU.
for (const theme of ["ops", "ops-refined"]) await scenario(async () => {
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  const db = deskDb(theme); db.company.brand = { ...db.company.brand, calls: true }; db.company.calls = { on: true };
  db.callsLog = [{ id: 91, company_id: "c1", at: ago(2), from_number: "+447700900123", booking_id: "w2", kind: "drops", reg: "CD34EFG", name: "X", status: "missed", handled_name: "", handled_by: null }];
  for (const [width, sb] of [[1440, 224], [1600, 224], [1280, 64]]) {
    const tag = "Desk calls (" + theme + " " + width + ")";
    const page = await phone(browser, structuredClone(db), { width }); await page.setViewportSize({ width, height: 900 });
    await open(page); await page.waitForSelector("#callQueueToggle"); await sleep(400);
    const g = await page.evaluate(() => {
      const q = document.getElementById("callQueue").getBoundingClientRect(), hits = [...document.querySelectorAll("#tally button, #colHead, #boardHead")].map((e) => e.getBoundingClientRect());
      return { qTop: q.top, qBottom: q.bottom, h: innerHeight, over: hits.some((r) => r.width && !(r.bottom <= q.top || r.top >= q.bottom || r.right <= q.left || r.left >= q.right)) };
    });
    check(tag + ": the minimised Calls bar sits at the foot, over none of the figures or headings", g.qBottom >= g.h - 24 && !g.over, g);
    await page.click("#callQueueToggle"); await page.waitForSelector("#callPop"); await sleep(400);
    const o = await page.evaluate(() => {
      const q = document.getElementById("callQueue").getBoundingClientRect(), nav = document.getElementById("bnav").getBoundingClientRect(), bar = document.querySelector(".bar").getBoundingClientRect();
      const rows = [...document.querySelectorAll("#main .drow")].map((r) => r.querySelector(".acts").getBoundingClientRect().right);
      return { qL: q.left, qT: q.top, navW: Math.round(nav.width), barB: bar.bottom, rows };
    });
    check(tag + ": open, the dock starts under the top bar, the side bar is the icon rail and every row's buttons stay clear of it", o.qT >= o.barB && o.navW === 64 && o.rows.length > 3 && o.rows.every((r) => r <= o.qL), o);
    await page.context().close();
  }
  const page = await phone(browser, deskDb(theme), { width: 1440 }); await page.setViewportSize({ width: 1440, height: 900 }); await open(page); await sleep(400);
  await page.evaluate(() => document.querySelector("#bnav [data-bn=menuBtn]").click()); await page.waitForSelector("#menu[open]"); await sleep(300);
  const e = await page.evaluate(() => getComputedStyle(document.querySelector("#menuBody > h2"), "::before").content);
  check("Desk (" + theme + "): the menu has no OPERATIONS / MENU line", e === "none" || e === "normal", e);
  await page.context().close();
});
// Second pass (1 Nov): a selected PICKS figure kept its number visible; the menu has no swipe settings on a desk;
// Settings and the Dashboard have their sections as tabs along the top, not a second side list.
for (const theme of ["ops", "ops-refined"]) await scenario(async () => {
  const page = await phone(browser, deskDb(theme), { width: 1440 }); await page.setViewportSize({ width: 1440, height: 900 }); await open(page); await sleep(500);
  await page.click('#kindBar [data-kind="picks"]'); await sleep(700);
  await page.click('#catTally [data-cat="shortleft"]'); await sleep(500);
  const c = await page.evaluate(() => { const b = document.querySelector('#catTally [data-cat="shortleft"]'), n = b.querySelector(".num"); return { on: b.classList.contains("on"), num: getComputedStyle(n).color, bg: getComputedStyle(b).backgroundColor }; });
  check("Desk (" + theme + "): a selected PICKS figure keeps its number readable", c.on && c.num !== "rgb(255, 255, 255)" && c.bg !== "rgba(0, 0, 0, 0)", c);
  await page.click('#kindBar [data-kind="drops"]'); await sleep(600);
  await page.evaluate(() => document.querySelector("#bnav [data-bn=menuBtn]").click()); await page.waitForSelector("#menu[open]"); await sleep(300);
  const sw = await page.evaluate(() => { const g = document.querySelector("#menuBody .swipestep"); return g ? g.getBoundingClientRect().height : 0; });
  check("Desk (" + theme + "): no swipe settings in the desk menu", sw === 0, sw);
  await page.click('#menuBody [data-view="settings"]'); await sleep(900);
  const st = await page.evaluate(() => { const n = document.querySelector(".set-nav").getBoundingClientRect(), b = document.querySelector(".set-desk .box").getBoundingClientRect(); return { navW: n.width, navB: n.bottom, boxT: b.top }; });
  check("Desk (" + theme + "): Settings sections are tabs along the top", st.navW > 600 && st.navB <= st.boxT, st);
  await page.context().close();
});
