import { fs, path, ROOT, check, sleep, TONIGHT, addDays, makeDb, deskDb, phone, open, text, noSideScroll, toast, pickKind, scenario, browser } from "../harness.mjs";

// Operations Refined (brand theme "ops-refined", html.ops-refined, ops-refined.css): the
// Operations pages and features in their own stylesheet. Nothing here may change another look.
const refined = () => deskDb("ops-refined");
const calls = (db, fn) => db.calls.filter((c) => c.fn === fn);

// The files: its own stylesheet, linked, cached for offline, every rule under html.ops-refined.
await scenario(async () => {
  const css = fs.readFileSync(path.join(ROOT, "ops-refined.css"), "utf8"), html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  check("Operations Refined: index.html links ops-refined.css after ops.css", /href="\/ops\.css">\s*<link rel="stylesheet" href="\/ops-refined\.css">/.test(html));
  check("Operations Refined: the offline cache keeps ops-refined.css, with a new cache name", /"\/ops-refined\.css"/.test(sw) && !/takeoff-ops-v11"/.test(sw) && /const CACHE = "takeoff-ops-v\d+"/.test(sw));
  // Every selector in the file starts with html.ops-refined (so no other look can wear it).
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean)
    .flatMap((sel) => sel.split(/,(?![^(]*\))/).map((x) => x.trim())).filter((s) => s && !s.startsWith("html.ops-refined"));
  check("Operations Refined: every rule in ops-refined.css sits under html.ops-refined", bare.length === 0, bare.slice(0, 5));
  check("Operations Refined: no fixed TakeOff amber in its stylesheet (the brand colour comes from the client)", !/#f9a01b/i.test(css));
  check("Operations: ops.css never mentions the new look", !/ops-refined/.test(fs.readFileSync(path.join(ROOT, "ops.css"), "utf8")));
});

// The look on a phone: its classes, the Operations features, its own colours; Operations keeps its own.
await scenario(async () => {
  const db = refined(), page = await phone(browser, db, { width: 390 }), ops = await phone(browser, deskDb("ops"), { width: 390 });
  await open(page); await open(ops); await sleep(300);
  const st = await page.evaluate(() => { const c = document.documentElement.classList; return { stdplus: c.contains("stdplus"), refined: c.contains("ops-refined"), ops: c.contains("ops"), bg: getComputedStyle(document.body).backgroundColor,
    bnav: getComputedStyle(document.getElementById("bnav")).display, kind: !document.getElementById("kindBar").classList.contains("hidden"), sheet: [...document.querySelectorAll("#sheetPick option")].map((o) => o.textContent),
    hot: getComputedStyle(document.querySelector("#main .sec.hot")).backgroundColor, sheets: [...document.styleSheets].some((s) => /ops-refined\.css$/.test(s.href || "")) }; });
  check("Operations Refined: html.stdplus + html.ops-refined, never html.ops", st.stdplus && st.refined && !st.ops, st);
  check("Operations Refined: pale grey page, bottom bar, Drops | Picks in the top bar", st.bg === "rgb(245, 247, 250)" && st.bnav === "flex" && st.kind, st);
  check("Operations Refined: the day picker says e.g. Today 22 Oct, without DROPS", st.sheet.some((x) => /^Today \d{1,2} \w{3,4}$/.test(x)) && st.sheet.every((x) => /^(Today|\w{3}) \d{1,2} \w{3,4}$/.test(x)), st.sheet);
  check("Operations Refined: Next in queue in deep navy (Operations keeps its blue)", st.hot === "rgb(15, 28, 46)" && await ops.evaluate(() => getComputedStyle(document.querySelector("#main .sec.hot")).backgroundColor) === "rgb(21, 88, 214)", st.hot);
  check("Operations Refined: the stylesheet is loaded", st.sheets);
  check("Operations: still html.ops only, and its day picker unchanged", await ops.evaluate(() => document.documentElement.classList.contains("ops") && !document.documentElement.classList.contains("ops-refined") && /· today$/.test(document.querySelector("#sheetPick option").textContent)));
  // Rows as dense as Operations': the same height, so as many jobs fit.
  const heights = (pg) => pg.evaluate(() => [...document.querySelectorAll("#main .row")].slice(0, 8).map((r) => Math.round(r.getBoundingClientRect().height)));
  check("Operations Refined: drops rows as tall as Operations' (as many jobs on the screen)", JSON.stringify(await heights(page)) === JSON.stringify(await heights(ops)), [await heights(page), await heights(ops)]);
  // TO DO counts cars not yet SENT, as everywhere.
  check("Operations Refined: TO DO counts cars not yet SENT", /TO DO \(13\)/.test(await text(page, "#tabTodo")), await text(page, "#tabTodo"));
  for (const w of [360, 390]) { await page.setViewportSize({ width: w, height: 800 }); await sleep(200);
    const bar = await page.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); return { pick: r("sheetPick").top, rf: r("refreshBtn").top, brand: r("menuBtn").top }; });
    check("Operations Refined: " + w + " px, brand, Drops | Picks, the day and refresh on one line", Math.abs(bar.pick - bar.brand) < 8 && Math.abs(bar.rf - bar.brand) < 8, bar);
    check("Operations Refined: " + w + " px, no sideways scrolling on the board", await noSideScroll(page)); }
  // SENT, CALLED, CLEAR as ever.
  await page.click('.row[data-id="w1"] [data-act="sent"]'); await sleep(400);
  check("Operations Refined: SENT saves (tap_drop) as in every look", calls(db, "tap_drop").some((c) => c.args.p_booking === "w1" && c.args.p_action === "sent" && c.args.p_on === true), db.calls.slice(-3));
  check("Operations Refined: SENT button marked with my name", /RAKESH/.test(await text(page, '.row[data-id="w1"] [data-act="sent"]')), await text(page, '.row[data-id="w1"] [data-act="sent"]'));
  check("Operations Refined: no errors on the board", page.__errors.length === 0, page.__errors);
});

// The cached look meets the server's: switching leaves no class or style behind.
await scenario(async () => {
  for (const [from, to, want] of [["ops-refined", "ops", "ops"], ["ops", "ops-refined", "ops-refined"], ["ops-refined", "", ""], ["premium", "ops-refined", "ops-refined"], ["ops-refined", "stdplus", "stdplus"]]) {
    const db = makeDb(); db.company.brand = { colour: "#1560BD", ink: "#FFFFFF", short: "Bay", theme: to };
    const page = await phone(browser, db, { width: 390 });
    await page.addInitScript((t) => { try { localStorage.setItem("takeoff_brand", JSON.stringify({ name: "X", brand: { theme: t, colour: "#F9A01B" } })); } catch (e) {} }, from);
    await open(page); await sleep(300);
    const c = await page.evaluate(() => ({ cls: [...document.documentElement.classList].filter((x) => ["ops", "ops-refined", "stdplus", "premium", "pboard", "cards", "pro"].includes(x)).sort().join(" "), bg: getComputedStyle(document.body).backgroundColor }));
    const expect = { ops: "ops stdplus", "ops-refined": "ops-refined stdplus", "": "", stdplus: "stdplus" }[want];
    check("Looks: " + (from || "Standard") + " remembered, " + (to || "Standard") + " from the server: only " + (to || "Standard") + "'s classes", c.cls === expect, c);
    await page.context().close();
  }
});

// Booking details: sections, read-only text, boxes saved by Save changes, taps that save at once, the footer's state.
await scenario(async () => {
  const db = refined(); db.company.exit_fee = 10; db.company.overstay_rate = 30;
  const page = await phone(browser, db, { width: 390 });
  await open(page);
  await page.click('.row[data-id="w6"] .reg'); await page.waitForSelector("#panel[open] .rf-sec");
  const p = await page.evaluate(() => ({ secs: [...document.querySelectorAll("#panelBody .rf-h")].map((h) => h.childNodes[0].textContent), sub: document.querySelector("#panelBody .sub").textContent,
    state: document.getElementById("carState").textContent, exitLabels: [...document.querySelectorAll("#panelBody label, #panelBody .det b")].filter((l) => /exit fee/i.test(l.textContent)).length,
    now: [...document.querySelectorAll("#panelBody .rf-now")].length, backRO: [...document.querySelectorAll("#panelBody .det b")].some((b) => b.textContent === "Back"), pressed: document.querySelector('#panelBody [data-setyard="T"]').getAttribute("aria-pressed"),
    foot: [...document.querySelectorAll("#panelBody .rf-foot button")].map((b) => b.textContent) }));
  check("Booking details (Refined): Customer & vehicle, Return & parking, Notes & status, Payments", p.secs.slice(0, 4).join("|") === "Customer & vehicle|Return & parking|Notes & status|Payments", p.secs);
  check("Booking details (Refined): the reg and the sheet under the title", /^KL12PQR #6 · Drops · \w{3} \d{1,2} \w{3}$/.test(p.sub), p.sub);
  check("Booking details (Refined): the exit fee shows once, in Payments", p.exitLabels === 1, p.exitLabels);
  check("Booking details (Refined): the return shows once (in its box, not also as text)", !p.backRO);
  check("Booking details (Refined): the yard and Mark as say they save when tapped; the yard picked is pressed", p.now >= 2 && p.pressed === "true", p);
  check("Booking details (Refined): Cancel / Save changes, no unsaved changes yet", p.foot.join("|") === "Cancel|Save changes" && p.state === "No unsaved changes", p);
  await page.fill("#noteText", "Customer called. Ready at terminal.");
  check("Booking details (Refined): typing says Unsaved changes", (await text(page, "#carState")) === "Unsaved changes" && await page.evaluate(() => document.getElementById("carState").classList.contains("dirty")));
  // A tap that saves at once redraws the panel; what was typed stays.
  await page.click('#panelBody [data-setyard="NY"]'); await sleep(400);
  check("Booking details (Refined): tapping a yard saves it at once (set_yard)", calls(db, "set_yard").some((c) => c.args.p_booking === "w6" && c.args.p_yard === "NY"), calls(db, "set_yard"));
  check("Booking details (Refined): the typed note is still there after the yard tap, still unsaved", (await page.inputValue("#noteText")) === "Customer called. Ready at terminal." && (await text(page, "#carState")) === "Unsaved changes");
  // A box Save changes can't take: said in the footer, nothing saved.
  await page.fill("#retT", "99:99"); await page.click("#panelBody [data-savepanel]"); await sleep(200);
  check("Booking details (Refined): a bad time is said in the footer, in red, and nothing is saved", /Type the time/.test(await text(page, "#carState")) && await page.evaluate(() => document.getElementById("carState").classList.contains("bad")) && !calls(db, "set_note").length);
  await page.fill("#retT", "12:40"); await page.click("#panelBody [data-savepanel]"); await sleep(500);
  check("Booking details (Refined): Save changes saves the note and closes", calls(db, "set_note").some((c) => c.args.p_booking === "w6" && c.args.p_note === "Customer called. Ready at terminal.") && !(await page.$("#panel[open]")), calls(db, "set_note"));
  check("Booking details (Refined): Saved", /Saved/.test(await toast(page)), await toast(page));
  // The return date changed by the office: set_return as in Operations.
  await page.click('.row[data-id="w1"] .reg'); await page.waitForSelector("#panel[open] #retD");
  await page.fill("#retD", addDays(TONIGHT, 2)); await page.fill("#retT", "10:15");
  check("Booking details (Refined): a new return date is unsaved until Save", (await text(page, "#carState")) === "Unsaved changes");
  await page.click("#panelBody [data-savepanel]"); await sleep(500);
  check("Booking details (Refined): Save changes moves the return (set_return)", calls(db, "set_return").some((c) => c.args.p_booking === "w1" && c.args.p_return_local === addDays(TONIGHT, 2) + " 10:15"), calls(db, "set_return"));
  // Cancel leaves everything as it was.
  await page.click('.row[data-id="w2"] .reg'); await page.waitForSelector("#panel[open] #noteText");
  const before = db.calls.length; await page.fill("#noteText", "not this"); await page.click("#panelBody .rf-foot [data-close]"); await sleep(300);
  check("Booking details (Refined): Cancel closes and saves nothing", !(await page.$("#panel[open]")) && !db.calls.slice(before).some((c) => c.fn === "set_note"));
  // The last box stays reachable above the footer.
  await page.setViewportSize({ width: 360, height: 640 });
  await page.click('.row[data-id="w2"] .reg'); await page.waitForSelector("#panel[open] .rf-foot");
  await page.evaluate(() => { const p = document.getElementById("panel"); p.scrollTop = p.scrollHeight; }); await sleep(200);
  const reach = await page.evaluate(() => { const f = document.querySelector("#panelBody .rf-foot").getBoundingClientRect(), secs = [...document.querySelectorAll("#panelBody .rf-sec")], last = secs[secs.length - 1].getBoundingClientRect(); return { foot: f.top, last: last.bottom, side: document.getElementById("panel").scrollWidth <= document.getElementById("panel").clientWidth + 1 }; });
  check("Booking details (Refined): 360 px, the last section ends above the footer and nothing runs off the side", reach.last <= reach.foot + 1 && reach.side, reach);
  await page.focus("#noteText"); await sleep(500);
  const nb = await page.evaluate(() => ({ note: document.getElementById("noteText").getBoundingClientRect().bottom, foot: document.querySelector("#panelBody .rf-foot").getBoundingClientRect().top }));
  check("Booking details (Refined): the note box being typed in sits above Cancel / Save changes", nb.note <= nb.foot, nb);
  check("Booking details (Refined): no errors", page.__errors.length === 0, page.__errors);
});

// PICKS car: drop-off moved, return changed, return flight, the location tap.
await scenario(async () => {
  const db = refined(); db.sheets.push({ id: "p1", company_id: "c1", kind: "picks", day: addDays(TONIGHT, 1) });
  const page = await phone(browser, db, { width: 390 });
  await open(page); await pickKind(page, "picks");
  await page.click('.row[data-id="pk2"] .reg'); await page.waitForSelector("#panel[open] #dropD");
  const s = await page.evaluate(() => [...document.querySelectorAll("#panelBody .rf-h")].map((h) => h.childNodes[0].textContent));
  check("Booking details (Refined, PICKS): Customer & vehicle, Drop-off & parking, Notes & status", s.slice(0, 3).join("|") === "Customer & vehicle|Drop-off & parking|Notes & status", s);
  check("Booking details (Refined, PICKS): drop-off, return, return flight and location all there", await page.evaluate(() => ["dropD", "dropT", "retD", "retT", "pickFlightText"].every((id) => document.getElementById(id)) && !!document.querySelector("#panelBody [data-setyard]")));
  await page.fill("#pickFlightText", "W43451"); await page.fill("#dropD", addDays(TONIGHT, 1)); await page.fill("#retT", "10:30");
  await page.click("#panelBody [data-savepanel]"); await sleep(600);
  check("Booking details (Refined, PICKS): return flight saved (set_pick_flight)", calls(db, "set_pick_flight").some((c) => c.args.p_booking === "pk2" && c.args.p_flight === "W43451"), calls(db, "set_pick_flight"));
  check("Booking details (Refined, PICKS): drop-off moved after the question (move_pick)", page.__dialogs.some((d) => /^Move PB22BBB to PICKS/.test(d)) && calls(db, "move_pick").some((c) => c.args.p_booking === "pk2"), [page.__dialogs, calls(db, "move_pick")]);
  check("Booking details (Refined, PICKS): return changed (set_pick_return)", calls(db, "set_pick_return").some((c) => c.args.p_booking === "pk2" && /10:30$/.test(c.args.p_return_local)), calls(db, "set_pick_return"));
  check("Booking details (Refined, PICKS): no errors", page.__errors.length === 0, page.__errors);
});

// Who sees what: a driver gets no office boxes, the view-only login no buttons, Settings only for owners and managers.
await scenario(async () => {
  for (const role of ["bongo", "view", "manager"]) {
    const db = refined(); db.me = { ...db.me, role };
    if (role === "bongo") db.perms = { sent: true, rtc: true, note: true, intake: true };
    if (role === "view") db.perms = {};
    if (role === "manager") db.perms = { sent: true, called: true, clear: true, note: true, intake: true, import: true, flights: true, yard: true, settings: true, log: true, summary: true };
    const page = await phone(browser, db, { width: 390 });
    await open(page);
    await page.click('.row[data-id="w1"] .reg'); await page.waitForSelector("#panel[open]");
    const c = await page.evaluate(() => ({ ret: !!document.getElementById("retD"), reg: !!document.getElementById("regText"), note: !!document.getElementById("noteText"), save: !!document.querySelector("#panelBody [data-savepanel]"), close: [...document.querySelectorAll("#panelBody .rf-foot button")].map((b) => b.textContent).join("|") }));
    if (role === "bongo") check("Operations Refined, driver: a note box, no return or reg boxes", c.note && !c.ret && !c.reg && c.save, c);
    if (role === "view") check("Operations Refined, view only: nothing to edit, just Close", !c.note && !c.ret && !c.save && c.close === "Close", c);
    await page.keyboard.press("Escape"); await sleep(200);
    await page.click('#bnav [data-bn="menuBtn"]'); await page.waitForSelector("#menu[open]");
    const set = await page.$('#menuBody [data-view="settings"]');
    if (role === "manager") {
      check("Operations Refined, manager: Settings in the menu", !!set);
      if (set) { await set.click(); await sleep(400);
        const tabs = await page.evaluate(() => [...document.querySelectorAll(".set-tabs [data-settab]")].map((b) => b.textContent));
        check("Operations Refined, manager: no owner-only sections (booking website, backup)", tabs.length && !tabs.includes("Booking website") && !tabs.includes("Backup"), tabs); }
    } else check("Operations Refined, " + role + ": no Settings in the menu", !set);
    await page.context().close();
  }
});

// Settings on a phone: the sections as tabs, one open; unsaved changes said in the box being edited.
await scenario(async () => {
  const db = refined(); const page = await phone(browser, db, { width: 390 });
  await open(page);
  await page.click('#bnav [data-bn="menuBtn"]'); await page.waitForSelector("#menu[open]"); await page.click('#menuBody [data-view="settings"]'); await sleep(500);
  const t = await page.evaluate(() => ({ tabs: [...document.querySelectorAll(".set-tabs [data-settab]")].map((b) => b.textContent + (b.getAttribute("aria-selected") === "true" ? "*" : "")), shown: [...document.querySelectorAll("main .set-group")].filter((g) => !g.hidden).map((g) => g.id) }));
  check("Settings (Refined): six tabs, Parking open first, one section shown", t.tabs.join("|") === "Parking*|Flights|Charges|Alerts|Booking website|Backup" && t.shown.join() === "set-parking", t);
  await page.click('[data-settab="flights"]'); await sleep(150);
  check("Settings (Refined): Flights tab shows only Flight checks", await page.evaluate(() => [...document.querySelectorAll("main .set-group")].filter((g) => !g.hidden).map((g) => g.id).join() === "set-flights" && document.querySelector('[data-settab="flights"]').getAttribute("aria-selected") === "true"));
  check("Settings (Refined): every setting appears once (one Automatic checks control)", await page.locator('[data-setting="enabled"]').count() === 1);
  await page.selectOption('[data-setting="live_every_min"]', "15"); await sleep(300);
  const d = await page.evaluate(() => ({ banner: !!document.querySelector(".ops-unsaved"), dirty: (document.querySelector("#set-flights .rf-dirty") || {}).textContent, shown: [...document.querySelectorAll("main .set-group")].filter((g) => !g.hidden).map((g) => g.id).join() }));
  check("Settings (Refined): a change says Unsaved changes in Flight checks only, and the tab stays open", !d.banner && d.dirty === "Unsaved changes" && d.shown === "set-flights", d);
  await page.click("#set-flights [data-savesettings]"); await sleep(400);
  check("Settings (Refined): Save flight settings saves (set_flight_settings) and clears the note", calls(db, "set_flight_settings").some((c) => c.args.p.live_every_min === 15) && (await text(page, "#set-flights .rf-dirty")) === "", calls(db, "set_flight_settings"));
  // A typed value in another tab survives switching tabs.
  await page.click('[data-settab="charges"]'); await page.fill("#ovRate", "45"); await page.click('[data-settab="parking"]'); await page.click('[data-settab="charges"]');
  check("Settings (Refined): switching tabs keeps what was typed", (await page.inputValue("#ovRate")) === "45");
  await page.click("[data-saverate]"); await sleep(400);
  check("Settings (Refined): Save rate saves", calls(db, "set_overstay_rate").some((c) => +c.args.p_rate === 45), calls(db, "set_overstay_rate"));
  for (const w of [360, 768]) { await page.setViewportSize({ width: w, height: 800 }); await sleep(200); check("Settings (Refined): " + w + " px, no sideways scrolling", await noSideScroll(page)); }
  await page.setViewportSize({ width: 1280, height: 900 }); await sleep(400);
  check("Settings (Refined): a desktop keeps the grouped layout with its side list", await page.evaluate(() => !!document.querySelector("main .set-desk .set-nav") && !document.querySelector(".set-tabs")));
  check("Settings (Refined): no errors", page.__errors.length === 0, page.__errors);
});

// Shift summary, Flights, Key check and the desktop tables.
await scenario(async () => {
  const db = refined(); db.activity = [{ at: new Date(Date.now() - 600000).toISOString(), action: "SENT", value: "", reg: "KL12PQR", staff_id: "s2", staff_name: "SUGU", booking_id: "w6" }];
  const page = await phone(browser, db, { width: 360 });
  await open(page);
  await page.click('#bnav [data-bn="logBtn"]'); await sleep(500);
  const s = await page.evaluate(() => ({ big: (document.querySelector("#main .stat.big") || {}).innerText, scope: (document.querySelector("#main .ops-scope") || {}).innerText, strip: [...document.querySelectorAll("#main .ops-strip span")].map((x) => x.textContent).join("|"), act: [...document.querySelectorAll("#main .actrow")].length }));
  check("Shift summary (Refined): cars back, % done and how many to go, from the board's own cars", /Cars back\s*1 \/ 16/.test(s.big) && /6% done · 15 to go/.test(s.big), s.big);
  check("Shift summary (Refined): names the sheet, day and shift hours", /^DROPS · Today 22|^DROPS · \w{3} \d{1,2} \w{3} · 06:00 \w{3} to 05:59 \w{3}/.test(s.scope) || /DROPS · .* · 06:00 \w{3} to 05:59 \w{3}/.test(s.scope), s.scope);
  check("Shift summary (Refined): the same numbers as Operations, and the activity", s.strip === "On the way|Overstays|Complaints" && s.act === 1, s);
  check("Shift summary (Refined): 360 px, no sideways scrolling", await noSideScroll(page));
  await page.click('#bnav [data-bn="flBtn"]'); await sleep(500);
  const f = await page.evaluate(() => ({ rows: document.querySelectorAll("#main .ops-flin").length, sch: (document.querySelector("#main .ops-flt small") || {}).textContent }));
  check("Flights (Refined): a line per flight, Sch / Est words", f.rows > 10 && f.sch === "Sch", f);
  check("Flights (Refined): 360 px, no sideways scrolling", await noSideScroll(page));
  await page.click("#bnBoard"); await sleep(300);
  check("Key check (Refined): K beside TO DO / ALL", await page.isVisible("#keyBtn"));
  await page.click("#keyBtn"); await page.waitForSelector("[data-keystart]"); await page.click("[data-keystart]"); await page.waitForSelector(".kc-row");
  check("Key check (Refined): the shared check starts (key_check_start)", db.calls.some((c) => /^key_check_start/.test(c.fn)), db.calls.filter((c) => /^key_check/.test(c.fn)).map((c) => c.fn));
  check("Key check (Refined): 360 px, no sideways scrolling", await noSideScroll(page));
  await page.click("#keyBtn"); await sleep(300);
  // Desktop: the Operations tables and tabs.
  await page.setViewportSize({ width: 1440, height: 1000 }); await sleep(400);
  const d = await page.evaluate(() => ({ desk: document.body.classList.contains("ops-desk"), drow: document.querySelectorAll("#main .row.drow").length, tabs: getComputedStyle(document.getElementById("bnav")).position, head: !!document.querySelector("#opsHead h1") }));
  check("Operations Refined desktop: the DROPS table, tabs under the top bar", d.desk && d.drow > 10 && d.tabs === "relative" && d.head, d);
  await page.click('.row[data-id="w6"] .reg'); await page.waitForSelector("#panel[open] .rf-2col");
  check("Operations Refined desktop: Booking details in two columns", await page.evaluate(() => document.querySelectorAll("#panelBody .rf-2col > .rf-col").length === 2));
  await page.keyboard.press("Escape"); await sleep(300);
  await pickKind(page, "picks"); await sleep(300);
  check("Operations Refined desktop: the PICKS table", await page.evaluate(() => document.querySelectorAll("#main .row.drow .dc-b").length > 3));
  check("Operations Refined desktop: yard colour dots by the counts", await page.evaluate(() => /html\.ops-refined body\.ops-desk #tally/.test((document.getElementById("yardColours") || {}).textContent || "")));
  check("Operations Refined: no errors on summary, flights, key check and desktop", page.__errors.length === 0, page.__errors);
});
