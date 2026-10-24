import { check, sleep, makeDb, phone, open, scenario, browser } from "../harness.mjs";

// Customer texts (setup 114): an add-on; owners set it in Settings → Customer texts; the car's
// Texts list what was sent, and the office sends one by hand after seeing the words. Every look.
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const CFG = { on: true, sender: "TAKEOFF", office: "0161 496 0000", meet: "Terminal 2", at: "18:00" };
const textsDb = (theme, addon = true) => {
  const db = makeDb(); if (theme) db.company.brand = { theme, colour: "#F9A01B", ink: "#172536", short: "TakeOff" };
  db.company.brand = { ...(db.company.brand || {}), texts: addon };
  db.company.texts = { ...CFG };
  Object.assign(db.bookings.find((b) => b.id === "b2"), { name: "KHAIRA MS" });
  db.texts = [{ at: ago(20), booking_id: "b1", rule: "landed", to_number: "+447868615571", body: "Welcome back Miss Senior.", status: "delivered", error: "", staff_name: "" },
    { at: ago(5), booking_id: "b1", rule: "sent", to_number: "+447868615571", body: "Your car is on its way.", status: "failed", error: "code 30003", staff_name: "" }];
  return db;
};
const settings = async (page) => {
  await page.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await page.waitForSelector("#menu[open]"); await sleep(250);
  await page.click('#menuBody [data-view="settings"]'); await sleep(500);
  if (await page.$('[data-setsec="texts"]')) { await page.click('[data-setsec="texts"]'); await sleep(250); }
  if (await page.$('[data-settab="texts"]')) { await page.click('[data-settab="texts"]'); await sleep(250); }
};
for (const theme of ["", "pro", "cards", "premium", "board", "stdplus", "ops", "ops-refined"]) await scenario(async () => {
  const look = theme || "standard", db = textsDb(theme);
  const page = await phone(browser, db);
  await open(page);
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]"); await sleep(500);
  const t = await page.innerText("#carTexts");
  check("Texts (" + look + "): the car lists its texts, newest first, with how each went", /Car on its way[\s\S]*Not delivered: code 30003[\s\S]*Flight landed[\s\S]*Delivered/.test(t), t);
  await page.click('[data-txpick="sent"]'); await sleep(200);
  const words = await page.innerText("#txConfirm");
  check("Texts (" + look + "): picking a text shows its words for this car before anything is sent", /To 07868 615571/.test(words) && /EK14JPV/.test(words) && /Terminal 2/.test(words) && /TAKEOFF/.test(words) && !(db.textCalls || []).length, words);
  await page.click("[data-txcancel]"); await sleep(150);
  check("Texts (" + look + "): Cancel sends nothing", await page.isHidden("#txConfirm") && !(db.textCalls || []).length);
  await page.click('[data-txpick="landed"]'); await sleep(150); await page.click("[data-txsend]"); await sleep(500);
  const c = (db.textCalls || []).pop();
  check("Texts (" + look + "): Send now asks send-texts for this car and text", c && c.type === "manual" && c.booking === "b1" && c.rule === "landed", c);
  check("Texts (" + look + "): the list shows the new text", /Sent by hand/.test(await page.innerText("#carTexts")));
  check("Texts (" + look + "): no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
}, "texts");

// The name in the words: "KHAIRA MS" is Ms Khaira; a PICKS car gets the Reminder.
await scenario(async () => {
  const db = textsDb("stdplus");
  const page = await phone(browser, db);
  await open(page);
  await page.click('.row[data-id="b2"] .reg'); await page.waitForSelector("#panel[open]"); await sleep(400);
  check("Texts: only the DROPS texts on a DROPS car", await page.locator("[data-txpick]").count() === 2 && !(await page.$('[data-txpick="reminder"]')));
  await page.click('[data-txpick="landed"]'); await sleep(150);
  check("Texts: KHAIRA MS is Ms Khaira in the words", /Welcome back Ms Khaira\./.test(await page.innerText("#txConfirm")));
  check("Texts: a car with no texts says so", /No texts sent to this customer yet/.test(await page.innerText("#carTexts")));
  await page.context().close();
}, "texts");

// Demo: the car says nothing goes to the customer; the list shows demo texts as not sent.
await scenario(async () => {
  const db = textsDb("ops"); db.company.texts.demo = true; db.texts[0].status = "demo";
  const page = await phone(browser, db);
  await open(page);
  await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]"); await sleep(400);
  check("Texts demo: a demo text reads Demo, not sent", /Flight landed · Demo, not sent/.test(await page.innerText("#carTexts")));
  await page.click('[data-txpick="sent"]'); await sleep(150);
  check("Texts demo: Send says it goes on the list, not to the customer", /Demo: it goes on the list, not to the customer/.test(await page.innerText("#txConfirm")));
  await page.context().close();
}, "texts");

// Without the add-on: nothing in Settings, nothing on the car. Texts off: the list stays, no Send.
await scenario(async () => {
  for (const [addon, on] of [[false, true], [true, false]]) {
    const db = textsDb("stdplus", addon); db.company.texts.on = on;
    const page = await phone(browser, db);
    await open(page);
    await page.click('.row[data-id="b1"] .reg'); await page.waitForSelector("#panel[open]"); await sleep(400);
    if (!addon) check("Texts: without the add-on the car has no Texts", !(await page.$("#carTexts")));
    else check("Texts: switched off, the list stays and nothing can be sent", /Flight landed/.test(await page.innerText("#carTexts")) && !(await page.$("[data-txpick]")));
    await page.keyboard.press("Escape"); await sleep(300);
    await settings(page);
    if (!addon) check("Texts: without the add-on Settings has no Customer texts", !(await page.$("[data-savetexts]")));
    await page.context().close();
  }
}, "texts");

// Settings → Customer texts: owners only; the words preview as typed; Save sends what's on the page.
for (const theme of ["", "stdplus", "ops", "ops-refined", "premium"]) await scenario(async () => {
  const look = theme || "standard", db = textsDb(theme);
  const page = await phone(browser, db);
  await open(page); await settings(page);
  check("Customer texts (" + look + "): the owner has the box", await page.isVisible("[data-savetexts]"));
  await page.fill('[data-txrule="landed"]', "Hi {name}, your car {reg}. Call {office}.");
  const prev = await page.innerText('[data-txprev="landed"]');
  check("Customer texts (" + look + "): the words preview as typed, with how many texts", /Hi Ms Jones, your car AB12CDE\. Call 0161 496 0000\./.test(prev) && /1 text/.test(prev), prev);
  if (theme === "stdplus" || theme === "premium") check("Customer texts (" + look + "): typing shows Unsaved changes", /Customer texts/.test(await page.innerText("#setUnsaved")));
  await page.uncheck('[data-txon="sent"]'); await page.selectOption("#txAt", "19:00");
  await page.click("[data-savetexts]"); await sleep(400);
  const p = db.calls.filter((x) => x.fn === "set_texts").pop()?.args.p;
  check("Customer texts (" + look + "): Save sends the settings", p && p.on === true && p.sender === "TAKEOFF" && p.at === "19:00" && p.sent.on === false && p.landed.on === true && p.landed.text === "Hi {name}, your car {reg}. Call {office}.", p);
  await page.selectOption("#txOn", "demo"); await page.click("[data-savetexts]"); await sleep(400);
  const pd = db.calls.filter((x) => x.fn === "set_texts").pop()?.args.p;
  check("Customer texts (" + look + "): Demo saves on and demo", pd && pd.on === true && pd.demo === true, pd);
  await page.fill("#txSender", "TAKEOFF-UK!"); await page.click("[data-savetexts]"); await sleep(200);
  check("Customer texts (" + look + "): a sender name with signs in it isn't sent", db.calls.filter((x) => x.fn === "set_texts").length === 2);
  check("Customer texts (" + look + "): no errors", page.__errors.length === 0, page.__errors);
  await page.context().close();
  // The office doesn't see it.
  const db2 = textsDb(theme); db2.me = { ...db2.me, role: "office" };
  const p2 = await phone(browser, db2); await open(p2);
  await p2.evaluate(() => (document.querySelector("#bnav [data-bn=menuBtn]") || document.getElementById("menuBtn")).click()); await sleep(300);
  const s = await p2.$('#menuBody [data-view="settings"]');
  if (s) { await s.click(); await sleep(400); }
  check("Customer texts (" + look + "): not for the office", !(await p2.$("[data-savetexts]")));
  await p2.context().close();
}, "texts");
