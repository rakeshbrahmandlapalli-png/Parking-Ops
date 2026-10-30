import { check, sleep, makeDb, phone, browser, BASE, scenario } from "../harness.mjs";

// Parking Ops → Clients: a line per client with its add-ons and what Health says about it.
await scenario(async () => {
  const db = makeDb(); db.clientCompany = db.company;
  db.company = { id: "c0", name: "Parking Ops", slug: "platform", yards: [], drops_day_end: "06:00:00", brand: {}, time_zone: "Europe/London" };
  db.me = { ...db.me, company_id: "c0" };
  db.adminClients = [
    { id: "c1", name: "TAKEOFF", slug: "takeoff", yards: ["NB"], brand: { host: "takeoff-ops.vercel.app", attendance: true, texts: true, topup: true }, staff: 14, has_owner: true, sheets_7d: 18, cars_7d: 2074, last_activity: new Date().toISOString() },
    { id: "c2", name: "Airport Parking Bay", slug: "apb", yards: ["A"], brand: { host: "parkingbay-ops.vercel.app" }, staff: 9, has_owner: true, sheets_7d: 17, cars_7d: 960, last_activity: new Date().toISOString() }];
  const page = await phone(browser, db);
  await page.goto(BASE + "/"); await page.waitForSelector("[data-clientopen]", { timeout: 8000 }); await sleep(1200);
  const rows = await page.locator(".client").allInnerTexts();
  check("Clients: a client lists its add-ons", /Add-ons: Attendance · Texts · SKIDATA top-up/.test(rows[0]), rows[0]);
  check("Clients: Health problems show on their client", /3 app errors in 24 hours/.test(rows[0]), rows[0]);
  check("Clients: a client with none says so, with no problems", /No add-ons/.test(rows[1]) && !/error/.test(rows[1]), rows[1]);
  check("Clients: no errors", page.__errors.length === 0, page.__errors);
}, "platform");
