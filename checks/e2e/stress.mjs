import { check, sleep, server, BASE, addDays, TONIGHT, iso, makeDb, now, rpc, phone, open, noSideScroll, scenario, browser } from "./harness.mjs";

// ── stress tests (STRESS=1) ──────────────────────────────────────────────
// 2. A big night on a slow phone, 3. bad signal, 4. big imports.
function bigDb(drops, picks) {
  const db = makeDb();
  db.bookings = db.bookings.filter((b) => b.sheet_id !== "d0" && b.sheet_id !== "p0");
  for (let i = 0; i < drops; i++) {
    const mins = 6 * 60 + Math.floor(i * (23 * 60) / drops), day = mins < 24 * 60 ? TONIGHT : addDays(TONIGHT, 1), hm = String(Math.floor(mins / 60) % 24).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
    db.bookings.push({ id: "sd" + i, company_id: "c1", sheet_id: "d0", kind: "drops", ref: "SD" + i, reg: "SD" + String(i).padStart(3, "0") + "XY", num: i + 1, name: "CUSTOMER " + i,
      make: ["FORD", "KIA", "BMW", "AUDI"][i % 4], flight: "U2" + (3000 + i), return_at: iso(day, hm), yard: ["NB", "S", ""][i % 3], note: i % 25 ? "" : "S/D", updated_at: now() });
  }
  for (let i = 0; i < picks; i++) {
    const mins = 4 * 60 + Math.floor(i * (19 * 60) / picks), hm = String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
    db.bookings.push({ id: "sp" + i, company_id: "c1", sheet_id: "p0", kind: "picks", ref: "SP" + i, reg: "SP" + String(i).padStart(3, "0") + "XY", num: i + 1, name: "PICK " + i,
      drop_at: iso(TONIGHT, hm), return_at: iso(addDays(TONIGHT, 1 + (i % 9)), "10:00"), intake: "", note: "", updated_at: now() });
  }
  return db;
}
// No signal, for real: every request to the database fails until it's back.
async function noSignal(page) {
  const state = { off: false };
  await page.context().route("**/rest/v1/**", (route) => state.off ? route.abort("internetdisconnected") : route.fallback());
  return {
    off: async () => { state.off = true; await page.context().setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event("offline"))); },
    on: async () => { state.off = false; await page.context().setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event("online"))); },
    state
  };
}
async function slowPhone(page, rate) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate }); return cdp; }
export async function stressTests() {
  // 2. 800 DROPS and 800 PICKS, phone four times slower than this computer
  for (const theme of ["", "stdplus"]) await scenario(async () => {
    const db = bigDb(800, 800); if (theme) db.company.brand = { ...db.company.brand, theme };
    const look = theme || "standard";
    const page = await phone(browser, db);
    await slowPhone(page, 4);
    let t0 = Date.now(); await page.goto(BASE + "/"); await page.waitForSelector('.row[data-id="sd799"]', { state: "attached", timeout: 30000 }); const tOpen = Date.now() - t0;
    if (process.env.PROFILE) {
      const cdp2 = await page.context().newCDPSession(page); await cdp2.send("Profiler.enable"); await cdp2.send("Profiler.setSamplingInterval", { interval: 100 }); await cdp2.send("Profiler.start");
      await page.evaluate(async () => { document.querySelector('.row[data-id="sd401"] [data-act="sent"]').click(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
      const { profile } = await cdp2.send("Profiler.stop");
      const self = {}; const byId = Object.fromEntries(profile.nodes.map((n) => [n.id, n]));
      const dt = profile.timeDeltas; profile.samples.forEach((id, i) => { const n = byId[id]; const k = (n.callFrame.functionName || "(anon)") + ":" + n.callFrame.lineNumber; self[k] = (self[k] || 0) + (dt[i] || 0); });
      console.log(Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => k + " " + Math.round(v / 1000) + "ms").join("\n"));
    }
    const tTap = await page.evaluate(async () => { const b = document.querySelector('.row[data-id="sd400"] [data-act="sent"]'); const t = performance.now(); b.click(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t; });
    const tScroll = await page.evaluate(async () => { const t = performance.now(); window.scrollTo(0, document.body.scrollHeight); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); window.scrollTo(0, 0); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t; });
    t0 = Date.now(); await page.fill("#q", "SD42"); await page.waitForFunction(() => document.querySelectorAll("#main .row").length < 20, null, { timeout: 15000 }); const tSearch = Date.now() - t0;
    await page.fill("#q", ""); await sleep(300);
    const todo = await page.textContent("#tabTodo");
    t0 = Date.now();
    if (await page.locator("#kindSeg:not(.hidden)").count()) await page.click("#kindSeg [data-kind=picks]"); else await page.selectOption("#sheetPick", "p0");
    await page.waitForSelector('.row[data-id="sp799"]', { state: "attached", timeout: 30000 }); const tPicks = Date.now() - t0;
    const tPick = await page.evaluate(async () => { const b = document.querySelector('.row[data-id="sp300"] [data-pick="Collected"]'); const t = performance.now(); b.click(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t; });
    console.log("      " + look + ", 800 + 800 cars, phone 4x slower: open " + tOpen + " ms, tap " + Math.round(tTap) + " ms, scroll end-to-end " + Math.round(tScroll) + " ms, search " + tSearch + " ms, to PICKS " + tPicks + " ms, COLL " + Math.round(tPick) + " ms");
    check("Stress (" + look + "): 800 DROPS open in under 8 s on a slow phone", tOpen < 8000, tOpen);
    check("Stress (" + look + "): a SENT tap shows in under 500 ms", tTap < 500, tTap);
    check("Stress (" + look + "): scrolling to the end and back stays under 1 s", tScroll < 1000, tScroll);
    check("Stress (" + look + "): search answers in under 3 s", tSearch < 3000, tSearch);
    check("Stress (" + look + "): switching to 800 PICKS takes under 6 s", tPicks < 6000, tPicks);
    check("Stress (" + look + "): a COLL tap shows in under 500 ms", tPick < 500, tPick);
    check("Stress (" + look + "): TO DO still counts right (799 not sent)", /799/.test(todo), todo);
    const sent = db.calls.filter((c) => c.fn === "tap_drop");
    check("Stress (" + look + "): the tap reached the server once", sent.length === 1 && sent[0].args.p_booking === "sd400", sent.map((c) => c.args));
    check("Stress (" + look + "): no sideways scrolling with 800 cars", await noSideScroll(page));
  });

  // 3a. No signal: 10 taps (one undone), then the signal comes back.
  await scenario(async () => {
    const db = bigDb(40, 0);
    const page = await phone(browser, db);
    const net = await noSignal(page);
    await open(page); await page.waitForSelector('.row[data-id="sd9"]');
    await net.off();
    for (let i = 0; i < 10; i++) { await page.click('.row[data-id="sd' + i + '"] [data-act="sent"]'); await sleep(120); }
    await page.click('.row[data-id="sd3"] [data-act="sent"]'); await sleep(200);
    const shown = await page.evaluate(() => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => document.querySelector('.row[data-id="sd' + i + '"] [data-act="sent"]').classList.contains("on")));
    check("Stress, no signal: every tap shows at once on the phone", shown.filter(Boolean).length === 9 && !shown[3], shown);
    check("Stress, no signal: nothing reached the server yet", !db.calls.some((c) => c.fn === "tap_drop"));
    await net.on();
    await page.waitForFunction(() => !document.querySelector(".row.busy"), null, { timeout: 20000 }).catch(() => {}); await sleep(1500);
    const taps = db.calls.filter((c) => c.fn === "tap_drop").map((c) => c.args.p_booking + (c.args.p_on ? "+" : "-"));
    const per = (id) => taps.filter((t) => t.startsWith(id + "+") || t.startsWith(id + "-"));
    check("Stress, signal back: each car saved exactly once", [0, 1, 2, 4, 5, 6, 7, 8, 9].every((i) => per("sd" + i).length === 1 && per("sd" + i)[0].endsWith("+")), taps);
    check("Stress, signal back: the undone car saved on then off, in that order", per("sd3").join(",") === "sd3+,sd3-", per("sd3"));
    check("Stress, signal back: the server matches the phone", [0, 1, 2, 4, 5, 6, 7, 8, 9].every((i) => db.bookings.find((b) => b.id === "sd" + i).sent_at) && !db.bookings.find((b) => b.id === "sd3").sent_at);
  });

  // 3b. Taps made with no signal survive the app being closed and opened again.
  await scenario(async () => {
    const db = bigDb(20, 0);
    const page = await phone(browser, db);
    const net = await noSignal(page);
    await open(page); await page.waitForSelector('.row[data-id="sd5"]');
    await net.off();
    for (let i = 0; i < 5; i++) { await page.click('.row[data-id="sd' + i + '"] [data-act="sent"]'); await sleep(120); }
    const queued = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("takeoff_queue_")).map((k) => JSON.parse(localStorage.getItem(k)).length).reduce((a, b) => a + b, 0));
    check("Stress, app closed with no signal: the 5 taps are kept on the phone", queued === 5, queued);
    // Opened again while the database still can't be reached, then the signal comes back.
    await page.context().setOffline(false); await page.reload(); await sleep(2500);
    const early = db.calls.filter((c) => c.fn === "tap_drop").length;
    await net.on(); await page.waitForSelector('.row[data-id="sd5"]', { timeout: 15000 }).catch(() => {}); await sleep(3000);
    check("Stress, app opened again before the signal: nothing lost, nothing sent early", early === 0, early);
    const taps = db.calls.filter((c) => c.fn === "tap_drop").map((c) => c.args.p_booking);
    check("Stress, app opened again: the 5 taps are saved, once each", taps.length === 5 && new Set(taps).size === 5, taps);
  });

  // 3c. Weak signal: every save takes 2.5 s; 8 quick taps.
  await scenario(async () => {
    const db = bigDb(20, 0);
    const page = await phone(browser, db);
    await page.route("**/rest/v1/rpc/tap_drop", async (route) => { await sleep(2500); await route.fallback(); });
    await open(page); await page.waitForSelector('.row[data-id="sd8"]');
    const t0 = Date.now();
    for (let i = 0; i < 8; i++) await page.click('.row[data-id="sd' + i + '"] [data-act="sent"]');
    const tapsMs = Date.now() - t0;
    const allOn = await page.evaluate(() => [0, 1, 2, 3, 4, 5, 6, 7].every((i) => document.querySelector('.row[data-id="sd' + i + '"] [data-act="sent"]').classList.contains("on")));
    check("Stress, weak signal: 8 taps don't wait for each other (" + tapsMs + " ms)", tapsMs < 4000 && allOn, { tapsMs, allOn });
    await page.waitForFunction(() => !document.querySelector(".row.busy"), null, { timeout: 40000 }).catch(() => {}); await sleep(500);
    const taps = db.calls.filter((c) => c.fn === "tap_drop").map((c) => c.args.p_booking);
    check("Stress, weak signal: all 8 saved, none twice", taps.length === 8 && new Set(taps).size === 8, taps);
  });

  // 3d. Dropping signal: the first try of every save is cut off.
  await scenario(async () => {
    const db = bigDb(20, 0);
    const page = await phone(browser, db);
    const tried = {};
    await page.route("**/rest/v1/rpc/tap_drop", async (route) => {
      const k = (route.request().postData() || "");
      if (!tried[k]) { tried[k] = 1; return route.abort("connectionreset"); }
      return route.fallback();
    });
    await open(page); await page.waitForSelector('.row[data-id="sd6"]');
    for (let i = 0; i < 6; i++) { await page.click('.row[data-id="sd' + i + '"] [data-act="sent"]'); await sleep(100); }
    await page.waitForFunction(() => !document.querySelector(".row.busy"), null, { timeout: 60000 }).catch(() => {}); await sleep(1000);
    const taps = db.calls.filter((c) => c.fn === "tap_drop").map((c) => c.args.p_booking);
    check("Stress, signal dropping: every tap still saved, once each", taps.length === 6 && new Set(taps).size === 6, taps);
    check("Stress, signal dropping: the phone shows all 6 as SENT", await page.evaluate(() => [0, 1, 2, 3, 4, 5].every((i) => document.querySelector('.row[data-id="sd' + i + '"] [data-act="sent"]').classList.contains("on"))));
  });

  // 4. Big imports: a 500-car file, read and sent, then the same file again.
  for (const kind of ["drops", "picks"]) await scenario(async () => {
    const db = makeDb();
    const page = await phone(browser, db, { width: 1000 });
    await open(page);
    const d1 = addDays(TONIGHT, 1);
    const rows = [" Reference Number \t Car Reg \t Client \t Booking From \t Drop off Time \t Booking To \t Collection Time "];
    for (let i = 1; i <= 500; i++) {
      const m = 6 * 60 + Math.floor(i * (17 * 60) / 500), t = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
      rows.push(["R" + i, "AB" + String(i).padStart(3, "0") + "CDE", "CUSTOMER " + i, kind === "picks" ? TONIGHT : addDays(TONIGHT, -3), kind === "picks" ? t : "08:00", kind === "picks" ? addDays(d1, i % 9) : TONIGHT, kind === "picks" ? "10:00" : t].join("\t"));
    }
    const file = { name: kind + "-500.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from(rows.join("\n")) };
    const importOnce = async () => {
      for (let k = 0; k < 3; k++) { if (await page.evaluate(() => !!document.querySelector("dialog[open]"))) { await page.keyboard.press("Escape"); await sleep(300); } }
      await page.evaluate(() => document.getElementById("menuBtn").click()); await sleep(300); await page.click('#menu [data-view="import"]'); await sleep(300);
      await page.click('[data-impkind="' + kind + '"]'); await sleep(200);
      await page.setInputFiles('input[data-file="excel"]', file);
      const t0 = Date.now(); await sleep(100); await page.click("[data-read]"); await page.waitForSelector("[data-create]", { timeout: 30000 }); const tRead = Date.now() - t0;
      const n0 = db.calls.filter((c) => c.fn === "import_sheet").length;
      await page.click("[data-create]"); await page.waitForFunction((n) => true, n0); await sleep(1500);
      return { tRead, call: db.calls.filter((c) => c.fn === "import_sheet")[n0] };
    };
    const a = await importOnce();
    const sentRows = a.call ? a.call.args.p_rows.length : 0;
    let all = a.call ? a.call.args.p_rows : [];
    if (a.call && !a.call.args.p_rows.length) all = [];
    const days = new Set(db.calls.filter((c) => c.fn === "import_sheet").map((c) => c.args.p_day));
    const total = db.calls.filter((c) => c.fn === "import_sheet").reduce((t, c) => t + c.args.p_rows.length, 0);
    const refs = db.calls.filter((c) => c.fn === "import_sheet").flatMap((c) => c.args.p_rows.map((r) => r.ref));
    console.log("      " + kind + ": 500-row file read in " + a.tRead + " ms, sent as " + days.size + " day(s), " + total + " rows");
    check("Stress import (" + kind + "): 500 rows read in under 5 s", a.tRead < 5000, a.tRead);
    check("Stress import (" + kind + "): all 500 cars sent, none twice", total === 500 && new Set(refs).size === 500, { total, unique: new Set(refs).size, first: sentRows });
    const b = await importOnce();
    const total2 = db.calls.filter((c) => c.fn === "import_sheet").reduce((t, c) => t + c.args.p_rows.length, 0) - total;
    check("Stress import (" + kind + "): the same file again sends the same 500 (the server keeps one of each)", total2 === 500, total2);
  });
}
