import { fs, path, ROOT, check, sleep, TONIGHT, addDays, makeDb, deskDb, phone, open, text, noSideScroll, toast, pickKind, scenario, browser, biDb, dashData, dashExit } from "../harness.mjs";

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
    hot: getComputedStyle(document.querySelector("#main .sec.hot")).boxShadow, sheets: [...document.styleSheets].some((s) => /ops-refined\.css$/.test(s.href || "")) }; });
  check("Operations Refined: html.stdplus + html.ops-refined, never html.ops", st.stdplus && st.refined && !st.ops, st);
  check("Operations Refined: pale grey page, bottom bar, Drops | Picks in the top bar", st.bg === "rgb(245, 247, 250)" && st.bnav === "flex" && st.kind, st);
  check("Operations Refined: the day picker says e.g. Today 22 Oct, without DROPS", st.sheet.some((x) => /^Today \d{1,2} \w{3,4}$/.test(x)) && st.sheet.every((x) => /^(Today|\w{3}) \d{1,2} \w{3,4}$/.test(x)), st.sheet);
  check("Operations Refined: Next in queue marked by the brand's edge (Operations keeps its blue band)", /rgb\(249, 160, 27\).*inset|inset.*rgb\(249, 160, 27\)/.test(st.hot) && await ops.evaluate(() => getComputedStyle(document.querySelector("#main .sec.hot")).backgroundColor) === "rgb(21, 88, 214)", st.hot);
  check("Operations Refined: the stylesheet is loaded", st.sheets);
  check("Operations: still html.ops only, and its day picker unchanged", await ops.evaluate(() => document.documentElement.classList.contains("ops") && !document.documentElement.classList.contains("ops-refined") && /· today$/.test(document.querySelector("#sheetPick option").textContent)));
  // Its own rows: the reg on its own line with the yard and number, then car · customer, then flight · times; the
  // three buttons in words. A plain row stays compact (no taller than the picture's), the buttons big enough to tap.
  const rw = await page.evaluate(() => { const r = document.querySelector('#main .row[data-id="w1"]'), b = r.querySelector('[data-act="sent"]').getBoundingClientRect();
    return { rfr: r.classList.contains("rfr"), l1: [r.querySelector(".reg").textContent, r.querySelector(".l1 .code").value, r.querySelector(".l1 .dn").textContent].join(" "), who: r.querySelector(".rfw").textContent, fl: r.querySelector(".rft").innerText.replace(/\s+/g, " "),
      acts: [...r.querySelectorAll(".acts button")].map((x) => x.textContent), h: Math.round(r.getBoundingClientRect().height), bh: Math.round(b.height), bw: Math.round(b.width), ops: !!document.querySelector("#main .row:not(.rfr)") }; });
  check("Operations Refined: its own rows (reg · yard · number, then car · customer, then flight · times)", rw.rfr && !rw.ops && rw.l1 === "AB12CDE CP #1" && rw.who === "KIA · Taylor Mrs" && rw.fl === "U22001 11:45 → 11:47", rw);
  check("Operations Refined: Sent / Called / Clear in words, buttons at least 48 px tall", rw.acts.join("|") === "Sent|Called|Clear" && rw.bh >= 48 && rw.bw >= 54, rw);
  check("Operations Refined: a plain row is no taller than 76 px", rw.h <= 76, rw);
  check("Operations: its rows unchanged (no Refined row, its capital words)", await ops.evaluate(() => !document.querySelector("#main .row.rfr") && document.querySelector('#main .row[data-id="w1"] [data-act="sent"]').textContent === "SENT"));
  // TO DO counts cars not yet SENT, as everywhere.
  check("Operations Refined: To do counts cars not yet SENT", /^To do 13$/.test(await text(page, "#tabTodo")) && /^All 16$/.test(await text(page, "#tabAll")), await text(page, "#tabTodo"));
  for (const w of [360, 390]) { await page.setViewportSize({ width: w, height: 800 }); await sleep(200);
    const bar = await page.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); return { pick: r("sheetPick").top, rf: r("refreshBtn").top, brand: r("menuBtn").top }; });
    check("Operations Refined: " + w + " px, brand, Drops | Picks, the day and refresh on one line", Math.abs(bar.pick - bar.brand) < 8 && Math.abs(bar.rf - bar.brand) < 8, bar);
    check("Operations Refined: " + w + " px, no sideways scrolling on the board", await noSideScroll(page)); }
  // SENT, CALLED, CLEAR as ever.
  await page.click('.row[data-id="w1"] [data-act="sent"]'); await sleep(400);
  check("Operations Refined: SENT saves (tap_drop) as in every look", calls(db, "tap_drop").some((c) => c.args.p_booking === "w1" && c.args.p_action === "sent" && c.args.p_on === true), db.calls.slice(-3));
  check("Operations Refined: SENT button marked with my name", /Rakesh/i.test(await text(page, '.row[data-id="w1"] [data-act="sent"]')), await text(page, '.row[data-id="w1"] [data-act="sent"]'));
  check("Operations Refined: no errors on the board", page.__errors.length === 0, page.__errors);
});

// PICKS on a phone: the same buttons in words; a yard that is set keeps its yard colour (every look).
await scenario(async () => {
  const db = refined(), page = await phone(browser, db, { width: 390 }), ops = await phone(browser, deskDb("ops"), { width: 390 });
  await open(page); await open(ops); await pickKind(page, "picks"); await pickKind(ops, "picks"); await sleep(300);
  const yard = (p) => p.evaluate(() => { const b = document.querySelector("#main .row .acts .pyard.on"); return b && { y: [...b.classList].find((c) => /^y-/.test(c)), bg: getComputedStyle(b).backgroundColor, ink: getComputedStyle(b).color }; });
  const ry = await yard(page), oy = await yard(ops);
  check("Operations Refined: PICKS rows its own, Coll / Yard in words", await page.evaluate(() => !!document.querySelector("#main .row.rfr.rfp") && [...document.querySelectorAll("#main .row.rfp .acts")].some((a) => /Coll/.test(a.textContent) && /Yard/.test(a.textContent))));
  check("Operations Refined: a set yard keeps its yard colour on PICKS, as in Operations", !!ry && !!oy && ry.y === oy.y && ry.bg === oy.bg && ry.ink === oy.ink && ry.bg !== "rgb(255, 255, 255)", { ry, oy });
  check("Operations Refined: PICKS at 390 px, no sideways scrolling", await noSideScroll(page));
  // Hide numbers folds the counts block (LEFT, COLL, NO SHOW, RTC, yards) away; SHORT / LONG and SHORT TO stay (the user, 22 Oct).
  const vis = (p) => p.evaluate(() => ({ tally: getComputedStyle(document.getElementById("tally")).display !== "none", cats: getComputedStyle(document.getElementById("catTally")).display !== "none", top: Math.round(document.querySelector("#main .row").getBoundingClientRect().top), fold: document.getElementById("tallyFold").innerText.replace(/\s+/g, " "), ctl: document.getElementById("tallyFold").getAttribute("aria-controls") }));
  const before = await vis(page);
  await page.click("#tallyFold"); await ops.click("#tallyFold"); await sleep(300);
  const after = await vis(page), oa = await vis(ops);
  check("Operations Refined: PICKS Hide numbers folds the counts block, the SHORT / LONG strip stays", before.tally && before.cats && !after.tally && after.cats && after.ctl === "tally", { before, after });
  check("Operations Refined: folded, the counts read on one line with Show, and the list starts higher", /LEFT/.test(after.fold) && /Show$/.test(after.fold) && after.top < before.top - 60, { before, after });
  check("Operations: Hide numbers still folds both blocks", !oa.tally && !oa.cats && oa.ctl === "tally catTally", oa);
  check("Operations Refined: the fold is remembered on the phone", await page.evaluate(() => localStorage.getItem("takeoff_tally_folded") === "1"));
  await page.click("#tallyFold"); await sleep(300);
  check("Operations Refined: Show brings the counts block back", (await vis(page)).tally);
});

// Staff & access, Booking import and Dashboard on a phone: their own arrangement (Operations keeps its own).
await scenario(async () => {
  const mk = (theme) => { const db = deskDb(theme), bi = biDb("ops"); Object.assign(db, { autoImport: bi.autoImport, reviews: bi.reviews, preview: bi.preview, imports: bi.imports });
    db.company.exit_fee = 10; db.company.capacity = 40; db.dash = dashData(); db.dash.exit = dashExit();
    db.staff.push({ id: "s3", name: "TERRY JONES", role: "terminal", active: true }, { id: "s4", name: "ALI KHAN", role: "bongo", active: true }); return db; };
  const page = await phone(browser, mk("ops-refined"), { width: 390 }), ops = await phone(browser, mk("ops"), { width: 390 });
  const go = async (p, v) => { await p.evaluate(() => document.querySelector("#bnav [data-bn=menuBtn]").click()); await p.waitForSelector("#menu[open]"); await p.click('#menuBody [data-view="' + v + '"]'); await sleep(700); };
  await open(page); await open(ops);
  await go(page, "staff"); await go(ops, "staff");
  const person = (p) => p.evaluate(() => [...document.querySelectorAll("#main .ops-person")].map((r) => { const b = r.getBoundingClientRect(), n = r.querySelector(".grow strong").getBoundingClientRect(), d = r.querySelector(".ops-dd summary");
    return { name: r.querySelector(".grow strong").textContent, h: Math.round(b.height), dd: d ? Math.round(d.getBoundingClientRect().top - b.top) : null, ddRight: d ? Math.round(d.getBoundingClientRect().right) : 0, role: r.querySelector(".grow span").getBoundingClientRect().top - n.top }; }));
  const rp = await person(page), op = await person(ops);
  check("Operations Refined: Staff, a person in at most 96 px with Actions beside the name (Operations taller)", rp.length >= 3 && rp.every((x) => x.h <= 96 && (x.dd === null || x.dd < 40) && x.ddRight <= 390 && x.role > 10 && x.role < 26) && op.some((x) => x.h > 110), { rp, op });
  check("Operations Refined: Staff at 390 px, no sideways scrolling", await noSideScroll(page));
  await go(page, "import");
  const bi = await page.evaluate(() => { const pn = document.querySelector("#main .bi-panel").getBoundingClientRect(), b = [...document.querySelectorAll("#main .bi-act .btn")].map((x) => x.getBoundingClientRect()), d = [...document.querySelectorAll("#main .bi-range input[type=date]")].map((x) => x.getBoundingClientRect());
    const kids = [...document.querySelector("#main .bi-panel").children], act = document.querySelector("#main .bi-act"), ord = (x) => +getComputedStyle(x).order || 0;
    return { side: b.length === 2 && Math.round(b[0].top) === Math.round(b[1].top), foot: kids.every((x) => x === act || ord(x) < ord(act)) && b[0].bottom <= pn.bottom + 1, dates: d.length === 2 && Math.round(d[0].top) === Math.round(d[1].top) && d[0].width > 120, sched: Math.round(document.querySelector("#main .bi-sched").getBoundingClientRect().width) };
  });
  check("Operations Refined: Booking import, From / To side by side, the schedule full width, Check and Import together at the panel's foot", bi.side && bi.foot && bi.dates && bi.sched > 300, bi);
  check("Operations Refined: Booking import at 390 px, no sideways scrolling", await noSideScroll(page));
  await go(page, "dashboard"); await go(ops, "dashboard");
  const pay = (p) => p.evaluate(() => { const c = document.querySelector("#main .od-pay .od-coll"); if (!c) return null; const l = c.querySelector("small").getBoundingClientRect(), v = c.querySelector("b").getBoundingClientRect();
    return { same: Math.abs(l.top - v.top) < 6, right: Math.round(v.left), th: getComputedStyle(document.querySelector("#main .od-th")).display, edge: getComputedStyle(document.querySelector("#main .od-attn-item")).boxShadow }; });
  const rd = await pay(page), od = await pay(ops);
  check("Operations Refined: Dashboard payments as label and amount on one line (Operations stacks them)", rd && rd.same && rd.right > 200 && rd.th === "none" && od && !od.same, { rd, od });
  check("Operations Refined: Dashboard, what needs attention edged in its colour", /inset/.test(rd.edge) && !/inset/.test(od.edge), { r: rd.edge, o: od.edge });
  check("Operations Refined: Dashboard at 390 px, no sideways scrolling", await noSideScroll(page));
  check("Operations Refined: no errors on Staff, Import and Dashboard", page.__errors.length === 0, page.__errors);
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
    state: document.getElementById("carState").textContent, exitLabels: [...document.querySelectorAll("#panelBody label, #panelBody .det b, #panelBody .rf-kv span")].filter((l) => /exit fee/i.test(l.textContent)).length,
    now: [...document.querySelectorAll("#panelBody .rf-now")].length, backRO: [...document.querySelectorAll("#panelBody .det b, #panelBody .rf-kv span")].some((b) => b.textContent === "Back"), pressed: document.querySelector('#panelBody [data-setyard="T"]').getAttribute("aria-pressed"),
    foot: [...document.querySelectorAll("#panelBody .rf-foot button")].map((b) => b.textContent) }));
  check("Booking details (Refined): Customer & vehicle, Return & parking, Notes & status, Payments", p.secs.slice(0, 4).join("|") === "Customer & vehicle|Return & parking|Notes & status|Payments", p.secs);
  check("Booking details (Refined): the reg and the sheet under the title", /^KL12PQR #6 · Drops · \w{3} \d{1,2} \w{3}$/.test(p.sub), p.sub);
  check("Booking details (Refined): the exit fee shows once, in Payments", p.exitLabels === 1, p.exitLabels);
  check("Booking details (Refined): the return shows once (in its box, not also as text)", !p.backRO);
  check("Booking details (Refined): the yard and Mark as say they save when tapped; the yard picked is pressed", p.now >= 2 && p.pressed === "true", p);
  check("Booking details (Refined): Cancel / Save changes, no unsaved changes yet", p.foot.join("|") === "Cancel|Save changes" && p.state === "No unsaved changes", p);
  // Laid out like the picture: Customer | Vehicle, the boxes two by two, Sent / Called / Clear side by side.
  const lay = await page.evaluate(() => { const box = (id) => document.getElementById(id).getBoundingClientRect(), cv = [...document.querySelectorAll("#panelBody .rf-cv > div")];
    return { cv: cv.map((d) => d.querySelector("small").textContent + ":" + d.querySelector("b").textContent), cvTop: cv.map((d) => Math.round(d.getBoundingClientRect().top)), call: !!document.querySelector("#panelBody .rf-cv .tel"),
      regFlight: Math.abs(box("regText").top - box("flightText").top) < 2 && box("flightText").left > box("regText").right,
      dateTime: Math.abs(box("retD").top - box("retT").top) < 2 && box("retT").left > box("retD").right, labels: ["retD", "retT"].map((id) => document.querySelector('label[for="' + id + '"]').textContent),
      stamps: [...document.querySelectorAll("#panelBody .rf-stamps > div")].map((d) => d.innerText.replace(/\s+/g, " ")), mark: [...document.querySelectorAll("#panelBody [data-word]")].map((b) => b.textContent) }; });
  check("Booking details (Refined): Customer and Vehicle side by side, the call link under the name", lay.cv.join("|") === "Customer:Green Mr|Vehicle:Peugeot 208" && lay.cvTop[0] === lay.cvTop[1] && lay.call, lay);
  check("Booking details (Refined): registration beside flight number, return date beside return time, each named", lay.regFlight && lay.dateTime && lay.labels.join("|") === "Return date|Return time", lay);
  check("Booking details (Refined): Sent / Called / Clear in one row with when and who", lay.stamps.length === 3 && /^Sent \d{2}:\d{2} Sugu$/.test(lay.stamps[0]) && /^Clear —$/.test(lay.stamps[2]) && lay.mark.join("|") === "Called|At desk|Overstay|Complaint", lay);
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
  // Every tab's whole name readable ("Booking website" never cut short) at 360 and 390 px.
  for (const w of [360, 390]) { await page.setViewportSize({ width: w, height: 800 }); await sleep(150);
    const cut = await page.evaluate(() => [...document.querySelectorAll(".set-tabs [data-settab]")].filter((b) => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > innerWidth).map((b) => b.textContent));
    check("Settings (Refined): " + w + " px, every tab's name in full, Booking website too", cut.length === 0 && await page.isVisible('.set-tabs [data-settab="bookings"]'), cut); }
  await page.setViewportSize({ width: 390, height: 800 });
  // The other sections listed under the open one, with what they're set to; a tap opens one.
  const more = await page.evaluate(() => [...document.querySelectorAll(".set-more [data-settab]")].filter((b) => !b.hidden).map((b) => b.innerText.replace(/\s+/g, " ")));
  check("Settings (Refined): the other five sections listed under Parking, with what they're set to", more.length === 5 && /^Flight checks Automatic checks on$/.test(more[0]), more);
  await page.click('.set-more [data-settab="charges"]'); await sleep(150);
  check("Settings (Refined): tapping one in the list opens it as the tab", await page.evaluate(() => document.querySelector('.set-tabs [data-settab="charges"]').getAttribute("aria-selected") === "true" && [...document.querySelectorAll("main .set-group")].filter((g) => !g.hidden).map((g) => g.id).join() === "set-charges" && document.querySelector('.set-more [data-settab="charges"]').hidden && !document.querySelector('.set-more [data-settab="parking"]').hidden));
  await page.click('[data-settab="flights"]'); await sleep(150);
  check("Settings (Refined): Flights tab shows only Flight checks", await page.evaluate(() => [...document.querySelectorAll("main .set-group")].filter((g) => !g.hidden).map((g) => g.id).join() === "set-flights" && document.querySelector('[data-settab="flights"]').getAttribute("aria-selected") === "true"));
  check("Settings (Refined): every setting appears once (one Automatic checks control)", await page.locator('[data-setting="enabled"]').count() === 1);
  check("Settings (Refined): a setting a line each, its name on the left and the choice on the right", await page.evaluate(() => { const f = document.querySelector('[data-setting="live_every_min"]'), l = f.closest("label").getBoundingClientRect(), b = f.getBoundingClientRect(); return b.left > l.left + 100 && b.height < l.height + 1; }));
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
  check("Shift summary (Refined): each part of the shift as \"n of n\" with its bar, the activity in its own panel", await page.evaluate(() => [...document.querySelectorAll("#main .ops-tr")].map((r) => r.innerText.replace(/\s+/g, " ")).join("|") === "Morning 06:00–17:30 0 of 12|Night 17:31–05:59 1 of 3" &&
    document.querySelectorAll("#main .ops-tr .mbar").length === 2 && !!document.querySelector("#main .rf-act .actrow") && !document.querySelector("#main > .section-label")));
  check("Shift summary (Refined): 360 px, no sideways scrolling", await noSideScroll(page));
  await page.click('#bnav [data-bn="flBtn"]'); await sleep(500);
  const f = await page.evaluate(() => ({ rows: document.querySelectorAll("#main .ops-flin").length, sch: (document.querySelector("#main .ops-flt small") || {}).textContent }));
  check("Flights (Refined): a line per flight, Sch / Est words", f.rows > 10 && f.sch === "Sch", f);
  check("Flights (Refined): 360 px, no sideways scrolling", await noSideScroll(page));
  await page.click("#bnBoard"); await sleep(300);
  check("Key check (Refined): Keys beside To do / All, on one line at 360 px", await page.isVisible("#keyBtn") && (await text(page, "#keyBtn")) === "Keys" &&
    await page.evaluate(() => { const t = (id) => Math.round(document.getElementById(id).getBoundingClientRect().top); return t("keyBtn") === t("tabTodo") && t("tabAll") === t("tabTodo") && document.getElementById("keyBtn").getBoundingClientRect().right <= innerWidth; }));
  await page.click("#keyBtn"); await page.waitForSelector("[data-keystart]"); await page.click("[data-keystart]"); await page.waitForSelector(".kc-row");
  check("Key check (Refined): the shared check starts (key_check_start)", db.calls.some((c) => /^key_check_start/.test(c.fn)), db.calls.filter((c) => /^key_check/.test(c.fn)).map((c) => c.fn));
  check("Key check (Refined): Keys with the count, still on the To do / All line at 360 px", /^Keys \d+\/\d+$/.test((await text(page, "#keyBtn")).replace(/\s+/g, " ")) &&
    await page.evaluate(() => { const k = document.getElementById("keyBtn").getBoundingClientRect(), b = document.querySelector("#keyBtn b").getBoundingClientRect(), n = document.querySelector("#keyBtn .num").getBoundingClientRect(); return Math.round(k.top) === Math.round(document.getElementById("tabTodo").getBoundingClientRect().top) && k.right <= innerWidth && Math.abs(b.top + b.height / 2 - n.top - n.height / 2) < 3 && n.left > b.right; }), await text(page, "#keyBtn"));
  check("Key check (Refined): 360 px, no sideways scrolling", await noSideScroll(page));
  await page.click("#keyBtn"); await sleep(300);
  // Desktop: the Operations tables and tabs.
  await page.setViewportSize({ width: 1440, height: 1000 }); await sleep(400);
  const d = await page.evaluate(() => ({ desk: document.body.classList.contains("ops-desk"), drow: document.querySelectorAll("#main .row.drow").length, tabs: getComputedStyle(document.getElementById("bnav")).position, head: !!document.querySelector("#opsHead h1") }));
  check("Operations Refined desktop: the DROPS table, tabs under the top bar", d.desk && d.drow > 10 && d.tabs === "relative" && d.head, d);
  check("Operations Refined desktop: Key check in words, To do / All with their counts, buttons in words", /^Key check( \d+\/\d+)?$/.test((await text(page, "#keyBtn")).replace(/\s+/g, " ")) && /^To do \d+$/.test(await text(page, "#tabTodo")) &&
    await page.evaluate(() => [...document.querySelectorAll('#main .row.drow[data-id="w1"] .acts button')].map((b) => b.textContent).join("|") === "Sent|Called|Clear"));
  await page.click('.row[data-id="w6"] .reg'); await page.waitForSelector("#panel[open] .rf-2col");
  check("Operations Refined desktop: Booking details in two columns", await page.evaluate(() => document.querySelectorAll("#panelBody .rf-2col > .rf-col").length === 2));
  await page.keyboard.press("Escape"); await sleep(300);
  await pickKind(page, "picks"); await sleep(300);
  check("Operations Refined desktop: the PICKS table", await page.evaluate(() => document.querySelectorAll("#main .row.drow .dc-b").length > 3));
  check("Operations Refined desktop: yard colour dots by the counts", await page.evaluate(() => /html\.ops-refined body\.ops-desk #tally/.test((document.getElementById("yardColours") || {}).textContent || "")));
  check("Operations Refined: no errors on summary, flights, key check and desktop", page.__errors.length === 0, page.__errors);
});
