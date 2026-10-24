// Parking Ops — the app. One codebase, several parking companies.
//
// Data lives in TAKEOFF's own Supabase project. The page only ever READS
// tables; every change goes through a database function that checks the
// person's role and writes the activity log (setup/01-core.sql).
//
// Taps are applied on screen straight away and saved through a queue kept on
// the phone, so a weak signal on the yard never loses a tap: it saves when
// the signal comes back. Changes by anyone else arrive live (Supabase Realtime).
(function () {
  "use strict";

  var CFG = {
    url: "https://oioqjfrlwrjovnouhusp.supabase.co",
    // TAKEOFF's public (anon) key: safe in the page, it can only do what the
    // database rules allow a signed-in person to do.
    key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pb3FqZnJsd3Jqb3Zub3VodXNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3MDQsImV4cCI6MjEwNTIwNTcwNH0.09ddpfS4_KwZN7QWJoAiwaIl02wQLaw6yJWEltNMQ2U"
  };
  var TZ = "Europe/London";
  var LINK_KEY = "takeoff_link";

  // ── helpers ───────────────────────────────
  var $ = function (id) { return document.getElementById(id); };
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function toast(msg, bad) {
    var t = document.createElement("div"); t.className = "toast" + (bad ? " bad" : ""); t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 5000 : 3000);
  }
  // One formatter per format, made once: building one per call made a big
  // board (hundreds of cars, several times each) slow to redraw after a tap.
  var FMT = {};
  function fmt(k, o) { return FMT[k] || (FMT[k] = new Intl.DateTimeFormat("en-GB", o)); }
  function hhmm(ts) { return ts ? fmt("hm", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(ts)) : ""; }
  function dayShort(ts) { return ts ? fmt("day", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(ts)) : ""; }
  function londonParts(d) {
    var p = {}; fmt("parts", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return { key: p.year + "-" + p.month + "-" + p.day, time: (p.hour === "24" ? "00" : p.hour) + ":" + p.minute };
  }
  // "YYYY-MM-DD HH:MM" in the company's time zone, as a moment.
  function londonIso(local) {
    var guess = new Date(local.replace(" ", "T") + ":00Z"), p = londonParts(guess);
    var off = new Date(p.key + "T" + p.time + ":00Z").getTime() - guess.getTime();
    return new Date(guess.getTime() - off).toISOString();
  }
  // Cars past their return and not handed back (database part 80): grouped by how long over, then listed.
  function lateBody(PK) {
    var cars = PK.late_cars || [];
    if (!cars.length) return '<div class="empty">None.</div>';
    var now = Date.now(), lv = [["Less than a day", 0], ["1 day", 0], ["2 days", 0], ["3+ days", 0]];
    cars.forEach(function (c) { var d = Math.floor((now - new Date(c.return_at).getTime()) / 864e5); c.lv = Math.max(0, Math.min(3, d)); lv[c.lv][1]++; });
    var chips = lv.map(function (l, i) { return l[1] ? '<span class="late-lv lv' + i + '"><b>' + l[1] + "</b> " + l[0] + "</span>" : ""; }).join("");
    return '<div class="late-levels">' + chips + "</div>" + cars.map(function (c) {
      return '<div class="rowline late-car"><div class="grow"><strong>' + esc(c.reg) + "</strong>" + (c.name ? " · " + esc(c.name) : "") + '<div class="note">Due ' + esc(dayShort(c.return_at)) + " " + esc(hhmm(c.return_at)) + (c.yard ? " · " + esc(YARD_LABEL[c.yard] || c.yard) : "") + '</div></div><span class="late-lv lv' + c.lv + '">' + lv[c.lv][0] + "</span></div>";
    }).join("") + (+PK.late > cars.length ? '<div class="note">Showing the first ' + cars.length + " of " + PK.late + ".</div>" : "");
  }
  function addDaysKey(key, n) { var d = new Date(key + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  // "DROPS 17TH SEPT", the way the Sheet's tabs were named.
  function sheetLabel(s) {
    if (!s.day) return s.kind.toUpperCase();
    var d = new Date(s.day + "T12:00:00Z"), n = d.getUTCDate();
    var th = n >= 11 && n <= 13 ? "TH" : ({ 1: "ST", 2: "ND", 3: "RD" }[n % 10] || "TH");
    return s.kind.toUpperCase() + " " + n + th + " " + fmt("mon", { month: "short", timeZone: "UTC" }).format(d).toUpperCase().replace(/\.$/, "");
  }
  function show(id, on) { $(id).classList.toggle("hidden", !on); }
  function only(id) { ["boot", "noLink", "pinGate", "setupGate", "app"].forEach(function (x) { show(x, x === id); }); }

  // Requests give up after 20 seconds, so a dead signal ends in a clear state.
  function timedFetch(input, init) {
    var ctrl = new AbortController(), outer = init && init.signal;
    if (outer) { if (outer.aborted) ctrl.abort(); else outer.addEventListener("abort", function () { ctrl.abort(); }); }
    var timer = setTimeout(function () { ctrl.abort(); }, 20000);
    return fetch(input, Object.assign({}, init, { signal: ctrl.signal })).finally(function () { clearTimeout(timer); });
  }
  function isNetwork(err) { return !navigator.onLine || /Failed to fetch|NetworkError|Load failed|AbortError|aborted|network/i.test(String((err && (err.message || err.name)) || err)); }
  // The server itself in trouble (outage, overload, timeout), as opposed to a
  // real "no": worth waiting and trying again, never a reason to drop a tap
  // or sign anyone out.
  function isDown(res) {
    var err = res && res.error !== undefined ? res.error : res, st = res && res.status !== undefined ? +res.status : 0;
    if (!err) return false;
    if (isNetwork(err)) return true;
    st = st || +err.status || +err.statusCode || 0;
    return st >= 500 || st === 429 || st === 408 || /upstream|timed? ?out|unavailable|bad gateway|gateway|temporarily|overloaded|too many|ECONN|fetch failed/i.test(String(err.message || err.hint || ""));
  }
  function isAuth(err) { return !!err && (err.status === 401 || err.code === "PGRST301" || /JWT expired|invalid jwt|refresh token|Auth session missing/i.test(String(err.message || ""))); }

  // The app can't do anything without its database library: say so and offer
  // a reload rather than a blank page.
  if (!window.supabase) {
    only("boot");
    $("boot").innerHTML = "The app didn't load properly. Check your signal.<br><br>";
    var reload0 = document.createElement("button"); reload0.className = "btn"; reload0.textContent = "Try again";
    reload0.onclick = function () { location.reload(); }; $("boot").appendChild(reload0);
    return;
  }
  var sb = window.supabase.createClient(CFG.url, CFG.key, { global: { fetch: timedFetch }, auth: { autoRefreshToken: !window.TakeOffPhone } });
  // Native relay refreshes the phone session while the screen is off. Adopt its
  // latest token on startup/resume instead of overwriting it with an old WebView token.
  var restoringPhoneSession = false;
  async function restorePhoneSession() {
    if (!window.TakeOffPhone || !window.TakeOffPhone.latestSession || restoringPhoneSession) return;
    restoringPhoneSession = true;
    try {
      var nativeSession = JSON.parse(window.TakeOffPhone.latestSession());
      if (nativeSession.access_token && nativeSession.refresh_token) await sb.auth.setSession(nativeSession);
      else {
        // The phone holds no sign-in yet (first run, or an update): give it the one this page already has.
        var cur = (await sb.auth.getSession()).data.session;
        if (cur && cur.access_token && cur.refresh_token) window.TakeOffPhone.setSession(cur.access_token, cur.refresh_token);
      }
    } catch (e) {} finally { restoringPhoneSession = false; }
  }
  window.addEventListener("takeoff:phone-session", restorePhoneSession);
  try { sb.auth.onAuthStateChange(function (event, session) {
    if (!window.TakeOffPhone) return;
    if (event === "INITIAL_SESSION") { setTimeout(restorePhoneSession, 0); return; }
    if (session && session.access_token && session.refresh_token) window.TakeOffPhone.setSession(session.access_token, session.refresh_token);
    else if (event === "SIGNED_OUT" && window.TakeOffPhone.clearSession) window.TakeOffPhone.clearSession();
  }); } catch (e) {}

  async function callFunction(name, body, withSession) {
    var headers = { "Content-Type": "application/json", apikey: CFG.key, Authorization: "Bearer " + CFG.key };
    if (withSession) {
      var s = (await sb.auth.getSession()).data.session;
      if (!s) throw new Error("Sign in again.");
      headers.Authorization = "Bearer " + s.access_token;
    }
    var res;
    try { res = await timedFetch(CFG.url + "/functions/v1/" + name, { method: "POST", headers: headers, body: JSON.stringify(body) }); }
    catch (e) { throw new Error("Can't reach the server. Check your signal and try again."); }
    var data = {}; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.error || data.message || ("Error " + res.status));
    return data;
  }

  // The booking import reads the booking site page by page, so its answer can take minutes and may only reach the
  // phone at the end: no 20-second limit here, only a 5-minute one, and every failure ends as { error }.
  async function callBookings(body) {
    var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, 300000);
    try {
      var s = (await sb.auth.getSession()).data.session;
      if (!s) return { error: new Error("Sign in again.") };
      var res = await fetch(CFG.url + "/functions/v1/takeoff-bookings", { method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.key, Authorization: "Bearer " + s.access_token }, body: JSON.stringify(body), signal: ctrl.signal });
      var text = await res.text(), data = null;
      try { data = JSON.parse(text); } catch (e) {}
      return data ? { data: data } : { error: new Error("Error " + res.status) };
    } catch (e) { return { error: e }; } finally { clearTimeout(timer); }
  }

  // ── state ─────────────────────────────────
  var S = {
    me: null, perms: {}, company: null, staff: {}, sheets: [], sheetId: null, rows: [],
    view: "board", filter: "todo", q: "", yardFilter: "", catFilter: "", runs: null, pending: {}, queue: [], flushing: false, live: false,
    imp: null, issued: null, activity: null
  };
  function can(a) { return !!S.perms[a]; }
  function sheet() { if (S.switching && S.switching.sheet && !S.switching.o.stay) return S.switching.sheet; return S.sheets.concat(S.archiveSheet ? [S.archiveSheet] : []).filter(function (s) { return s.id === S.sheetId; })[0] || null; }
  function staffName(id) { return id && S.staff[id] ? S.staff[id].name : ""; }
  // Who pressed it: the name picked on a shared login (database part 98) or the login's own name.
  function byName(r, col) { return (r && r.by_name && r.by_name[col]) || staffName(r && r[col]); }
  function markBy(x, col) { var n = Object.assign({}, x.by_name || {}); if (x[col] && S.me && S.me.acting) n[col] = S.me.acting; else delete n[col]; x.by_name = n; }

