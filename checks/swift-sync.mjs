// The read-only Swift sync: guarded client, report checks, planner (preview) and
// setup part 86, with a pretend booking site, sanitised fixtures (made-up people,
// refs and plates) and an in-memory Postgres (PGlite). No real site, no real data.
//   cd checks && npm install @electric-sql/pglite && node swift-sync.mjs
import fs from "fs";
import { PGlite } from "@electric-sql/pglite";
import { parseHtmlTable, parseTsv, makeClient, assertAllowed, checkDownload, readReport, plan, planHash, previewView, londonDay, windowFor, siteDate } from "../supabase/functions/takeoff-bookings/swift.mjs";

let fails = 0;
const ok = (n, c, d) => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(d))); if (!c) fails++; };
const throws = async (f) => { try { await f(); return ""; } catch (e) { return e.message + (e.code ? " [" + e.code + "]" : ""); } };

// ── dates ──
ok("London day just after midnight BST (24 Oct 23:30Z is 25 Oct 00:30)", londonDay(Date.parse("2026-10-24T23:30:00Z")) === "2026-10-25");
ok("+1 across the clocks going back (25 Oct) is 26 Oct, not skipped or repeated", londonDay(Date.parse("2026-10-24T12:00:00Z"), 2) === "2026-10-26");
ok("clocks going forward: 27 Mar 23:30Z is still 27 Mar; +1 is 28 Mar", londonDay(Date.parse("2027-03-27T23:30:00Z")) === "2027-03-27" && londonDay(Date.parse("2027-03-27T23:30:00Z"), 1) === "2027-03-28");
ok("site date box format", siteDate("2026-10-05") === "05-October-2026");
ok("window is bounded to 14 days", windowFor(Date.parse("2026-10-14T12:00:00Z"), 99).to === "2026-10-27" && windowFor(Date.parse("2026-10-14T12:00:00Z"), 2).to === "2026-10-15");

// ── address guard ──
const BASE = "https://www.example-swift.test/admin/";
const H = ["www.example-swift.test"], S = ["index.php", "bookinglist.php", "export_to_excel.php"];
const A = (u, m = "GET") => throws(() => assertAllowed(u, BASE, H, S, m));
ok("approved report address passes", (await A(BASE + "bookinglist.php?x=1")) === "");
ok("another host is blocked", /another address/.test(await A("https://evil.test/admin/bookinglist.php")));
ok("http is blocked", /another address|https/.test(await A("http://www.example-swift.test/admin/bookinglist.php")));
ok("address with a login inside is blocked", /login in it|another address/.test(await A("https://user:pw@www.example-swift.test/admin/bookinglist.php")));
ok("outside /admin/ is blocked", /outside the admin area/.test(await A("https://www.example-swift.test/other/bookinglist.php")));
ok("a page not on the report list is blocked", /approved reports/.test(await A(BASE + "booking_edit.php")));
ok("edit / cancel / password pages are blocked even if listed", (await Promise.all(["booking_edit.php", "cancel_booking.php", "change_password.php"].map((p) => throws(() => assertAllowed(BASE + p, BASE, H, [...S, p], "GET"))))).every((m) => /could change bookings/.test(m)));
ok("DELETE/PUT are blocked", /Blocked a DELETE/.test(await A(BASE + "bookinglist.php", "DELETE")));
ok("the real report pages (Booking Manager, Return Report) pass the address guard", (await Promise.all(["bookinglist-parkandride.php?req=news", "arrival_report_parkandride.php?req=news"].map((p) => throws(() => assertAllowed("https://www.luton.swiftairportparking.co.uk/admin/" + p, "https://www.luton.swiftairportparking.co.uk/admin/", ["www.luton.swiftairportparking.co.uk"], ["bookinglist-parkandride.php", "arrival_report_parkandride.php"], "GET"))))).every((m) => m === ""));
ok("a host not on the approved list is refused as the base", /approved list/.test(await throws(() => assertAllowed("https://x.test/admin/index.php", "https://x.test/admin/", H, S, "GET"))));

// ── the pretend site ──
function site(over = {}) {
  const calls = [];
  const state = { loggedIn: false, ...over };
  const fetch = async (url, init = {}) => {
    const u = new URL(url); calls.push({ url, method: init.method, cookie: init.headers && init.headers.cookie, host: u.host });
    const R = (status, body, headers = {}) => new Response(body, { status, headers });
    const script = u.pathname.split("/").pop();
    if (state.hook) { const r = state.hook(u, init, state); if (r) return r; }
    if (script === "index.php" && init.method === "POST") {
      if (state.bad) return R(200, '<html><form><input type="password" name="password"></form></html>', { "content-type": "text/html" });
      state.loggedIn = true; const h = new Headers({ location: "/admin/home.php" }); h.append("set-cookie", "PHPSESSID=abc123; path=/"); return new Response(null, { status: 302, headers: h });
    }
    if (!state.loggedIn || state.expired) return R(200, '<html><form><input type="password" name="password"></form></html>', { "content-type": "text/html" });
    if (script === "bookinglist.php") return R(200, state.results || "<html>results</html>", { "content-type": "text/html" });
    if (script === "export_to_excel.php") { const b = state.export || "x\ty"; return R(200, b, { "content-type": "application/vnd.ms-excel", ...(state.length ? { "content-length": String(state.length) } : {}) }); }
    return R(404, "no");
  };
  return { fetch, calls, state };
}
const CFG = { base: BASE, hosts: H, scripts: ["bookinglist.php", "export_to_excel.php"] };
const mk = (s, user = "u", pass = "p") => makeClient(CFG, { fetch: s.fetch, sleep: async () => {}, user, pass });

{ const s = site({ results: "<html>Completed (125 results)</html>" }); const c = mk(s); await c.login();
  const b = await c.download("bookinglist.php?a=1", "export_to_excel.php");
  ok("the site's own result count is read from the search page", b.siteRows === 125, b.siteRows); }
{ const s = site(); const c = mk(s); await c.login(); const b = await c.download("bookinglist.php?a=1", "export_to_excel.php");
  ok("no count on the page means no count to compare", b.siteRows === null); }
{ const s = site(); const c = mk(s);
  await c.login(); const buf = await c.download("bookinglist.php?a=1", "export_to_excel.php");
  ok("signs in once, searches, downloads", s.calls.filter((x) => x.method === "POST").length === 1 && buf.length > 0 && s.calls.length === 3, s.calls.map((x) => x.method + x.url));
  ok("only GET besides the one sign-in POST", s.calls.every((x) => x.method === "GET" || x.method === "POST"));
  ok("the session cookie is sent on later requests", s.calls[1].cookie === "PHPSESSID=abc123"); }
{ const s = site({ bad: true }); const c = mk(s);
  const m = await throws(() => c.login());
  ok("a failed sign-in stops with login_failed and is tried once", /sign-in failed.*\[login_failed\]/.test(m) && s.calls.length === 1, m);
  ok("and the same client refuses a second sign-in", /second sign-in/.test(await throws(() => c.login()))); }
ok("no login saved is a clear message, no request made", await (async () => { const s = site(); const m = await throws(() => mk(s, "", "").login()); return /No booking login saved/.test(m) && s.calls.length === 0; })());
{ const s = site({ expired: true }); const c = mk(s); await c.login(); s.state.expired = true;
  ok("expired session is detected (asked to sign in again)", /session expired.*\[session_expired\]/.test(await throws(() => c.download("bookinglist.php", "export_to_excel.php")))); }
{ const s = site({ export: "<html><body>Please wait</body></html>" }); const c = mk(s); await c.login();
  ok("a web page instead of the report is rejected", /web page instead of the report/.test(await throws(() => c.download("bookinglist.php", "export_to_excel.php")))); }
{ const s = site({ length: 9999 }); const c = mk(s); await c.login();
  ok("an incomplete download (length mismatch) is rejected", /cut short/.test(await throws(() => c.download("bookinglist.php", "export_to_excel.php")))); }
ok("empty and oversized downloads are rejected", /empty/.test(await throws(() => checkDownload(new Uint8Array(), ""))) && /bigger than expected/.test(await throws(() => checkDownload(new Uint8Array(6 * 1024 * 1024), ""))));
{ const s = site(); s.state.hook = (u) => u.pathname.endsWith("bookinglist.php") ? new Response(null, { status: 302, headers: { location: "https://evil.test/steal" } }) : null;
  const c = mk(s); await c.login();
  const m = await throws(() => c.download("bookinglist.php", "export_to_excel.php"));
  ok("a redirect to another origin is blocked and nothing is sent there", /another address/.test(m) && !s.calls.some((x) => x.host === "evil.test"), m); }
{ const s = site(); s.state.hook = (u) => u.pathname.endsWith("bookinglist.php") ? new Response(null, { status: 302, headers: { location: "/admin/booking_cancel.php?id=1" } }) : null;
  const c = mk(s); await c.login();
  ok("a redirect into a non-report page is blocked", /approved reports|could change/.test(await throws(() => c.download("bookinglist.php", "export_to_excel.php")))); }
{ const s = site(); const c = mk(s); await c.login();
  let m = ""; for (let i = 0; i < 14 && !m; i++) m = await throws(() => c.download("bookinglist.php", "export_to_excel.php"));
  ok("request count is capped per run", /too many requests/.test(m), m); }

// a report whose search is a POST form (the Return Report): one allowed search, nothing else
{ const s = site(); s.state.hook = (u, init) => u.pathname.endsWith("report.php") && init.method === "POST" ? new Response("<table><tr><th>Ref#</th></tr></table>", { status: 200 }) : null;
  const c = makeClient({ ...CFG, scripts: [...CFG.scripts, "report.php"], post_scripts: ["report.php"] }, { fetch: s.fetch, sleep: async () => {}, user: "u", pass: "p" });
  await c.login();
  ok("a configured report search can be POSTed (read-only search)", /<table>/.test(await c.postPage("report.php", { filter_from: "14-October-2026" })) && s.calls.filter((x) => x.method === "POST").length === 2);
  ok("a POST to any other page is blocked", /Blocked a form submission/.test(await throws(() => c.postPage("bookinglist.php", { a: 1 }))));
  await c.postPage("report.php", {});
  ok("searches by POST are capped per run", /too many searches/.test(await throws(() => c.postPage("report.php", {})))); }

// ── fixtures: sanitised ──
const HEAD = ["Booking Status", "Reference", "Full Name", "Car Reg", "Car Make", "Telephone", "Booking From", "Booking To", "Return Flight", "Supplier", "Notes"];
const row = (st, ref, name, reg, from, to, fl = "", sup = "TakeOff", note = "") => [st, ref, name, "", reg, "", from, to, fl, sup, note].slice(0, 0).concat([st, ref, name, reg, "Ford", "07000 000000", from, to, fl, sup, note]);
const SCOPE = { column: "Supplier", values: ["takeoff"] };
const grid = (...rows) => [["Luton report"], HEAD, ...rows];

ok("no scope configured: nothing read", /Supplier scope isn't configured/.test(await throws(() => readReport(grid(row("Booked", "T1", "A One", "AB12 CDE", "2026-10-14 08:00", "2026-10-16 10:00")), undefined))));
ok("scope column missing from the report: refused", /no 'Supplier' column/.test(await throws(() => readReport([["x", "y"], ["Reference", "Full Name", "Car Reg", "Booking From", "Booking To"], ["R", "N", "AB12CDE", "2026-10-14 08:00", "2026-10-16 10:00"]], SCOPE))));
{ const r = readReport(grid(row("Booked", "T1", "A One", "AB12 CDE", "2026-10-14 08:00", "2026-10-16 10:00"), row("Booked", "O1", "Other Co", "ZZ99 ZZZ", "2026-10-14 08:00", "2026-10-16 10:00", "", "Someone Else"), row("Cancelled", "T2", "B Two", "CD34 EFG", "2026-10-14 09:00", "2026-10-15 10:00")), SCOPE);
  ok("only the approved supplier's bookings are read; others counted as excluded", r.rows.length === 2 && r.excludedScope === 1 && !r.rows.some((x) => x.ref === "O1"), r);
  ok("cancelled bookings are kept and marked (not silently dropped)", r.rows.find((x) => x.ref === "T2").cancelled === true && r.rows.find((x) => x.ref === "T1").cancelled === false); }
ok("an unexplained empty result is rejected", /no bookings for this scope/.test(await throws(() => readReport(grid(row("Booked", "O1", "Other", "ZZ99 ZZZ", "2026-10-14 08:00", "2026-10-16 10:00", "", "Someone Else")), SCOPE))));
ok("an empty flights report can be allowed", readReport(grid(), SCOPE, { allowEmpty: true }).rows.length === 0);
ok("changed report structure (no Reference/Name/dates) is rejected", /Couldn't find the column names|missing columns/.test(await throws(() => readReport([["Supplier", "Colour"], ["TakeOff", "red"]], SCOPE))));
ok("a report missing the return column is rejected", /missing columns \(ret\)/.test(await throws(() => readReport([["Booking Status", "Reference", "Full Name", "Car Reg", "Booking From", "Supplier"], ["Booked", "T1", "A", "AB12CDE", "2026-10-14 08:00", "TakeOff"]], SCOPE))));
ok("exactly one full page of rows is treated as possibly incomplete", /may be incomplete/.test(await throws(() => readReport(grid(...Array.from({ length: 3 }, (_, i) => row("Booked", "P" + i, "N" + i, "AB12 CD" + i, "2026-10-14 08:00", "2026-10-16 10:00"))), SCOPE, { pageSize: 3 }))));

// the real Booking Manager's headings (from the 14 Oct screenshot), made-up rows
{ const H2 = ["Ref#", "Supplier Name", "Booking Type", "Payment Status", "Full Name", "Booked", "Meet", "Return", "Vehicle", "Total Days", "V/Code", "V/Value", "Booking Status"];
  const g2 = [H2, ["AAAA11", "HES", "PR", "Payment Success", "MR A SAMPLE", "13-10-2026 00:16", "14-10-2026 18:50", "19-10-2026 09:15", "TOYOTA COROLLA ICON HEV CVT AB24XYZ", "6", "", "0.00", "Booked"],
    ["BBBB22", "L4P", "MG", "Payment Success", "Mx Sample", "22-09-2026 10:07", "14-10-2026 21:00", "17-10-2026 08:00", "CD09XYZ", "3", "", "0.00", "Booked"],
    ["CCCC33", "HES", "MG", "Payment Success", "MISS D SAMPLE", "27-09-2026 21:16", "14-10-2026 17:00", "19-10-2026 03:00", "LEXUS CT EF64XYZ", "6", "", "0.00", "Cancelled"]];
  const a = readReport(g2, { column: "Supplier Name", values: ["HES"] });
  ok("Booking Manager headings read: ref, name, reg split from vehicle, dd-mm-yyyy dates, status", a.rows.length === 2 && a.rows[0].reg === "AB24XYZ" && a.rows[0].meet.key === "2026-10-14" && a.rows[0].ret.time === "09:15" && a.rows[1].cancelled === true, a.rows);
  const b = readReport(g2, [{ column: "Supplier Name", values: ["HES"] }, { column: "Booking Type", values: ["MG"] }]);
  ok("scope can require supplier AND booking type", b.rows.length === 1 && b.rows[0].ref === "CCCC33" && b.excludedScope === 2, b); }

// Return Report (14 Oct photo): no meet/return columns, flights in input boxes, and every booking is TakeOff's
{ const html = `<table><tr><th>Time</th><th>Agent</th><th>Ref#</th><th>Client</th><th>Telephone</th><th>Day</th><th>Car Make</th><th>Car Reg</th><th>Flight No.</th><th>Flight Time</th><th>Booking Status</th></tr>
  <tr><td>00:30</td><td>APL</td><td>APL-087811</td><td>Mr. Sample One</td><td>07000 000001</td><td>06-10</td><td>MG</td><td>LC23 TPP</td><td><input type="text" value="EZY2594"></td><td><input value=""></td><td>Booked</td></tr>
  <tr><td>00:30</td><td>HES</td><td>LDQKMY</td><td>MR SAMPLE TWO</td><td></td><td>01-10</td><td>BMW</td><td>X333JWS</td><td><input type="text" value="U22382"></td><td></td><td>Collected</td></tr>
  <tr><td>00:30</td><td>HES</td><td>LDRKDQ</td><td>MR SAMPLE THREE</td><td></td><td>01-10</td><td>VOLVO</td><td>A11YJT</td><td><input type="text" value=""></td><td></td><td>Booked</td></tr></table>`;
  const g = parseHtmlTable(html); const f = readReport(g, { all: true }, { flights: true, allowEmpty: true });
  ok("Return Report table: flights read from the input boxes, no meet/return needed", f.rows.length === 3 && f.rows[0].flightIn === "EZY2594" && f.rows[1].flightIn === "U22382" && f.rows[2].flightIn === "" && f.rows[0].reg === "LC23 TPP", f.rows);
  ok("a page with no table is rejected", /No table/.test(await throws(() => parseHtmlTable("<html>nothing</html>"))));
  ok("{all:true} scope keeps every booking (owner confirmed all are TakeOff's)", readReport(grid(row("Booked", "T1", "A One", "AB12 CDE", "2026-10-14 08:00", "2026-10-16 10:00", "", "Anyone")), { all: true }).rows.length === 1);
  ok("scope still can't be left out", /scope isn't configured/.test(await throws(() => readReport(grid(), undefined))) && /scope isn't configured/.test(await throws(() => readReport(grid(), {})))); }

{ const g3 = grid(row("Booked", "T1", "A One", "AB12 CDE", "2026-10-14 08:00", "2026-10-15 10:00"));
  ok("an export inside the searched dates is accepted", readReport(g3, SCOPE, { field: "ret", window: { from: "2026-10-14", to: "2026-10-15" } }).rows.length === 1);
  ok("an export that doesn't match the search (site ignored the filter) is rejected", /doesn't match the dates searched/.test(await throws(() => readReport(g3, SCOPE, { field: "ret", window: { from: "2026-10-20", to: "2026-10-21" } })))); }

// ── planner ──
const WIN = { from: "2026-10-12", to: "2026-10-15" };
const parse = (rows) => readReport(grid(...rows), SCOPE).rows;
const ex = (o) => ({ reg: "AB12CDE", name: "A One", phone: "07000 000000", make: "Ford", drop_local: "", return_local: "", flight: "", flight_typed: false, note: "", sheet_day: "", cleared: false, removed: false, early: false, sent: false, ...o });
const P = (rows, existing = new Map(), extra = {}) => { const all = parse(rows); return plan({ drops: all, picks: all, existing, window: WIN, cutoff: "06:00", cancelledRows: all.filter((r) => r.cancelled).flatMap((row) => [{ kind: "drops", row }, { kind: "picks", row }]), ...extra }); };
const one = row("Booked", "T1", "A One", "AB12 CDE", "2026-10-12 08:00", "2026-10-14 10:00", "U22001");

{ const p = P([one]);
  ok("a first import: the booking is new on both sheets", p.counts.new === 2 && p.batches.length === 2, p.counts);
  ok("DROPS grouped by return day, PICKS by meet day", p.batches.find((b) => b.kind === "drops").day === "2026-10-14" && p.batches.find((b) => b.kind === "picks").day === "2026-10-12");
  // pretend the import happened: existing now equals what was sent
  const e = new Map(); p.batches.forEach((b) => b.rows.forEach((r) => e.set(b.kind + "|" + r.ref, ex({ ...r, sheet_day: b.day }))));
  const p2 = P([one], e, { window: { from: "2026-10-12", to: "2026-10-15" } });
  ok("importing the same report again creates nothing (duplicate prevention)", p2.counts.new === 0 && p2.counts.changed === 0 && p2.counts.unchanged === 2 && p2.batches.length === 0, p2.counts);
  ok("the plan hash is stable and changes when the plan changes", (await planHash(p)) === (await planHash(P([one]))) && (await planHash(p)) !== (await planHash(P([row("Booked", "T1", "A One", "AB12 CDE", "2026-10-12 08:00", "2026-10-14 11:00")])))); }

{ const e = new Map([["drops|T1", ex({ return_local: "2026-10-14 10:00", drop_local: "2026-10-12 08:00", sheet_day: "2026-10-14", flight: "U22001" })]]);
  const p = P([row("Booked", "T1", "A One", "AB12 CDE", "2026-10-12 08:00", "2026-10-14 12:30", "U22001")], e, { window: { from: "2026-10-12", to: "2026-10-15" } });
  const it = p.items.find((i) => i.kind === "drops");
  ok("an amended return time on the same day is a change, listing the field", it.status === "changed" && it.changes.some((c) => c.field === "return" && c.from === "2026-10-14 10:00" && c.to === "2026-10-14 12:30"), it); }
{ const e = new Map([["drops|T1", ex({ return_local: "2026-10-14 10:00", drop_local: "2026-10-12 08:00", sheet_day: "2026-10-14", flight: "XX1", flight_typed: true })]]);
  const p = P([row("Booked", "T1", "A One", "AB12 CDE", "2026-10-12 08:00", "2026-10-14 10:00", "U22001")], e, { window: { from: "2026-10-12", to: "2026-10-15" } });
  ok("a flight typed by staff is never overwritten or even re-sent", p.items.find((i) => i.kind === "drops").status === "unchanged" && !JSON.stringify(p.batches).includes("U22001"), p.items); }
{ const e = new Map([["drops|T1", ex({ return_local: "2026-10-14 10:00", drop_local: "2026-10-12 08:00", sheet_day: "2026-10-14", flight_typed: true, flight: "XX1" })]]);
  const p = P([row("Booked", "T1", "A One", "AB12 CDE", "2026-10-12 08:00", "2026-10-14 13:00", "U22001")], e, { window: { from: "2026-10-12", to: "2026-10-15" } });
  const sent = p.batches.find((b) => b.kind === "drops").rows[0];
  ok("a changed car still keeps the staff flight (the row we send carries none)", sent.flight === "" && p.items.find((i) => i.kind === "drops").changes.every((c) => c.field !== "flight")); }
ok("no operational field (yard, driver, called, sent, paid, exit fee, photos) can be in what is sent", (() => { const p = P([one]); const keys = new Set(p.batches.flatMap((b) => b.rows.flatMap((r) => Object.keys(r)))); return [...keys].every((k) => ["ref", "reg", "name", "phone", "make", "drop_local", "return_local", "flight", "note"].includes(k)); })());

{ const p = P([row("Booked", "T9", "Late Night", "EF56 GHI", "2026-10-12 08:00", "2026-10-15 00:22")], new Map(), { window: { from: "2026-10-12", to: "2026-10-16" } });
  ok("a 00:22 return belongs to the night before (DROPS day ends 06:00)", p.batches.find((b) => b.kind === "drops").day === "2026-10-14", p.batches); }
{ const p = P([row("Booked", "T8", "Midnight", "EF56 GHJ", "2026-10-15 00:00", "2026-10-18 09:00")], new Map(), { window: { from: "2026-10-12", to: "2026-10-18" } });
  ok("a PICKS meet at 00:00 stays on its own date", p.batches.find((b) => b.kind === "picks").day === "2026-10-15"); }
{ const p = P([row("Booked", "T7", "Far Future", "EF56 GHK", "2027-01-01 08:00", "2027-01-05 09:00")]);
  ok("bookings outside the window are not imported", p.batches.length === 0 && p.counts.outside === 2, p.counts); }

{ const e = new Map([["drops|T2", ex({ name: "B Two", sheet_day: "2026-10-14" })]]);
  const p = P([row("Cancelled", "T2", "B Two", "CD34 EFG", "2026-10-12 09:00", "2026-10-14 10:00"), one], e);
  ok("a cancelled booking the app holds goes to office review, not into the import", p.reviews.some((r) => r.kind === "cancelled" && r.ref === "T2") && !JSON.stringify(p.batches).includes("T2"), p.reviews);
  const p2 = P([row("Cancelled", "T3", "Not Ours Here", "CD34 EFH", "2026-10-12 09:00", "2026-10-14 10:00")], new Map());
  ok("a cancelled booking the app never had is not flagged", p2.reviews.length === 0); }
{ const e = new Map([["drops|GONE", ex({ sheet_day: "2026-10-14" })]]);
  const p = P([one], e);
  ok("a booking missing from the report is NOT treated as cancelled", p.reviews.length === 0 && p.items.every((i) => i.ref !== "GONE")); }
{ const e = new Map([["drops|T1", ex({ return_local: "2026-10-14 10:00", sheet_day: "2026-10-14", cleared: true })]]);
  const p = P([row("Booked", "T1", "A One", "AB12 CDE", "2026-10-12 08:00", "2026-10-14 15:00")], e, { window: { from: "2026-10-12", to: "2026-10-15" } });
  ok("a changed return on a car already handed back is a conflict for review", p.reviews.some((r) => r.kind === "conflict" && r.ref === "T1") && !p.batches.some((b) => b.kind === "drops"), p.reviews); }
{ const e = new Map([["picks|T1", ex({ drop_local: "2026-10-12 08:00", sheet_day: "2026-10-12" })]]);
  const p = P([row("Booked", "T1", "A One", "AB12 CDE", "2026-10-13 08:00", "2026-10-14 10:00")], e, { window: { from: "2026-10-12", to: "2026-10-15" } });
  ok("a PICKS booking moved to another day is a conflict (no duplicate car is made)", p.reviews.some((r) => r.kind === "conflict" && /moved from sheet/.test(r.detail.why)) && !p.batches.some((b) => b.kind === "picks"), p.reviews); }
{ const e = new Map([["drops|T1", ex({ return_local: "2026-10-14 10:00", drop_local: "2026-10-12 08:00", sheet_day: "2026-10-14" })]]);
  const p = P([row("Booked", "T1", "A One", "AB12 CDE", "2026-10-12 08:00", "2026-10-15 10:00")], e, { window: { from: "2026-10-12", to: "2026-10-16" } });
  ok("an extended DROPS return is allowed through (the app moves it, as for a hand import)", p.batches.some((b) => b.kind === "drops" && b.day === "2026-10-15") && p.reviews.length === 0, p); }
{ const p = P([row("Booked", "D1", "Dup A", "AB12 CDE", "2026-10-12 08:00", "2026-10-14 10:00"), row("Booked", "D1", "Dup B", "ZZ99 ZZZ", "2026-10-12 08:00", "2026-10-14 10:00"), row("Booked", "", "No Ref", "AB12 CDF", "2026-10-12 08:00", "2026-10-14 10:00"), row("Booked", "D2", "No Date", "AB12 CDG", "", "")]);
  ok("ambiguous duplicates, missing reference and missing dates are reported invalid and not imported", p.counts.invalid >= 4 && p.batches.length === 0 && p.invalid.some((i) => /ambiguous/.test(i.reason)) && p.invalid.some((i) => /no booking reference/.test(i.reason)) && p.invalid.some((i) => /date/.test(i.reason)), p.invalid);
  ok("the screen cannot apply a plan with invalid records", previewView(p, "h").can_apply === false); }
{ const v = previewView(P([one]), "h"); ok("a clean plan can be applied and carries no phone numbers", v.can_apply === true && !JSON.stringify(v).includes("07000")); }

// ── setup part 86 on in-memory Postgres ──
const db = new PGlite();
await db.exec(`
create schema private;
create role anon; create role authenticated; create role service_role;
create table companies (id uuid primary key default gen_random_uuid(), slug text, time_zone text default 'Europe/London', suspended_at timestamptz);
create table sheets (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, day date);
create table bookings (id uuid primary key default gen_random_uuid(), company_id uuid, sheet_id uuid, kind text, ref text default '', reg text default '', name text default '', phone text default '', make text default '',
  drop_at timestamptz, return_at timestamptz, flight text default '', note text default '', sent_at timestamptz, cleared_at timestamptz, removed_at timestamptz, early boolean default false);
create table activity (id bigint generated always as identity primary key, booking_id uuid, action text);
create table staff (id uuid primary key default gen_random_uuid(), company_id uuid, name text, role text);
create table cur (sid uuid);
create function me() returns staff language sql as $$ select s from staff s where id = (select sid from cur) $$;
create function can(a text) returns boolean language sql as $$ select (select role from me()) in ('owner','manager','office') $$;
create table private.auto_import (company_id uuid primary key references companies(id) on delete cascade, provider text not null default 'swift', enabled boolean not null default false,
  last_run timestamptz, last_ok timestamptz, last_error text, last_summary jsonb, updated_at timestamptz not null default now());
create table done (company uuid, kind text, day date, ref text);
create function import_sheet_system(c uuid, k text, d date, r jsonb, s jsonb) returns jsonb language plpgsql as $$
declare x jsonb; begin
  for x in select * from jsonb_array_elements(r) loop
    if x->>'ref' = 'BOOM' then raise exception 'boom on %', d; end if;
    insert into done values (c, k, d, x->>'ref'); end loop;
  return jsonb_build_object('added', jsonb_array_length(r), 'updated', 0, 'undo_id', 1, 'added_ids', '[]'::jsonb); end $$;
insert into companies(slug) values ('takeoff'), ('airport-parking-bay');
`);
const sql = fs.readFileSync(new URL("../setup/86-swift-readonly-sync.sql", import.meta.url), "utf8");
for (let i = 0; i < 2; i++) await db.exec(sql);
ok("part 86 runs twice without error", true);
const q = async (s, a) => (await db.query(s, a)).rows;
const co = (await q(`select id from companies where slug='takeoff'`))[0].id, other = (await q(`select id from companies where slug='airport-parking-bay'`))[0].id;
const err = async (s, a) => { try { await db.query(s, a); return ""; } catch (e) { return e.message; } };

const t1 = (await q(`select swift_lock($1) t`, [co]))[0].t;
ok("the first run gets the lock", !!t1);
ok("a concurrent run for the same company is refused", /already running/.test(await err(`select swift_lock($1)`, [co])));
ok("another company is not affected by that lock", !!(await q(`select swift_lock($1) t`, [other]))[0].t);
await db.exec(`insert into staff(company_id,name,role) values ('${co}','Office','office'), ('${co}','Driver','bongo')`);
const as = (n) => db.exec(`delete from cur; insert into cur select id from staff where name='${n}'`);
await as("Office");
await db.exec(`update private.auto_import set config='{"base":"https://x/admin/","manual_enabled":true}' where company_id='${co}'`);
const st = (await q(`select auto_import_status() s`))[0].s;
ok("status: available, running, and no config or secrets leaked", st.available === true && st.running === true && !("config" in st) && !JSON.stringify(st).includes("https://x"), st);
await db.query(`select swift_unlock($1,$2)`, [co, t1]);
ok("after unlock a new run can start", !!(await q(`select swift_lock($1) t`, [co]))[0].t);
await db.exec(`update private.auto_import set lock_until = now() - interval '1 minute' where company_id='${co}'`);
const t2 = (await q(`select swift_lock($1) t`, [co]))[0].t;
ok("a lock left by a dead run expires by itself", !!t2);
await db.query(`select swift_unlock($1,$2,60)`, [co, t2]);
ok("after a failed sign-in the sync is paused (no repeated login attempts)", /paused after a failed sign-in/.test(await err(`select swift_lock($1)`, [co])));
ok("status shows the pause", !!(await q(`select auto_import_status() s`))[0].s.blocked_until);

await db.query(`select swift_review_upsert($1,$2)`, [co, JSON.stringify([{ ref: "T2", kind: "cancelled", detail: { name: "B Two" } }, { ref: "T1", kind: "conflict", detail: { why: "x" } }])]);
await db.query(`select swift_review_upsert($1,$2)`, [co, JSON.stringify([{ ref: "T2", kind: "cancelled", detail: { name: "B Two" } }])]);
let rv = (await q(`select swift_reviews_open() r`))[0].r;
ok("reviews are listed once each (a second sync does not duplicate them)", rv.length === 2, rv);
await db.query(`select swift_review_resolve($1)`, [rv[0].id]);
await db.query(`select swift_review_upsert($1,$2)`, [co, JSON.stringify([{ ref: rv[0].ref, kind: rv[0].kind, detail: rv[0].detail }])]);
ok("a resolved review stays resolved while nothing about it changed", (await q(`select swift_reviews_open() r`))[0].r.length === 1);
await db.query(`select swift_review_upsert($1,$2)`, [co, JSON.stringify([{ ref: rv[0].ref, kind: rv[0].kind, detail: { changed: true } }])]);
ok("…and reopens when the booking site's details change again", (await q(`select swift_reviews_open() r`))[0].r.length === 2);
await as("Driver");
ok("a driver cannot see or resolve reviews", /Not allowed/.test(await err(`select swift_reviews_open()`)) && /Not allowed/.test(await err(`select swift_review_resolve(1)`)));
await as("Office");
const stOther = await (async () => { await db.exec(`insert into staff(company_id,name,role) values ('${other}','Other Office','office')`); await as("Other Office"); return (await q(`select swift_reviews_open() r`))[0].r; })();
ok("another company never sees these reviews", stOther.length === 0);

// swift_existing + apply atomicity
const sh = (await q(`insert into sheets(company_id,kind,day) values ($1,'drops','2026-10-14') returning id`, [co]))[0].id;
const bk = (await q(`insert into bookings(company_id,sheet_id,kind,ref,reg,name,return_at,cleared_at) values ($1,$2,'drops','T1','AB12CDE','A One','2026-10-14 09:00+01', now()) returning id`, [co, sh]))[0].id;
await db.query(`insert into activity(booking_id, action) values ($1,'FLIGHT')`, [bk]);
const e = (await q(`select swift_existing($1,$2) r`, [co, ["T1", "NOPE"]]))[0].r;
ok("swift_existing returns London local times, state flags and typed-flight marker", e.length === 1 && e[0].return_local === "2026-10-14 09:00" && e[0].cleared === true && e[0].flight_typed === true && e[0].sheet_day === "2026-10-14", e);
ok("swift_existing is company-isolated", (await q(`select swift_existing($1,$2) r`, [other, ["T1"]]))[0].r.length === 0);
const good = [{ kind: "drops", day: "2026-10-14", rows: [{ ref: "A" }] }, { kind: "picks", day: "2026-10-12", rows: [{ ref: "A" }] }];
const r1 = (await q(`select swift_apply($1,$2) r`, [co, JSON.stringify(good)]))[0].r;
ok("swift_apply imports every day", r1.length === 2 && (await q(`select count(*)::int n from done`))[0].n === 2 && !JSON.stringify(r1).includes("added_ids"), r1);
const bad = [{ kind: "drops", day: "2026-10-14", rows: [{ ref: "B" }] }, { kind: "picks", day: "2026-10-13", rows: [{ ref: "BOOM" }] }];
const m = await err(`select swift_apply($1,$2)`, [co, JSON.stringify(bad)]);
ok("if a later day fails nothing from that sync is kept (no partial import)", /boom/.test(m) && (await q(`select count(*)::int n from done`))[0].n === 2, m);
ok("the service-role-only functions are not callable by the app's users", (await q(`select has_function_privilege('authenticated','swift_apply(uuid,jsonb,jsonb)','execute') a, has_function_privilege('authenticated','swift_lock(uuid,int)','execute') b, has_function_privilege('service_role','swift_apply(uuid,jsonb,jsonb)','execute') c`))[0].a === false);

{
  const enc = (t) => new TextEncoder().encode(t);
  const g = parseTsv(enc('Sr#\tRef\tNotes\r\n1\tAB1\t"two\nlines, ""q"""\r\n2\tAB2\t\r\n\r\n'));
  ok("the tab-separated export is read as text (quotes, line breaks, blank rows)", g && g.length === 3 && g[1][2] === 'two\nlines, "q"' && g[2][1] === "AB2" && g[2][2] === "", JSON.stringify(g));
  ok("a real spreadsheet or a web page is not read as text", parseTsv(new Uint8Array([0x50, 0x4b, 3, 4])) === null && parseTsv(enc("<html>no tabs</html>")) === null);
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
