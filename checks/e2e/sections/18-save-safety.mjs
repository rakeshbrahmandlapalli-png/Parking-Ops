import { check, sleep, TONIGHT, makeDb, phone, open, toast, scenario, browser } from "../harness.mjs";

// Save changes in the car panel (every look): only boxes typed in are sent, "Saved" waits for the server,
// a mark (Called) keeps the typed boxes, a yard tap keeps the typed charge, the caller menu says what landed.
// A colleague's change reaching the board while the panel is open: the app comes back to the foreground.
async function colleagueSaved(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(900);
}
const fail = (page, fn, message) => page.context().route("**/rest/v1/rpc/" + fn, (r) => r.fulfill({ status: 400, json: { message } }));

for (const theme of ["", "ops-refined"]) await scenario(async () => {
  const look = theme || "standard";
  // 1. An older form doesn't overwrite a colleague's note or flight.
  let db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  let page = await phone(browser, db);
  await open(page);
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  const b1 = db.bookings.find((b) => b.id === "b1");
  b1.note = "colleague note"; b1.flight = "BA999";
  await colleagueSaved(page);
  await page.fill("#phoneText", "07700 900123"); await page.click("[data-savepanel]"); await sleep(700);
  check("Stale (" + look + "): saving the phone alone doesn't resend the note or the flight", db.calls.some((x) => x.fn === "set_phone") && !db.calls.some((x) => ["set_note", "set_flight"].includes(x.fn)), db.calls.map((x) => x.fn));
  check("Stale (" + look + "): the colleague's note and flight stand", b1.note === "colleague note" && b1.flight === "BA999");
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  check("Stale (" + look + "): and the reopened panel shows them", await page.inputValue("#noteText") === "colleague note");
  // Typing over a note a colleague changed asks first.
  await page.fill("#noteText", "mine"); b1.note = "colleague again"; await colleagueSaved(page);
  page.__dialogs.length = 0;
  await page.click("[data-savepanel]"); await sleep(700);
  check("Stale (" + look + "): replacing a note somebody else changed asks first", page.__dialogs.some((d) => /Someone else changed.*note/.test(d)), page.__dialogs);
  check("Stale (" + look + "): no errors", page.__errors.length === 0, page.__errors);
}, "savesafe");

for (const theme of ["", "ops-refined"]) await scenario(async () => {
  const look = theme || "standard";
  // 2. Saved only after every write is confirmed; a failed one is said.
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  const page = await phone(browser, db);
  await open(page);
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  await fail(page, "set_note", "Note refused");
  await page.fill("#phoneText", "07700 900123"); await page.fill("#noteText", "new note"); await page.click("[data-savepanel]"); await sleep(900);
  const t = await toast(page);
  check("Saved (" + look + "): one write failing doesn't say Saved", !/(^|\| )Saved( \||$)/.test(t) && /1 of 2 changes did not save/.test(t) && /Note refused/.test(t), t);
  check("Saved (" + look + "): the one that worked did save", db.bookings.find((b) => b.id === "b1").phone === "07700 900123");
}, "savesafe");

await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db);
  await open(page);
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  await page.fill("#phoneText", "07700 900123"); await page.click("[data-savepanel]"); await sleep(700);
  check("Saved: shown once the write is confirmed", /Saved/.test(await toast(page)) && db.bookings.find((b) => b.id === "b1").phone === "07700 900123", await toast(page));
}, "savesafe");

// 3. CALLED from the car panel with a typed note saves the note too; a bad box stops the mark.
await scenario(async () => {
  const db = makeDb();
  const page = await phone(browser, db);
  await open(page);
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  await page.fill("#noteText", "keys on desk");
  await page.click('#panel [data-word^="called"]'); await sleep(800);
  const b1 = db.bookings.find((b) => b.id === "b1");
  check("Called: the typed note is saved with the mark", b1.note === "keys on desk" && !!b1.called_at, [b1.note, b1.called_at]);
  await page.click('.row[data-id="b2"] .reg'); await page.waitForSelector("#panel[open]");
  await page.fill("#regText", "BAD!!REG"); await page.click('#panel [data-word^="called"]'); await sleep(500);
  check("Called: a box that can't be saved stops the mark and keeps the panel", !db.bookings.find((b) => b.id === "b2").called_at && await page.isVisible("#panel[open]"));
}, "savesafe");

// 4. A yard tap keeps a typed charge amount and reason, and the typed note, in every look.
for (const theme of ["", "premium", "stdplus", "ops", "ops-refined"]) await scenario(async () => {
  const look = theme || "standard";
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  const page = await phone(browser, db);
  await open(page);
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]");
  await page.click("[data-chargeadd]");
  await page.fill("#chgAmount", "12.50"); await page.fill("#chgReason", "late return"); await page.fill("#noteText", "typed note");
  await page.click("#panel [data-setyard]"); await sleep(400);
  check("Yard (" + look + "): the typed charge amount and reason stay", await page.inputValue("#chgAmount") === "12.50" && await page.inputValue("#chgReason") === "late return", [await page.inputValue("#chgAmount"), await page.inputValue("#chgReason")]);
  check("Yard (" + look + "): and the typed note", await page.inputValue("#noteText") === "typed note");
  check("Yard (" + look + "): the yard was set", db.calls.some((x) => x.fn === "set_yard"));
}, "savesafe");

// 5. Caller menu: the text setting failing after the menu saved says so and shows what is held.
await scenario(async () => {
  const db = makeDb(); db.company.brand = { theme: "ops", colour: "#F9A01B", short: "TakeOff", calls: true, texts: true, voice: true }; db.company.calls = { on: true };
  let state = { configured: true, approved: true, app_ready: true, on: false, greeting: "Hello", menu_text: "demo" }, menuCalls = 0, textCalls = 0;
  const page = await phone(browser, db); await page.setViewportSize({ width: 420, height: 940 });
  await page.context().route("**/rest/v1/rpc/voice_menu_settings", (r) => r.fulfill({ json: state }));
  await page.context().route("**/rest/v1/rpc/set_voice_menu", (r) => { const a = r.request().postDataJSON(); menuCalls++; state = { ...state, on: a.p_on, greeting: a.p_greeting }; return r.fulfill({ json: state }); });
  await page.context().route("**/rest/v1/rpc/set_voice_menu_text", (r) => { textCalls++; return r.fulfill({ status: 400, json: { message: "Texts are not set up" } }); });
  await open(page);
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click());
  await page.waitForSelector("#menu[open]"); await page.click('#menuBody [data-view="settings"]'); await sleep(200);
  if (await page.$('[data-settab="texts"]')) await page.click('[data-settab="texts"]');
  if (await page.$('[data-setsec="calls"]')) await page.click('[data-setsec="calls"]');
  await page.waitForSelector("#vmOn");
  await page.selectOption("#vmOn", "true"); await page.selectOption("#vmText", "off"); await page.click("[data-savevoice]"); await sleep(600);
  const t = await toast(page);
  check("Caller menu: a failed text setting says the menu was saved", /Menu and greeting saved, but the text setting was not: Texts are not set up/.test(t), t);
  check("Caller menu: the boxes show what is held (menu on, text still demo)", await page.inputValue("#vmOn") === "true" && await page.inputValue("#vmText") === "demo");
  await page.click("[data-savevoice]"); await sleep(500);
  check("Caller menu: saving again sends only what is still different", menuCalls === 1 && textCalls === 1, [menuCalls, textCalls]);
}, "savesafe");
