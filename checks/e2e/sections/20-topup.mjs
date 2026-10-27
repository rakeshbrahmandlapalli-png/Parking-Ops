import { check, sleep, makeDb, phone, open, scenario, browser, noSideScroll, path, ROOT } from "../harness.mjs";

// SKIDATA card top-up (part 128, 27 Oct): Menu → SKIDATA top-up works out the tickets for a
// shift and records the top-up with the machine photo. An add-on (brand.topup). Every look.
const goTopup = async (page) => { await page.locator('#menuBtn:visible,[data-bn="menuBtn"]:visible').first().click(); await page.click('#menu [data-view="topup"]'); await page.waitForSelector(".tu"); await sleep(200); };
for (const theme of ["", "pro", "cards", "premium", "board", "stdplus", "ops", "ops-refined"]) await scenario(async () => {
  const look = theme || "standard";
  const db = makeDb(); db.company.brand = { ...(theme ? { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" } : {}), topup: true };
  const page = await phone(browser, db);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await goTopup(page);
  check("Top-up (" + look + "): the counts are read for a shift", db.topupCounts?.length > 0 && /^\d{4}-\d\d-\d\d$/.test(db.topupCounts[0].p_day), db.topupCounts);
  check("Top-up (" + look + "): two shifts to pick from, one marked now or next", await page.locator("[data-tushift]").count() === 2);
  check("Top-up (" + look + "): asks for the drivers first", /Type the drivers on shift/.test(await page.locator(".tu").innerText()));
  await page.fill("#tuDrivers", "4"); await sleep(100);
  await page.fill("#tuCard", "7"); await sleep(100);
  const t = await page.locator(".tu-box").innerText();
  check("Top-up (" + look + "): 20 drops, 4 drivers = 5 rounds, 25 tickets, £87.50", /Bongo rounds[\s\S]*5/.test(t) && /Tickets[\s\S]*25/.test(t) && /£87\.50/.test(t), t);
  check("Top-up (" + look + "): £7 on the card, top up £90 (£10 steps)", /Top up\s*£90/.test(t) && /card then £97/.test(t), t);
  check("Top-up (" + look + "): typing keeps the box focused", await page.evaluate(() => document.activeElement && document.activeElement.id === "tuCard"));
  check("Top-up (" + look + "): no sideways scroll at 390", await noSideScroll(page));
  await page.click("[data-tuform]");
  check("Top-up (" + look + "): the amount starts at the top-up worked out", await page.inputValue("#tuAmount") === "90");
  await page.fill("#tuAmount", "80");
  await page.setInputFiles("#tuFile", path.join(ROOT, "icons/icon-512.png")); await sleep(200);
  await page.click('#tuRec [type="submit"]');
  for (let i = 0; i < 50 && !db.calls.some((x) => x.fn === "record_topup"); i++) await sleep(100);
  await sleep(300);
  const rec = db.calls.filter((x) => x.fn === "record_topup").pop();
  check("Top-up (" + look + "): saved with its sums", rec && rec.args.p.amount === 80 && rec.args.p.card === 7 && rec.args.p.drivers === 4 && rec.args.p.tickets === 25 && rec.args.p.rounds === 5 && rec.args.p.need === 87.5, rec && rec.args);
  check("Top-up (" + look + "): the machine photo is uploaded first", /^c1\/docs\/topup\/t\d+\.jpg$/.test(rec?.args.p.photo || "") && db.uploads.includes(rec.args.p.photo), db.uploads);
  check("Top-up (" + look + "): it shows in the list", /£80[\s\S]*RAKESH/.test(await page.locator(".tu-list").innerText().catch(() => "")));
  await page.setViewportSize({ width: 320, height: 700 }); await sleep(200);
  // The page itself fits (Operations' top bar at 320 px with a sync note is the same on every page).
  check("Top-up (" + look + "): the page fits at 320", await page.evaluate(() => [...document.querySelectorAll(".tu *")].every((e) => e.getBoundingClientRect().right <= innerWidth + 1)));
  check("Top-up (" + look + "): no errors", page.__errors.length === 0, page.__errors);
}, "topup");

await scenario(async () => {
  // No add-on: no menu line, never read.
  const db = makeDb(); db.company.brand = { theme: "ops" };
  const page = await phone(browser, db); await open(page);
  await page.click("#menuBtn"); await sleep(200);
  check("Top-up off: no menu line without the add-on", await page.locator('#menu [data-view="topup"]').count() === 0);
  check("Top-up off: the counts are never read", !db.calls.some((x) => x.fn === "topup_counts"));
  await page.click("[data-view=staff]").catch(() => {}); await sleep(300);
  check("Top-up off: no errors", page.__errors.length === 0, page.__errors);

  // A driver doesn't get it by default.
  const d2 = makeDb(); d2.company.brand = { theme: "stdplus", topup: true }; d2.me = { ...d2.me, role: "bongo" }; d2.perms = { sent: true, clear: true };
  const p2 = await phone(browser, d2); await open(p2); await p2.click("#menuBtn"); await sleep(200);
  check("Top-up: a driver has no menu line", await p2.locator('#menu [data-view="topup"]').count() === 0);

  // Terminal staff do: and no owner settings for them.
  const d3 = makeDb(); d3.company.brand = { theme: "stdplus", topup: true }; d3.me = { ...d3.me, role: "terminal" }; d3.perms = { clear: true, desk: true };
  const p3 = await phone(browser, d3); await open(p3); await goTopup(p3);
  check("Top-up: terminal staff open it", await p3.locator(".tu-box").count() === 1);
  check("Top-up: terminal staff don't see the ticket price settings", await p3.locator(".tu-set").count() === 0);

  // Owner: ticket price and shifts; picks count too; card already enough.
  const d4 = makeDb(); d4.company.brand = { theme: "ops", topup: true }; d4.topupDrops = 3; d4.topupPicks = 5;
  const p4 = await phone(browser, d4); await open(p4); await goTopup(p4);
  await p4.fill("#tuDrivers", "4"); await p4.fill("#tuCard", "50"); await sleep(100);
  const t4 = await p4.locator(".tu-box").innerText();
  check("Top-up: picks count, rounds apart: 3 + 5 + (1 + 2) = 11 tickets, £38.50", /Tickets[\s\S]*11/.test(t4) && /£38\.50/.test(t4), t4);
  check("Top-up: enough on the card says no top-up", /No top-up needed/.test(t4), t4);
  await p4.click(".tu-set summary");
  await p4.fill('#tuSet [name="ticket"]', "4"); await p4.fill('#tuSet [name="n0"]', "Early"); await p4.fill('#tuSet [name="s0"]', "03:00");
  await p4.click('#tuSet [type="submit"]'); await sleep(500);
  const s = d4.calls.filter((x) => x.fn === "set_topup_settings").pop();
  check("Top-up: the owner saves price and shifts", s && s.args.p.ticket === "4" && s.args.p.shifts.length === 2 && s.args.p.shifts[0].name === "Early" && s.args.p.shifts[0].start === "03:00", s && s.args);
  await p4.fill("#tuDrivers", "4"); await p4.fill("#tuCard", "0"); await sleep(100);
  check("Top-up: the new price is used", /£44/.test(await p4.locator(".tu-box").innerText()));
  check("Top-up: no errors", p4.__errors.length === 0 && p3.__errors.length === 0, p4.__errors.concat(p3.__errors));

  // Without part 128 the page says so.
  const d5 = makeDb(); d5.company.brand = { topup: true }; d5.topupError = "Could not find the function public.topup_counts";
  const p5 = await phone(browser, d5); await open(p5); await goTopup(p5); await sleep(300);
  check("Top-up: says the database part is missing", /needs database part 128/.test(await p5.locator(".tu").innerText()));

}, "topup");
