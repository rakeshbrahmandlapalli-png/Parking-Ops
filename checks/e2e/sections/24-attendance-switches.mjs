import { check, sleep, makeDb, phone, open, scenario, browser, noSideScroll } from "../harness.mjs";

// Attendance and the lock per person (part 139, user 29 Oct: "how can I turn on the attendance to others?").
// An owner of a client with the Attendance add-on switches both for the other people in Staff access.
const openPerson = async (page, name) => {
  await page.evaluate(() => { document.getElementById("menuBtn").click(); }); await sleep(300);
  await page.click('#menu [data-view="staff"]'); await sleep(400);
  if (await page.locator("#main .ops-person").count()) { await page.locator("#main .ops-person", { hasText: name }).locator(".ops-dd summary").click(); await sleep(150); }
  await page.locator("[data-manage]", { hasText: "" }).first().waitFor();
};
for (const [theme, width] of [["ops", 1280], ["ops", 390], ["", 390]]) await scenario(async () => {
  const tag = "Attendance switches (" + (theme || "standard") + " " + width + ")";
  const db = makeDb(); db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff", attendance: true };
  db.staff.push({ id: "s3", name: "Anil", role: "office", active: true, extra: [] });
  const page = await phone(browser, db, { width });
  await open(page);
  await openPerson(page, "Anil");
  await page.click('[data-manage="s3"]'); await sleep(500);
  const seg = async (k, to) => page.locator('#panelBody [data-attswitch="' + k + '"][data-to="' + to + '"]');
  check(tag + ": both switches show, Off picked", await (await seg("attendance", "off")).getAttribute("class") === "on" && await (await seg("lock", "off")).getAttribute("class") === "on");
  check(tag + ": the lock can't be turned on before Attendance", await (await seg("lock", "on")).isDisabled());
  if (width < 900) check(tag + ": no sideways scrolling", await noSideScroll(page));
  await (await seg("attendance", "on")).click(); await sleep(500);
  const c1 = db.calls.find((x) => x.fn === "attendance_person_set");
  check(tag + ": Attendance on is sent", c1 && c1.args.p_staff === "s3" && c1.args.p_on === true, c1);
  check(tag + ": the panel shows it on and the lock can be chosen", await (await seg("attendance", "on")).getAttribute("class") === "on" && !(await (await seg("lock", "on")).isDisabled()));
  await (await seg("lock", "on")).click(); await sleep(500);
  check(tag + ": the lock asks first", /^Lock Parking Ops for Anil\?/.test(page.__dialogs.join("|")), page.__dialogs);
  const c2 = db.calls.find((x) => x.fn === "clock_gate_set");
  check(tag + ": the lock is sent", c2 && c2.args.p_staff === "s3" && c2.args.p_on === true, c2);
  await (await seg("attendance", "off")).click(); await sleep(500);
  check(tag + ": Attendance can't go off while locked, the real message is shown", /lock off first/.test(await page.locator(".toast").last().innerText().catch(() => "")) && await (await seg("attendance", "on")).getAttribute("class") === "on");
  if (process.env.ATTSW_SHOTS) await page.screenshot({ path: process.env.ATTSW_SHOTS + "/attsw-" + (theme || "standard") + "-" + width + ".png" });
  check(tag + ": no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "attsw");

// No switches for a manager, for yourself, on a shared login, or where the add-on is off or part 139 isn't run.
for (const [label, setup, who] of [
  ["a manager", (db) => { db.me = { ...db.me, role: "manager" }; }, "Anil"],
  ["no add-on", (db) => { db.company.brand.attendance = false; }, "Anil"],
  ["part 139 not run", (db) => { db.noAttPart = true; }, "Anil"],
  ["a shared login", (db) => { db.staff.find((p) => p.id === "s3").desk_names = ["A", "B"]; }, "Anil"],
]) await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "ops", attendance: true };
  db.staff.push({ id: "s3", name: "Anil", role: "office", active: true, extra: [] }); setup(db);
  const page = await phone(browser, db, { width: 1280 });
  await open(page); await openPerson(page, who);
  await page.click('[data-manage="s3"]'); await sleep(500);
  check("Attendance switches: none for " + label, await page.locator("#panelBody [data-attswitch]").count() === 0 && !/ATTENDANCE/.test(await page.locator("#panelBody").innerText()));
  check("Attendance switches (" + label + "): the panel still works, no errors", await page.locator("#panelBody [data-setrole]").count() > 0 && page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "attsw");
