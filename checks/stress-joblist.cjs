// Stress check for Airport Parking Bay's Joblist PDF reader: a made-up 6-page,
// 300-booking PICKS list (no real customers), drawn line by line the way the
// real PDF is (VIP references split over two lines, long names wrapped), read
// by the SHIPPING public/reader.js. Every booking must come out once, intact.
//   node checks/stress-joblist.cjs        (no installs needed)
const fs = require("fs"), path = require("path"), vm = require("vm");
const win = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "reader.js"), "utf8"), {
  window: win, console, Promise, Math, String, Number, Date, RegExp, Object, Array, JSON,
  document: { querySelector: () => null, head: { appendChild() {} }, createElement: () => ({}) },
});
const R = win.TakeoffReader;
let failed = 0;
const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + String(JSON.stringify(d)).slice(0, 300))); if (!c) failed++; };

// Column x positions, as on the 2026 sheets.
const X = { ref: 28, name: 110, phone: 200, meet: 270, ret: 330, reg: 395, make: 450, colour: 520, pt: 570, location: 600, note: 640 };
const head = (y) => ({ y, items: [["ID", "ref"], ["Customer", "name"], ["Mobile No", "phone"], ["Departure Date", "meet"], ["Return Date", "ret"], ["Vehicle Reg", "reg"], ["Make & Model", "make"], ["Colour", "colour"], ["PT", "pt"], ["Location", "location"], ["Notes", "note"]].map(([s, k]) => ({ x: X[k], w: 30, s })) });
const pad = (n) => String(n).padStart(2, "0");
const want = [];
const pages = [];
let n = 0;
for (let pg = 0; pg < 6; pg++) {
  const lines = [{ y: 561, items: [{ x: 28, w: 200, s: "Joblist 08/10/2026 - 08/10/2026 — PICKS" }] }, head(530)];
  let y = 515;
  for (let k = 0; k < 50; k++, n++) {
    const vip = n % 7 === 0, longName = n % 11 === 0, hh = pad(Math.floor(n / 13) % 24), mm = pad((n * 7) % 60);
    const ref = vip ? "VIP APB-" + (1000 + n) : "CPD-19-" + (600000 + n), reg = "AB" + pad(n % 100) + "C" + String.fromCharCode(65 + (n % 26)) + "D";
    const name = longName ? "Customer Number " + n + " Longsurname" : "Customer " + n;
    want.push({ ref, reg, name });
    // dates above the main line, times below (as the real PDF draws them)
    lines.push({ y: y + 6, items: [{ x: X.meet, w: 40, s: "08/10/2026" }, { x: X.ret, w: 40, s: "1" + (n % 9 + 1) + "/10/2026" }] });
    const main = [{ x: X.name, w: 60, s: longName ? "Customer Number" : name }, { x: X.phone, w: 50, s: "07700 9" + String(n).padStart(5, "0") }, { x: X.reg, w: 40, s: reg }, { x: X.make, w: 50, s: "Ford Focus" }, { x: X.colour, w: 30, s: "Blue" }, { x: X.location, w: 20, s: "GS" }];
    if (vip) main.push({ x: 31, w: 6, s: "★" }, { x: 40, w: 14, s: "VIP" }, { x: 57, w: 30, s: "APB-" }); else main.push({ x: X.ref, w: 60, s: ref });
    lines.push({ y, items: main });
    const below = [{ x: X.meet, w: 30, s: hh + ":" + mm }, { x: X.ret, w: 30, s: "10:00" }];
    if (vip) below.push({ x: 28, w: 30, s: String(1000 + n) });
    if (longName) below.push({ x: X.name, w: 60, s: n + " Longsurname" });
    lines.push({ y: y - 5, items: below });
    y -= 21;   // the real sheets: about 20 points from one booking to the next
  }
  lines.sort((a, b) => b.y - a.y);
  pages.push(lines);
}
const t0 = Date.now();
let rows = [], kind = "";
for (const lines of pages) { const got = R.parseJoblistLines(lines, kind); kind = got.kind || kind; rows = rows.concat(got.rows); }
const ms = Date.now() - t0;
console.log("      300 bookings over 6 pages read in " + ms + " ms");
ok("all 300 bookings read, none merged or lost", rows.length === 300, rows.length);
ok("read as PICKS", kind === "picks", kind);
ok("every reference whole, VIP ones joined back together", want.every((w, i) => rows[i] && rows[i].ref.replace(/^VIP\s*/, "VIP ") === w.ref), rows.filter((r, i) => r.ref.replace(/^VIP\s*/, "VIP ") !== want[i].ref).slice(0, 3).map((r) => r.ref));
ok("every reg right", want.every((w, i) => rows[i] && rows[i].reg === w.reg));
ok("wrapped names joined back", want.every((w, i) => rows[i] && rows[i].name === w.name), rows.filter((r, i) => r.name !== want[i].name).slice(0, 3).map((r) => r.name));
ok("no reference twice", new Set(rows.map((r) => r.ref)).size === 300);
ok("drop-off times read", rows.every((r) => r.meet && r.meet.time));
ok("read in under 1 s", ms < 1000, ms);

// The 14 Oct 2026 DROPS layout (positions copied from the real PDF, people made
// up, rows closed up as on a full page): a VIP reference over three lines with its reg on a line of its own, a
// wrapped make, an FHR reference split in two, and a four-line booking at the
// foot of the page whose flight reads "Not provided". TBA is no flight either.
const D = [
  { y: 561, items: [{ x: 304.1, w: 150, s: "Joblist 14/10/2026 - 14/10/2026 — DROPS" }] },
  { y: 530, items: [["ID", 28.5], ["Customer", 99.9], ["Mobile No", 195.1], ["Departure Date", 266.5], ["Return Date", 338], ["Vehicle Reg", 409.4], ["Make & Model", 464.9], ["Colour", 544.3], ["Flight", 591.9], ["Flight Landing Time", 639.5], ["Location", 695], ["Notes", 726.7]].map(([s, x]) => ({ x, w: 30, s })) },
  { y: 515, items: [{ x: 266.5, w: 40, s: "12/10/2026" }, { x: 338, w: 40, s: "14/10/2026" }] },
  { y: 509, items: [{ x: 28.5, w: 50, s: "SPF-AB12CD" }, { x: 99.9, w: 50, s: "Customer One" }, { x: 195.1, w: 50, s: "07700900001" }, { x: 409.4, w: 40, s: "AA11AAA" }, { x: 464.9, w: 40, s: "Ford Focus" }, { x: 544.3, w: 30, s: "Grey" }, { x: 591.9, w: 20, s: "TBA" }] },
  { y: 505, items: [{ x: 266.5, w: 30, s: "19:00" }, { x: 338, w: 30, s: "07:45" }] },
  { y: 490, items: [{ x: 31.5, w: 6, s: "★" }, { x: 39.9, w: 14, s: "VIP" }] },
  { y: 489, items: [{ x: 56.7, w: 20, s: "APB-" }, { x: 266.5, w: 40, s: "07/10/2026" }, { x: 338, w: 40, s: "14/10/2026" }, { x: 464.9, w: 40, s: "Range Rover" }] },
  { y: 485, items: [{ x: 99.9, w: 30, s: "Two" }, { x: 195.1, w: 50, s: "07700900002" }, { x: 409.4, w: 40, s: "BB22 BBB" }, { x: 544.3, w: 30, s: "Black" }, { x: 591.9, w: 30, s: "W6 4551" }] },
  { y: 480, items: [{ x: 28.5, w: 20, s: "2202" }, { x: 266.5, w: 30, s: "07:30" }, { x: 338, w: 30, s: "09:45" }, { x: 464.9, w: 30, s: "Sport" }] },
  { y: 465, items: [{ x: 28.5, w: 20, s: "FHR-" }, { x: 266.5, w: 40, s: "09/10/2026" }, { x: 338, w: 40, s: "14/10/2026" }] },
  { y: 461, items: [{ x: 99.9, w: 50, s: "Mr C Three" }, { x: 195.1, w: 50, s: "+447700900003" }, { x: 409.4, w: 40, s: "CC33CCC" }, { x: 591.9, w: 20, s: "TBC" }] },
  { y: 456, items: [{ x: 28.5, w: 50, s: "1434000001" }, { x: 266.5, w: 30, s: "13:00" }, { x: 338, w: 30, s: "11:00" }] },
  { y: 441, items: [{ x: 266.5, w: 40, s: "10/10/2026" }, { x: 338, w: 40, s: "14/10/2026" }] },
  { y: 435, items: [{ x: 28.5, w: 50, s: "CAP-18-600004" }, { x: 99.9, w: 50, s: "Customer Four" }, { x: 195.1, w: 50, s: "07700900004" }, { x: 409.4, w: 40, s: "DD44DDD" }, { x: 464.9, w: 40, s: "BMW 640D" }, { x: 544.3, w: 30, s: "GREY" }, { x: 591.9, w: 30, s: "FR5456" }] },
  { y: 430, items: [{ x: 266.5, w: 30, s: "12:00" }, { x: 338, w: 30, s: "17:30" }] },
  { y: 415, items: [{ x: 266.5, w: 40, s: "07/10/2026" }, { x: 338, w: 40, s: "14/10/2026" }, { x: 591.9, w: 20, s: "Not" }] },
  { y: 411, items: [{ x: 31.5, w: 6, s: "★" }, { x: 39.9, w: 14, s: "VIP" }] },
  { y: 410, items: [{ x: 56.7, w: 30, s: "APB-992" }, { x: 99.9, w: 50, s: "Mr Five" }, { x: 195.1, w: 50, s: "07700900005" }, { x: 409.4, w: 40, s: "EE55 EEE" }, { x: 464.9, w: 40, s: "BMW X3" }, { x: 544.3, w: 30, s: "Black/blue" }] },
  { y: 405, items: [{ x: 266.5, w: 30, s: "05:00" }, { x: 338, w: 30, s: "18:30" }, { x: 591.9, w: 30, s: "provided" }] },
];
const d = R.parseJoblistLines(D, "");
ok("14 Oct layout: all 5 bookings, read as DROPS", d.rows.length === 5 && d.kind === "drops", d.rows.map((r) => r.ref));
ok("14 Oct layout: split references joined", d.rows.map((r) => r.ref).join() === "SPF-AB12CD,VIP APB-2202,FHR-1434000001,CAP-18-600004,VIP APB-992", d.rows.map((r) => r.ref));
ok("14 Oct layout: regs and return times", d.rows.map((r) => r.reg + " " + r.ret.time).join() === "AA11AAA 07:45,BB22 BBB 09:45,CC33CCC 11:00,DD44DDD 17:30,EE55 EEE 18:30", d.rows.map((r) => r.reg + " " + (r.ret && r.ret.time)));
ok("14 Oct layout: TBA, TBC and Not provided are no flight", d.rows.map((r) => r.flightIn).join() === ",W64551,,FR5456,", d.rows.map((r) => r.flightIn));
console.log(failed ? failed + " failed" : "all passed");
process.exit(failed ? 1 : 0);
