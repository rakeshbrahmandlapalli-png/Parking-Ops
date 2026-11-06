import { check, sleep, makeDb, phone, open, scenario, browser, iso, TONIGHT, addDays, pickKind } from "../harness.mjs";

// 6 Nov (user): a PICKS car added by a later import (or at the desk) shows when
// it was added, "ADDED 16:05", in place of the words NEW BOOKING. Every look, phone and desktop.
// DROPS rows are unchanged; a PICKS car marked Called still shows its own word.
for (const theme of [null, "pro", "cards", "premium", "board", "stdplus", "ops", "ops-refined"]) {
  for (const width of [360, 390, 1440]) {
    await scenario(async () => {
      const db = makeDb(); if (theme) db.company.brand = { ...(db.company.brand || {}), theme };
      Object.assign(db.bookings.find((x) => x.id === "p2"), { pick_called: "New Booking", pick_called_at: iso(TONIGHT, "16:05") });
      Object.assign(db.bookings.find((x) => x.id === "p3"), { pick_called: "Called", pick_called_at: iso(TONIGHT, "16:20") });
      // Only cars added from 17:00 the day before show a time (user, 6 Nov).
      Object.assign(db.bookings.find((x) => x.id === "p1"), { pick_called: "New Booking", pick_called_at: iso(addDays(TONIGHT, -1), "17:00") });
      Object.assign(db.bookings.find((x) => x.id === "p4"), { pick_called: "New Booking", pick_called_at: iso(addDays(TONIGHT, -1), "16:59") });
      const page = await phone(browser, db, { width });
      await open(page);
      await pickKind(page, "picks"); await page.click("#tabAll").catch(() => {}); await sleep(600);
      const look = (theme || "standard") + " " + width;
      const tag = page.locator('#main .row[data-id="p2"] .tag.nb');
      const txt = (await tag.count()) ? (await tag.innerText()).trim() : "";
      check("Added time (" + look + "): ADDED 16:05 on the re-imported car", txt === "ADDED 16:05", txt);
      check("Added time (" + look + "): the tag is not cut off", await tag.evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().width > 20).catch(() => false));
      check("Added time (" + look + "): no NEW BOOKING words on the board", !/NEW BOOKING/.test(await page.locator("#main .row").allInnerTexts().then((t) => t.join(" "))));
      check("Added time (" + look + "): a called car keeps its own word", /CALLED/i.test(await page.locator('#main .row[data-id="p3"]').innerText({ timeout: 3000 }).catch(() => "")));
      const t1 = (await page.locator('#main .row[data-id="p1"] .tag.nb').allInnerTexts()).join("|").trim();
      check("Added time (" + look + "): added 17:00 the day before shows ADDED 17:00", t1 === "ADDED 17:00", t1);
      const r4 = page.locator('#main .row[data-id="p4"]');
      check("Added time (" + look + "): added 16:59 the day before shows nothing", (await r4.count()) === 0 || ((await r4.locator(".tag.nb").count()) === 0 && !/ADDED|NEW BOOKING/.test(await r4.innerText()) && !/·\s*$/.test((await r4.locator(".l2a").allInnerTexts()).join(""))));
      check("Added time (" + look + "): other cars have no tag", await page.locator('#main .row[data-id="p2"] ~ .row:not([data-id="p1"]):not([data-id="p4"]) .tag.nb').count() === 0);
      // (Operations at 360 px has a known top-bar overflow from the refresh button, not from the rows.)
      if (width < 900) check("Added time (" + look + "): the PICKS rows fit the screen", await page.evaluate(() => [...document.querySelectorAll("#main .row .l2t, #main .row .tag")].every((e) => e.getBoundingClientRect().right <= innerWidth + 1)));
      check("Added time (" + look + "): no errors", page.__errors.length === 0, page.__errors);
    });
  }
}
