import { check, sleep, makeDb, phone, open, scenario, browser, noSideScroll } from "../harness.mjs";

// Change role (part 138, user 29 Oct): Office has no Dashboard (it needs Settings, a Manager
// default), so an owner or manager can change a person's role in PIN and access.
for (const [theme, width] of [["ops", 1280], ["ops", 390], ["stdplus", 390], ["", 390]]) await scenario(async () => {
  const tag = "Change role (" + (theme || "standard") + " " + width + ")";
  const db = makeDb(); db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  db.staff.push({ id: "s3", name: "Anil", role: "office", active: true, extra: [] });
  const page = await phone(browser, db, { width });
  await open(page);
  await page.evaluate(() => { document.getElementById("menuBtn").click(); });  await sleep(300);
  await page.click('#menu [data-view="staff"]'); await sleep(400);
  if (await page.locator("#main .ops-dd summary").count()) { await page.locator("#main .ops-person", { hasText: "Anil" }).locator(".ops-dd summary").click(); await sleep(150); }
  await page.click('[data-manage="s3"]'); await sleep(300);
  const btns = await page.locator("#panelBody [data-setrole]").allInnerTexts();
  check(tag + ": the owner sees every role, Office picked", btns.join("|") === "Office|Manager|Bongo driver|Terminal|View only|Owner" && await page.locator('#panelBody [data-setrole="office"].on').count() === 1, btns);
  check(tag + ": Settings unticked for Office", !(await page.locator('#panelBody [data-perm="settings"]').isChecked()));
  if (width < 900) check(tag + ": no sideways scrolling", await noSideScroll(page));
  if (process.env.ROLE_SHOTS) await page.screenshot({ path: process.env.ROLE_SHOTS + "/role-" + (theme || "standard") + "-" + width + "-before.png" });
  await page.click('#panelBody [data-setrole="manager"]'); await sleep(500);
  const c = db.calls.find((x) => x.fn === "set_staff_role");
  check(tag + ": asks first", /^Make Anil Manager\?/.test(page.__dialogs.join("|")), page.__dialogs);
  check(tag + ": Manager saves the role", c && c.args.p_staff === "s3" && c.args.p_role === "manager", c);
  check(tag + ": the panel shows Manager picked and Settings ticked", await page.locator('#panelBody [data-setrole="manager"].on').count() === 1 && await page.locator('#panelBody [data-perm="settings"]').isChecked());
  if (process.env.ROLE_SHOTS) await page.screenshot({ path: process.env.ROLE_SHOTS + "/role-" + (theme || "standard") + "-" + width + "-after.png" });
  check(tag + ": no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "role");

// A manager can't make an owner.
await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "ops" };
  db.me = { ...db.me, role: "manager" };
  db.staff.push({ id: "s3", name: "Anil", role: "office", active: true, extra: [] });
  const page = await phone(browser, db, { width: 1280 });
  await open(page);
  await page.evaluate(() => { document.getElementById("menuBtn").click(); }); await sleep(300);
  await page.click('#menu [data-view="staff"]'); await sleep(400);
  await page.locator("#main .ops-person", { hasText: "Anil" }).locator(".ops-dd summary").click(); await sleep(150);
  await page.click('[data-manage="s3"]'); await sleep(300);
  const btns = await page.locator("#panelBody [data-setrole]").allInnerTexts();
  check("Change role: a manager gets no Owner button", btns.join("|") === "Office|Manager|Bongo driver|Terminal|View only", btns);
  check("Change role (manager): no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "role");
