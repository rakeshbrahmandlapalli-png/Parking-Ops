import { check, sleep, makeDb, phone, open, scenario, browser, dashData, dashExit, dashSheets } from "../harness.mjs";

// The dashboard while it loads: the period bar (24 hours / 7 days / 30 days) looks and sits exactly as on
// the loaded page, in every look, so nothing jumps when the figures arrive.
const LOOKS = ["", "pro", "cards", "premium", "board", "stdplus", "ops", "ops-refined"];
for (const theme of LOOKS) await scenario(async () => {
  const look = theme || "standard";
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#1560BD", ink: "#FFFFFF", short: "Parking Bay" };
  db.company.exit_fee = 10; db.dash = dashData(); db.dash.exit = dashExit(); dashSheets(db);
  let release; db.dashGate = new Promise((r) => { release = r; });
  const page = await phone(browser, db);
  await open(page); await sleep(400);
  await page.evaluate(() => { const b = [...document.querySelectorAll('#bnav [data-bn=menuBtn], #cHead:not(.hidden), #menuBtn')].find((e) => e.offsetParent); b.click(); });
  await page.waitForSelector("#menu[open]"); await sleep(300);
  await page.click('#menuBody [data-view="dashboard"]'); await sleep(500);
  // What the period bar looks like: each button's place, size, colours and border, and the bar's own.
  const bar = () => page.evaluate(() => {
    const st = (e) => { const c = getComputedStyle(e), r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), c.backgroundColor, c.color, c.borderTopWidth, c.borderTopColor, c.borderRadius, c.fontSize, c.fontWeight]; };
    const g = document.querySelector('#main [data-dashp]').parentElement;
    return { bar: st(g), x: [...g.querySelectorAll("[data-dashp]")].map((b) => [b.textContent, b.classList.contains("on"), ...st(b), Math.round(b.getBoundingClientRect().left)]) };
  });
  const loading = await bar();
  const busyText = (await page.locator("#main").innerText()).includes("Loading…");
  release(); db.dashGate = null; await sleep(800);
  const loaded = await bar();
  check("Dashboard loading (" + look + "): it says Loading… while the figures come", busyText);
  check("Dashboard loading (" + look + "): the period bar looks the same loading as loaded", JSON.stringify(loading) === JSON.stringify(loaded), { loading, loaded });
  if (["stdplus", "ops", "ops-refined"].includes(theme)) {
    check("Dashboard loading (" + look + "): the loaded head's place is kept", await page.locator("#main .od-head .dchips").count() === 1);
  }
}, "dashload");
