import { check, sleep, makeDb, phone, open, scenario, browser, noSideScroll, BASE } from "../harness.mjs";

// Clock in and out inside Parking Ops (user, 29 Oct): one slide, nearest site by GPS, the database decides.
const SITES = [{ id: "w1", name: "Millfield Lane", lat: 51.8609617, lng: -0.4728942, radius_m: 200 }, { id: "w2", name: "Airport", lat: 51.877055, lng: -0.3737165, radius_m: 200 }];
const HERE = { latitude: 51.8611, longitude: -0.4731, accuracy: 12 }, FAR = { latitude: 51.88, longitude: -0.42, accuracy: 15 };
const slide = async (p, sel = ".clk-slide") => {
  const k = await (await p.$(sel + " .clk-knob")).boundingBox(), t = await (await p.$(sel)).boundingBox();
  await p.mouse.move(k.x + 20, k.y + 20); await p.mouse.down(); await p.mouse.move(t.x + t.width - 10, k.y + 20, { steps: 12 }); await p.mouse.up();
};
const setup = async (onShift, where, width = 390) => {
  const db = makeDb(); db.company.brand = { theme: "stdplus", colour: "#F9A01B", ink: "#172536", short: "TakeOff", attendance: true };
  db.aero = { manager: false, sites: SITES, open: onShift ? { id: "sh1", clock_in_at: new Date(Date.now() - 3600e3).toISOString(), worksite_id: "w1" } : null, shifts: [] };
  db.gate = { gated: true, closed: !onShift, name: "AASHISH", company: "TAKEOFF", attendance: true };
  if (!onShift) { db.meSaved = db.me; db.me = null; }
  const page = await phone(browser, db, { width });
  await page.context().grantPermissions(["geolocation"], { origin: BASE }); await page.context().setGeolocation(where);
  return { db, page };
};

await scenario(async () => {
  const { db, page } = await setup(false, HERE);
  await page.goto(BASE + "/"); await page.waitForSelector(".gatebox .clk-slide", { timeout: 8000 }); await sleep(800);
  check("Clock in: the nearest site is picked and shown", /At Millfield Lane/.test(await page.locator(".clk-zone").innerText()));
  await page.locator(".clk-knob").click({ position: { x: 20, y: 20 } }); await sleep(300);
  check("Clock in: a plain tap does not clock in", !db.calls.some((c) => c.fn === "aero_clock_in"));
  await slide(page); await sleep(2800);
  const c = db.calls.find((x) => x.fn === "aero_clock_in");
  check("Clock in: sliding sends the site and location", c && c.args.p_worksite_id === "w1" && Math.abs(c.args.p_lat - 51.8611) < 1e-6, c);
  check("Clock in: the board comes back", await page.locator(".row[data-id]").count() > 0 && await page.locator("#boot").isHidden());
  check("Clock in: no errors", page.__errors.length === 0, page.__errors);
}, "gate");

await scenario(async () => {
  const { db, page } = await setup(false, FAR);
  await page.goto(BASE + "/"); await page.waitForSelector(".gatebox .clk-slide"); await sleep(800);
  check("Clock in: too far says how far and from which site", /km from Airport\. Move closer/.test(await page.locator(".clk-zone").innerText()), await page.locator(".clk-zone").innerText());
  db.aero.refuse = "You are 3.2 km from Airport.";
  await slide(page); await sleep(900);
  check("Clock in: the database's refusal is shown as it is, and the board stays hidden", /3\.2 km from Airport/.test(await page.locator(".clk-zone").innerText()) && await page.locator(".row[data-id]").count() === 0);
}, "gate");

for (const width of [390, 1280]) await scenario(async () => {
  const { db, page } = await setup(true, HERE, width);
  await open(page); await sleep(1500);
  check("Clock out (" + width + "): the top bar shows the shift timer", /1h 0\dm/.test(await page.locator("#clockBtn").innerText()), await page.locator("#clockBtn").innerText());
  await page.click("#clockBtn"); await sleep(500);
  check("Clock out (" + width + "): the sheet opens with the slide", await page.locator("#panel .clk-slide.clk-out").count() === 1);
  await page.locator("#panel .clk-knob").click({ position: { x: 20, y: 20 } }); await sleep(300);
  check("Clock out (" + width + "): a plain tap does not clock out", !db.calls.some((c) => c.fn === "aero_clock_out"));
  await slide(page, "#panel .clk-slide"); await sleep(3000);
  check("Clock out (" + width + "): sliding clocks out", db.calls.some((c) => c.fn === "aero_clock_out"));
  check("Clock out (" + width + "): Parking Ops locks", await page.locator(".gatebox").count() === 1 && await page.locator(".row[data-id]").count() === 0);
  if (width < 900) check("Clock out: no sideways scrolling", await noSideScroll(page));
  check("Clock out (" + width + "): no errors", page.__errors.length === 0, page.__errors);
}, "gate");

// Clock-out is never blocked: no location still clocks out.
await scenario(async () => {
  const { db, page } = await setup(true, HERE);
  await page.context().clearPermissions();
  await open(page); await sleep(1200); await page.click("#clockBtn"); await sleep(400);
  await slide(page, "#panel .clk-slide"); await sleep(2500);
  const c = db.calls.find((x) => x.fn === "aero_clock_out");
  check("Clock out: without a location it still clocks out, unverified", c && (c.args.p_lat == null), c);
}, "gate");

// Someone without Attendance sees none of it.
await scenario(async () => {
  const db = makeDb(); const page = await phone(browser, db); await open(page); await sleep(1200);
  check("Clock: no clock button without Attendance", await page.locator("#clockBtn").isHidden());
}, "gate");
