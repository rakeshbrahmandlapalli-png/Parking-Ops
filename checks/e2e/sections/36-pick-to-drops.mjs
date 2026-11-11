import { check, sleep, addDays, TONIGHT, TOMORROW, iso, makeDb, phone, open, text, toast, scenario, browser } from "../harness.mjs";
import fs from "fs";

// 2 Nov (LK06LFN, Airport Parking Bay): taken in on PICKS, but the night's DROPS file
// never listed it. ADD TO DROPS on the PICKS car puts it on a night picked (part 145).
const shots = process.env.PICKADD_SHOTS;
async function toPicks(page) {
  if (await page.locator("#kindBar").isVisible()) { await page.click("#kindBar [data-kind=picks]"); await sleep(700); if (await page.locator('#sheetPick option[value="p0"]').count()) await page.selectOption("#sheetPick", "p0"); }
  else if (await page.locator("#shiftBtn").isVisible()) { await page.click("#shiftBtn"); await page.waitForSelector('[data-pickshift="p0"]'); await page.click('[data-pickshift="p0"]'); }
  else if (await page.locator("#sheetPick").isVisible()) await page.selectOption("#sheetPick", "p0");
  else await page.evaluate(() => { const s = document.getElementById("sheetPick"); s.value = "p0"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(700);
}
async function car(page, id) {
  const reg = page.locator('[data-id="' + id + '"] .reg').first();
  if (await reg.count()) await reg.click(); else await page.locator('[data-id="' + id + '"]').first().click();
  await sleep(800);
}
for (const theme of ["", "stdplus", "ops", "ops-refined", "premium"]) await scenario(async () => {
  const T = (s) => s + " (" + (theme || "standard") + ")";
  const db = makeDb(); if (theme) db.company.brand = { ...db.company.brand, theme };
  const p4 = db.bookings.find((b) => b.id === "p4"); p4.return_at = iso(TONIGHT, "20:00");
  const p1 = db.bookings.find((b) => b.id === "p1"); Object.assign(p1, { intake: "Collected", return_at: iso(TONIGHT, "21:00") });
  const page = await phone(browser, db);
  await open(page);
  await toPicks(page);
  await car(page, "p2");
  check(T("a PICKS car not taken in has no ADD TO DROPS"), await page.locator("[data-pickadd]").count() === 0);
  await page.click("#panel [data-close]").catch(() => {}); await sleep(200);
  await car(page, "p1");
  check(T("a PICKS car already on DROPS has no ADD TO DROPS"), await page.locator("[data-pickadd]").count() === 0);
  await page.click("#panel [data-close]").catch(() => {}); await sleep(200);
  await car(page, "p4");
  const box = page.locator("#addDay");
  check(T("taken in with no DROPS car: ADD TO DROPS with a night picker"), await page.locator("[data-pickadd]").count() === 1 && await box.count() === 1);
  check(T("the picker runs from its return day to the last DROPS sheet, tonight first"), (await box.getAttribute("min")) === TONIGHT && (await box.getAttribute("max")) === TOMORROW && (await box.inputValue()) === TONIGHT);
  check(T("on its return night it's not an overstay"), !/OVERSTAY/.test(await page.locator("#addTo").innerText()), await page.locator("#addTo").innerText());
  await box.fill(TOMORROW); await box.dispatchEvent("change"); await sleep(200);
  check(T("a later night says overstay"), /OVERSTAY/.test(await page.locator("#addTo").innerText()), await page.locator("#addTo").innerText());
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.locator("#addTo").scrollIntoViewIfNeeded(); await page.screenshot({ path: shots + "/" + (theme || "standard") + "-phone.png" }); }
  check(T("no EARLY RETURN beside it (its return isn't later)"), await page.locator("[data-pearly]").count() === 0);
  await page.click("[data-pickadd]"); await sleep(1500);
  check(T("ADD TO DROPS sends the car and the night"), (db.pickAdds || []).some((a) => a.p_picks === "p4" && a.p_day === TOMORROW), db.pickAdds);
  check(T("the app follows the car to that night's DROPS"), (await page.locator("#sheetPick").inputValue()) === "d1");
  check(T("the car is on the board there"), /HJ12PGK/.test(await text(page, "#main")));
  check(T("the toast says where"), /added to/i.test(await toast(page)), await toast(page));
  check(T("no script errors"), page.__errors.length === 0, page.__errors.join(" | "));
  await page.close();
});

// Office only (part 145 checks can('import') too).
await scenario(async () => {
  const db = makeDb(); db.bookings.find((b) => b.id === "p4").return_at = iso(TONIGHT, "20:00");
  db.perms = Object.fromEntries(["sent", "clear", "summary", "intake", "called", "picksinfo", "note"].map((k) => [k, true]));
  const page = await phone(browser, db);
  await open(page);
  await toPicks(page);
  await car(page, "p4");
  check("without office rights there is no ADD TO DROPS", await page.locator("[data-pickadd]").count() === 0);
  await page.close();
});
