import { check, sleep, makeDb, phone, browser, scenario, BASE } from "../harness.mjs";

// 2 Nov (RAIHAN, Airport Parking Bay): the server cancelled the phone's sign-in, "me" still
// answered and every other read came back 401. The app said "Check your signal": it asks for the PIN now.
for (const theme of ["", "stdplus", "ops"]) await scenario(async () => {
  const db = makeDb(); if (theme) db.company.brand = { ...db.company.brand, theme };
  db.authGone = true;
  const page = await phone(browser, db);
  await page.goto(BASE + "/"); await sleep(2500);
  const pin = await page.locator("#pinGate").isVisible(), err = await page.locator("#pinErr").innerText().catch(() => "");
  const boot = await page.locator("#boot").isVisible() ? await page.locator("#boot").innerText() : "";
  check("Sign-in ended (" + (theme || "standard") + "): the PIN screen, not 'check your signal'", pin && !/signal/i.test(boot), boot || err);
  check("Sign-in ended (" + (theme || "standard") + "): says the sign-in ended", /Your sign-in ended\. Enter your PIN/.test(err), err);
  check("Sign-in ended (" + (theme || "standard") + "): the sign-in is cleared on this phone", await page.evaluate(() => !localStorage.getItem("sb-oioqjfrlwrjovnouhusp-auth-token")));
  check("Sign-in ended (" + (theme || "standard") + "): no offline copy kept", await page.evaluate(() => localStorage.getItem("takeoff_snap")) === null);
  check("Sign-in ended (" + (theme || "standard") + "): no script errors", page.__errors.length === 0, page.__errors.join(" | "));
  db.authGone = false;
  await page.fill("#pin", "1234"); await sleep(2500);
  check("Sign-in ended (" + (theme || "standard") + "): the PIN signs back in to the board", await page.locator("#main .row").count() > 0);
  await page.close();
});
