import { check, sleep, makeDb, phone, open, scenario, browser, iso, TONIGHT, addDays, pickKind } from "../harness.mjs";

// 23 Nov (user): AK18SOA, an early return moved at 16:11 with its new flight due
// at 21:05, sat between a 15:58 and a 16:20 car: the board sorted early returns
// by when they were moved and skipped the timetable time. An early return now
// goes by its live time, else its new night's timetable time, else when they
// rang, else when it was moved. A timetable time still on the booked night is
// the old flight and is skipped.
function earlyDb(theme) {
  const db = makeDb(); if (theme) db.company.brand = { ...(db.company.brand || {}), theme };
  db.bookings.push(
    // Moved at 20:00, new flight 22:05: belongs between 22:00 (b2) and 22:15 (b3).
    { id: "e1", sheet_id: "d0", company_id: "c1", kind: "drops", ref: "E1", reg: "AK18SOA", num: 80, name: "EARLY MR", make: "PEUGEOT", flight: "W61801", return_at: iso(addDays(TONIGHT, 2), "22:30"), sched_at: iso(TONIGHT, "22:05"), early: true, early_at: iso(TONIGHT, "20:00"), moved_from: "d1", note: "" },
    // Moved at 21:00, its timetable time is still the booked night's: goes by when it was moved (before b1 21:45).
    { id: "e2", sheet_id: "d0", company_id: "c1", kind: "drops", ref: "E2", reg: "OLD1FLT", num: 81, name: "STALE MR", flight: "W60000", return_at: iso(addDays(TONIGHT, 3), "10:00"), sched_at: iso(addDays(TONIGHT, 3), "10:00"), early: true, early_at: iso(TONIGHT, "21:00"), moved_from: "d1", note: "" },
    // Live time beats everything: 21:50, between b1 (21:45) and b2 (22:00).
    { id: "e3", sheet_id: "d0", company_id: "c1", kind: "drops", ref: "E3", reg: "LIVE1ER", num: 82, name: "LIVE MS", flight: "W60001", return_at: iso(addDays(TONIGHT, 1), "12:00"), sched_at: iso(TONIGHT, "23:30"), est_at: iso(TONIGHT, "21:50"), early: true, early_at: iso(TONIGHT, "19:00"), moved_from: "d1", note: "" });
  return db;
}
for (const theme of [null, "stdplus", "ops", "ops-refined"]) {
  for (const width of [390, 1440]) {
    await scenario(async () => {
      const page = await phone(browser, earlyDb(theme), { width });
      await open(page);
      await pickKind(page, "drops"); await page.click("#tabAll").catch(() => {}); await sleep(600);
      const look = (theme || "standard") + " " + width;
      const ids = await page.locator("#main .row[data-id], #main .drow[data-id]").evaluateAll((els) => [...new Set(els.map((e) => e.dataset.id))]);
      const order = ids.filter((x) => ["b1", "b2", "b3", "e1", "e2", "e3"].includes(x)).join(",");
      check("Early order (" + look + "): early returns sit at their real time", order === "e2,b1,e3,b2,e1,b3", order);
      check("Early order (" + look + "): no errors", page.__errors.length === 0, page.__errors);
    });
  }
}
