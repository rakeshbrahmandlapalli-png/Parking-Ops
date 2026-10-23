import { check, sleep, makeDb, phone, open, noSideScroll, scenario, browser, apbDb } from "../harness.mjs";

// 18a3d4. Settings: each section opens on its own, with what it's set to on its header; unsaved changes are kept from being lost.
for (const theme of ["stdplus", "ops", "premium", "board"]) await scenario(async () => {
  const db = apbDb(theme); db.company.capacity = 800; db.company.exit_fee = 10; db.company.exit_free = ["CAP"];
  const page = await phone(browser, db), asked = [];
  let answer = false;
  page.removeAllListeners("dialog"); page.on("dialog", (d) => { asked.push(d.type() + ": " + d.message()); answer ? d.accept() : d.dismiss(); });
  await open(page); await sleep(300);
  await page.click('#bnav [data-bn="menuBtn"]'); await sleep(250); await page.click('#menuBody [data-view="settings"]'); await sleep(400);
  const openBodies = () => page.locator("#main .setbody:not([hidden])").count();
  const heads = await page.locator("#main .sethead").allInnerTexts();
  check("Settings sections (" + theme + "): all closed to start, each header says what it's set to", await openBodies() === 0 && heads.length >= 7
    && heads.some((h) => /Car park capacity\s+800 spaces/.test(h)) && heads.some((h) => /Flight checks\s+Automatic checks on/.test(h)) && heads.some((h) => /Exit fee\s+£10/.test(h)) && !(await page.isVisible("#setUnsaved")), heads);
  await page.click('[data-setsec="cap"]'); await sleep(200);
  check("Settings sections (" + theme + "): a header opens its section", await openBodies() === 1 && await page.isVisible("#capTotal") && await page.getAttribute('[data-setsec="cap"]', "aria-expanded") === "true");
  await page.click('[data-setsec="exit"]'); await sleep(200);
  check("Settings sections (" + theme + "): opening another closes the first", await openBodies() === 1 && await page.isVisible("#exitFee") && !(await page.isVisible("#capTotal")));
  await page.fill("#exitFee", "12");
  check("Settings sections (" + theme + "): typing shows the unsaved bar", await page.isVisible("#setUnsaved") && /Unsaved changes in Exit fee/.test(await page.innerText("#setUnsaved")));
  await page.click('[data-setsec="cap"]'); await sleep(200);
  check("Settings sections (" + theme + "): opening another section with unsaved changes asks, and No keeps them", asked.length === 1 && /Unsaved changes in Exit fee/.test(asked[0]) && await page.inputValue("#exitFee") === "12" && await page.isVisible("#exitFee"), asked);
  await page.click('#bnav [data-bn="logBtn"]'); await sleep(300);
  check("Settings sections (" + theme + "): leaving for another page asks, and No stays on Settings", asked.length === 2 && await page.isVisible("#exitFee") && await page.inputValue("#exitFee") === "12", asked);
  await page.click("#bnBoard"); await sleep(300);
  check("Settings sections (" + theme + "): Board asks too", asked.length === 3 && await page.isVisible("#exitFee"), asked);
  // A redraw (here: a flight checks change) keeps what was typed.
  await page.evaluate(() => { const s = document.querySelector('[data-setting="live_every_min"]'); s.value = "60"; s.dispatchEvent(new Event("change", { bubbles: true })); }); await sleep(200);
  check("Settings sections (" + theme + "): a redraw keeps what was typed", await page.inputValue("#exitFee") === "12" && /Exit fee/.test(await page.innerText("#setUnsaved")) && /Flight checks/.test(await page.innerText("#setUnsaved")));
  if (theme === "stdplus") {
    const r = await page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
    check("Settings sections: closing the app with unsaved changes asks first", r);
  }
  await page.click("#setUnsaved [data-savedirty]"); await sleep(500);
  const c = db.calls.filter((x) => x.fn === "set_exit_fee").pop();
  const f = db.calls.filter((x) => x.fn === "set_flight_settings").pop();
  check("Settings sections (" + theme + "): Save changes on the bar saves every section with changes", c && c.args.p_fee === 12 && JSON.stringify(c.args.p_free) === '["CAP"]' && /£12/.test(await page.innerText('[data-setsec="exit"]')) && await page.inputValue("#exitFee") === "12" && f && f.args.p.live_every_min === 60, [c, f]);
  check("Settings sections (" + theme + "): nothing unsaved, no bar", !(await page.isVisible("#setUnsaved")));
  await page.fill("#exitFee", "15"); answer = true;
  await page.click('[data-setsec="exit"]'); await sleep(300);
  check("Settings sections (" + theme + "): closing a section with unsaved changes asks; Yes puts back what's saved", asked.length === 4 && await openBodies() === 0 && await page.inputValue("#exitFee") === "12" && !(await page.isVisible("#setUnsaved")), asked);
  await page.click('[data-setsec="flights"]'); await sleep(200); await page.selectOption('[data-setting="before_min"]', "60"); await sleep(200);
  check("Settings sections (" + theme + "): Flight checks changes show the bar", /Unsaved changes in Flight checks/.test(await page.innerText("#setUnsaved")));
  check("Settings sections (" + theme + "): nothing on the page runs off the side", await page.evaluate(() => [...document.querySelectorAll("#main *")].every((e) => e.getBoundingClientRect().right <= innerWidth + 1)));
  await page.click('#bnav [data-bn="logBtn"]'); await sleep(400);
  check("Settings sections (" + theme + "): Yes leaves Settings", asked.length === 5 && !(await page.locator("#exitFee").count()), asked);
  check("Settings sections (" + theme + "): no errors", page.__errors.length === 0, page.__errors);
});
await scenario(async () => {
  const db = apbDb("standard"); db.company.brand = { ...db.company.brand, theme: undefined };
  const page = await phone(browser, db), asked = [];
  page.removeAllListeners("dialog"); page.on("dialog", (d) => { asked.push(d.message()); d.dismiss(); });
  await open(page); await sleep(300);
  await page.click("#menuBtn"); await sleep(300); await page.click('#menuBody [data-view="settings"]'); await sleep(400);
  check("Settings sections: Standard keeps its open boxes", await page.locator("#main .setsec, #setUnsaved").count() === 0 && await page.isVisible("#capTotal") && await page.isVisible('[data-setting="enabled"]'));
  await page.fill("#capTotal", "50"); await page.click("#menuBtn"); await sleep(300); await page.click('#menuBody [data-view="board"]'); await sleep(300);
  check("Settings sections: Standard doesn't ask on leaving", asked.length === 0 && !(await page.locator("#capTotal").count()), asked);
});

// The Operations desktop (groups) and Operations Refined (tabs) keep their layouts, and still ask before unsaved changes are lost.
for (const [theme, width] of [["ops", 1200], ["ops-refined", 390]]) await scenario(async () => {
  const db = apbDb(theme); db.company.exit_fee = 10;
  const page = await phone(browser, db, { width }), asked = [];
  page.removeAllListeners("dialog"); page.on("dialog", (d) => { asked.push(d.message()); d.dismiss(); });
  await open(page); await sleep(300);
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]:not(.hidden)") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(250);
  await page.click('#menuBody [data-view="settings"]'); await sleep(400);
  check("Settings sections (" + theme + " " + width + " px): its own layout, no fold-away headers", await page.locator("#main .setsec").count() === 0 && await page.locator("#main [data-sec]").count() >= 6);
  if (theme === "ops-refined") { await page.click('.set-tabs [data-settab="charges"]'); await sleep(150); }
  await page.fill("#exitFee", "12");
  if (theme === "ops") check("Settings sections (Operations desktop): the bar names the unsaved section", /Unsaved changes in Exit fee/.test(await page.innerText("#setUnsaved")));
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]:not(.hidden)") || document.getElementById("menuBtn")).click()); await sleep(250);
  await page.click('#menuBody [data-view="board"]').catch(() => {}); await sleep(300);
  check("Settings sections (" + theme + " " + width + " px): leaving with unsaved changes asks, No stays", asked.length === 1 && /Exit fee/.test(asked[0]) && await page.inputValue("#exitFee") === "12", asked);
  check("Settings sections (" + theme + "): no errors", page.__errors.length === 0, page.__errors);
});
