import { check, sleep, deskDb, phone, open, scenario, browser, noSideScroll } from "../harness.mjs";

// Settings → Attendance → Clock-in sites: add, change, remove.
const build = (theme, role = "owner") => {
  const db = deskDb(theme); db.company.brand = { ...db.company.brand, theme, attendance: true };
  db.me = { ...db.me, role }; db.att = {};
  db.aero = { manager: true, sites: [], shifts: [], openAll: [] };
  db.aeroSites = [{ id: "w1", name: "Millfield Lane", lat: 51.86096, lng: -0.47289, radius_m: 200 }, { id: "w2", name: "Airport", lat: 51.87706, lng: -0.37372, radius_m: 200 }];
  return db;
};
const toSettings = async (page, width) => {
  await open(page); await sleep(500);
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]");
  await page.click('#menuBody [data-view="settings"]'); await sleep(1200);
  if (width < 900) { const h = page.locator('[data-setsec="attendance"]'); if (await h.count()) { await h.click(); await sleep(300); } }
};
for (const [theme, width] of [["ops", 1440], ["stdplus", 390]]) await scenario(async () => {
  const tag = "Sites (" + theme + " " + width + ")";
  const db = build(theme);
  const page = await phone(browser, db, { width }); await page.setViewportSize({ width, height: width < 900 ? 844 : 1000 });
  await page.context().grantPermissions(["geolocation"]); await page.context().setGeolocation({ latitude: 51.88049, longitude: -0.40457, accuracy: 10 });
  await toSettings(page, width);
  let t = await page.locator("#stBox").innerText();
  check(tag + ": lists the sites with radius", /Millfield Lane · 200 m/.test(t) && /Airport · 200 m/.test(t), t);
  await page.click('[data-site="add"]'); await sleep(200);
  check(tag + ": add needs a name", /Give the site a name/.test(await page.locator("#stBox").innerText()) && !db.siteCalls);
  await page.fill("#stAN", "Crescent Road"); await page.click('[data-site="add"]'); await sleep(200);
  check(tag + ": add needs the location", /Use my location while you are at the site/.test(await page.locator("#stBox").innerText()) && !db.siteCalls);
  await page.click('[data-site="here"]'); await sleep(800);
  check(tag + ": location is shown", /Using your location \(51\.88049/.test(await page.locator("#stBox").innerText()));
  await page.click('[data-site="add"]'); await sleep(900);
  const post = (db.siteCalls || []).find((c) => c.method === "POST");
  check(tag + ": add sends name, radius and place", post && post.body.name === "Crescent Road" && post.body.radius_m === 200 && Math.abs(post.body.lat - 51.88049) < 1e-4 && post.body.company_id === db.company.id, post);
  check(tag + ": the new site shows", /Crescent Road · 200 m/.test(await page.locator("#stBox").innerText()));
  await page.click('[data-sid="w2"][data-site="edit"]'); await page.fill("#stR", "10"); await page.click('[data-site="save"]'); await sleep(200);
  check(tag + ": a radius under 50 m is refused", /between 50 and 1000/.test(await page.locator("#stBox").innerText()) && !(db.siteCalls || []).some((c) => c.method === "PATCH"));
  await page.fill("#stR", "250"); await page.click('[data-site="save"]'); await sleep(900);
  check(tag + ": edit sends the new radius", (db.siteCalls || []).some((c) => c.method === "PATCH" && c.id === "w2" && c.body.radius_m === 250));
  check(tag + ": the new radius shows", /Airport · 250 m/.test(await page.locator("#stBox").innerText()));
  await page.click('[data-sid="w1"][data-site="ask"]'); await sleep(200);
  check(tag + ": remove asks first", /Remove Millfield Lane\?/.test(await page.locator("#stBox").innerText()) && !(db.siteCalls || []).some((c) => c.method === "DELETE"));
  await page.click('[data-site="remove"]'); await sleep(900);
  check(tag + ": remove sends the delete and the site goes", (db.siteCalls || []).some((c) => c.method === "DELETE" && c.id === "w1") && !/Millfield Lane/.test(await page.locator("#stBox").innerText()));
  if (width < 900) check(tag + ": no sideways scrolling", await noSideScroll(page));
  check(tag + ": no errors", page.__errors.length === 0, page.__errors);
}, "gate");

await scenario(async () => {
  const db = build("ops"); db.siteDeny = true;
  const page = await phone(browser, db, { width: 1440 }); await page.setViewportSize({ width: 1440, height: 1000 });
  await toSettings(page, 1440);
  await page.click('[data-sid="w2"][data-site="edit"]'); await page.fill("#stR", "300"); await page.click('[data-site="save"]'); await sleep(900);
  check("Sites: the real error is shown", /row-level security/.test(await page.locator("#stBox").innerText()));
}, "gate");
