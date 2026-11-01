import { check, sleep, makeDb, phone, open, scenario, browser, noSideScroll } from "../harness.mjs";

// The person panel from Staff & access (1 Nov, the user: "doesn't give the enterprise level feel"):
// Role as a dropdown, Attendance and the lock as switches, permissions in groups with "Changed" only where
// they differ from the role's default. Same data hooks and RPCs as before. Every look, phone and desktop.
const openPerson = async (page, id, name) => {
  await page.evaluate(() => { document.getElementById("menuBtn").click(); }); await sleep(300);
  await page.click('#menu [data-view="staff"]'); await sleep(400);
  if (await page.locator("#main .ops-person").count()) { await page.locator("#main .ops-person", { hasText: name }).locator(".ops-dd summary").click(); await sleep(150); }
  await page.click('[data-manage="' + id + '"]'); await sleep(500);
};
const LOOKS = [["", 360], ["pro", 360], ["cards", 360], ["premium", 390], ["board", 390], ["stdplus", 390], ["ops", 390], ["ops-refined", 430], ["ops", 1280], ["ops-refined", 1440], ["stdplus", 1024], ["cards-dark", 390]];
for (let [theme, width] of LOOKS) await scenario(async () => {
  const tag = "Staff panel (" + (theme || "standard") + " " + width + ")";
  const dark = theme === "cards-dark"; if (dark) theme = "cards";
  const db = makeDb(); db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff", attendance: true, calls: true, topup: true, collections: true };
  db.staff.push({ id: "s3", name: "AASHISH", role: "manager", active: true, extra: ["flights"] });
  db.att = { s3: { attendance: true, locked: true, on_shift: true } };
  const page = await phone(browser, db, { width });
  if (dark) await page.addInitScript(() => { try { localStorage.setItem("takeoff_mode", "dark"); } catch (e) {} });
  await open(page);
  await openPerson(page, "s3", "AASHISH");
  if (dark) check(tag + ": dark Cards draws the panel dark", await page.evaluate(() => document.documentElement.classList.contains("dark") && getComputedStyle(document.getElementById("panel")).backgroundColor !== "rgb(255, 255, 255)"));
  const body = page.locator("#panelBody");
  check(tag + ": title is the name, role and shift under it", (await page.locator("#panelTitle").innerText()).trim() === "AASHISH" && /Manager\s*·\s*On shift now/.test(await body.locator(".sp-meta").innerText()));
  check(tag + ": sections Role, Attendance, Permissions, Sign-in", (await body.locator(".sp-sec > h3").allInnerTexts()).map((x) => x.split("\n")[0].replace(/ Manager.*$/, "").trim()).join("|") === "Role|Attendance|Permissions|Sign-in", await body.locator(".sp-sec > h3").allInnerTexts());
  check(tag + ": permissions in four groups", (await body.locator(".sp-grp").allInnerTexts()).join("|") === "DROPS|PICKS|Board|Office", await body.locator(".sp-grp").allInnerTexts());
  check(tag + ": no 'default: yes' on every row, and DROPS: / PICKS: not repeated", !/default: (yes|no)/.test(await body.innerText()) && !/DROPS: press|PICKS: RTC/.test(await body.innerText()));
  check(tag + ": only the changed permission says Changed", await body.locator(".sp-chg:not([hidden])").count() === 1 && /flight numbers/.test(await body.locator(".sp-perm", { has: page.locator(".sp-chg:not([hidden])") }).innerText()));
  check(tag + ": the count says 1 changed", /Manager defaults · 1 changed/.test(await page.locator("#spPermN").innerText()));
  check(tag + ": both switches on", await body.locator('[data-attswitch="attendance"]').getAttribute("aria-checked") === "true" && await body.locator('[data-attswitch="lock"]').getAttribute("aria-checked") === "true");
  check(tag + ": no uppercase labels left (ROLE, SAVE ACCESS …)", !/\bROLE\b|SAVE ACCESS|ROLE DEFAULTS|SAVE NAMES|SET A NEW PIN|WHAT AASHISH CAN DO/.test(await body.innerText()));
  if (process.env.STAFFPANEL_SHOTS) {
    await page.evaluate(() => { const p = document.getElementById("panel"); p.style.maxHeight = "none"; p.style.height = "auto"; p.style.position = "absolute"; p.style.overflow = "visible"; });
    const h = await page.evaluate(() => Math.ceil(document.getElementById("panel").getBoundingClientRect().bottom + 24));
    await page.setViewportSize({ width, height: Math.max(h, 844) }); await sleep(200);
    await page.screenshot({ path: process.env.STAFFPANEL_SHOTS + "/panel-" + (dark ? "cards-dark" : theme || "standard") + "-" + width + ".png", fullPage: true });
    await page.setViewportSize({ width, height: 844 }); await page.evaluate(() => { const p = document.getElementById("panel"); p.style.cssText = ""; }); await sleep(100);
  }
  // Unticking a default shows Changed at once; Reset puts the role's defaults back.
  await body.locator('[data-perm="summary"]').click({ force: true }); await sleep(100);
  check(tag + ": a switch turned off says Changed and the count follows", await body.locator('.sp-perm:has([data-perm="summary"]) .sp-chg:not([hidden])').count() === 1 && /2 changed/.test(await page.locator("#spPermN").innerText()));
  await body.locator("[data-roledefault]").click(); await sleep(100);
  check(tag + ": Reset to Manager defaults clears every Changed", await body.locator(".sp-chg:not([hidden])").count() === 0 && (await page.locator("#spPermN").innerText()).trim() === "Manager defaults");
  const fits = await page.evaluate(() => { const p = document.getElementById("panelBody"), r = p.getBoundingClientRect(); return [...p.querySelectorAll("*")].every((e) => { const b = e.getBoundingClientRect(); return b.width === 0 || (b.left >= r.left - 1 && b.right <= r.right + 1); }); });
  check(tag + ": everything fits inside the panel", fits);
  if (width < 900) check(tag + ": no sideways scrolling", await noSideScroll(page));
  const boxes = await page.evaluate(() => [...document.querySelectorAll("#panelBody .sp-sw, #panelBody .sp-sel, #panelBody .sp-btn")].map((e) => Math.round(e.getBoundingClientRect().height)));
  check(tag + ": switches, dropdown and buttons are compact (20–36 px)", boxes.every((h) => h >= 20 && h <= 36), boxes);
  check(tag + ": no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "staffpanel");

// Save access still sends only what differs from the role's default; Close and reopen shows it.
await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "ops" };
  db.staff.push({ id: "s3", name: "Anil", role: "office", active: true, extra: [] });
  const page = await phone(browser, db, { width: 390 });
  await open(page); await openPerson(page, "s3", "Anil");
  await page.locator('#panelBody [data-perm="settings"]').click({ force: true });
  await page.locator('#panelBody [data-perm="sent"]').click({ force: true });
  await page.click("#panelBody [data-saveaccess]"); await sleep(400);
  const c = db.calls.find((x) => x.fn === "set_staff_access");
  check("Staff panel: Save access sends settings on, SENT off", c && c.args.p_staff === "s3" && JSON.stringify([...c.args.p_extra].sort()) === JSON.stringify(["-sent", "settings"]), c);
  await page.click("#panelBody [data-close]"); await sleep(200);
  check("Staff panel: closing drops its panel class", await page.evaluate(() => !document.getElementById("panel").classList.contains("sp-panel")));
  check("Staff panel (save): no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "staffpanel");
