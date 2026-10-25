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

  // ── sign-in ───────────────────────────────
  var linkFromHash = (location.hash.match(/^#t=([A-Za-z0-9_-]{32,64})$/) || [])[1];
  if (linkFromHash) {
    try { localStorage.setItem(LINK_KEY, linkFromHash); } catch (e) {}
    history.replaceState(null, "", location.pathname);
  }

  async function start() {
    brandFromServer(location.hostname);
    var setupHash = location.hash.match(/^#setup(?:=([a-z0-9-]{1,60}))?$/);
    if (setupHash) {
      S.setupCompany = setupHash[1] || "";
      brandFromServer(S.setupCompany || location.hostname);
      only("setupGate"); $("setupName").focus(); return;
    }
    var session = (await sb.auth.getSession()).data.session;
    // A new personal link on a phone signed in as someone else: that person signs out.
    if (session && linkFromHash) { await sb.auth.signOut(); session = null; }
    if (session) return loadApp();
    showSignIn();
  }
  function storedLink() { try { return localStorage.getItem(LINK_KEY) || ""; } catch (e) { return ""; } }
  function showSignIn(message) {
    if (storedLink()) { only("pinGate"); $("pinErr").textContent = message || ""; $("pin").value = ""; $("pin").focus(); }
    else only("noLink");
  }

  $("pinForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var pin = $("pin").value.trim();
    if (!/^\d{4}$/.test(pin)) { $("pinErr").textContent = "Enter your 4-digit PIN."; return; }
    $("pinGo").disabled = true; $("pinErr").textContent = "";
    try {
      var r = await callFunction("staff-login", { token: storedLink(), pin: pin }, false);
      var v = await sb.auth.verifyOtp({ type: "magiclink", token_hash: r.token_hash });
      if (v.error) throw v.error;
      await loadApp();
    } catch (err) { $("pinErr").textContent = err.message || String(err); $("pin").value = ""; }
    finally { $("pinGo").disabled = false; }
  });
  document.addEventListener("input", function (e) { if (e.target && e.target.id === "handoverText") S.handoverDraft = e.target.value; });
  $("pin").addEventListener("input", function () { if (/^\d{4}$/.test(this.value)) $("pinForm").requestSubmit(); });
  // The Home Screen app on an iPhone keeps its own storage, so a link opened in
  // Safari never reaches it. Accepts the whole link, a message containing it, or
  // just the code after "#t=".
  function linkFromPaste(text) {
    var s = String(text || "").trim();
    var m = s.match(/[#&?]t=([A-Za-z0-9_-]{32,64})/) || s.match(/^([A-Za-z0-9_-]{32,64})$/);
    return m ? m[1] : "";
  }
  $("linkForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var token = linkFromPaste($("linkPaste").value);
    if (!token) { $("linkErr").textContent = "That isn't a " + brandName() + " link. Copy the whole link the office sent you."; return; }
    try { localStorage.setItem(LINK_KEY, token); } catch (err) { $("linkErr").textContent = "This phone won't let " + brandName() + " save your link. Turn off private browsing and try again."; return; }
    $("linkErr").textContent = ""; $("linkPaste").value = "";
    showSignIn();
  });
  $("forget").addEventListener("click", function () {
    if (!confirm("Remove your " + brandName() + " link from this phone? You'll need the office to send it again.")) return;
    try { localStorage.removeItem(LINK_KEY); localStorage.removeItem(BRAND_KEY); } catch (e) {}
    only("noLink");
  });

  $("setupForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var name = $("setupName").value.trim(), code = $("setupCode").value;
    if (!name || !code) { $("setupErr").textContent = "Enter your name and the setup code."; return; }
    $("setupGo").disabled = true; $("setupErr").textContent = "";
    try {
      // "#setup" sets up the default company; "#setup=<slug>" sets up that
      // company. One app, so the first owner of each has to say which.
      var slug = (S.setupCompany || "").trim();
      var r = await callFunction("manage-staff", { action: "setup", code: code, name: name,
        company: slug || "takeoff", app_url: location.origin + "/" }, false);
      $("setupDone").innerHTML = issuedHtml(r) + '<a class="btn brand" href="' + esc(r.link) + '">Sign in on this device</a>';
      show("setupDone", true); $("setupGo").classList.add("hidden");
    } catch (err) { $("setupErr").textContent = err.message; }
    finally { $("setupGo").disabled = false; }
  });

  sb.auth.onAuthStateChange(function (event) {
    if (event === "SIGNED_OUT" && S.me) { S.me = null; teardown(); showSignIn("You've been signed out. Enter your PIN to sign in again."); }
  });

  // ── loading ───────────────────────────────
  var channel = null;
  async function loadApp() {
    try { await loadAppInner(); } catch (err) { oopsLog(err); bootTrouble(); }
  }
  // Loading went wrong somewhere: never a blank page, always a way back in.
  function bootTrouble() {
    if (S.me && !$("app").classList.contains("hidden")) return;
    only("boot");
    $("boot").innerHTML = "Something went wrong while loading. Check your signal and try again.<br><br>";
    var again = document.createElement("button"); again.className = "btn"; again.textContent = "Try again";
    again.onclick = function () { location.reload(); }; $("boot").appendChild(again);
  }
  async function loadAppInner(quiet) {
    if (!quiet) { only("boot"); $("boot").textContent = "Loading…"; }
    var me = await sb.rpc("me");
    if (me.error) {
      // Only a real sign-in problem signs out. Anything else (no signal, the
      // server down) opens the last board this phone had, if there is one.
      if (isAuth(me.error)) { toast(me.error.message, true); await sb.auth.signOut(); return showSignIn(); }
      if (openFromSnap()) return;
      $("boot").innerHTML = (isDown(me) ? "Can't reach the server just now. Check your signal, or it may be down for a few minutes." : "Couldn't load: " + esc(me.error.message)) + "<br><br>";
      var again = document.createElement("button"); again.className = "btn"; again.textContent = "Try again"; again.onclick = loadApp; $("boot").appendChild(again);
      // And by itself: when the phone says it's back online, or every 15 s (saved taps then go through).
      S.bootFailed = true; clearTimeout(S.bootRetry); S.bootRetry = setTimeout(function () { if (S.bootFailed && !S.me) loadApp(); }, 15000);
      return;
    }
    S.bootFailed = false; clearTimeout(S.bootRetry);
    if (!me.data || !me.data.id) { await sb.auth.signOut(); return showSignIn("Your access is switched off. Speak to the office."); }
    S.me = me.data;
    sb.rpc("i_am_here").then(function () {}, function () {});
    var res = await Promise.all([
      sb.rpc("my_permissions"),
      sb.from("companies").select("*").eq("id", S.me.company_id).single(),
      sb.from("staff").select("*").order("name"),
      loadSheets()
    ]);
    if (!res[1].data || res.some(function (x) { return x && x.error && isDown(x); })) { if (openFromSnap()) return; throw new Error("Couldn't load the company"); }
    S.offline = false;
    S.perms = res[0].data || {};
    S.company = res[1].data;
    applyBrand(S.company);
    S.staff = {}; (res[2].data || []).forEach(function (p) { S.staff[p.id] = p; });
    // The product owner's own login: no board, just the Clients page.
    S.platform = !!(S.company && S.company.slug === "platform");
    if (S.platform) { try { localStorage.removeItem(HOME_KEY); } catch (e) {} S.view = "clients"; only("app"); render(); return; }
    loadQueue();
    pickDefaultSheet();
    await loadRows();
    subscribe();
    only("app");
    render();
    flush();
    ptResume();
    loadLastDownload();
  }
  var PICKER_DAYS = 90;
  async function loadSheets() {
    // The picker holds 90 days back and anything imported ahead. Older days
    // are on the Archive screen and are never deleted.
    var r = await sb.from("sheets").select("*").gte("day", addDaysKey(londonParts(new Date()).key, -PICKER_DAYS))
      .order("day", { ascending: false }).order("kind").limit(400);
    if (!r.error) {
      S.sheets = (r.data || []).filter(function (x) { return !x.archived_at; });
      S.handArchived = (r.data || []).filter(function (x) { return x.archived_at; });
    }
    return r;
  }
  // The DROPS sheet for the shift running now (it runs to 06:00 next morning).
  function currentShiftKey() {
    var now = londonParts(new Date()), end = (S.company && S.company.drops_day_end || "06:00:00").slice(0, 5);
    return now.time <= end ? addDaysKey(now.key, -1) : now.key;
  }
  // A refresh keeps the sheet that was open; a fresh start of the app opens
  // the current DROPS again.
  function openSheetKey() { return "open_sheet_" + (S.company ? S.company.id : ""); }
  function pickDefaultSheet() {
    if (S.sheetId && sheet()) return;
    var kept = null; try { kept = sessionStorage.getItem(openSheetKey()); } catch (e) {}
    if (kept && S.sheets.some(function (s) { return s.id === kept; })) { S.sheetId = kept; return; }
    var key = currentShiftKey();
    var hit = S.sheets.filter(function (s) { return s.kind === "drops" && s.day === key; })[0] ||
              S.sheets.filter(function (s) { return s.kind === "drops" && s.day <= key; })[0] || S.sheets[0];
    S.sheetId = hit ? hit.id : null;
  }
  // Loads can overlap (waking, signal back, refresh, live updates, a sheet
  // switch). Only the newest one for the sheet on screen may fill the board,
  // so a late answer can never put one sheet's cars under another's name.
  var loadSeq = 0;
  function rowsOrder(sh) { return sh && sh.kind === "picks" ? "drop_at" : "return_at"; }
  function fetchSheetRows(id, sh) {
    return sb.from("bookings").select("*").eq("sheet_id", id).order(rowsOrder(sh), { ascending: true, nullsFirst: false });
  }
  function takeRows(want, r, sh) {
    // A different sheet: the filters picked on the last one don't apply here.
    if (S.rowsSheet !== want) { S.catFilter = ""; S.yardFilter = ""; }
    S.rowsSheet = want;
    S.rows = (r.data || []).filter(function (x) { return !x.removed_at; });
    S.removed = (r.data || []).filter(function (x) { return x.removed_at; });
    loadKeys(want);
    if (sh && sh.kind === "picks") loadPtUnsaved(want);
  }
  async function loadRows() {
    if (!S.sheetId) { S.rows = []; return; }
    var sh = sheet(), want = S.sheetId, seq = ++loadSeq;
    try { if (sh && !sh.archived_at) sessionStorage.setItem(openSheetKey(), want); } catch (e) {}
    var r = await fetchSheetRows(want, sh);
    if (seq !== loadSeq || want !== S.sheetId) return;
    if (r.error) {
      // Keep showing the sheet that's loaded, not another sheet's name over it.
      if (S.rowsSheet && S.rowsSheet !== S.sheetId) S.sheetId = S.rowsSheet;
      toast(isDown(r) ? "The server isn't answering. Still showing what was loaded." : r.error.message, true); return;
    }
    takeRows(want, r, sh);
  }
  // Switching sheets (day picker, Drops | Picks, Choose shift, Archive). The
  // sheet on screen stays untouched until the new one's cars have arrived: in
  // between the board shows only "Loading ...", with no old car to tap. Only
  // the newest request may land; a failure puts the old sheet back.
  // o: { view, stay, q, filter, archive } (what the old entry points set).
  var switchSeq = 0;
  function sheetByIdAny(id, extra) {
    return S.sheets.concat(S.handArchived || [], S.archiveSheet ? [S.archiveSheet] : [], extra ? [extra] : []).filter(function (x) { return x.id === id; })[0] || null;
  }
  function loadingHtml(sw) {
    var sh = sw.sheet;
    return '<div class="msg sheetload" role="status" aria-live="polite" data-loading="' + esc(sw.id) + '">' +
      (sw.failed ? '<b>Couldn\'t load ' + esc(sh ? sheetLabel(sh) : "that sheet") + '.</b><br>' + esc(sw.failed) + '<br><br><button type="button" class="btn brand" data-sheetretry>Try again</button> <button type="button" class="btn ghost" data-sheetback>Back to ' + esc(sw.prevLabel || "the last sheet") + '</button>'
        : 'Loading ' + esc(sh ? sheetLabel(sh) : "the sheet") + "…") + "</div>";
  }
  async function switchSheet(id, o) {
    o = o || {};
    if (!id) return;
    var sh = sheetByIdAny(id, o.archive);
    if (!S.switching && id === S.sheetId && !o.force) return;
    var prev = S.switching ? S.switching.prev : { sheetId: S.sheetId, label: sheet() ? sheetLabel(sheet()) : "" };
    var seq = ++switchSeq;
    // A car open from the old sheet must not stay up under the new one.
    panelRow = null; if ($("panel").open) $("panel").close();
    if ($("shiftPick").open) $("shiftPick").close();
    S.switching = { id: id, sheet: sh, seq: seq, o: o, prev: prev, prevLabel: prev.label, failed: "" };
    render();
    var r;
    try { r = await fetchSheetRows(id, sh); } catch (e) { r = { error: e }; }
    if (seq !== switchSeq || !S.switching) return;          // a newer choice owns the screen
    if (r.error) {
      S.switching.failed = isDown(r) ? "The server isn't answering." : (r.error.message || "Try again.");
      render(); return;
    }
    var stay = !!o.stay;
    if (o.archive) S.archiveSheet = o.archive;
    else if (S.archiveSheet && S.archiveSheet.id !== id) S.archiveSheet = null;   // leaving an archived sheet
    S.switching = null; loadSeq++;
    S.sheetId = id; S.q = o.q || ""; S.boardQueue = o.queue || ""; S.other = null; S.yardFilter = ""; S.catFilter = ""; S.runs = null; S.flTile = "";
    if (o.filter) S.filter = o.filter;
    S.view = stay ? S.view : "board"; if (stay) S.activity = null;
    S.rowsSheet = null;                                      // fresh sheet: filters reset in takeRows
    takeRows(id, r, sh);
    if (sh && !sh.archived_at) { try { sessionStorage.setItem(openSheetKey(), id); } catch (e) {} }
    render(); window.scrollTo(0, 0);
  }
  function sheetRetry() { var w = S.switching; if (w) switchSheet(w.id, Object.assign({}, w.o, { force: true })); }
  function sheetBack() {
    var w = S.switching; if (!w) return;
    switchSeq++; S.switching = null;                         // the old sheet was never touched
    render();
  }
  // PICKS cars whose PT was ticked over 2 hours ago but whose photos aren't
  // saved in the app (database part 51): shown to the office on the row.
  S.ptUnsaved = {};
  async function loadPtUnsaved(sheetId) {
    if (!can("import")) return;
    var u = await sb.rpc("pt_unsaved", { p_sheet: sheetId });
    if (u.error || sheetId !== S.sheetId) return;
    var m = {}; (u.data || []).forEach(function (id) { m[id] = 1; });
    var changed = Object.keys(m).join() !== Object.keys(S.ptUnsaved).join();
    S.ptUnsaved = m;
    if (changed && !$("panel").open) render();
  }
  setInterval(function () { var sh = sheet(); if (S.me && sh && sh.kind === "picks" && document.visibilityState === "visible") loadPtUnsaved(sh.id); }, 10 * 60000);
  function dropRemoved(id) { S.removed = (S.removed || []).filter(function (x) { return x.id !== id; }); }
  // A yard picker open on a row must not be redrawn out from under the finger.
  function yardOpen() { var a = document.activeElement; return !!(a && a.dataset && a.dataset.yard !== undefined); }

  function subscribe() {
    if (channel) sb.removeChannel(channel);
    var ch = channel = sb.channel("bookings-" + S.company.id);
    ch.on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: "company_id=eq." + S.company.id }, onChange)
      // A new import on any phone shows up in everyone's sheet list.
      .on("postgres_changes", { event: "*", schema: "public", table: "sheets", filter: "company_id=eq." + S.company.id }, function () {
        loadSheets().then(function () { var had = S.sheetId; pickDefaultSheet(); return had === S.sheetId ? null : loadRows(); }).then(function () { if (!$("panel").open && !yardOpen()) render(); });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "parking_lanes", filter: "company_id=eq." + S.company.id }, laneChanged)
      .on("postgres_changes", { event: "*", schema: "public", table: "parking_positions", filter: "company_id=eq." + S.company.id }, laneChanged)
      .on("postgres_changes", { event: "*", schema: "public", table: "key_check_sessions", filter: "company_id=eq." + S.company.id }, keyChanged)
      .on("postgres_changes", { event: "*", schema: "public", table: "key_check_entries", filter: "company_id=eq." + S.company.id }, keyChanged);
    // A customer calling (part 117): every office phone pops it up. Only with the add-on, so the table is there.
    if (callsAddon()) ch.on("postgres_changes", { event: "*", schema: "public", table: "customer_calls", filter: "company_id=eq." + S.company.id }, function (p) { window.dispatchEvent(new CustomEvent("takeoff:call", { detail: p.new })); });
    if (textsAddon()) ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "customer_sms", filter: "company_id=eq." + S.company.id }, function (p) { if (panelRow && p.new && p.new.booking_id === panelRow.id) carTexts(panelRow); });
    ch.subscribe(function (status) {
        if (ch !== channel) return;   // an old link closing late (after sign-out and back in)
        var was = S.live; S.live = status === "SUBSCRIBED"; renderSync();
        // Back after the live link dropped: changes made meanwhile were missed.
        // A short drop (weak signal) fetches just those; a long one, the sheet.
        if (S.live && liveLost) {
          if (keyAllowed()) loadKeys(S.sheetId);
          var gone = liveLostAt; liveLost = false;
          (Date.now() - gone < QUICK_BACK ? catchUp(gone - 10000) : loadRows()).then(function () { if (!$("panel").open && !yardOpen()) render(); });
        }
        if (was && !S.live) { liveLost = true; liveLostAt = Date.now(); }
      });
  }
  var liveLost = false, liveLostAt = 0;
  function teardown() { resetLanes(); if (channel) sb.removeChannel(channel); channel = null; liveLost = false; S.rows = []; S.keys = null; keyLoadSeq++; clearTimeout(keyLiveTimer); snapForget(); }

  // ── the last board, kept on the phone ──
  // If the server can't be reached when the app opens, the team still sees the
  // last board this phone loaded and can keep tapping: the taps are saved on
  // the phone and go through when the server answers again. Cleared on sign-out.
  var SNAP_KEY = "takeoff_snap", snapTimer = null;
  function snapSave() {
    if (!S.me || !S.company || S.platform) return;
    clearTimeout(snapTimer);
    snapTimer = setTimeout(function () {
      try {
        localStorage.setItem(SNAP_KEY, JSON.stringify({ v: 1, at: S.offline ? S.offlineAt : new Date().toISOString(), me: S.me, perms: S.perms, company: S.company,
          staff: S.staff, sheets: S.sheets, handArchived: S.handArchived, sheetId: S.rowsSheet || S.sheetId, rows: S.rows, removed: S.removed }));
      } catch (e) {}
    }, 2000);
  }
  function snapForget() { clearTimeout(snapTimer); try { localStorage.removeItem(SNAP_KEY); } catch (e) {} }
  function openFromSnap() {
    var x = null; try { x = JSON.parse(localStorage.getItem(SNAP_KEY) || "null"); } catch (e) {}
    if (!x || !x.me || !x.company || !x.rows) return false;
    S.me = x.me; S.perms = x.perms || {}; S.company = x.company; S.staff = x.staff || {};
    S.sheets = x.sheets || []; S.handArchived = x.handArchived || []; S.sheetId = x.sheetId; S.rowsSheet = x.sheetId;
    S.rows = x.rows; S.removed = x.removed || [];
    S.offline = true; S.offlineAt = x.at; S.live = false;
    try { applyBrand(S.company); } catch (e) {}
    loadQueue(); only("app"); render();
    toast("The server can't be reached. Showing the board from " + hhmm(x.at) + "; taps are saved and go through when it's back.", true);
    clearTimeout(S.reconnect); S.reconnect = setTimeout(reconnect, 15000);
    return true;
  }
  // Offline: try the server every 15 s (then less often); when it answers,
  // load everything fresh and send the saved taps.
  async function reconnect() {
    if (!S.offline) return;
    var me; try { me = await sb.rpc("me"); } catch (e) { me = { error: e }; }
    if (me && !me.error && me.data && me.data.id) {
      try { await loadAppInner(true); if (!S.offline) toast("Back online. Board up to date."); }
      catch (e) { oopsLog(e); if (S.me) { S.offline = true; renderSync(); clearTimeout(S.reconnect); S.reconnect = setTimeout(reconnect, 20000); } }
      return;
    }
    if (me && me.error && isAuth(me.error)) { S.offline = false; S.me = null; teardown(); await sb.auth.signOut(); return showSignIn(); }
    S.reconnectWait = Math.min(120000, (S.reconnectWait || 10000) * 1.5);
    S.reconnect = setTimeout(reconnect, S.reconnectWait);
  }

  var redraw = null;
  function onChange(p) {
    var n = p.new || {}, o = p.old || {}, id = n.id || o.id;
    var idx = S.rows.findIndex(function (r) { return r.id === id; });
    if (p.eventType === "DELETE") { if (idx >= 0) S.rows.splice(idx, 1); dropRemoved(id); }
    else if (n.sheet_id === S.sheetId && n.removed_at) { if (idx >= 0) S.rows.splice(idx, 1); dropRemoved(id); S.removed.push(n); }
    else if (n.sheet_id === S.sheetId) {
      dropRemoved(id);
      if (S.pending[id]) return;                   // our own tap is still saving; its answer wins
      var before = idx >= 0 ? S.rows[idx] : null;
      if (idx >= 0) S.rows[idx] = n; else S.rows.push(n);
      // Flash a row someone else tapped, not every flight-time refresh.
      if (!before || TAP_FIELDS.some(function (k) { return before[k] !== n[k]; })) flashId = id;
    } else if (idx >= 0) S.rows.splice(idx, 1);
    clearTimeout(redraw); redraw = setTimeout(function () { if ((S.view === "board" || S.view === "flights") && !$("panel").open && !yardOpen()) render(); }, 150);
  }
  var flashId = null;
  var TAP_FIELDS = ["yard", "sent_at", "called_at", "called_word", "cleared_at", "clear_word", "intake", "pt_at", "pick_called", "note", "charge_method", "exit_method"];

  // ── saving: optimistic, queued, retried ───
  function queueKey() { return "takeoff_queue_" + (S.me ? S.me.id : ""); }
  function loadQueue() { try { S.queue = JSON.parse(localStorage.getItem(queueKey()) || "[]"); } catch (e) { S.queue = []; } S.pending = {}; S.queue.forEach(function (op) { S.pending[op.rowId] = (S.pending[op.rowId] || 0) + 1; }); }
  function saveQueue() { try { localStorage.setItem(queueKey(), JSON.stringify(S.queue)); } catch (e) {} }

  function run(fn, args, row, mutate) {
    // A car from another sheet (an old dialog, a late tap) never acts under this one.
    if (S.switching || (row && row.sheet_id && S.sheetId && row.sheet_id !== S.sheetId)) { toast("Loading another sheet. Try again in a moment.", true); return; }
    if (row && mutate) mutate(row);
    S.queue.push({ fn: fn, args: args, rowId: row ? row.id : null });
    if (row) S.pending[row.id] = (S.pending[row.id] || 0) + 1;
    saveQueue(); render(); flush();
  }
  var retryTimer = null;
  async function flush() {
    if (S.flushing || !S.queue.length || !S.me) { renderSync(); return; }
    S.flushing = true; renderSync();
    var op = S.queue[0];
    var r = await sb.rpc(op.fn, op.args);
    S.flushing = false;
    if (r.error && isDown(r)) {
      // Kept and tried again: every 5 s, slowing to once a minute in a long outage.
      S.retryWait = Math.min(60000, (S.retryWait || 2500) * 2);
      renderSync(); clearTimeout(retryTimer); retryTimer = setTimeout(flush, S.retryWait); return;
    }
    S.retryWait = 0;
    // Sign-in expired: renew it and try again. If it can't be renewed the app
    // is signed out and asks for the PIN, and the saved taps go after that.
    if (r.error && isAuth(r.error)) {
      renderSync();
      try { var ref = await sb.auth.refreshSession(); if (!ref.error) { clearTimeout(retryTimer); retryTimer = setTimeout(flush, 1000); } } catch (e) {}
      return;
    }
    S.queue.shift(); saveQueue();
    if (op.rowId) { S.pending[op.rowId] = Math.max(0, (S.pending[op.rowId] || 1) - 1); if (!S.pending[op.rowId]) delete S.pending[op.rowId]; }
    if (r.error) {
      toast(r.error.message, true);
      if (op.rowId) await refreshRow(op.rowId);     // put back what the database really holds
    } else if (r.data && r.data.id && !S.pending[r.data.id]) {
      var idx = S.rows.findIndex(function (x) { return x.id === r.data.id; });
      // Moved to another day's sheet (return date changed): it leaves this board.
      if (idx >= 0 && r.data.sheet_id && r.data.sheet_id !== S.sheetId) {
        S.rows.splice(idx, 1);
        var to = (S.sheets || []).filter(function (x) { return x.id === r.data.sheet_id; })[0];
        toast((r.data.reg || "Car") + " moved to " + (to ? sheetLabel(to) : "another day") + ".");
        if ($("panel").open && panelRow && panelRow.id === r.data.id) $("panel").close();
      } else if (idx >= 0) S.rows[idx] = r.data;
    }
    if (!$("panel").open && !yardOpen()) render();
    flush();
  }
  async function refreshRow(id) {
    var r = await sb.from("bookings").select("*").eq("id", id).maybeSingle();
    var idx = S.rows.findIndex(function (x) { return x.id === id; });
    if (r.data && idx >= 0) S.rows[idx] = r.data;
  }
  // Signal back: the cars changed meanwhile (a short gap), or the sheet (a long one).
  var offlineAt = 0;
  window.addEventListener("offline", function () { offlineAt = Date.now(); if (S.me && keyOn()) render(); });
  window.addEventListener("online", function () {
    // Opened from the saved copy (no server at the time): reconnect now, not at the next 15 s retry.
    if (S.offline && S.me) { clearTimeout(S.reconnect); reconnect(); return; }
    if (!S.me && S.bootFailed) { S.bootFailed = false; clearTimeout(S.bootRetry); loadApp(); return; }
    flush(); if (!S.me) return;
    if (keyAllowed()) loadKeys(S.sheetId);
    // A board from the phone's saved copy (S.offline) is reloaded whole.
    (offlineAt && !S.offline && Date.now() - offlineAt < QUICK_BACK ? catchUp(offlineAt - 10000) : loadRows()).then(render);
    offlineAt = 0;
  });
  // Coming back to the app: up to 30 minutes away (WhatsApp for PT, a call)
  // with the live link still up fetches only the cars changed meanwhile. A
  // longer time away, or a dropped link, reloads the sheet. (Reloading after
  // 90 s was ~60 full-sheet downloads an hour: most of the free plan's
  // download allowance.)
  var hiddenAt = 0, QUICK_BACK = 30 * 60000;
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    if (!S.me) return;
    if (keyAllowed()) loadKeys(S.sheetId);
    flush(); companyFresh();
    if (S.live && hiddenAt && Date.now() - hiddenAt < QUICK_BACK) {
      // Belt and braces: just the cars changed while away (usually none), in
      // case a live update went astray while the phone was asleep.
      if (Date.now() - hiddenAt > 15000) catchUp(hiddenAt - 10000);
      else redrawOnReturn();
      return;
    }
    loadSheets().then(loadRows).then(redrawOnReturn);
  });
  // Only the board and Flights are redrawn on coming back. Choosing a file
  // (import, settings) sends a phone's app to the background; redrawing that
  // screen on return replaced the file button before the chosen file reached
  // it, so the import never got the file.
  function redrawOnReturn() { if ((S.view === "board" || S.view === "flights") && !$("panel").open) render(); }

  // Settings that can change mid-shift (where PT copies go, the PT way) are
  // read again when the app comes back (at most every 5 minutes) and when PT
  // starts (at most every minute, since the PT way matters then): a few bytes. Switching the copies back to Supabase then reaches
  // phones that are already open, not only ones that reload.
  var companyAt = Date.now();
  function companyFresh(soon) {
    if (!S.company || Date.now() - companyAt < (soon ? 60000 : 5 * 60000)) return;
    companyAt = Date.now();
    sb.from("companies").select("pt_copy_store, pt_method, pt_method_ios").eq("id", S.company.id).single()
      .then(function (r) { if (r.data && S.company) Object.assign(S.company, r.data); }, function () {});
  }
  // The cars changed since a time: this sheet's in full, and just the ids of
  // cars that moved to another sheet meanwhile (carried over, early return),
  // so they leave this one. A few rows instead of the whole sheet.
  async function catchUp(sinceMs) {
    var want = S.sheetId; if (!want) return;
    var since = new Date(sinceMs).toISOString();
    var both = await Promise.all([
      sb.from("bookings").select("*").eq("sheet_id", want).gte("updated_at", since),
      sb.from("bookings").select("id, sheet_id").neq("sheet_id", want).gte("updated_at", since).limit(1000)]);
    var r = both[0], away = both[1];
    if (r.error || want !== S.sheetId) { if (r.error && isDown(r)) return; return loadRows(); }
    var gone = {}; (away.data || []).forEach(function (x) { gone[x.id] = 1; });
    var n0 = S.rows.length; S.rows = S.rows.filter(function (x) { return !gone[x.id]; });
    (r.data || []).forEach(function (n) { onChange({ eventType: "UPDATE", new: n, old: {} }); });
    if (!(r.data || []).length && S.rows.length === n0) redrawOnReturn(); else if (!$("panel").open && !yardOpen()) render();
  }
  function renderSync() {
    var el = $("sync"); if (!el) return;
    // Parking Ops has no board, so no live link to wait for.
    if (S.platform) { el.className = "pend"; el.textContent = ""; return; }
    var waiting = S.queue.length;
    // Silent while all is well, like the Sheet app: it only speaks up when a
    // tap is waiting or live updates have dropped.
    var down = S.offline || !!S.retryWait;
    el.className = "pend" + (waiting || !S.live || down ? " on" : "") + (!navigator.onLine || down ? " stuck" : "");
    el.textContent = S.offline ? "OFFLINE · BOARD FROM " + hhmm(S.offlineAt) + (waiting ? " · " + waiting + " TO SEND" : "")
      : waiting ? (!navigator.onLine ? "OFFLINE · " + waiting : S.retryWait ? "SERVER BUSY · " + waiting + " WAITING" : "SAVING " + waiting)
      : (S.live ? "" : navigator.onLine ? "CONNECTING" : "OFFLINE");
  }

  // ── chrome ────────────────────────────────
  // The header is the one the team already knows from the Sheet app: sheet
  // picker, who is signed in, and a row of icon buttons. The yard tally, TO DO /
  // ALL, search and column captions belong to the board only.
  var OPS_TITLE = { calls: "Calls", summary: "Shift summary", stats: "Hourly stats", staff: "Staff & access" }, BN_VIEW = { logBtn: "summary", psBtn: "stats", flBtn: "flights" };
  var VIEW_TITLE = { lanes: "Yard planner", dashboard: "Dashboard", clients: "Clients", flights: "Flights", summary: "Summary and activity", import: "Booking import", staff: "Staff", settings: "Settings", archive: "Archive", me: "Me" };
  var YARD_LABEL = { Y: "NB", S: "S YARD" };
  // The tally reads left to right as the Sheet's did; any yard not listed follows.
  var YARD_ORDER = ["Y", "S", "CP", "NY", "T"];
  function yardOrder() {
    var ys = S.company.yards || [];
    return YARD_ORDER.filter(function (y) { return ys.indexOf(y) !== -1; }).concat(ys.filter(function (y) { return YARD_ORDER.indexOf(y) === -1; }));
  }

  function renderChrome() {
    var sh = sheet(), picks = !!(sh && sh.kind === "picks"), board = S.view === "board";
    document.body.classList.toggle("picks", picks);
    document.body.classList.toggle("on-board", board);
    $("who").textContent = meName().toUpperCase(); $("who").setAttribute("data-role", ROLE_LABEL[S.me.role] || "");
    if (deskNames().length) { $("who").setAttribute("role", "button"); $("who").setAttribute("tabindex", "0"); $("who").classList.add("can-switch"); }
    else { $("who").removeAttribute("role"); $("who").removeAttribute("tabindex"); $("who").classList.remove("can-switch"); }
    show("homeBtn", !S.platform && !!homeSaved());
    $("clock").textContent = londonParts(new Date()).time;
    var shift = currentShiftKey();
    var cardsLook = isCards();
    $("sheetPick").innerHTML = S.sheets.length || S.archiveSheet ? pickerHtml(shift) : "<option>No sheets yet</option>";
    show("sheetPick", !S.platform && !cardsLook);
    // Cards: the navy shift button in the bar. Premium: a title bar (company +
    // who + updated) and, under DROPS/PICKS, a white "which shift" row.
    var premium = isPremium();
    show("shiftBtn", !S.platform && cardsLook && !premium);
    if (cardsLook && !premium) $("shiftBtn").innerHTML = shiftBtnHtml(sh);
    show("cHead", !S.platform && premium);
    if (premium) $("cHead").innerHTML = cHeadHtml();
    show("cShift", premium && board && !!sh);
    if (premium && sh) $("cShift").innerHTML = cShiftHtml(sh);
    show("kindSeg", cardsLook && board && !!sh);
    // Operations: Drops | Picks in the top bar.
    var opsLook = isOps();
    show("kindBar", opsLook && !S.platform && !!sh);
    if (opsLook && sh) Array.prototype.forEach.call($("kindBar").querySelectorAll("[data-kind]"), function (b) { b.setAttribute("aria-pressed", b.dataset.kind === sh.kind); });
    if (cardsLook && sh) {
      $("kindSeg").querySelector('[data-kind="drops"]').setAttribute("aria-pressed", sh.kind === "drops");
      $("kindSeg").querySelector('[data-kind="picks"]').setAttribute("aria-pressed", sh.kind === "picks");
    }
    show("logBtn", !S.platform && (can("summary") || can("log")));
    show("flBtn", !S.platform && can("flights") && !picks);
    show("rtBtn", !S.platform && can("picksinfo") && picks);
    show("psBtn", !S.platform && can("picksinfo"));
    // The bottom bar (card looks, and Standard with features) mirrors the top bar's buttons.
    show("bnav", (isCards() || isStdPlus()) && !S.platform);
    // Operations on a wide screen: the bottom bar becomes the tabs under the top
    // bar, with Office and Settings for those who have them in the menu.
    var desk = opsDesk();
    document.body.classList.toggle("ops-desk", desk);
    placeDeskNav(desk);
    if ($("bnDash")) { show("bnDash", desk && can("settings")); show("bnSet", desk && can("settings")); }
    Array.prototype.forEach.call(document.querySelectorAll("#bnav [data-bn]"), function (b) {
      var src = $(b.dataset.bn); b.classList.toggle("hidden", !!src && src.classList.contains("hidden"));
    });
    $("bnBoard").classList.toggle("on", board);
    show("boardHead", board && !S.switching);
    show("viewHead", !board);
    if (!board) { var vt = (isOps() && OPS_TITLE[S.view]) || VIEW_TITLE[S.view] || ""; $("viewTitle").textContent = vt; $("viewTitle").setAttribute("data-eyebrow", vt.toUpperCase()); }
    // Operations: the open section is marked in the bottom bar too.
    markBnav();
    if (board) renderBoardHead();
    renderSync();
  }

  // Today and anything ahead first, then a group per month, so 90 days of
  // DROPS and PICKS stay quick to scroll on a phone.
  // The Cards look shows the open sheet as a shift, and a "Choose shift" sheet.
  // A DROPS day is the night that ends at drops_day_end (06:00), so it reads as
  // two dates: "Sat 3 Oct → Sun 4 Oct". PICKS is the single day.
  function longDay(key) { return new Date(key + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); }
  function shiftWhen(s) {
    if (!s || !s.day) return "";
    return s.kind === "drops" ? longDay(s.day) + " → " + longDay(addDaysKey(s.day, 1)) : longDay(s.day);
  }
  function shiftTag(s) {
    if (!s || !s.day) return "";
    var now = currentShiftKey();
    if (s.day === now) return s.kind === "drops" ? "CURRENT NIGHT SHIFT" : "TODAY";
    if (s.day === addDaysKey(now, 1)) return "NEXT SHIFT";
    return s.day > now ? "COMING UP" : "PAST SHIFT";
  }
  // Premium look header: the brand mark, the company, who is on and
  // their role, and the live "Updated HH:MM". Same mark/colour as every brand.
  function niceRole(role) {
    return { owner: "Owner", manager: "Manager", office: "Office", driver: "Driver" }[role] || "Team";
  }
  // One login, several people (the office PC, part 97): the names on it, the one working now.
  function deskNames() { return (S.me && S.me.desk_names) || []; }
  function meName() { return (S.me.acting || S.me.name || ""); }
  function whoSub() {
    return '<p class="sub">' + esc(meName()) + " · " + esc(ROLE_LABEL[S.me.role] || S.me.role) + "</p>" +
      (deskNames().length ? '<button type="button" class="btn ghost small switchname" data-switchname>Switch name</button>' : "");
  }
  function openSwitchName() {
    if ($("menu").open) $("menu").close();
    panelRow = null;
    $("panelBody").innerHTML = '<h2 id="panelTitle">Who\'s working? <small>' + esc(S.me.name) + "</small></h2>" +
      '<div class="swname">' + deskNames().map(function (n) {
        var on = n === S.me.acting;
        return '<button type="button" class="btn ghost' + (on ? " on" : "") + '" data-acting="' + esc(n) + '" aria-pressed="' + on + '">' + esc(n) + "</button>";
      }).join("") + "</div>" +
      '<div class="pbtns"><button type="button" data-close>Close</button></div>';
    if (!$("panel").open) $("panel").showModal();
  }
  async function setActing(n, btn) {
    btn.disabled = true;
    var r = await sb.rpc("set_acting", { p_name: n });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    S.me.acting = r.data && r.data.acting !== undefined ? r.data.acting : n;
    $("panel").close(); render();
    toast("Working now: " + meName());
  }
  function cHeadHtml() {
    var short = String((S.company && (S.company.brand || {}).short) || (S.company && S.company.name) || PRODUCT).trim();
    var mark = String((S.company && (S.company.brand || {}).mark) || short.charAt(0) || "P").slice(0, 2);
    return '<span class="ch-mark" aria-hidden="true">' + esc(mark) + '</span>' +
      '<span class="ch-txt"><b>' + esc(short) + '</b>' +
      '<small>' + esc(meName()) + ' · ' + esc(niceRole(S.me.role)) + '</small></span>' +
      '<span class="ch-upd"><i aria-hidden="true"></i>Updated ' + esc(londonParts(new Date()).time) + '</span>';
  }
  function dayShortLabel(key) { return key ? new Date(key + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : ""; }
  function shiftTagShort(s) {
    return { "TODAY": "Today", "CURRENT NIGHT SHIFT": "Tonight", "NEXT SHIFT": "Next", "COMING UP": "Upcoming", "PAST SHIFT": "Earlier" }[shiftTag(s)] || "";
  }
  // The white "which shift" row under the DROPS/PICKS toggle (Premium look).
  function cShiftHtml(sh) {
    if (!sh || !sh.day) return '<span class="cs-l">No sheets yet</span><span class="cs-r">change sheet</span>';
    var kindWord = sh.kind === "picks" ? "Picks" : "Drops";
    return '<span class="cs-l">' + esc(kindWord + " · " + dayShortLabel(sh.day)) + '</span>' +
      '<span class="cs-r">' + esc(shiftTagShort(sh)) + ' · change sheet</span>';
  }
  function shiftBtnHtml(sh) {
    if (!sh) return '<span class="st-tag">No sheets yet</span>';
    var end = (S.company && S.company.drops_day_end || "06:00:00").slice(0, 5);
    var sub = sh.kind === "drops" ? "Ends at " + end + " · London" : "Pick-ups · London";
    return '<span class="st-tag">' + esc(sh.kind.toUpperCase() + " · " + shiftTag(sh)) + "</span>" +
      '<span class="st-when">' + esc(shiftWhen(sh)) + '</span><span class="st-sub">' + esc(sub) + "</span>";
  }
  function openShiftPick() {
    var shift = currentShiftKey();
    var order = S.sheets.slice().sort(function (a, b) { return a.day > b.day ? -1 : a.day < b.day ? 1 : a.kind < b.kind ? -1 : 1; });
    var ahead = order.filter(function (s) { return s.day >= shift; }).reverse();
    var past = order.filter(function (s) { return s.day < shift; });
    var item = function (s) {
      return '<button type="button" class="shiftrow' + (s.id === (S.switching ? S.switching.id : S.sheetId) ? " on" : "") + '" data-pickshift="' + s.id + '">' +
        '<span class="sr-when">' + esc(shiftWhen(s)) + '</span><span class="sr-tag">' + esc(s.kind.toUpperCase() + " · " + shiftTag(s)) + "</span></button>";
    };
    var h = '<h2>Choose shift</h2>';
    if (ahead.length) h += '<div class="shiftlist">' + ahead.map(item).join("") + "</div>";
    if (past.length) h += '<label>EARLIER</label><div class="shiftlist">' + past.slice(0, 20).map(item).join("") + "</div>";
    $("shiftBody").innerHTML = h + '<div class="pbtns"><button type="button" data-closeshift>Close</button></div>';
    if (!$("shiftPick").open) $("shiftPick").showModal();
  }
  // DROPS/PICKS toggle (Cards look): open the other kind's sheet, keeping the
  // day where there is one, else the current shift's, else the latest.
  function switchKind(kind) {
    var sh = S.switching && S.switching.sheet || sheet();
    if (sh && sh.kind === kind && !(S.switching && S.switching.failed)) return;
    var same = sh && S.sheets.filter(function (s) { return s.kind === kind && s.day === sh.day; })[0];
    var now = currentShiftKey();
    var cur = S.sheets.filter(function (s) { return s.kind === kind && s.day === now; })[0];
    var latest = S.sheets.filter(function (s) { return s.kind === kind; }).sort(function (a, b) { return a.day > b.day ? -1 : 1; })[0];
    var pick = same || cur || latest;
    if (pick) chooseShift(pick.id);
    else toast("No " + kind.toUpperCase() + " sheet yet.");
  }
  function chooseShift(id) {
    $("shiftPick").close();
    if (id === (S.switching ? S.switching.id : S.sheetId)) return;
    // Operations: Drops | Picks on Hourly stats or Shift summary stays on that page.
    var stay = isOps() && (S.view === "summary" || S.view === "stats");
    if (!stay && !leaveOk()) return;
    switchSheet(id, { stay: stay });
  }
  function pickerHtml(shift) {
    // Operations: Drops | Picks sits beside the picker, so it lists only that
    // kind's days, without the word ("7TH OCT · today").
    var cur = sheet(), oneKind = isOps() && cur ? cur.kind : "";
    var sheets = oneKind ? S.sheets.filter(function (s) { return s.kind === oneKind; }) : S.sheets;
    function opt(s) { return '<option value="' + s.id + '"' + (s.id === (S.switching ? S.switching.id : S.sheetId) ? " selected" : "") + ">" + esc(oneKind ? (isRefined() && s.day ? refinedDay(s.day, s.day === shift) : sheetLabel(s).replace(/^\S+ /, "")) : sheetLabel(s)) + (s.day === shift && !(isRefined() && oneKind && s.day) ? " · today" : "") + "</option>"; }
    var ahead = sheets.filter(function (s) { return s.day >= shift; }).sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : a.kind < b.kind ? -1 : 1; });
    var h = ahead.length ? '<optgroup label="TODAY AND COMING UP">' + ahead.map(opt).join("") + "</optgroup>" : "";
    var months = {};
    sheets.filter(function (s) { return s.day < shift; }).forEach(function (s) { (months[s.day.slice(0, 7)] = months[s.day.slice(0, 7)] || []).push(s); });
    Object.keys(months).sort().reverse().forEach(function (m) {
      h += '<optgroup label="' + new Date(m + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase() + '">' + months[m].map(opt).join("") + "</optgroup>";
    });
    if (S.archiveSheet) h += '<optgroup label="OPENED FROM ARCHIVE">' + opt(S.archiveSheet) + "</optgroup>";
    return h;
  }

  // The board after a tap: renderBoard() also lists its pieces (each row on its
  // own), and only the rows whose HTML changed are rebuilt. Anything else (rows
  // added, gone or moved, a heading changed) is redrawn whole. Stress test: a tap
  // on an 800-car sheet on a slow phone went from about 0.6 s to a few ms.
  var boardChunks = null, shownChunks = null, sheetChunks = null, mainTpl = document.createElement("template");
  function setMain(html, view) {
    var main = $("main"), next = view === "board" ? boardChunks : null, prev = shownChunks;
    shownChunks = next;
    if (next && prev && main.dataset.view === "board" && prev.length === next.length) {
      var changed = [], ok = true;
      for (var i = 0; i < next.length && ok; i++) {
        if (prev[i][0] !== next[i][0]) ok = false;
        else if (prev[i][1] !== next[i][1]) { if (next[i][0].slice(0, 4) === "row:") changed.push(next[i]); else ok = false; }
      }
      if (ok) {
        var els = changed.map(function (c) { return main.querySelector(':scope > [data-id="' + c[0].slice(4) + '"]'); });
        if (els.every(Boolean)) {
          changed.forEach(function (c, k) { mainTpl.innerHTML = c[1]; var n = mainTpl.content.firstElementChild; if (n && mainTpl.content.children.length === 1) els[k].replaceWith(n); else ok = false; });
          mainTpl.innerHTML = "";
          if (ok) return;
        }
      }
    }
    main.innerHTML = html; main.dataset.view = view;
  }
  function render() {
    if (!S.me) return;
    document.body.classList.toggle("on-lanes", S.view === "lanes");
    document.body.classList.toggle("keychecking", S.view === "board" && keyOn() && !S.switching);
    try { renderChrome(); } catch (err) { oopsLog(err); }
    var fn = { calls: renderCalls, lanes: renderLanes, stats: renderStats, clients: renderClients, board: renderBoard, flights: renderFlights, summary: renderSummary, dashboard: renderDashboard, import: renderImport, staff: renderStaff, settings: renderSettings, archive: renderArchive, me: renderMe }[S.view] || renderBoard;
    var html;
    if (S.switching && S.view === "board" || S.switching && S.switching.o.archive) { boardChunks = null; html = loadingHtml(S.switching); setMain(html, "loading"); return; }
    // One screen going wrong never takes the app down: it says so and offers a way out.
    try { html = fn(); } catch (err) {
      oopsLog(err);
      html = '<div class="msg">This screen couldn\'t be shown just now.<br><br>' + (S.view !== "board" ? '<button type="button" class="btn brand" data-view="board">Back to the board</button> ' : "") +
        '<button type="button" class="btn ghost" data-reload>Reload the app</button></div>';
    }
    var keep = S.view === "settings" && $("main").dataset.view === "settings" && hasFeatures() ? setEdits() : null;
    setMain(html, S.view);
    if (S.view === "settings" && hasFeatures()) settingsDrawn(keep);
    snapSave();
    if (flashId) { var el = document.querySelector('[data-id="' + flashId + '"]'); if (el) { el.classList.add("flash"); setTimeout(function () { el.classList.remove("flash"); }, 1500); } flashId = null; }
  }
  function markBnav() {
    var m = isOps() && $("menu").open;
    Array.prototype.forEach.call(document.querySelectorAll("#bnav [data-bn]"), function (b) { b.classList.toggle("on", isOps() && (m ? b.dataset.bn === "menuBtn" : BN_VIEW[b.dataset.bn] === S.view)); });
    if (m) $("bnBoard").classList.remove("on");
    [["bnDash", "dashboard"], ["bnSet", "settings"]].forEach(function (x) { if ($(x[0])) $(x[0]).classList.toggle("on", isOps() && !m && S.view === x[1]); });
    Array.prototype.forEach.call(document.querySelectorAll("#bnav button"), function (b) { if (b.classList.contains("on") && opsDesk()) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  }
  function placeDeskNav(desk) {
    var nav = $("bnav"), bar = document.querySelector(".top .bar");
    if (desk && nav.parentNode !== bar.parentNode) bar.after(nav);
    else if (!desk && nav.parentNode === bar.parentNode) $("main").after(nav);
  }
  function go(view) { if (S.view === "settings" && view !== "settings" && !leaveOk()) { if ($("menu").open) $("menu").close(); return false; } if (S.platform && view !== "me") view = "clients"; if (view === "import" && S.updateReady && !S.queue.length && !pt && !camStream && !BK.length) { location.reload(); return; } if (view === "import") S.recentImports = null; if (view === "lanes" && !lanePlanner()) view = "board"; if (view === "calls") S.callsList = null; if (view === "lanes") { LP.error = ""; loadLanes(); } S.view = view; S.settingsDraft = null; if (view === "summary") S.activity = null; if (view === "dashboard") { S.dash = null; S.dashLive = undefined; } if ($("menu").open) $("menu").close(); render(); window.scrollTo(0, 0); }

  // ── board ─────────────────────────────────
  // Same rules as the Sheet app, so nobody has to relearn what a count means.
  var WARN_MINS = 25, LATE_MINS = 50;
  function isPicks() { var sh = sheet(); return !!(sh && sh.kind === "picks"); }
  function minsSince(ts) { return ts ? (Date.now() - new Date(ts).getTime()) / 60000 : null; }

  // Still needs doing. DROPS: SENT and CLEAR both. PICKS: taken in AND
  // photographed; No Show and RTC need no photos.
  function outstanding(r) {
    if (r.kind === "drops") return !(r.sent_at && r.cleared_at);
    if (!r.intake) return true;
    return r.intake === "Collected" && !r.pt_at;
  }
  // Earlier days' cars nobody has rung about, or ones marked OVERSTAY.
  function inOverstayBlock(r) { return r.called_word === "Overstay" || (r.overstay && !r.called_at); }
  // The TO DO number: work nobody has picked up yet. A car already SENT is in hand.
  function waiting(r) { return outstanding(r) && (r.kind === "picks" || (!r.sent_at && !inOverstayBlock(r))); }
  // A dashboard queue opened on the board (S.boardQueue): just that queue's cars.
  var QUEUES = {
    called: ["Called, not sent", function (r) { return r.kind === "drops" && !!r.called_at && !r.sent_at && !r.cleared_at && !r.overstay && !inOverstayBlock(r); }],
    sent: ["Sent, not handed back", function (r) { return r.kind === "drops" && !!r.sent_at && !r.cleared_at; }],
    soon: ["Due in the next 2 hours, not sent", function (r) { return r.kind === "drops" && waiting(r) && orderAt(r) <= new Date(Date.now() + 2 * 3600000).toISOString(); }],
    // A tapped number on Summary or Hourly stats: the cars it counts.
    way: ["On the way", function (r) { return !!r.sent_at && !r.cleared_at; }],
    over: ["Overstays", function (r) { return !!r.overstay; }],
    comp: ["Complaints", function (r) { return r.clear_word === "COMPLAINT" || /^!/.test(r.note); }],
    sentall: ["Sent", function (r) { return !!r.sent_at; }],
    back: ["Collected", function (r) { return !!r.cleared_at; }],
    left: ["Still to collect", function (r) { return !r.cleared_at; }],
    owed: ["Overstay still owed", function (r) { var d = !r.charge_method && chargeDue(r); return !!(d && d.amount > 0); }],
    cash: ["Overstay paid: cash", function (r) { return r.charge_method === "cash"; }],
    card: ["Overstay paid: card", function (r) { return r.charge_method === "card"; }],
    waived: ["Overstay waived", function (r) { return r.charge_method === "waived"; }],
    carsin: ["Cars in", function (r) { return r.intake === "Collected"; }],
    come: ["Still to come", function (r) { return !r.intake; }],
    noshow: ["No shows", function (r) { return r.intake === "No Show"; }],
    rtc: ["RTC", function (r) { return r.intake === "RTC"; }],
    pdone: ["Completed", function (r) { return r.intake === "Collected" || r.intake === "RTC"; }]
  };
  // Open the board on one of those queues ("" = the whole sheet).
  function openTile(k) {
    keyModeSet(false); S.q = ""; S.yardFilter = ""; S.catFilter = ""; S.paymentFilter = "";
    S.boardQueue = QUEUES[k] ? k : ""; if (!S.boardQueue) S.filter = "all";
    go("board");
  }
  // A number that opens its cars: a tile that is also a button.
  function tileAttr(k) { return ' data-tileq="' + k + '" role="button" tabindex="0"'; }
  function queueBar() {
    var q = QUEUES[S.boardQueue]; if (!q) return "";
    return '<div class="queuebar"><span>Showing <b>' + esc(q[0]) + '</b> · ' + S.rows.filter(q[1]).length + '</span><button type="button" data-queueclear>Show all</button></div>';
  }

  // Running order: when the car is really needed. A flight two hours late is
  // needed two hours later, so a live or expected time beats the timetable.
  function orderAt(r) {
    if (r.kind === "picks") return r.drop_at || "9";
    // An early return is needed from when they rang, not their booked day.
    if (r.early) return r.est_at || r.called_at || r.early_at || "9";
    return r.est_at || r.sched_at || r.return_at || r.called_at || "9";
  }

  // ── PICKS categories: where to park the car ──
  // A return up to the day-end (06:00) belongs to the day before, so a 22nd
  // 06:00 return is a 21st return. SHORT runs to the sheet's short date and
  // always includes SAME DAY and NEXT DAY.
  var CATS = [["same", "SAME DAY"], ["next", "NEXT DAY"], ["short", "SHORT"], ["long", "LONG"]];
  function returnDay(r) {
    if (!r.return_at) return "";
    var l = londonParts(new Date(r.return_at)), end = ((S.company && S.company.drops_day_end) || "06:00").slice(0, 5);
    return l.time <= end ? addDaysKey(l.key, -1) : l.key;
  }
  function catOf(r, sh) {
    sh = sh || sheet();
    var d = returnDay(r);
    if (!sh || sh.kind !== "picks" || !d) return "";
    if (d <= sh.day) return "same";
    if (d === addDaysKey(sh.day, 1)) return "next";
    if (!sh.short_until) return "";
    return d <= sh.short_until ? "short" : "long";
  }
  // SHORT LEFT / LONG LEFT on the board: the cars of that group still LEFT (not collected, no show or RTC).
  var LEFT_CATS = [["shortleft", "SHORT LEFT", "short"], ["longleft", "LONG LEFT", "long"]];
  function inCat(r, cat) {
    if (cat === "shortleft" || cat === "longleft") return (r.intake || "LEFT") === "LEFT" && inCat(r, cat === "shortleft" ? "short" : "long");
    var c = catOf(r); return cat === "short" ? c === "same" || c === "next" || c === "short" : c === cat;
  }
  function catCounts() {
    var n = { same: 0, next: 0, short: 0, long: 0, shortleft: 0, longleft: 0 };
    S.rows.forEach(function (r) { CATS.concat(LEFT_CATS).forEach(function (c) { if (inCat(r, c[0])) n[c[0]]++; }); });
    return n;
  }
  function dayWord(key) { var d = +key.slice(8, 10); return pad(d) + ordinal(d); }

  function visibleRows(withoutPayments) {
    var q = S.q.trim().toUpperCase().replace(/^#/, "").replace(/\s+/g, "");
    var usePayments = !withoutPayments && S.paymentFilter && boardPaymentsAvailable();
    return S.rows.filter(function (r) {
      if (usePayments && !paymentMatches(r, S.paymentFilter)) return false;
      // A search looks at the whole sheet: a car already done must still be findable from TO DO.
      if (q) return [r.reg, r.num, r.flight, r.name, r.phone, r.note, r.ref, r.make].join("").toUpperCase().replace(/\s+/g, "").indexOf(q) !== -1;
      if (QUEUES[S.boardQueue]) return QUEUES[S.boardQueue][1](r);
      if (S.filter === "todo" && !outstanding(r)) return false;
      if (S.catFilter && !inCat(r, S.catFilter)) return false;
      if (S.yardFilter) {
        if (S.yardFilter.slice(0, 2) === "y:") { var yf = S.yardFilter.slice(2); if (yf === "-" ? r.yard || r.intake !== "Collected" : r.yard !== yf) return false; }
        else if (r.kind === "picks" ? (r.intake || "LEFT") !== S.yardFilter : (S.yardFilter === "-" ? r.yard || r.cleared_at : r.yard !== S.yardFilter || r.cleared_at)) return false;
      }
      return true;
    }).sort(function (a, b) {
      var x = orderAt(a), y = orderAt(b);
      return x < y ? -1 : x > y ? 1 : (a.num || 0) - (b.num || 0);
    });
  }

  function renderBoardHead() {
    var picks = isPicks(), cells;
    if (picks) {
      var c = { LEFT: 0, Collected: 0, "No Show": 0, RTC: 0 };
      S.rows.forEach(function (r) { var k = r.intake || "LEFT"; if (c[k] !== undefined) c[k]++; });
      cells = [["LEFT", "LEFT", c.LEFT], ["COLL", "Collected", c.Collected], ["NO SHOW", "No Show", c["No Show"]], ["RTC", "RTC", c.RTC]];
      if (picksYard()) {
        (S.company.yards || []).forEach(function (y) { cells.push([YARD_LABEL[y] || y, "y:" + y, S.rows.filter(function (r) { return r.yard === y; }).length]); });
        var unset = S.rows.filter(function (r) { return !r.yard && r.intake === "Collected"; }).length;
        if (unset) cells.push(["NO YARD", "y:-", unset]);
      }
    } else {
      var open = S.rows.filter(function (r) { return !r.cleared_at; });
      cells = yardOrder().map(function (y) { return [YARD_LABEL[y] || y, y, open.filter(function (r) { return r.yard === y; }).length]; });
      var none = open.filter(function (r) { return !r.yard; }).length;
      if (none && can("yard")) cells.push(["NO YARD", "-", none]);
    }
    var pro = isCards();
    var cellHtml = function (x) {
      return '<button type="button" data-tally="' + esc(x[1]) + '" class="' + (S.yardFilter === x[1] ? "on" : "") + (x[1] === "-" || x[1] === "y:-" ? " warn" : "") + '" aria-pressed="' + (S.yardFilter === x[1]) + '"><span>' + esc(x[0]) + '</span><b class="num">' + x[2] + "</b></button>";
    };
    var yardCells = cells.filter(function (x) { return String(x[1]).slice(0, 2) === "y:"; });
    $("tally").innerHTML = cells.filter(function (x) { return String(x[1]).slice(0, 2) !== "y:"; }).map(cellHtml).join("") +
      (yardCells.length ? '<div class="tyards">' + yardCells.map(cellHtml).join("") + "</div>" : "");
    $("tally").classList.toggle("has-yards", !!yardCells.length);
    renderCatStrip(picks);
    renderTallyFold(cells);
    renderKeyBtn();
    var cardsWords = pro && !isPremium();
    if (isRefined()) { $("tabTodo").innerHTML = 'To do <b class="num">' + S.rows.filter(waiting).length + "</b>"; $("tabAll").innerHTML = 'All <b class="num">' + S.rows.length + "</b>"; }
    else {
      $("tabTodo").textContent = cardsWords ? S.rows.filter(waiting).length + " Waiting for action" : "TO DO (" + S.rows.filter(waiting).length + ")";
      $("tabAll").textContent = cardsWords ? "All " + S.rows.length : "ALL (" + S.rows.length + ")";
    }
    $("tabTodo").classList.toggle("on", !keyOn() && S.filter === "todo");
    $("tabAll").classList.toggle("on", !keyOn() && S.filter === "all");
    $("tabTodo").setAttribute("aria-pressed", !keyOn() && S.filter === "todo");
    $("tabAll").setAttribute("aria-pressed", !keyOn() && S.filter === "all");
    if (document.activeElement !== $("q")) $("q").value = S.q;
    $("q").placeholder = pro ? "Search reg or name" : "Search reg, name, number or note";
    show("qClear", !!S.q);
    var desk = opsDesk();
    if ($("opsHead")) { show("opsHead", desk); if (desk) $("opsHead").innerHTML = opsHeadHtml(sheet()); }
    $("colHead").classList.toggle("dhead", desk);
    if (desk) $("colHead").innerHTML = picks ? opsPickColHead() : opsColHead(); else $("colHead").innerHTML = '<span class="hl">' + (picks ? "CAR · CUSTOMER" : "CAR · FLIGHT") + '</span><span class="hr">' +
      (picks ? "<span>COLL</span><span>" + (picksYard() ? "YARD" : "NO SHOW") + "</span><span>RTC</span><span>PT</span>" : swipeOnly() ? "<span>DONE</span>" : "<span>SENT</span><span>CALLED</span><span>CLEAR</span>") + "</span>";
  }

  // Premium look: the day's numbers fold away to one line, so the list starts
  // higher on the screen. Remembered on this phone.
  var TALLY_FOLD_KEY = "takeoff_tally_folded";
  function tallyFolded() { try { return localStorage.getItem(TALLY_FOLD_KEY) === "1"; } catch (e) { return false; } }
  function toggleTallyFold() {
    try { if (tallyFolded()) localStorage.removeItem(TALLY_FOLD_KEY); else localStorage.setItem(TALLY_FOLD_KEY, "1"); } catch (e) {}
    render();
  }
  function renderTallyFold(cells) {
    var on = hasFeatures(), folded = on && tallyFolded();
    document.body.classList.toggle("tfolded", folded);
    show("tallyFold", on);
    if (!on) return;
    $("tallyFold").setAttribute("aria-expanded", !folded);
    // Operations Refined: the fold takes away the counts block only; SHORT / LONG and SHORT TO stay.
    $("tallyFold").setAttribute("aria-controls", isRefined() ? "tally" : "tally catTally");
    if (!folded) { $("tallyFold").innerHTML = '<span class="tf-act">Hide numbers</span>'; return; }
    var sum = cells.map(function (x) { return '<b class="num">' + x[2] + "</b> <i>" + esc(x[0]) + "</i>"; }).join(" · ");
    var f = S.yardFilter ? (cells.filter(function (x) { return x[1] === S.yardFilter; })[0] || [S.yardFilter])[0]
      : S.catFilter ? (LEFT_CATS.concat(CATS).filter(function (c) { return c[0] === S.catFilter; })[0] || [0, S.catFilter])[1] : "";
    $("tallyFold").innerHTML = '<span class="tf-sum">' + sum + (f ? ' · <em>showing ' + esc(f) + "</em>" : "") +
      '</span><span class="tf-act">Show</span>';
  }

  function renderCatStrip(picks) {
    var sh = sheet();
    show("catTally", picks);
    if (!picks || !sh) return;
    var n = catCounts(), set = !!sh.short_until;
    // Board strip: SHORT LEFT, LONG LEFT, SHORT, LONG (SAME DAY and NEXT DAY stay in the stats panel).
    var strip = set ? LEFT_CATS.concat(CATS.slice(2)) : LEFT_CATS.slice(0, 1);
    var cells = strip.map(function (c) {
      return '<button type="button" data-cat="' + c[0] + '" class="' + (c[2] || c[0]) + (S.catFilter === c[0] ? " on" : "") + '" aria-pressed="' + (S.catFilter === c[0]) + '"><span>' + c[1] + '</span><b class="num">' + n[c[0]] + "</b></button>";
    }).join("");
    var pick = "";
    if (can("yard")) {
      var opts = ['<option value="">' + (set ? "Clear" : "Set") + "</option>"];
      for (var i = 2; i <= 30; i++) { var k = addDaysKey(sh.day, i); opts.push('<option value="' + k + '"' + (k === sh.short_until ? " selected" : "") + ">" + dayWord(k) + "</option>"); }
      pick = '<label class="shortpick' + (set ? "" : " unset") + '"><span>SHORT TO</span><select data-shortuntil aria-label="Short dates up to">' + opts.join("") + "</select></label>";
    } else if (!set) pick = '<div class="shortpick unset"><span>SHORT TO</span><b>not set</b></div>';
    $("catTally").innerHTML = cells + pick;
  }

  function renderBoard() {
    renderBoardPayments();
    if (keyOn()) { boardChunks = null; sheetChunks = null; return renderKeyBoard(); }
    var n = backupNudge(), d = deskBtn() + keyStrip(); sheetChunks = null;
    var sh = renderSheet(), o = otherDaysHtml(), f = opsBoardFoot();
    boardChunks = [["nudge", n], ["desk", d]].concat(sheetChunks || [["sheet", sh]]).concat([["foot", f], ["other", o]]);
    return n + d + sh + f + o;
  }
  // PICKS: a booking made at the desk, added in one go with a photo of the
  // docket (database part 69). Anyone who takes cars in can add one.
  function deskBtn() {
    var sh = sheet();
    if (!sh || sh.kind !== "picks" || sh.archived_at || S.platform || !can("intake")) return "";
    return '<button type="button" class="deskbtn" data-deskbook aria-label="New booking at the desk"><b aria-hidden="true">+</b><span>New booking</span></button>';
  }
  var deskPhoto = null, deskSheet = null;
  // AF14BDU (24 Oct): added at 11:28 with the next day's PICKS board open, so it went on the wrong
  // day's sheet. A sheet that isn't today's says so, and offers today's when it's in.
  function deskWarn(sh, today) {
    if (!sh.day || sh.day === today) return "";
    var t = S.sheets.filter(function (x) { return x.kind === "picks" && x.day === today && !x.archived_at; })[0];
    return '<p class="dkwarn" id="dkWarn">This is the PICKS sheet for <b>' + esc(dayShort(sh.day + "T12:00:00Z")) + "</b>, not today (" + esc(dayShort(today + "T12:00:00Z")) + ")." +
      (t ? ' <button type="button" class="btn ghost small" data-dktoday="' + esc(t.id) + '">Add to today\'s sheet</button>' : "") + "</p>";
  }
  function deskToday(id) {
    var t = S.sheets.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    deskSheet = t;
    var w = $("dkWarn"); if (w) w.remove();
    var sm = document.querySelector("#panelTitle small"); if (sm) sm.textContent = sheetLabel(t);
  }
  function openDeskBooking() {
    var sh = sheet(); if (!sh) return;
    deskPhoto = null;
    var now = londonParts(new Date());
    deskSheet = sh;
    function f(id, label, attrs) { return '<label for="' + id + '">' + label + '</label><input id="' + id + '" ' + (attrs || "") + ">"; }
    $("panelBody").innerHTML = '<h2 id="panelTitle">New booking <small>' + esc(sheetLabel(sh)) + "</small></h2>" +
      '<form id="deskForm" novalidate>' + deskWarn(sh, now.key) +
      '<label class="docshot" id="dkShot"><input type="file" accept="image/*" capture="environment" data-deskfile hidden><span class="docshot-ico" aria-hidden="true">📷</span><span id="dkShotTxt">Take photo of docket</span></label>' +
      f("dkReg", "REG", 'autocomplete="off" autocapitalize="characters" maxlength="12" required') +
      f("dkName", "NAME", 'autocomplete="off" maxlength="80"') +
      f("dkPhone", "PHONE", 'type="tel" autocomplete="off" maxlength="30"') +
      f("dkMake", "CAR", 'autocomplete="off" maxlength="60" placeholder="Make and colour"') +
      f("dkRef", "REF", 'autocomplete="off" maxlength="40" placeholder="Docket or booking number"') +
      '<label>BACK</label><div class="when2"><input id="dkRetD" type="date">' + timeBox("dkRetT", "") + "</div>" +
      (picksYard() ? '<label>LOCATION</label><div class="pseg yard" id="dkYard">' + (S.company.yards || []).map(function (y) { return '<button type="button" data-dkyard="' + esc(y) + '">' + esc(YARD_LABEL[y] || y) + "</button>"; }).join("") + "</div>" : "") +
      '<label for="dkNote">NOTE</label><textarea id="dkNote" maxlength="500" placeholder="e.g. £20 paid cash"></textarea>' +
      '<label class="check"><input type="checkbox" id="dkIn" checked> Car taken in now (COLL)</label>' +
      '<div class="pbtns"><button type="button" data-close>Cancel</button><button class="save" id="dkGo">Add booking</button></div></form>';
    $("panelBody").dataset.drop = now.key + " " + now.time;
    if (!$("panel").open) $("panel").showModal();
    setTimeout(function () { $("dkReg").focus(); }, 50);
  }
  async function saveDeskBooking() {
    var sh = deskSheet || sheet(), reg = $("dkReg").value.trim();
    if (!reg) return toast("Enter the registration.", true);
    if (sh.day && sh.day !== londonParts(new Date()).key && $("dkIn").checked && !confirm("Add " + reg.toUpperCase() + " to PICKS " + dayShort(sh.day + "T12:00:00Z") + "? It was taken in today.")) return;
    var ret = localWhen("dkRet");
    if (ret === null) return toast("Type the time like 13:20 (or 1320).", true);
    var yb = document.querySelector("#dkYard button.on");
    var p = { reg: reg, name: $("dkName").value, phone: $("dkPhone").value, make: $("dkMake").value, ref: $("dkRef").value, note: $("dkNote").value,
      return_local: ret, drop_local: $("panelBody").dataset.drop || "", yard: yb ? yb.dataset.dkyard : "", desk: true, taken_in: $("dkIn").checked };
    $("dkGo").disabled = true;
    var x = await sb.rpc("add_booking", { p_sheet: sh.id, p: p });
    if (x.error) { $("dkGo").disabled = false; return toast(x.error.message, true); }
    var photo = deskPhoto; deskPhoto = null;
    $("panel").close();
    await loadRows();
    toast(x.data.reg + " added" + (sh !== sheet() ? " to " + sheetLabel(sh) : "") + (photo ? " · saving the docket photo…" : ""));
    if (photo) await uploadDoc(x.data, photo);
    if (can("import")) await askDrops([x.data.id]);
  }
  async function uploadDoc(r, file) {
    try {
      var small = await bkSmall(file, true);
      var path = S.company.id + "/docs/" + r.id + "/" + Date.now() + ".jpg";
      var up = await sb.storage.from("pt-photos").upload(path, small.blob, { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      var x = await sb.rpc("set_doc", { p_booking: r.id, p_path: path });
      if (x.error) throw x.error;
      var row = S.rows.filter(function (y) { return y.id === r.id; })[0];
      if (row) { row.doc_path = path; row.doc_at = nowIso(); }
      toast("Docket photo saved for " + r.reg);
      if (panelRow && panelRow.id === r.id && $("panel").open) openPanel(row || r);
    } catch (e) { toast("The docket photo didn't save: " + ((e && e.message) || e), true); }
  }
  // The car's panel: the docket photo (its own, or for a DROPS car its PICKS car's).
  function docBlockHtml(r) {
    var mine = r.kind === "picks";
    if (!r.doc_path && !(mine && can("intake")) && !r.ref) return "";
    return '<label>DOCKET</label><div class="docbox" id="docBox">' + (r.doc_path ? '<a class="docimg" id="docImg" target="_blank" rel="noopener"><span class="note">Loading photo…</span></a>' : '<span class="note" id="docNone">' + (mine ? "No photo yet." : "") + "</span>") +
      (mine && can("intake") ? '<label class="btn ghost small docadd">' + (r.doc_path ? "Retake photo" : "Take photo of docket") + '<input type="file" accept="image/*" capture="environment" data-docfile hidden></label>' : "") + "</div>";
  }
  async function fillDoc(r) {
    var path = r.doc_path;
    if (!path && r.kind === "drops" && r.ref) {
      var m = await sb.from("bookings").select("doc_path").eq("kind", "picks").eq("ref", r.ref).neq("doc_path", "").limit(1);
      path = m.data && m.data[0] && m.data[0].doc_path;
      if (!path) { var box = $("docBox"); if (box && !box.querySelector(".docadd")) { var sec = box.closest(".ops-docs"); if (sec) sec.remove(); else { box.previousElementSibling.remove(); box.remove(); } } return; }
      if ($("docNone")) $("docNone").outerHTML = '<a class="docimg" id="docImg" target="_blank" rel="noopener"><span class="note">Loading photo…</span></a>';
    }
    if (!path) return;
    var u = await sb.storage.from("pt-photos").createSignedUrl(path, 3600);
    var a = $("docImg"); if (!a || !panelRow || panelRow.id !== r.id) return;
    if (u.error || !u.data) { a.innerHTML = '<span class="note">Photo not found.</span>'; return; }
    a.href = u.data.signedUrl; a.innerHTML = '<img alt="Docket photo" src="' + esc(u.data.signedUrl) + '">';
  }
  // The free plan's nightly backups live inside Supabase itself: the owner is
  // reminded weekly to keep a copy of their own somewhere else.
  var BACKUP_EVERY_DAYS = 7;
  function backupNudge() {
    if (!S.me || S.me.role !== "owner" || S.platform || S.lastDownload === undefined) return "";
    var days = S.lastDownload ? Math.floor((Date.now() - Date.parse(S.lastDownload)) / 864e5) : null;
    if (days !== null && days < BACKUP_EVERY_DAYS) return "";
    return '<div class="nudge"><span>Keep your own copy of the company data: ' + (days === null ? "never downloaded yet." : "last downloaded " + days + " days ago.") +
      '</span><button type="button" class="btn ghost" data-backup>Download now</button></div>';
  }
  async function loadLastDownload() {
    if (!S.me || S.me.role !== "owner" || S.platform) return;
    var r = await sb.from("activity").select("at").eq("action", "SETTINGS").like("value", "Downloaded a backup%").order("at", { ascending: false }).limit(1);
    if (r.error) return;   // unknown: no nudge rather than a wrong one
    S.lastDownload = r.data && r.data[0] ? r.data[0].at : null;
    if (S.view === "board" && !$("panel").open) render();
  }
  // ── search: other days ──
  // Three characters or more also look at every other sheet (not removed cars),
  // so a reg typed on today's board finds it on yesterday's or on PICKS.
  var otherTimer = null;
  function searchWords() { var raw = (S.q || "").trim(); return { raw: raw.replace(/[^A-Za-z0-9 '-]/g, "").trim(), tight: raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase() }; }
  function searchOtherDays() {
    clearTimeout(otherTimer);
    var w = searchWords();
    if (w.tight.length < 3) { S.other = null; return; }
    otherTimer = setTimeout(async function () {
      var key = w.tight + "|" + S.sheetId;
      var r = await sb.from("bookings").select("id, sheet_id, kind, reg, name, make, overstay, cleared_at, intake, sheets!bookings_sheet_id_fkey(day, kind)")
        .neq("sheet_id", S.sheetId).is("removed_at", null)
        .or('reg.ilike."%' + w.tight + '%",ref.ilike."%' + w.tight + '%",phone.ilike."%' + w.tight + '%"' + (w.raw.length >= 3 ? ',name.ilike."%' + w.raw + '%"' : ""))
        .order("updated_at", { ascending: false }).limit(20);
      var now = searchWords(); if (now.tight + "|" + S.sheetId !== key) return;   // typed on since
      S.other = r.error ? null : (r.data || []).sort(function (a, b) { return ((b.sheets || {}).day || "") < ((a.sheets || {}).day || "") ? -1 : 1; });
      if (S.view === "board") setMain(renderBoard(), "board");
    }, 350);
  }
  function otherDaysHtml() {
    if (!S.q || !S.other || !S.other.length) return "";
    return '<div class="sec">ON OTHER DAYS <b class="num">' + S.other.length + "</b></div>" + S.other.map(function (r) {
      var sh = r.sheets || {}, st = r.kind === "picks" ? (r.intake || "LEFT") : r.cleared_at ? "DONE" : r.overstay ? "OVERSTAY" : "OUT";
      return '<button type="button" class="otherhit" data-othersheet="' + r.sheet_id + '" data-otherreg="' + esc(r.reg) + '"><b>' + esc(r.reg || "NO REG") + "</b><span>" + esc(r.name) + (r.make ? " · " + esc(r.make) : "") + "</span><i>" + esc(sheetLabel({ day: sh.day || "", kind: sh.kind || r.kind })) + " · " + st + "</i></button>";
    }).join("");
  }
  function renderSheet() {
    var sh = sheet();
    if (!sh) return '<div class="msg">No day sheets yet.' + (can("import") ? ' Open <b>☰ → Import</b> to create one from the booking site\'s download.' : " The office will import today's bookings.") + "</div>";
    var rows = visibleRows();
    var groups;
    if (sh.kind === "picks") groups = [{ title: "", cls: "", rows: rows }];
    else {
      var wait = [], main = [], over = [];
      rows.forEach(function (r) {
        if (inOverstayBlock(r)) over.push(r);
        else if (r.called_at && !r.cleared_at && !r.sent_at) wait.push(r);   // customer is there, nobody on it yet
        else main.push(r);
      });
      // At the desk first (part 112), then longest wait first.
      wait.sort(function (a, b) { var da = atDesk(a), db = atDesk(b); return da !== db ? (da ? -1 : 1) : da ? (a.desk_at < b.desk_at ? -1 : 1) : a.called_at < b.called_at ? -1 : 1; });
      groups = [{ title: "NEXT IN QUEUE", cls: " hot", rows: wait }, { title: "COMING UP", cls: "", rows: main }, { title: "OVERSTAYS", cls: " old", note: overNote(over, sh), rows: over }]
        .filter(function (g) { return g.rows.length; });
    }
    if (!S.rows.length) return '<div class="msg">No cars on this sheet.</div>';
    if (!rows.length) return queueBar() + '<div class="msg">' + (QUEUES[S.boardQueue] ? "Nothing in this queue now." : S.filter === "todo" && !S.q && !S.yardFilter ? "Nothing outstanding." : S.q ? (S.other && S.other.length ? "Not on this sheet. Found on another day below." : searchWords().tight.length >= 3 && S.other ? "Not found on any sheet." : "Not on this sheet.") : "Nothing matches.") + "</div>";
    var draw = sh.kind === "picks" ? pickRow : dropRow, paymentRows = boardPaymentsAvailable();
    var cardsLook = isCards() && !isBoard();   // Premium Board heads its sections like the old board
    var chunks = [], qb = queueBar();
    if (qb) chunks.push(["queue", qb]);
    var out = qb + groups.map(function (g) {
      var head = "";
      if (g.title) {
        var note = g.note;
        if (cardsLook && g.title === "COMING UP") {
          var prog = g.rows.filter(function (r) { return r.sent_at && !r.cleared_at; }).length;
          note = g.rows.length + (g.rows.length === 1 ? " car" : " cars") + (prog ? ", including " + prog + " in progress" : "");
          head = '<div class="sec' + g.cls + '">' + g.title + ' <span>' + note + "</span></div>";
        } else if (cardsLook) {
          head = '<div class="sec' + g.cls + '">' + g.title + ' · ' + g.rows.length + (note ? ' <span>' + note + "</span>" : "") + "</div>";
        } else {
          head = '<div class="sec' + g.cls + '">' + g.title + ' <b class="num">' + g.rows.length + "</b>" + (note ? "<span>" + note + "</span>" : "") + "</div>";
        }
      }
      chunks.push(["head:" + g.title, head]);
      return head + g.rows.map(function (r) { var x = draw(r); if (paymentRows) x = withBoardPayments(r, x); chunks.push(["row:" + r.id, x]); return x; }).join("");
    }).join("");
    sheetChunks = chunks;
    return out;
  }

  function yardChip(r, noGrey) {
    // Key mode: grey until the car's key is ticked (not in the key check itself).
    var kg = !noGrey && r.kind === "drops" && r.yard && keyGrey() && !keyFound(r) ? " kgrey" : "";
    if (!can("yard")) return r.yard ? '<span class="code ' + esc(r.yard) + kg + '">' + esc(r.yard) + "</span>" : "";
    // The chip is the picker: one tap, choose, saved.
    return '<select class="code pick ' + (r.yard ? esc(r.yard) : "unset") + kg + '" data-yard aria-label="Yard for ' + esc(r.reg) + '"><option value="">' + (r.yard ? "—" : "YARD") + "</option>" +
      (S.company.yards || []).map(function (y) { return "<option" + (y === r.yard ? " selected" : "") + ' value="' + esc(y) + '">' + esc(y) + "</option>"; }).join("") + "</select>";
  }
  // An early return gets its own line, like a note, so the flight line stays clear.
  // Carried from an earlier day, or marked OVERSTAY on the day it was due.
  function overNote(rows, sh) {
    var old = 0, today = 0;
    rows.forEach(function (r) { if (sh && returnDay(r) && returnDay(r) < sh.day) old++; else today++; });
    return old && today ? "earlier days · staying longer" : old ? "earlier days" : "staying longer";
  }
  function earlyLine(r) { return r.early ? '<div class="l3 early">EARLY · booked ' + esc(r.return_at ? dayShort(r.return_at) + " " + hhmm(r.return_at) : "later") + "</div>" : ""; }
  function noteLine(r) { return r.note ? '<div class="l3' + (/^!/.test(r.note) ? " bang" : "") + '">' + esc(r.note.replace(/^!\s*/, "")) + "</div>" : ""; }
  // A pressed button shows the time and the first name of whoever pressed it.
  // The Cards look's buttons are big enough for words, not codes.
  var RF_WORDS = { COLL: "Coll", "NO SHOW": "No show", SENT: "Sent", CALLED: "Called", "AT DESK": "At desk", CLEAR: "Clear", OVERSTAY: "Overstay", COMPLAINT: "Complaint" };
  var PRO_WORDS = { COLL: "Collected", "NO SHOW": "No show", SENT: "Sent", CALLED: "Called", "AT DESK": "At desk", CLEAR: "Clear", OVERSTAY: "Overstay", COMPLAINT: "Complaint" };
  // A card per car (Cards or Premium look); isPremium tells the two apart.
  function isCards() { var c = document.documentElement.classList; return c.contains("cards") || c.contains("premium"); }
  function isPremium() { return document.documentElement.classList.contains("premium"); }
  // Premium Board: Premium with two-line rows (board.css).
  function isBoard() { return document.documentElement.classList.contains("pboard"); }
  // Operations and Operations Refined (html.ops-refined, ops-refined.css) share the Operations pages and features.
  function isOps() { var c = document.documentElement.classList; return c.contains("ops") || c.contains("ops-refined"); }
  function isRefined() { return document.documentElement.classList.contains("ops-refined"); }
  // Operations Refined's day words: "Thu 22 Oct" ("Today 22 Oct" for the shift on now), and "Drops · Thu 22 Oct" for a sheet.
  function refinedDay(key, today) {
    if (!key) return "";
    var d = new Date(key + "T12:00:00Z"), o = function (x) { x.timeZone = "UTC"; return d.toLocaleDateString("en-GB", x); };
    return (today ? "Today" : o({ weekday: "short" })) + " " + d.getUTCDate() + " " + o({ month: "short" });
  }
  function refinedSheetLabel(s) { var k = s.kind === "picks" ? "Picks" : "Drops"; return s.day ? k + " · " + refinedDay(s.day) : k; }
  function isStdPlus() { return document.documentElement.classList.contains("stdplus"); }
  // The working features (swipe, pull to refresh, the number fold, the menu in
  // sections, the Summary upgrades): Premium looks and Standard with features.
  function hasFeatures() { return isPremium() || isStdPlus(); }
  // Booking sites send names in capitals; the Cards look shows them as written ("Senior Miss").
  // Operations Refined keeps the short model codes in capitals ("BMW 3 Series", "Audi Q5 S Line").
  var RF_CAPS = /^(bmw|mg|vw|ds|byd|amg|gti|gtd|tdi|tsi|suv|ev|hev|phev|gt|rs|st|se|sr|xe|xf|xj|ii|iii|iv|vi|[a-z]\d{1,2}|id\.?\d?)$/i;
  function niceMake(m) { return m.length <= 3 ? m : isRefined() ? nice(m).split(" ").map(function (w) { return RF_CAPS.test(w) ? w.toUpperCase() : w; }).join(" ") : nice(m); }
  function sentence(t) { t = String(t || ""); return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); }
  // Card looks and Operations Refined tidy names to "Senior Miss"; Premium Board keeps them as imported, like Standard.
  function nice(t) { t = String(t || ""); return (isCards() && !isBoard()) || isRefined() ? t.toLowerCase().replace(/(^|[\s\-'(])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }) : t; }
  function actBtn(r, attrs, cls, label, on, at, allowed, who) {
    var pro = isCards() && !isBoard();   // Premium Board's buttons read like Standard's (COLL, NO SHOW)
    if (pro && PRO_WORDS[label]) label = PRO_WORDS[label];
    // Premium Board's pick rows have narrow buttons: the short word, as the old rows had.
    if (label === "Collected" && isBoard()) label = "Coll";
    // Operations Refined: the words in sentence case, easier to read at a glance.
    if (isRefined() && RF_WORDS[label]) label = RF_WORDS[label];
    var name = on && at ? nice(String(who || "").trim().split(/\s+/)[0]) : "";
    return '<button type="button" class="' + cls + (on ? " on" : "") + (label.length > 7 ? " lng" : "") + '" ' + attrs + (allowed ? "" : " disabled") + ">" +
      (pro ? '<span class="w">' + label + "</span>" : label) + (on && at ? '<small class="num">' + esc(hhmm(at)) + "</small>" : "") + (name ? '<em class="by">' + esc(name) + "</em>" : "") + "</button>";
  }

  // The brand only ("SKODA KODIAQ SE IV PHEV SA BLUE" -> "SKODA"), for the row.
  var TWO_WORD_MAKES = /^(LAND ROVER|RANGE ROVER|ALFA ROMEO|ASTON MARTIN|MERCEDES BENZ|ROLLS ROYCE|L ROVER|DS AUTOMOBILES)\b/i;
  function makeOnly(m) {
    var s = String(m || "").trim();
    if (!s || /^[-\s.]*$/.test(s) || /^(unknown|tbc|n\/?a)\b/i.test(s)) return "";
    var two = s.match(TWO_WORD_MAKES);
    return two ? two[1] : s.split(/\s+/)[0];
  }
  // ── overstay charges (database part 23) ──
  // Booked back before the DROPS day end (06:00): free until 12:00 that day,
  // then one day's rate at once and one more at every midnight.
  // Booked back at 06:00 or later: free until 06:00 the next morning, then one
  // day's rate at once and one more at every 06:00. Counted to CLEAR, or to now.
  function overstayDue(r) {
    var rate = +(S.company && S.company.overstay_rate) || 0;
    if (!rate || r.kind !== "drops" || !r.return_at) return null;
    // A stay made longer in the booking system is charged from the first booked return.
    var ret = londonParts(new Date(r.orig_return_at || r.return_at)), end = londonParts(r.cleared_at ? new Date(r.cleared_at) : new Date());
    var dayEnd = ((S.company.drops_day_end) || "06:00").slice(0, 5);
    var dates = function (a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }, days;
    if (ret.time < dayEnd) {
      var later = dates(ret.key, end.key);
      days = later < 0 ? 0 : later === 0 ? (end.time > "12:00" ? 1 : 0) : 1 + later;
    } else {
      // Up to and including 06:00 still belongs to the day before.
      days = dates(ret.key, end.key) - (end.time <= dayEnd ? 1 : 0);
    }
    return days > 0 ? { days: days, amount: days * rate } : null;
  }
  // What's owed now: the office's agreed amount (a discount) when one is set,
  // else the daily-rate sum. An agreed amount stays put; it doesn't go up.
  function chargeDue(r) {
    var d = overstayDue(r);
    if (r.charge_agreed == null || r.charge_agreed === "") return d;
    return { days: d ? d.days : 0, amount: +r.charge_agreed, agreed: true, calc: d ? d.amount : 0 };
  }
  function money(n) { n = +n || 0; return "£" + (n % 1 ? n.toFixed(2) : n); }
  function chargeTag(r) {
    if (r.charge_method) return ' · <span class="tag pd">' + (r.charge_method === "waived" ? "WAIVED" : money(r.charge_amount) + " " + r.charge_method.toUpperCase()) + "</span>";
    var d = chargeDue(r);
    return d && d.amount > 0 ? ' · <span class="tag due">' + money(d.amount) + " DUE</span>" : "";
  }
  function chargePanelHtml(r) {
    var d = chargeDue(r);
    // No charge yet: the office can add one for any reason (database part 52).
    if (!d && !r.charge_method) {
      if (!can("clear") || r.cleared_at) return "";
      if (S.chargeAdd !== r.id) return '<button type="button" class="link" data-chargeadd>+ ADD CHARGE</button>';
      return "<label>ADD A CHARGE</label>" +
        '<div class="when2 chgpay"><input id="chgAmount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="£" aria-label="Amount">' +
        '<input id="chgReason" maxlength="80" placeholder="Reason, e.g. return date changed" aria-label="Reason" style="flex:3!important"></div>' +
        '<div class="when2 chgpay"><button type="button" data-chargeagreed="set">SET AS DUE</button></div>';
    }
    var h = "<label>" + (d && d.calc ? "OVERSTAY CHARGE" : "CHARGE") + "</label>";
    if (r.charge_method) {
      h += '<div class="chgbox pd"><b>' + (r.charge_method === "waived" ? "Waived " + money(r.charge_amount) : money(r.charge_amount) + " paid by " + r.charge_method) + "</b><span>" +
        esc(byName(r, "charge_by")) + (r.charge_at ? " · " + esc(dayShort(r.charge_at) + " " + hhmm(r.charge_at)) : "") + "</span>" +
        (can("clear") ? '<button type="button" class="link" data-chargeundo>Undo</button>' : "") + "</div>";
      return h;
    }
    if (d.agreed) h += '<div class="chgbox"><b>' + money(d.amount) + " due</b><span>" + esc(r.charge_reason || "agreed") + (d.calc ? " · was " + money(d.calc) + " (" + d.days + (d.days === 1 ? " day" : " days") + ")" : "") + "</span>" +
      (can("clear") ? '<button type="button" class="link" data-chargeagreed="">Undo</button>' : "") + "</div>";
    else h += '<div class="chgbox"><b>' + money(d.amount) + " due</b><span>" + d.days + (d.days === 1 ? " day" : " days") + " × " + money(S.company.overstay_rate) + (r.cleared_at ? "" : " · so far, still going up") + "</span></div>";
    if (can("clear")) h += '<div class="when2 chgpay"><input id="chgAmount" type="number" inputmode="decimal" min="0" step="0.01" value="' + d.amount + '" aria-label="Amount">' +
      '<button type="button" data-chargeagreed="set">SET AS DUE</button></div>' +
      '<div class="when2 chgpay"><button type="button" data-charge="cash">CASH</button><button type="button" data-charge="card">CARD</button><button type="button" data-charge="waived">WAIVE</button></div>' +
      '<div class="hint">Change the amount for a discount: SET AS DUE saves it for everyone, or CASH / CARD takes it now.</div>';
    return h;
  }
  function recordCharge(r, method) {
    var amt = method === "" ? null : parseFloat(($("chgAmount") || {}).value);
    if (method && (isNaN(amt) || amt < 0)) return toast("Check the amount.", true);
    if (method === "waived") { var d = chargeDue(r); amt = d ? d.amount : amt; }
    run("set_overstay_paid", { p_booking: r.id, p_amount: amt, p_method: method }, r, function (x) {
      x.charge_amount = method ? amt : null; x.charge_method = method; x.charge_at = method ? nowIso() : null; x.charge_by = method ? S.me.id : null; markBy(x, "charge_by");
    });
    toast(method === "" ? "Charge cleared" : method === "waived" ? "Waived" : money(amt) + " " + method + " recorded");
  }
  // An agreed amount (a discount) before it's paid; "" puts back the daily-rate sum.
  function setAgreed(r, how) {
    var amt = how ? parseFloat(($("chgAmount") || {}).value) : null;
    if (how && (isNaN(amt) || amt < 0 || (amt === 0 && !overstayDue(r)))) return toast("Check the amount.", true);
    // A new charge keeps its reason; changing an existing one keeps the reason it had.
    var why = how ? ($("chgReason") ? $("chgReason").value.trim() : (r.charge_reason || "")) : "";
    run("set_overstay_agreed", { p_booking: r.id, p_amount: amt, p_reason: why }, r, function (x) { x.charge_agreed = amt; x.charge_reason = amt == null ? "" : why; });
    S.chargeAdd = null;
    toast(how ? money(amt) + " due, saved" : overstayDue(r) ? "Back to the daily rate" : "Charge removed");
  }
  // The flights check couldn't find this number among the day's arrivals, or
  // it isn't a flight number at all (TBC, …): the office needs to look.
  function flightToCheck(r) {
    if (!r.flight || r.flight === "NO FLIGHT" || r.cleared_at) return false;
    // Flight found but landing far from when they booked to be back: it has
    // the flight's time (for the order) and still needs a look.
    if (/over 6 h from the booked time/.test(r.flight_note)) return true;
    if (r.sched_time) return false;
    return /check the flight number$/.test(r.flight_note) || !/^([A-Z0-9]{2}\d{1,5}|[A-Z]{3}\d{1,4})$/.test(r.flight);
  }
  // The car's tags on a line of their own under the flight and times, and only
  // when there are any, so the times stay on one line and no tag (e.g. £30
  // DUE) is ever hidden under the buttons.
  function rowTags(r, tags) {
    tags = tags.filter(Boolean);
    return tags.length ? '<div class="l2 l2t" data-open>' + tags.join(" ") + "</div>" : "";
  }
  // The DROPS card for the Cards look: the reg is the hero, the make/flight and
  // booked → landing time read on one line, the flight status on its own, then
  // the three full-width buttons. Same data and taps as the standard row.
  function flightLine(r) {
    if (r.flight_status === "landed") return '<div class="fst land">Landed</div>';
    if (r.flight_status === "cancelled") return '<div class="fst stop">Flight cancelled</div>';
    if (r.est_time === "DELAY") return '<div class="fst stop">Delayed</div>';
    if (r.flight_status === "expected" && r.est_time) return '<div class="fst due">Expected ' + esc(r.est_time) + "</div>";
    return "";
  }
  // Premium Board's drop row: the flight's state as a word beside the times.
  function flightWord(r) {
    if (r.flight_status === "landed") return ' <i class="fst land">Landed</i>';
    if (r.flight_status === "cancelled") return ' <i class="fst stop">Cancelled</i>';
    if (r.est_time === "DELAY") return ' <i class="fst stop">Delayed</i>';
    return "";
  }
  function dropCard(r, cls, overWord, cmpl, canc, over) {
    var booked = r.early ? r.sched_time : (r.sched_time || hhmm(r.return_at) || "—");
    var eta = canc ? "" : r.est_time;
    var mk = makeOnly(r.make) ? esc(niceMake(makeOnly(r.make))) : "";
    var flt = r.flight ? esc(r.flight) : can("flights") ? '<button type="button" class="addflight" data-addflight>+ FLIGHT</button>' : "";
    var mid = [mk, flt].filter(Boolean).join(" · ");
    var times = booked ? '<span class="bk">booked ' + esc(booked) + (eta && eta !== "DELAY" && eta !== booked ? ' &rarr; <b>' + esc(eta) + "</b>" : "") + "</span>" : "";
    return '<div class="row' + cls + (S.pending[r.id] ? " busy" : "") + '" data-id="' + r.id + '">' +
      '<div class="left"><div class="l1"><button type="button" class="reg" data-open>' + esc(r.reg || "NO REG") + "</button>" + yardChip(r) +
      catTag(r) + wasTag(r) + (r.num && isBoard() ? '<span class="dn num">#' + r.num + "</span>" : "") + '<span class="pin">' + (r.num && !isBoard() ? "#" + r.num + " · " : "") + esc(nice(r.name)) + "</span></div>" +
      // Premium Board: two lines like the old rows, the times on the right of line 2.
      (isBoard()
        ? '<div class="l2 cl2" data-open><span class="l2a">' + (mid || "&nbsp;") + '</span><span class="l2b">' + esc(booked || "") +
          (eta && eta !== "DELAY" && eta !== booked ? ' &rarr; <b>' + esc(eta) + "</b>" : "") + flightWord(r) + "</span></div>"
        : '<div class="l2" data-open>' + mid + (mid && times ? " · " : "") + times + "</div>" + flightLine(r)) +
      rowTags(r, [flightToCheck(r) ? '<span class="tag ck">' + (/^Not in the timetable/.test(r.flight_note) ? "CHECK MANUALLY"
        : /over 6 h from the booked time/.test(r.flight_note) && r.return_at ? "CHECK FLIGHT · BOOKED " + esc(hhmm(r.return_at)) : "CHECK FLIGHT NO.") + "</span>" : "",
        over ? '<span class="tag ov">OVERSTAY</span>' : "", cmpl ? '<span class="tag cm">COMPLAINT</span>' : "", chargeTag(r).replace(/^ · /, ""), exitTag(r)]) +
      earlyLine(r) + noteLine(r) + "</div>" + (swipeOnly() ? stepStatus(r) + "</div>" : dropButtons(r, overWord, cmpl) + "</div>");
  }
  function dropButtons(r, overWord, cmpl, extra) {
    return '<div class="acts' + (extra || "") + '"' + (extra ? ' data-id="' + r.id + '"' : "") + ">" +
      actBtn(r, 'data-act="sent"', "s", "SENT", !!r.sent_at, r.sent_at, can("sent"), byName(r, "sent_by")) +
      (atDesk(r) ? actBtn(r, 'data-act="called"', "c dk", "AT DESK", true, r.desk_at, canCalledTap(r), byName(r, "desk_by"))
        : actBtn(r, 'data-act="called"', "c" + (overWord ? " ov" : ""), overWord ? "OVERSTAY" : "CALLED", !!r.called_at, r.called_at, canCalledTap(r), byName(r, "called_by"))) +
      actBtn(r, 'data-act="clear"', "x" + (cmpl ? " cm" : ""), cmpl ? "COMPLAINT" : "CLEAR", !!r.cleared_at, r.cleared_at, can("clear"), byName(r, "cleared_by")) +
      "</div>";
  }
  function dropRow(r) {
    var cmpl = r.clear_word === "COMPLAINT", bang = /^!/.test(r.note), overWord = r.called_word === "Overstay";
    var canc = r.flight_status === "cancelled", over = r.overstay || overWord;
    var cls = "";
    if (cmpl || (bang && !r.cleared_at)) cls = " cmpl";
    else if (r.cleared_at) cls = " done";
    else if (over) cls = " ovst";
    else if (r.called_at) { var w = minsSince(r.called_at); cls = w > LATE_MINS ? " late" : w > WARN_MINS ? " warn" : " called"; }
    if (atDesk(r) && !r.cleared_at) cls += " atdesk";
    if (isCards()) return dropCard(r, cls, overWord, cmpl, canc, over);
    if (opsDesk()) return opsDeskRow(r, cls, overWord, cmpl, canc, over);
    if (isRefined()) return refinedDropRow(r, cls, overWord, cmpl, canc, over);
    // An early return shows no booked time here (it was for another day): the EARLY tag says when.
    var booked = r.early ? r.sched_time : (r.sched_time || hhmm(r.return_at) || "—");
    var eta = canc ? "" : r.est_time;
    // The card's time block (Cards look only; hidden in the others).
    var big = eta && eta !== "DELAY" ? eta : booked;
    var rt = '<div class="rt" data-open><b class="num' + (eta === "DELAY" ? " dly" : eta && r.flight_status === "expected" ? " exp" : "") + '">' + esc(big || "—") + "</b><small>" + esc(r.flight || "No flight") + "</small>" +
      (eta && booked && eta !== booked ? '<i class="num">booked ' + esc(booked) + "</i>" : "") + (r.flight_status === "landed" ? '<i class="ld">Landed</i>' : "") + "</div>";
    return '<div class="row' + cls + (S.pending[r.id] ? " busy" : "") + '" data-id="' + r.id + '">' + rt +
      '<div class="left"><div class="l1"><button type="button" class="reg" data-open>' + esc(r.reg || "NO REG") + "</button>" + yardChip(r) +
      (r.num ? '<span class="dn num">#' + r.num + "</span>" : "") + keyBox(r) + catTag(r) + wasTag(r) + '<span class="pin">' + esc(nice(r.name)) + "</span></div>" +
      '<div class="l2 num" data-open><span class="l2a">' + (makeOnly(r.make) ? '<span class="mk">' + esc(niceMake(makeOnly(r.make))) + "</span>" : "") +
      '<span class="flp' + (r.flight ? " has" : "") + '">' + (makeOnly(r.make) ? " · " : "") + (r.flight ? esc(r.flight) : can("flights") ? '<button type="button" class="addflight" data-addflight>+ FLIGHT</button>' : "—") + "</span></span>" +
      '<span class="l2b">' + (booked ? " · " + esc(booked) : "") +
      (eta ? ' &rarr; <span class="eta' + (eta === "DELAY" ? " dly" : "") + (r.flight_status === "expected" ? " exp" : "") + '">' + esc(eta) + "</span>" : "") +
      (r.flight_status === "landed" ? ' <span class="tag ld">LANDED</span>' : "") + "</span></div>" +
      // Not in the day's timetable: the flight may still be on, so the office checks by hand.
      rowTags(r, [flightToCheck(r) ? '<span class="tag ck">' + (/^Not in the timetable/.test(r.flight_note) ? "CHECK MANUALLY"
        : /over 6 h from the booked time/.test(r.flight_note) && r.return_at ? "CHECK FLIGHT · BOOKED " + esc(hhmm(r.return_at)) : "CHECK FLIGHT NO.") + "</span>" : "", canc ? '<span class="tag cx">CANCELLED</span>' : "",
        over ? '<span class="tag ov">OVERSTAY</span>' : "", cmpl ? '<span class="tag cm">COMPLAINT</span>' : "", chargeTag(r).replace(/^ · /, ""), exitTag(r)]) +
      earlyLine(r) + noteLine(r) + "</div>" +
      // "Show buttons on drops" off (Standard with features): what's done instead of buttons.
      (swipeOnly() ? stepStatus(r) : dropButtons(r, overWord, cmpl)) + "</div>";
  }

  // ── Operations Refined's rows (phone and tablet) ──
  // The reg big on its own line with the yard and number, then the car and
  // customer, then the flight and times with the flight's state as a word.
  // The same data, taps and buttons as every other row.
  function rfWho(r) { var mk = makeOnly(r.make); return [mk ? niceMake(mk) : "", nice(r.name)].filter(Boolean).join(" · "); }
  function refinedDropRow(r, cls, overWord, cmpl, canc, over) {
    var booked = r.early ? r.sched_time : (r.sched_time || hhmm(r.return_at) || "");
    var eta = canc ? "" : r.est_time, who = rfWho(r);
    var word = r.flight_status === "landed" ? '<span class="fw land">Landed</span>' : canc ? '<span class="fw stop">Cancelled</span>'
      : eta === "DELAY" ? '<span class="fw stop">Delayed</span>' : "";
    var flt = r.flight ? '<span class="flp">' + esc(r.flight) + "</span>" : can("flights") ? '<button type="button" class="addflight" data-addflight>+ Flight</button>' : '<span class="flp none">No flight</span>';
    return '<div class="row rfr' + cls + (S.pending[r.id] ? " busy" : "") + '" data-id="' + r.id + '">' +
      '<div class="left"><div class="l1"><button type="button" class="reg" data-open>' + esc(r.reg || "NO REG") + "</button>" + yardChip(r) +
      (r.num ? '<span class="dn num">#' + r.num + "</span>" : "") + keyBox(r) + "</div>" +
      (who || catTag(r) || wasTag(r) ? '<div class="l2 rfw" data-open>' + catTag(r) + wasTag(r) + esc(who) + "</div>" : "") +
      '<div class="l2 rft num" data-open>' + flt + (booked ? '<span class="tm">' + esc(booked) + "</span>" : "") +
      (eta && eta !== "DELAY" && eta !== booked ? '<span class="eta' + (r.flight_status === "expected" ? " exp" : "") + '">&rarr; ' + esc(eta) + "</span>" : "") + word + "</div>" +
      rowTags(r, [flightToCheck(r) ? '<span class="tag ck">' + (/^Not in the timetable/.test(r.flight_note) ? "CHECK MANUALLY"
        : /over 6 h from the booked time/.test(r.flight_note) && r.return_at ? "CHECK FLIGHT · BOOKED " + esc(hhmm(r.return_at)) : "CHECK FLIGHT NO.") + "</span>" : "",
        over ? '<span class="tag ov">OVERSTAY</span>' : "", cmpl ? '<span class="tag cm">COMPLAINT</span>' : "", chargeTag(r).replace(/^ · /, ""), exitTag(r)]) +
      earlyLine(r) + noteLine(r) + "</div>" +
      (swipeOnly() ? stepStatus(r) : dropButtons(r, overWord, cmpl)) + "</div>";
  }
  function refinedPickRow(r, cls) {
    var who = rfWho(r);
    var tags = (S.ptUnsaved[r.id] && r.pt_at ? '<span class="tag due">PT NOT SAVED</span>' : "") +
      (r.pick_called ? '<span class="rfpc"><span class="tag' + (r.pick_called === "New Booking" ? ' nb">NEW BOOKING' : '">' + esc(r.pick_called.toUpperCase())) + "</span> " + esc(hhmm(r.pick_called_at)) + "</span>" : "");
    return '<div class="row rfr rfp' + cls + (S.pending[r.id] ? " busy" : "") + '" data-id="' + r.id + '">' +
      '<div class="left"><div class="l1"><button type="button" class="reg" data-open>' + esc(r.reg || "NO REG") + "</button>" +
      (r.num ? '<span class="dn num">#' + r.num + "</span>" : "") + "</div>" +
      (who || catTag(r) ? '<div class="l2 rfw" data-open>' + catTag(r) + esc(who) + "</div>" : "") +
      '<div class="l2 rft num" data-open><span class="tm">Drop ' + esc(hhmm(r.drop_at) || "—") + "</span>" + (r.flight ? '<span class="flp">' + esc(r.flight) + "</span>" : "") + "</div>" +
      (tags ? '<div class="l2 l2t" data-open>' + tags + "</div>" : "") + noteLine(r) + "</div>" +
      pickActs(r) + "</div>";
  }

  // Short words on the row, so the customer's name still fits on a phone.
  // DROPS: SAME DAY when the car was met on the sheet's day, NEXT DAY when it
  // was met the day before (one night away).
  function dropCat(r) {
    var sh = sheet();
    if (!sh || sh.kind !== "drops" || !r.drop_at || r.early) return "";
    var d = londonParts(new Date(r.drop_at)).key;
    return d === sh.day ? "same" : d === addDaysKey(sh.day, -1) ? "next" : "";
  }
  // Return moved to a later day in the booking system: the day it was first due back.
  function wasTag(r) {
    if (r.kind !== "drops" || !r.orig_return_at) return "";
    var d = returnDay({ return_at: r.orig_return_at });
    return d ? '<span class="cat was">WAS ' + dayWord(d) + "</span>" : "";
  }
  function catTag(r) { var c = r.kind === "drops" ? dropCat(r) : catOf(r); return c ? '<span class="cat ' + c + '">' + c.toUpperCase() + "</span>" : ""; }
  // Location on PICKS (Clients → Edit, brand.picks_yard): the row's NO SHOW
  // button becomes the car's location (the company's yards); NO SHOW is in
  // the car's panel. Anyone who takes cars in can set it (database part 67).
  function picksYard() { return !!(S.company && S.company.brand && S.company.brand.picks_yard); }
  // Exit fee (Settings, owners only, database part 76): the bookings whose
  // reference starts with a listed start don't pay it. Compared by letters
  // and numbers only, so "Cpd 19660209" starts with CPD.
  function refKey(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function exitFee() { return +(S.company && S.company.exit_fee) || 0; }
  function exitFree(r) {
    var k = refKey(r.ref), list = S.company.exit_free || [];
    return exitFee() > 0 && !!k && list.some(function (x) { return x && k.indexOf(x) === 0; });
  }
  function exitTag(r) {
    if (exitFree(r)) return '<span class="tag pd">NO EXIT FEE</span>';
    return r.exit_method && exitFee() > 0 ? '<span class="tag pd">EXIT ' + money(r.exit_amount) + " " + r.exit_method.toUpperCase() + "</span>" : "";
  }
  // The car's EXIT FEE box (DROPS): paid by cash or card, with a photo of the
  // payment; or what's due, CASH / CARD opening the camera first.
  function exitPanelHtml(r) {
    if (r.kind !== "drops" || !(exitFee() > 0) || exitFree(r)) return "";
    var h = "<label>" + L("EXIT FEE") + "</label>";
    if (r.exit_method) return h + '<div class="chgbox pd exitbox"><b>' + money(r.exit_amount) + " paid by " + esc(r.exit_method) + "</b><span>" +
      esc(byName(r, "exit_by")) + (r.exit_at ? " · " + esc(dayShort(r.exit_at) + " " + hhmm(r.exit_at)) : "") + "</span>" +
      (can("clear") ? '<button type="button" class="link" data-exitundo>Undo</button>' : "") + "</div>" +
      (r.exit_photo ? '<div class="docbox"><a class="docimg" id="exitImg" target="_blank" rel="noopener"><span class="note">Loading photo…</span></a></div>' : '<p class="hint">No photo of the payment.</p>');
    h += '<div class="chgbox exitbox"><b>' + money(exitFee()) + " due</b><span>Take a photo of the payment, then it's marked paid.</span></div>";
    if (!can("clear")) return h;
    return h + '<div class="when2 chgpay exitpay"><button type="button" data-exitshot="cash">📷 CASH</button><button type="button" data-exitshot="card">📷 CARD</button>' +
      '<input type="file" id="exitFile" accept="image/*" capture="environment" data-exitfile hidden></div>' +
      '<button type="button" class="link" data-exitnophoto="cash">Cash, no photo</button> <button type="button" class="link" data-exitnophoto="card">Card, no photo</button>';
  }
  async function markExit(r, method, file) {
    r = S.rows.filter(function (x) { return x.id === r.id; })[0] || r;
    var path = "";
    if (file) {
      toast("Saving the photo…");
      try {
        var small = await bkSmall(file, true);
        path = S.company.id + "/docs/" + r.id + "/x" + Date.now() + ".jpg";
        var up = await sb.storage.from("pt-photos").upload(path, small.blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
      } catch (e) { return toast("The photo didn't save: " + ((e && e.message) || e), true); }
    }
    run("set_exit_paid", { p_booking: r.id, p_method: method, p_photo: path }, r, function (x) {
      x.exit_method = method; x.exit_amount = method ? exitFee() : null; x.exit_at = method ? nowIso() : null; x.exit_by = method ? S.me.id : null; markBy(x, "exit_by"); x.exit_photo = path;
    });
    toast(method ? "Exit fee " + money(exitFee()) + " " + method + " recorded" : "Exit fee cleared");
    if (panelRow && panelRow.id === r.id && $("panel").open) openPanel(r);
  }
  async function fillExit(r) {
    var u = await sb.storage.from("pt-photos").createSignedUrl(r.exit_photo, 3600);
    var a = $("exitImg"); if (!a || !panelRow || panelRow.id !== r.id) return;
    if (u.error || !u.data) { a.innerHTML = '<span class="note">Photo not found.</span>'; return; }
    a.href = u.data.signedUrl; a.innerHTML = '<img alt="Photo of the payment" src="' + esc(u.data.signedUrl) + '">';
  }
  // Collections on the board, shared by every look and gated by saved access.
  // An add-on per client (Parking Ops → Clients → Edit, brand.collections, part 109);
  // inside it, defaults and per-person grants/removals are resolved by my_permissions.
  function collectionsOn() { return !!(can("collections") && S.company && S.company.brand && S.company.brand.collections === true); }
  // Folded to its header line, remembered on this phone.
  var PAY_FOLD_KEY = "takeoff_collections_folded";
  function payFolded() { try { return localStorage.getItem(PAY_FOLD_KEY) === "1"; } catch (e) { return false; } }
  function togglePayFold() {
    try { if (payFolded()) localStorage.removeItem(PAY_FOLD_KEY); else localStorage.setItem(PAY_FOLD_KEY, "1"); } catch (e) {}
    renderBoardPayments();
  }
  // These are the existing
  // payment records: a recorded charge settles it (a smaller payment can be
  // the agreed discount), and a waiver is never counted as cash received.
  function paymentPence(n) { return Math.max(0, Math.round((+n || 0) * 100)); }
  function paymentFacts(r) {
    var fee = paymentPence(exitFee()), due = chargeDue(r), ex, ch;
    if (r.exit_method) ex = { state: "paid", amount: paymentPence(r.exit_amount), paid: paymentPence(r.exit_amount), due: 0, word: "Collected" };
    else if (exitFree(r)) ex = { state: "free", amount: 0, paid: 0, due: 0, word: "Exempt" };
    else ex = { state: fee ? "due" : "free", amount: fee, paid: 0, due: fee, word: fee ? "Due" : "No fee" };
    if (r.charge_method === "waived") ch = { state: "free", amount: paymentPence(r.charge_amount), paid: 0, due: 0, word: "Waived" };
    else if (r.charge_method) ch = { state: "paid", amount: paymentPence(r.charge_amount), paid: paymentPence(r.charge_amount), due: 0, word: "Collected" };
    else { var amount = paymentPence(due && due.amount); ch = { state: amount ? "due" : "free", amount: amount, paid: 0, due: amount, word: amount ? "Due" : "No charge" }; }
    var saving = S.queue.some(function (q) { return q.rowId === r.id && (q.fn === "set_exit_paid" || q.fn === "set_overstay_paid" || q.fn === "set_overstay_agreed"); });
    return { exit: ex, charge: ch, due: ex.due + ch.due, paid: ex.paid + ch.paid, check: ex.state === "paid" && !r.exit_photo, saving: saving };
  }
  function boardPaymentsAvailable() {
    var sh = sheet();
    return !!(collectionsOn() && sh && sh.kind === "drops" && !S.platform && !keyOn() && (exitFee() > 0 || S.rows.some(function (r) { return r.exit_method || r.charge_method || paymentPence((chargeDue(r) || {}).amount) > 0; })));
  }
  function paymentMatches(r, filter) {
    var p = paymentFacts(r);
    return filter === "due" ? p.due > 0 : filter === "paid" ? p.paid > 0 : filter === "check" ? p.check : true;
  }
  var boardPaymentScope = "", boardPaymentId = "";
  function renderBoardPayments() {
    var el = $("boardPayments"); if (!el) return;
    var scope = (S.company && S.company.id || "") + ":" + S.sheetId;
    if (scope !== boardPaymentScope) { boardPaymentScope = scope; S.paymentFilter = ""; }
    var on = boardPaymentsAvailable();
    el.classList.toggle("hidden", !on);
    if (!on) {
      S.paymentFilter = ""; el.innerHTML = "";
      if (boardPaymentId) {
        boardPaymentId = ""; $("panel").classList.remove("payment-sheet"); $("panelBody").innerHTML = "";
        if ($("panel").open) $("panel").close();
      }
      return;
    }
    var base = visibleRows(true), rows = visibleRows(), total = { exit: 0, charge: 0, due: 0, saving: false };
    // Collected counts the whole sheet (a paid car is usually done and off TO DO); Outstanding follows the cars shown.
    S.rows.forEach(function (r) { var p = paymentFacts(r); total.exit += p.exit.paid; total.charge += p.charge.paid; total.saving = total.saving || p.saving; });
    rows.forEach(function (r) { total.due += paymentFacts(r).due; });
    var filters = [["", "All"], ["due", "Outstanding"], ["paid", "Collected"], ["check", "Needs checking"]], folded = payFolded();
    var shown = filters.filter(function (f) { return f[0] && f[0] === S.paymentFilter; })[0];
    el.classList.toggle("folded", folded);
    el.innerHTML = '<button type="button" class="bpay-caption" data-payfold aria-expanded="' + !folded + '"><strong>Collections</strong><span>' +
      (folded ? money(total.due / 100) + " outstanding" + (shown ? " · " + shown[1] + " shown" : "") : rows.length + " bookings shown") + (total.saving ? " · Saving changes…" : "") +
      '<i class="bpay-chev" aria-hidden="true"></i></span></button>' + (folded ? "" : '<div class="bpay-totals">' +
      [["Exit fees collected", total.exit], ["Overstays & charges collected", total.charge], ["Outstanding", total.due]].map(function (v, i) { return '<div><span>' + (i === 1 && isRefined() ? "Overstays" : v[0]) + '</span><b class="num">' + money(v[1] / 100) + "</b></div>"; }).join("") +
      '</div><div class="bpay-filters" role="group" aria-label="Filter collections">' + filters.map(function (f) {
        var count = f[0] ? base.filter(function (r) { return paymentMatches(r, f[0]); }).length : base.length;
        return '<button type="button" data-payfilter="' + f[0] + '" aria-pressed="' + ((S.paymentFilter || "") === f[0]) + '">' + f[1] + ' <b class="num">' + count + "</b></button>";
      }).join("") + "</div>");
  }
  function withBoardPayments(r, html) {
    if (!collectionsOn()) return html;
    var p = paymentFacts(r);
    function label(title, x) { return '<span class="bpay-status ' + x.state + '">' + title + (x.amount ? ' <b class="num">' + money(x.amount / 100) + "</b>" : "") + " · " + x.word + "</span>"; }
    var line = '<button type="button" class="bpay-row" data-paydetails="' + esc(r.id) + '" aria-label="Collection details for ' + esc(r.reg) + '">' + label("Exit", p.exit) + label("Overstay / charge", p.charge) +
      (p.saving ? '<span class="bpay-check">Saving…</span>' : p.check ? '<span class="bpay-check">Needs checking</span>' : "") + '<span class="bpay-arrow" aria-hidden="true">›</span></button>';
    // Keep one outer element per booking for incremental redraws and swipes.
    html = html.replace('class="row', 'class="row with-payments');
    html = html.replace(chargeTag(r).replace(/^ · /, "") || "\u0000", "").replace(exitTag(r) || "\u0000", "").replace(/<div class="l2 l2t" data-open>\s*<\/div>/, "");
    return html.replace(/<\/div>$/, line + "</div>");
  }
  function openBoardPayment(r) {
    if (!boardPaymentsAvailable() || S.switching || !S.company || r.company_id && r.company_id !== S.company.id || r.sheet_id !== S.sheetId || r.kind !== "drops") return;
    var p = paymentFacts(r);
    boardPaymentId = r.id; panelRow = null;
    $("panel").classList.remove("ops-car"); $("panel").classList.add("payment-sheet");
    function detail(label, value) { return '<div class="bpay-kv"><dt>' + label + '</dt><dd>' + esc(value || "—") + "</dd></div>"; }
    function record(title, x, method, who, at, reason) {
      return '<section class="bpay-record"><div class="bpay-record-head"><h3>' + title + '</h3><b class="num">' + money(x.amount / 100) + '</b><span class="bpay-status ' + x.state + '">' + x.word + '</span></div><dl>' +
        (method ? detail("Payment method", method === "waived" ? "Waived" : sentence(method)) + detail(method === "waived" ? "Recorded by" : "Collected by", byName(r, who)) + detail("Recorded", at ? dayShort(at) + " · " + hhmm(at) : "") : "") +
        (reason ? detail("Reason", reason) : "") + "</dl></section>";
    }
    $("panelBody").innerHTML = '<div class="bpay-sheet"><div class="bpay-title"><div><span>Collection details</span><h2 id="panelTitle">' + esc(r.reg || "No registration") + '</h2><p>' + esc([niceMake(r.make || ""), r.ref].filter(Boolean).join(" · ")) + '</p></div><button type="button" data-close aria-label="Close collection details">×</button></div>' +
      '<div class="bpay-balance' + (p.due ? " due" : "") + '">' + (p.due ? money(p.due / 100) + " outstanding" : "No outstanding balance") + '</div><div class="bpay-summary"><span>Collected <b class="num">' + money(p.paid / 100) + '</b></span><span>Outstanding <b class="num">' + money(p.due / 100) + "</b></span></div>" +
      (p.saving ? '<p class="bpay-note" role="status">Payment changes are waiting to save.</p>' : "") +
      record("Exit fee", p.exit, r.exit_method, "exit_by", r.exit_at, "") +
      (p.exit.state === "paid" ? '<div class="bpay-proof" id="boardPayProof">' + (r.exit_photo ? 'Loading payment proof…' : '<span class="bpay-check">Needs checking · no payment photo recorded</span>') + "</div>" : "") +
      record("Overstay / additional charge", p.charge, r.charge_method, "charge_by", r.charge_at, r.charge_reason) +
      '<div class="bpay-footer"><button type="button" data-paybooking="' + esc(r.id) + '">Open booking</button><button type="button" data-close>Back to board</button></div></div>';
    if (!$("panel").open) $("panel").showModal();
    if (r.exit_photo && p.exit.state === "paid") fillBoardPaymentProof(r);
  }
  async function fillBoardPaymentProof(r) {
    var company = S.company && S.company.id, path = r.exit_photo, el = $("boardPayProof");
    if (!collectionsOn() || S.switching || !el || boardPaymentId !== r.id) return;
    if (!path || path.indexOf(company + "/") !== 0) { el.textContent = "Payment proof unavailable."; return; }
    el.textContent = "Loading payment proof…";
    var result;
    try { result = await sb.storage.from("pt-photos").createSignedUrl(path, 3600); } catch (err) { result = { error: err }; }
    el = $("boardPayProof");
    var current = S.rows.find(function (x) { return x.id === r.id; });
    if (!collectionsOn() || S.switching || !el || !$("panel").open || boardPaymentId !== r.id || !S.company || S.company.id !== company || !current || current.exit_photo !== path) return;
    if (result.error || !result.data || !result.data.signedUrl) { el.innerHTML = 'Payment proof unavailable. <button type="button" data-payproof="' + esc(r.id) + '">Try again</button>'; return; }
    el.innerHTML = '<a href="' + esc(result.data.signedUrl) + '" target="_blank" rel="noopener">View payment proof ›</a>';
  }
  function pickYardBtn(r) {
    var on = !!r.yard, lab = on ? esc(YARD_LABEL[r.yard] || r.yard) : isRefined() && !opsDesk() ? "Yard" : "YARD";
    if (!can("intake")) return '<button type="button" class="pyard' + (on ? " on y-" + esc(r.yard) : "") + '" disabled>' + lab + "</button>";
    return '<label class="pyard' + (on ? " on y-" + esc(r.yard) : "") + '"><span>' + lab + '</span><select data-yard aria-label="Location of ' + esc(r.reg) + '"><option value="">' + (on ? "— none" : "Choose") + "</option>" +
      (S.company.yards || []).map(function (y) { return "<option" + (y === r.yard ? " selected" : "") + ' value="' + esc(y) + '">' + esc(YARD_LABEL[y] || y) + "</option>"; }).join("") + "</select></label>";
  }
  function pickRow(r) {
    var bang = /^!/.test(r.note);
    var cls = r.intake === "Collected" ? " coll" : r.intake === "No Show" ? " nosh" : r.intake === "RTC" ? " rtc" : bang ? " cmpl" : "";
    if (opsDesk()) return opsDeskPickRow(r, cls);
    if (isRefined()) return refinedPickRow(r, cls);
    return '<div class="row' + cls + (S.pending[r.id] ? " busy" : "") + '" data-id="' + r.id + '">' +
      '<div class="rt" data-open><b class="num">' + esc(hhmm(r.drop_at) || "—") + "</b><small>Drop-off</small></div>" +
      (isBoard() ? pickLinesBoard(r) :
      '<div class="left"><div class="l1"><button type="button" class="reg" data-open>' + esc(r.reg || "NO REG") + "</button>" +
      (r.num ? '<span class="dn num">#' + r.num + "</span>" : "") + catTag(r) + '<span class="pin">' + esc(nice(r.name)) + "</span></div>" +
      // Just the make on the row; the full car and booking ref are in the car's panel.
      '<div class="l2 num" data-open><span class="l2a">' + (makeOnly(r.make) ? '<span class="mk">' + esc(niceMake(makeOnly(r.make))) + "</span>" : "") + '<span class="dp">' + (makeOnly(r.make) ? " · " : "") + "drop " + esc(hhmm(r.drop_at) || "—") + "</span>" + pickFlight(r) + (S.ptUnsaved[r.id] && r.pt_at ? ' · <span class="tag due">PT NOT SAVED</span>' : "") + (r.pick_called ? ' · <span class="tag' + (r.pick_called === "New Booking" ? ' nb">NEW BOOKING' : '">' + esc(r.pick_called)) + "</span> " + esc(hhmm(r.pick_called_at)) : "") + "</span></div>" +
      noteLine(r) + "</div>") +
      pickActs(r) + "</div>";
  }
  // COLL, NO SHOW (or the car's location), RTC and PT: the same buttons on every layout.
  function pickActs(r) {
    function b(v, c, label, perm) { return actBtn(r, 'data-pick="' + v + '"', c, label, r.intake === v, r.intake_at, can("intake") && (!perm || can(perm)), byName(r, "intake_by")); }
    return '<div class="acts">' + b("Collected", "k", "COLL") + (picksYard() ? pickYardBtn(r) : b("No Show", "n", "NO SHOW")) + b("RTC", "r", "RTC", "rtc") +
      actBtn(r, "data-pt", "p", "PT", !!r.pt_at, r.pt_at, can("intake"), byName(r, "pt_by")) + "</div>";
  }

  // The return flight the customer gave at drop-off (typed in the car), after the drop time.
  function pickFlight(r) { return r.flight ? ' · <span class="pfl">' + esc(r.flight) + "</span>" : ""; }
  function canPickFlight() { return can("intake") || can("flights"); }

  // Premium Board's two-line pick row, like the old board: plate, number, tag and name, then car and drop time.
  function pickLinesBoard(r) {
    var mk = makeOnly(r.make) ? '<span class="mk">' + esc(niceMake(makeOnly(r.make))) + "</span>" : "";
    var extra = (S.ptUnsaved[r.id] && r.pt_at ? ' <span class="tag due">PT NOT SAVED</span>' : "") +
      (r.pick_called ? ' · <span class="tag' + (r.pick_called === "New Booking" ? ' nb">NEW BOOKING' : '">' + esc(r.pick_called)) + "</span> " + esc(hhmm(r.pick_called_at)) : "");
    return '<div class="left"><div class="l1"><button type="button" class="reg" data-open>' + esc(r.reg || "NO REG") + "</button>" +
      (r.num ? '<span class="dn num">#' + r.num + "</span>" : "") + catTag(r) + '<span class="pin">' + esc(nice(r.name)) + "</span></div>" +
      '<div class="l2 cl2 num" data-open><span class="l2a">' + (mk ? mk + " · " : "") + "drop " + esc(hhmm(r.drop_at) || "—") + pickFlight(r) + extra + "</span></div>" + noteLine(r) + "</div>";
  }

  function sheetDayOf(r) { var sh = S.sheets.filter(function (x) { return x.id === r.sheet_id; })[0]; return sh ? sh.day : ""; }
  function rowOf(el) { var c = el.closest("[data-id]"); return c ? S.rows.filter(function (r) { return r.id === c.dataset.id; })[0] : null; }
  function nowIso() { return new Date().toISOString(); }

  // The customer is at the desk (part 112): only on a CALLED car, never OVERSTAY.
  function atDesk(r) { return !!(r.desk_at && r.called_at && r.called_word !== "Overstay"); }
  // The row's CALLED button: CALLED, then AT DESK, then back to CALLED. Taking
  // CALLED off altogether is in the car's panel. OVERSTAY taps off as before.
  // The row's CALLED button: whoever can press CALLED, or (AT DESK permission, part 115)
  // on a car that is not OVERSTAY and not SENT or CLEAR yet: the tap is AT DESK, which
  // calls a car not called yet. A car already at the desk can always be taken off.
  function canCalledTap(r) { return can("called") || (can("desk") && r.called_word !== "Overstay" && (atDesk(r) || (!r.sent_at && !r.cleared_at))); }
  function tapCalled(r) {
    if (atDesk(r)) return tapDrop(r, "desk");
    if (r.called_at && r.called_word !== "Overstay") return tapDrop(r, "desk");
    if (!can("called")) return tapDrop(r, "desk");   // AT DESK only (part 115): straight to the desk, which calls it too
    return tapDrop(r, "called");
  }
  function tapDrop(r, action, word) {
    var field = { sent: "sent_at", called: "called_at", clear: "cleared_at", desk: "desk_at" }[action];
    var on = word ? !(r[field] && (action === "called" ? r.called_word : r.clear_word) === word) : !r[field];
    run("tap_drop", { p_booking: r.id, p_action: action, p_on: on, p_word: word || "" }, r, function (x) {
      if (action === "sent") {
        if (on) { x.yard_before_t = x.yard; x.yard = "T"; x.sent_at = nowIso(); x.sent_by = S.me.id; }
        else { if (x.yard === "T" && x.yard_before_t) x.yard = x.yard_before_t; x.yard_before_t = ""; x.sent_at = null; x.sent_by = null; }
        markBy(x, "sent_by");
      } else if (action === "called") {
        // OVERSTAY taken off a car due back on this sheet was a mis-tap (part 95).
        if (!on && x.called_word === "Overstay" && !x.early && returnDay(x) && returnDay(x) >= sheetDayOf(x)) x.overstay = false;
        x.called_word = on ? (word || "Called") : ""; x.called_at = on ? nowIso() : null; x.called_by = on ? S.me.id : null; markBy(x, "called_by");
        if (on && word === "Overstay") x.overstay = true;
        if (!on || word === "Overstay") { x.desk_at = null; x.desk_by = null; markBy(x, "desk_by"); }
      } else if (action === "desk") {
        // AT DESK (part 112): the customer is at the desk; a car not called yet is called too.
        if (on && !x.called_at) { x.called_word = "Called"; x.called_at = nowIso(); x.called_by = S.me.id; markBy(x, "called_by"); }
        if (!on || !x.desk_at) { x.desk_at = on ? nowIso() : null; x.desk_by = on ? S.me.id : null; markBy(x, "desk_by"); }
      } else {
        x.clear_word = on ? (word || "Collected") : ""; x.cleared_at = on ? nowIso() : null; x.cleared_by = on ? S.me.id : null; markBy(x, "cleared_by");
      }
    });
    // CALLED on a car booked back on a later day: they're coming back early,
    // so offer to move it onto tonight's sheet there and then.
    if (action === "called" && on && !word && canEarly(r)) {
      var sh = S.sheets.filter(function (x) { return x.id === r.sheet_id; })[0];
      setTimeout(function () {
        if (confirm((r.reg || "This car") + " is booked back " + sheetLabel(sh) + ". Coming back early?\n\nOK moves it to tonight's sheet (" + sheetLabel({ kind: "drops", day: currentShiftKey() }) + ")."))
          earlyMove(r, { disabled: false }, false, true);
      }, 50);
    }
  }
  // PT: photos taken in the app's camera (quickest) or picked from the gallery.
  // Ways to get them to PT, chosen in Settings: companies.pt_method on Android
  // phones and computers, pt_method_ios on iPhones (part 49); ptMethod():
  //   photos  the reg goes to the PT WhatsApp chat, then the photos in albums
  //           (10 at a time on Android). Kept on the phone until all are sent,
  //           so a reload while WhatsApp is open carries on where it left off.
  //   link    they upload in the background as they come in, then WhatsApp
  //           opens once with the reg and a link to every photo (part 25).
  // 2400 px at 85% is about a third of a full camera photo to upload, and
  // still sharper than WhatsApp's own HD.
  var pt = null, PT_MAX = 2400, PT_Q = 0.85, PT_AT_ONCE = 4;
  function ptMethod() { var c = S.company || {}; return (IS_IOS && c.pt_method_ios) || c.pt_method || "photos"; }
  function ptCaption(r) { return r.reg || "NO REG"; }
  function ptToken() {
    var b = new Uint8Array(18); crypto.getRandomValues(b);
    return btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function ptLink() { return location.origin + "/p/" + pt.token; }
  function ptMessage(r) { var n = ptCount("done"); return ptCaption(r) + " – " + n + " PT photo" + (n === 1 ? "" : "s") + ": " + ptLink(); }
  function ptCount(state) { return pt ? pt.items.filter(function (x) { return !state || x.state === state; }).length : 0; }
  function openPt(r) {
    if (!pt || pt.id !== r.id) { ptClear(); pt = { id: r.id, reg: ptCaption(r), mode: ptMethod() === "link" ? "link" : "photos", token: ptToken(), items: [], saved: 0, sent: 0 }; }
    panelRow = r;
    if (pt.mode === "photos") return openPtPhotos(r);
    var num = (S.company && S.company.pt_whatsapp) || "", n = pt.items.length, ready = ptReady();
    var pick = '<input type="file" accept="image/*" multiple data-ptfile hidden>';
    $("panelBody").innerHTML = '<h2 id="panelTitle">PT · ' + esc(r.reg || "NO REG") + (r.num ? " <small>#" + r.num + "</small>" : "") + "</h2>" +
      '<button type="button" class="btn ' + (n ? "ghost" : "brand") + ' ptgo" data-ptcam>' + (n ? "+ TAKE MORE" : "TAKE PHOTOS") + "</button>" +
      '<label class="btn ghost ptpick">' + pick + (n ? "+ Add from gallery" : "Choose from gallery") + "</label>" +
      (n ? '<div class="ptthumbs" id="ptThumbs">' + pt.items.map(function (x, i) { return ptImg(x, ' data-pti="' + i + '" class="' + x.state + '"'); }).join("") + "</div>" : "") +
      '<p class="hint" id="ptStatus">' + ptStatusText() + "</p>" +
      (ready ? (num
          ? '<a class="btn brand ptgo" href="https://wa.me/' + esc(num) + "?text=" + encodeURIComponent(ptMessage(r)) + '" target="_blank" rel="noopener" data-ptlink>SEND TO PT ON WHATSAPP</a>'
          : '<button type="button" class="btn brand ptgo" data-ptlinkshare>SEND TO PT ON WHATSAPP</button>')
        : n ? '<button type="button" class="btn brand ptgo" disabled data-keepoff>' + (ptCount("fail") ? "Some photos didn't upload" : pt.saveFail ? "Link not saved yet" : "Uploading…") + "</button>" : "") +
      ((ptCount("fail") || pt.saveFail) && !ptCount("wait") && !ptCount("up") ? '<button type="button" class="btn ghost ptgo" data-ptretry>Try again' + (ptCount("fail") ? " (" + ptCount("fail") + ")" : "") + "</button>" : "") +
      '<div class="pbtns"><button type="button" data-close>Close</button>' + (n ? '<button type="button" data-ptclear>Start again</button>' : "") + "</div>" +
      '<button type="button" class="link" data-ptmark>Tick PT without sending photos</button>';
    if (!$("panel").open) $("panel").showModal();
  }
  function ptReady() { return !!pt && pt.items.length > 0 && ptCount("done") === pt.items.length && pt.saved === pt.items.length; }
  function ptStatusText() {
    if (!pt || !pt.items.length) return "";
    var n = pt.items.length, d = ptCount("done"), f = ptCount("fail");
    if (ptReady()) return "✓ " + n + " photo" + (n === 1 ? "" : "s") + " uploaded. Tap Send, then Send again in WhatsApp.";
    if (f && d + f === n) return d + " of " + n + " uploaded. " + f + " didn't upload: check the signal and try again.";
    if (pt.saveFail && d === n) return "✓ All " + n + " photos are up, but the link didn't save. Trying again… or tap Try again.";
    return "Uploading " + (d + 1 > n ? n : d + 1) + " of " + n + "… keep this screen open.";
  }
  // Update the thumbnails and the button in place while uploading, or redraw
  // the panel once everything's in.
  function ptRefresh() {
    var cc = $("camCount"); if (cc) { cc.textContent = camCountText(); return; }
    if (pt && pt.mode === "photos") { if ($("panel").open && panelRow && panelRow.id === pt.id) openPt(panelRow); return; }
    if (!pt || !$("panel").open || !panelRow || panelRow.id !== pt.id) return;
    if (ptReady() || (!ptCount("wait") && !ptCount("up"))) return openPt(panelRow);
    pt.items.forEach(function (x, i) { var im = $("panelBody").querySelector('[data-pti="' + i + '"]'); if (im) im.className = x.state; });
    var s = $("ptStatus"); if (s) s.textContent = ptStatusText();
  }
  function ptAdd(input) {
    var r = panelRow; if (!pt || !r) return;
    Array.prototype.forEach.call(input.files || [], function (f) {
      pt.items.push({ file: f, url: "", state: pt.mode === "photos" ? "prep" : "wait", n: pt.items.length + 1 });
    });
    input.value = "";
    openPt(r); ptPump(r);
  }
  // A canvas as a JPEG. On some Android phones toBlob's answer never comes
  // after the camera's been open (PT stuck on "Making the PDF…" or "Saving…"
  // until the app is switched away and back, 10 Oct). So it gets a few
  // seconds, then the picture is copied the plain way (toDataURL), which
  // always finishes; and for the next minute the plain way is used at once.
  var BLOB_WAIT = 4000, blobStuckAt = 0;
  function jpegOf(c, q) {
    if (Date.now() - blobStuckAt < 60000) return Promise.resolve(jpegPlain(c, q));
    return new Promise(function (ok) {
      var done = false, t = setTimeout(function () {
        if (done) return; done = true; blobStuckAt = Date.now(); ok(jpegPlain(c, q));
      }, BLOB_WAIT);
      try { c.toBlob(function (b) { if (done) return; done = true; clearTimeout(t); ok(b || jpegPlain(c, q)); }, "image/jpeg", q); }
      catch (e) { done = true; clearTimeout(t); ok(jpegPlain(c, q)); }
    });
  }
  function jpegPlain(c, q) {
    try {
      var s = atob(c.toDataURL("image/jpeg", q).split(",")[1]), a = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
      return a.length ? new Blob([a], { type: "image/jpeg" }) : null;
    } catch (e) { return null; }
  }
  // A promise that gives up after ms (the same Android stall can catch
  // createImageBitmap), so the caller's own fallback takes over.
  function inTime(p, ms) {
    var late = false;
    p.then(function (x) { if (late && x && x.close) x.close(); }, function () {});   // a picture that turns up too late is let go
    return Promise.race([p, new Promise(function (ok, no) { setTimeout(function () { late = true; no(new Error("took too long")); }, ms); })]);
  }
  // Full camera photos are 4-8 MB; 3000 px is sharper than anyone zooms into
  // and a lot quicker to upload on mobile data.
  // Gallery photos: made upload size and stamped with when they were taken.
  async function ptShrink(b, reg) {
    try {
      var when = await ptTakenAt(b);
      var im = await inTime(createImageBitmap(b), 8000), k = Math.min(1, PT_MAX / Math.max(im.width, im.height));
      var c = ptCanvas(im, Math.round(im.width * k), Math.round(im.height * k), when, reg); if (im.close) im.close();
      return (await jpegOf(c, PT_Q)) || b;
    } catch (e) { return b; }
  }
  // Date, time and reg burnt into the bottom corner of the photo, so it stays
  // with the photo in WhatsApp, downloads and the app's copy.
  function ptStampText(when, reg) {
    var t = new Date(when).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");
    return t + (reg ? " · " + reg : "");
  }
  // The photo on a canvas with a black bar UNDER it holding the date, time
  // and reg, so the stamp never covers any of the car.
  function ptBar(w) { return Math.max(28, Math.round(w * 0.032)); }
  function ptCanvas(src, w, h, when, reg) {
    var bar = ptBar(w), c = document.createElement("canvas"); c.width = w; c.height = h + bar;
    var g = c.getContext("2d"); g.drawImage(src, 0, 0, w, h);
    try {
      g.fillStyle = "#000"; g.fillRect(0, h, w, bar);
      var size = Math.round(bar * 0.6);
      g.font = "700 " + size + "px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
      g.fillStyle = "#fff"; g.textBaseline = "middle"; g.fillText(ptStampText(when, reg), Math.round(bar * 0.4), h + bar / 2);
    } catch (e) {}
    return c;
  }
  // When a gallery photo was taken: the camera's own date in the photo (EXIF
  // DateTimeOriginal, UK local time); failing that, the file's date.
  async function ptTakenAt(f) {
    var fallback = f.lastModified || Date.now();
    try {
      if (!/jpe?g/i.test(f.type || f.name || "")) return fallback;
      var v = new DataView(await f.slice(0, 131072).arrayBuffer());
      if (v.getUint16(0) !== 0xFFD8) return fallback;
      for (var o = 2; o + 4 < v.byteLength;) {
        var mk = v.getUint16(o), len = v.getUint16(o + 2);
        if (mk === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return ptExifDate(v, o + 10) || fallback;
        if ((mk & 0xFF00) !== 0xFF00) break;
        o += 2 + len;
      }
    } catch (e) {}
    return fallback;
  }
  function ptExifDate(v, t) {
    var le = v.getUint16(t) === 0x4949, u16 = function (p) { return v.getUint16(p, le); }, u32 = function (p) { return v.getUint32(p, le); };
    function find(ifd, tag) { var n = u16(ifd); for (var i = 0; i < n; i++) { var e = ifd + 2 + i * 12; if (u16(e) === tag) return e; } return 0; }
    var ifd0 = t + u32(t + 4), ex = find(ifd0, 0x8769), e = ex ? find(t + u32(ex + 8), 0x9003) : 0;
    if (!e) e = find(ifd0, 0x0132);
    if (!e) return 0;
    var at = t + u32(e + 8), str = "";
    for (var i = 0; i < 19; i++) str += String.fromCharCode(v.getUint8(at + i));
    var m = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/); if (!m) return 0;
    // The camera's clock is UK local time: find the moment that shows that in London.
    var guess = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    var shown = new Date(guess).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false });
    var off = (+shown % 24 - +m[4] + 24) % 24; if (off > 12) off -= 24;
    return guess - off * 3600000;
  }
  function ptPump(r) {
    var cur = pt; if (!cur) return;
    if (cur.mode === "photos") return ptPrep(r, cur);
    while (ptCount("up") < PT_AT_ONCE) {
      var x = cur.items.filter(function (y) { return y.state === "wait"; })[0]; if (!x) break;
      x.state = "up"; ptUpload(r, cur, x);
    }
    // The link is saved once shooting's finished (Done), not after every photo.
    if (!camStream && !ptCount("wait") && !ptCount("up") && ptCount("done") > cur.saved) ptSave(r, cur);
  }
  async function ptUpload(r, cur, x) {
    try {
      var b = x.ready ? x.file : await ptShrink(x.file, cur.reg);
      if (!x.url) { x.url = await ptThumbOf(b); var im0 = $("panelBody").querySelector('[data-pti="' + (x.n - 1) + '"]'); if (im0 && x.url) im0.src = x.url; }
      var ext = b.type === "image/png" ? "png" : b.type === "image/jpeg" ? "jpg" : (x.file.name.split(".").pop() || "jpg").toLowerCase();
      x.path = S.me.company_id + "/" + r.id + "/" + cur.token + "/" + String(x.n).padStart(2, "0") + "." + ext;
      var up = await sb.storage.from("pt-photos").upload(x.path, b, { contentType: b.type || "image/jpeg" });
      // "Already exists" on a retry means the first try got there after all.
      x.state = !up.error || /exist|duplicate/i.test(up.error.message || "") ? "done" : "fail";
      if (x.state === "fail") x.err = up.error.message;
    } catch (e) { x.state = "fail"; x.err = e.message; }
    if (pt !== cur) return;
    ptRefresh(); ptPump(r);
  }
  async function ptSave(r, cur) {
    if (cur.saving) return;
    cur.saving = true;
    var paths = cur.items.filter(function (x) { return x.state === "done"; }).map(function (x) { return x.path; });
    var res; try { res = await sb.rpc("pt_link_save", { p_token: cur.token, p_booking: r.id, p_paths: paths }); } catch (e) { res = { error: e }; }
    cur.saving = false;
    if (pt !== cur) return;
    if (res.error) {
      cur.saveFail = true;
      toast("Couldn't save the link yet: " + (isDown(res) ? "no signal or the server is busy." : res.error.message), true);
      setTimeout(function () { if (pt === cur && cur.saveFail) { cur.saveFail = false; ptSave(r, cur); } }, 8000);
      return ptRefresh();   // redraws only if this car's PT screen is open
    }
    cur.saveFail = false;
    cur.saved = paths.length;
    if (ptCount("fail")) { var f = cur.items.filter(function (x) { return x.state === "fail"; })[0]; if (f && f.err) toast("Upload failed: " + f.err, true); }
    ptRefresh();
  }
  // In-app camera for speed: one tap per photo, as fast as you like, and each
  // photo starts uploading straight away while you take the next.
  // If the phone refuses (no permission, old browser) the PT screen is there
  // to choose photos from the gallery instead.
  var camStream = null, camTorch = false;
  function camLight(on) {
    var track = camStream && camStream.getVideoTracks()[0]; if (!track) return Promise.resolve();
    return track.applyConstraints({ advanced: [{ torch: on }] });
  }
  async function camToggleTorch() {
    var want = !camTorch;
    try { await camLight(want); camTorch = want; }
    catch (e) { return toast("This phone won't let the app use its light.", true); }
    var b = $("camTorch"); if (b) { b.textContent = "⚡ FLASH " + (camTorch ? "ON" : "OFF"); b.classList.toggle("on", camTorch); b.setAttribute("aria-pressed", camTorch); }
  }
  // iPhones ask for camera permission every time the camera is started again,
  // so there the camera is parked (kept running, off screen) for a few minutes
  // after Done and picked up again by the next PT: one question, not one per car.
  var IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var camParked = null, camParkTimer = null, CAM_PARK_MS = 5 * 60000;
  function camLive(st) { return !!st && st.getVideoTracks().some(function (t) { return t.readyState === "live"; }); }
  function camUnpark() {
    clearTimeout(camParkTimer);
    if (camParked) camParked.getTracks().forEach(function (t) { t.stop(); });
    camParked = null;
  }
  async function ptCamera(r) {
    try {
      if (camLive(camParked)) { clearTimeout(camParkTimer); camStream = camParked; camParked = null; }
      else {
        camUnpark();
        camStream = await camOpen(camLensPick());
      }
    } catch (e) {
      toast(e && e.name === "NotAllowedError"
        ? (IS_IOS ? "Camera not allowed. Tap Allow when asked, or in Safari tap aA › Website Settings › Camera › Allow." : "Camera not allowed. Allow it in the browser's site settings, or choose photos from the gallery.")
        : "The camera wouldn't start. Choose photos from the gallery instead.", true);
      return;
    }
    $("panel").classList.add("cam");
    $("panelBody").innerHTML = '<div class="camview"><video id="camVideo" autoplay playsinline muted></video><div class="camflash" id="camFlash"></div><div class="camring" id="camRing"></div><button type="button" class="camtorch hidden" id="camTorch" data-camtorch aria-pressed="false">⚡ FLASH OFF</button><button type="button" class="camtorch camlens hidden" id="camLens" data-camlens>LENS</button>' + camTipsHtml() + "</div>" +
      '<div class="cambar"><span class="camcount" id="camCount">' + camCountText() + '</span><button type="button" class="shutter" data-shutter aria-label="Take photo"></button><button type="button" class="camdone" data-camdone>Done</button></div>';
    $("camVideo").srcObject = camStream;
    // Keep the picture sharp as the phone moves round the car.
    var track = camStream.getVideoTracks()[0], caps = track && track.getCapabilities ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.indexOf("continuous") !== -1) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(function () {});
    // Some phones open the back camera zoomed out (0.5x, the ultra-wide):
    // start at 1x, like the phone's own camera.
    if (caps.zoom && caps.zoom.min < 1 && caps.zoom.max >= 1) track.applyConstraints({ advanced: [{ zoom: 1 }] }).catch(function () {});
    // The phone's light, for dark corners of the terminal. Stays on while shooting.
    camTorch = false;
    if (caps.torch) show("camTorch", true);
    camLensButton(track);
  }
  // ── PT checklist on the camera screen ──
  // A reminder of how to photograph so small marks show (a chip low on a
  // door was lost in reflections, 28 Sept). ✕ folds it to a small button;
  // the phone remembers.
  var CAM_TIPS_KEY = "takeoff-cam-tips";
  var CAM_TIPS = [
    "Every side, front and back, and all 4 corners",
    "Crouch to door height for each side",
    "Step to one side so lights don't shine off the paint",
    "Close-up of every mark, however small",
    "Wheels, bumpers and mirrors",
  ];
  function camTipsOpen() { try { return localStorage.getItem(CAM_TIPS_KEY) !== "off"; } catch (e) { return true; } }
  function camTipsHtml() {
    if (!camTipsOpen()) return '<button type="button" class="camtipsbtn" data-camtips="on">✓ CHECKLIST</button>';
    return '<div class="camtips" id="camTips"><button type="button" class="camtipsx" data-camtips="off" aria-label="Hide the checklist">✕</button>' +
      "<b>PT checklist</b><ol>" + CAM_TIPS.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ol></div>";
  }
  function camTipsSet(on) {
    try { localStorage.setItem(CAM_TIPS_KEY, on ? "on" : "off"); } catch (e) {}
    var old = document.querySelector(".camtips, .camtipsbtn"); if (!old) return;
    var d = document.createElement("div"); d.innerHTML = camTipsHtml(); old.replaceWith(d.firstChild);
  }
  // ── Which back lens ──
  // A browser asking for "the back camera" can be given any of a phone's back
  // lenses, often the ultra-wide (a wide, bent picture). The main lens is
  // picked by name where the phone gives one, and LENS switches between the
  // back lenses; the choice is remembered on the phone.
  var CAM_LENS_KEY = "takeoff-cam-lens", camLenses = [];
  function camOpen(deviceId) {
    var v = { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } };
    if (deviceId) v.deviceId = { exact: deviceId }; else v.facingMode = { ideal: "environment" };
    return navigator.mediaDevices.getUserMedia({ audio: false, video: v }).catch(function (e) {
      if (!deviceId || e.name === "NotAllowedError") throw e;
      try { localStorage.removeItem(CAM_LENS_KEY); } catch (x) {}
      return camOpen("");
    });
  }
  function camLensPick() { try { return localStorage.getItem(CAM_LENS_KEY) || ""; } catch (e) { return ""; } }
  // Main lens first: not ultra-wide / tele / macro / depth; then the lowest
  // Android number ("camera2 0, facing back" is the main one on most phones).
  function camLensRank(d) {
    var l = d.label || "", n = +((l.match(/camera2?\s*(\d+)/i) || [])[1] || 50);
    return (/ultra|tele|macro|depth|dual|triple/i.test(l) ? 100 : 0) + n;
  }
  async function camLensButton(track) {
    try {
      var all = await navigator.mediaDevices.enumerateDevices();
      camLenses = all.filter(function (d) { return d.kind === "videoinput" && /back|rear|environment/i.test(d.label || ""); })
        .sort(function (a, b) { return camLensRank(a) - camLensRank(b); });
      if (camLenses.length < 2 || !camStream) return;
      var now = (track.getSettings ? track.getSettings().deviceId : "") || "";
      // First time on this phone: if the browser gave a lens other than the
      // main one, switch to the main one.
      if (!camLensPick() && now && camLenses[0].deviceId && now !== camLenses[0].deviceId) return camLensSet(camLenses[0].deviceId);
      var b = $("camLens"); if (!b) return;
      var i = camLenses.findIndex(function (d) { return d.deviceId === now; });
      b.textContent = "LENS " + (i + 1 > 0 ? i + 1 : 1) + "/" + camLenses.length;
      b.classList.remove("hidden");
    } catch (e) {}
  }
  async function camLensNext() {
    if (camLenses.length < 2 || !camStream) return;
    var track = camStream.getVideoTracks()[0], now = track && track.getSettings ? track.getSettings().deviceId : "";
    var i = camLenses.findIndex(function (d) { return d.deviceId === now; });
    camLensSet(camLenses[(i + 1) % camLenses.length].deviceId);
  }
  async function camLensSet(id) {
    try { localStorage.setItem(CAM_LENS_KEY, id); } catch (e) {}
    var r = panelRow; if (!r || !camStream) return;
    if (camTorch) await camLight(false).catch(function () {});
    camStream.getTracks().forEach(function (t) { t.stop(); });
    camStream = null;
    ptCamera(r);
  }
  // Tap the picture to focus on that spot (where the phone allows it).
  function camFocus(e) {
    var v = $("camVideo"), track = camStream && camStream.getVideoTracks()[0]; if (!v || !track) return;
    var caps = track.getCapabilities ? track.getCapabilities() : {}; if (!caps.pointsOfInterest && !caps.focusMode) return;
    var b = v.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    var c = { pointsOfInterest: [{ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }] };
    if (caps.focusMode && caps.focusMode.indexOf("continuous") !== -1) c.focusMode = "continuous";
    track.applyConstraints({ advanced: [c] }).catch(function () {});
    var ring = $("camRing"); if (ring) { ring.style.left = (e.clientX - b.left) + "px"; ring.style.top = (e.clientY - b.top) + "px"; ring.classList.remove("go"); void ring.offsetWidth; ring.classList.add("go"); }
  }
  $("panel").addEventListener("pointerdown", function (e) { if (e.target && e.target.id === "camVideo") camFocus(e); });
  function camCountText() {
    var n = pt ? pt.items.length : 0, d = ptCount("done");
    return n + " photo" + (n === 1 ? "" : "s") + (n && pt.mode === "link" ? " · " + d + " uploaded" : "");
  }
  function camStop() {
    var cur = camStream ? pt : null;
    // However the camera was closed (Done, Back, a tap outside), what was shot
    // carries on: the link (or the app's copy) is saved once shooting stops.
    if (cur) setTimeout(function () {
      if (pt !== cur) return;
      var row = S.rows.filter(function (x) { return x.id === cur.id; })[0] || { id: cur.id, reg: cur.reg };
      if (cur.mode === "photos") ptStore();
      ptPump(row);
    }, 0);
    if (camStream) {
      if (camTorch) camLight(false).catch(function () {});
      if (IS_IOS && camLive(camStream)) { camParked = camStream; clearTimeout(camParkTimer); camParkTimer = setTimeout(camUnpark, CAM_PARK_MS); }
      else camStream.getTracks().forEach(function (t) { t.stop(); });
    }
    camStream = null; camTorch = false; $("panel").classList.remove("cam");
  }
  // The picture on screen, saved at upload size in one go (no second squeeze).
  // Tapping the button shakes the phone, and a single frame of video caught
  // mid-shake is blurred. So each tap takes a few frames over about a quarter
  // of a second and keeps the sharpest. Taps queue up, one photo each, and
  // Done waits for the last one.
  var camShots = Promise.resolve(), CAM_BURST = 4, CAM_GAP = 50;
  function ptShoot(r) {
    var v = $("camVideo"); if (!v || !v.videoWidth || !pt) return;
    var f = $("camFlash"); if (f) { f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); }
    var cur = pt, when = Date.now();
    camShots = camShots.then(function () { return ptGrab(r, cur, when); }).catch(function (e) { oopsLog(e); });
  }
  async function ptGrab(r, cur, when) {
    var v = $("camVideo"); if (!v || !v.videoWidth || pt !== cur) return;
    var best = await camStill(v), bestScore = best ? Infinity : -1;
    for (var i = 0; i < CAM_BURST && bestScore !== Infinity; i++) {
      if (i) await new Promise(function (ok) { setTimeout(ok, CAM_GAP); });
      if (!v.videoWidth) break;
      var fr = null;
      // Copied at upload size: a full 4K frame is 33 MB of memory, a 2400 px one 13 MB.
      try { fr = await inTime(createImageBitmap(v, v.videoWidth >= v.videoHeight ? { resizeWidth: Math.min(PT_MAX, v.videoWidth), resizeQuality: "high" } : { resizeHeight: Math.min(PT_MAX, v.videoHeight), resizeQuality: "high" }), 3000); }
      catch (e) { try { fr = /too long/.test(e.message) ? null : await inTime(createImageBitmap(v), 3000); } catch (e2) { fr = null; } }
      if (!fr) { if (!best) best = v; break; }   // can't copy frames: the picture as it is now
      var sc = camSharpness(fr);
      if (sc > bestScore) { if (best && best.close) best.close(); best = fr; bestScore = sc; } else if (fr.close) fr.close();
    }
    if (!best || pt !== cur) { if (best && best.close) best.close(); return; }
    var w = best.videoWidth || best.width, h = best.videoHeight || best.height, k = Math.min(1, PT_MAX / Math.max(w, h));
    var c = ptCanvas(best, Math.round(w * k), Math.round(h * k), when, cur.reg);
    if (best.close) best.close();
    var thumb = ptThumb(c, c.width, c.height);
    var b = await jpegOf(c, PT_Q);
    c.width = c.height = 0;
    if (!b || pt !== cur) return;
    cur.items.push({ file: b, url: thumb, state: cur.mode === "photos" ? "local" : "wait", n: cur.items.length + 1, ready: true });
    var el = $("camCount"); if (el) el.textContent = camCountText();
    ptPump(r); ptPdfWarm(cur);
  }
  // ── Android: a real photo ──
  // Chrome on Android can ask the camera for a proper still photo (full size,
  // the phone's own sharpening and noise clean-up) instead of a frame of
  // video. It takes about half a second. If it fails or hangs twice, this
  // phone goes back to the sharpest-frame way for the rest of the session.
  // OFF (28 Sept): on some phones the camera hands back a 50+ MP photo and
  // opening it ran the phone out of memory, crashing the app during PT.
  var CAM_STILL_ON = false;
  var IS_ANDROID = /Android/i.test(navigator.userAgent), camIC = null, camStillFails = 0, CAM_STILL_WAIT = 5000;
  async function camStill(v) {
    if (!CAM_STILL_ON || !IS_ANDROID || camStillFails >= 2 || typeof ImageCapture === "undefined" || !camStream) return null;
    var track = camStream.getVideoTracks()[0]; if (!track || track.readyState !== "live") return null;
    try {
      if (!camIC || camIC.track !== track) {
        camIC = new ImageCapture(track); camIC.opts = {};
        // No flash going off for each photo (the FLASH button is the torch).
        var pc = await camIC.getPhotoCapabilities().catch(function () { return null; });
        if (pc && (pc.fillLightMode || []).indexOf("off") !== -1) camIC.opts.fillLightMode = "off";
      }
      var blob = await Promise.race([camIC.takePhoto(camTorch ? {} : camIC.opts),
        new Promise(function (ok, no) { setTimeout(function () { no(new Error("photo took too long")); }, CAM_STILL_WAIT); })]);
      var im = await createImageBitmap(blob, { resizeWidth: PT_MAX, resizeQuality: "high" });
      camStillFails = 0;
      return camUpright(im, v);
    } catch (e) {
      camStillFails++; camIC = null;
      // Logged (PT COPY line) so the office can see which phones can't.
      if (camStillFails === 2 && pt) bkReport(pt.id, "real photos off on this phone, using video frames: " + String(e && e.message || e).slice(0, 80));
      return null;
    }
  }
  // Some phones hand the photo back on its side. It's turned to match the
  // picture on screen: whichever quarter turn looks most like the video.
  function camUpright(im, v) {
    var vPortrait = v.videoHeight > v.videoWidth, pPortrait = im.height > im.width;
    if (vPortrait === pPortrait) return im;
    function grey(src, turn) {
      var N = 48, c = document.createElement("canvas"); c.width = c.height = N;
      var g = c.getContext("2d", { willReadFrequently: true });
      if (turn) { g.translate(N / 2, N / 2); g.rotate(turn * Math.PI / 2); g.translate(-N / 2, -N / 2); }
      g.drawImage(src, 0, 0, N, N);
      var d = g.getImageData(0, 0, N, N).data, out = new Float32Array(N * N);
      for (var i = 0; i < N * N; i++) out[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2];
      return out;
    }
    function diff(a, b) { var t = 0; for (var i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]); return t; }
    var ref = grey(v, 0), turn = diff(grey(im, 1), ref) <= diff(grey(im, 3), ref) ? 1 : 3;
    var c = document.createElement("canvas"); c.width = im.height; c.height = im.width;
    var g = c.getContext("2d"); g.translate(c.width / 2, c.height / 2); g.rotate(turn * Math.PI / 2); g.drawImage(im, -im.width / 2, -im.height / 2);
    if (im.close) im.close();
    return c;
  }
  // How sharp a frame is: the middle of the picture made small and grey, then
  // how much each pixel differs from its neighbours (a blurred frame is smooth).
  var camSharpCv = null;
  function camSharpness(fr) {
    try {
      var W = 160, H = 120, c = camSharpCv || (camSharpCv = document.createElement("canvas")); c.width = W; c.height = H;
      var g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(fr, fr.width * 0.2, fr.height * 0.2, fr.width * 0.6, fr.height * 0.6, 0, 0, W, H);
      var d = g.getImageData(0, 0, W, H).data, y = new Float32Array(W * H), sum = 0;
      for (var p = 0; p < W * H; p++) y[p] = d[p * 4] * 0.3 + d[p * 4 + 1] * 0.59 + d[p * 4 + 2] * 0.11;
      for (var row = 1; row < H - 1; row++) for (var col = 1; col < W - 1; col++) {
        var q = row * W + col, l = 4 * y[q] - y[q - 1] - y[q + 1] - y[q - W] - y[q + W];
        sum += l * l;
      }
      return sum;
    } catch (e) { return 0; }
  }
  function ptRetry(r) { pt.saveFail = false; pt.items.forEach(function (x) { if (x.state === "fail") x.state = "wait"; }); openPt(r); ptPump(r); }
  // WhatsApp is open with the message: PT is done.
  function ptSent(r) {
    r = S.rows.filter(function (x) { return x.id === r.id; })[0] || r;
    if (!r.pt_at) tapPick(r, "pt");
    toast(ptCaption(r) + ": PT link sent, PT ticked");
    setTimeout(function () { ptClear(); if ($("panel").open) $("panel").close(); }, 300);
  }
  function ptClear() { pt = null; }
  // PT ticked without sending: photos taken in the app are still saved as the
  // car's copy (kept on the phone until they are).
  function ptTickKeep(r) {
    tapPick(r, "pt");
    var cur = pt;
    cur.sent = cur.items.length; cur.regSent = true;
    if (cur.mode === "photos") {
      bkQueueSet(cur.id, cur.token, cur.items.filter(function (x) { return x.state === "local"; }));
      if (bkPending(cur)) { ptStore(); bkWatch(cur.id, cur.token, cur); } else ptForget(cur.id);
    }
    ptClear(); $("panel").close();
    toast(ptCaption(r) + ": PT ticked, photos kept in the app");
  }
  // No photos in the app: take them, or say why not (logged for the office).
  var PT_WHY = ["Camera not working", "Photos taken on the phone's own camera", "No signal / app not loading", "Other"];
  function ptNoPhotos(r) {
    panelRow = r;
    $("panelBody").innerHTML = '<h2 id="panelTitle">No photos in the app for ' + esc(r.reg || "this car") + "</h2>" +
      '<p class="sub">The app keeps a copy of PT photos in case of a complaint. Take them with the app\'s camera if you can.</p>' +
      '<button type="button" class="btn brand ptgo" data-ptcamgo>OPEN CAMERA</button>' +
      '<label>OR TICK PT ANYWAY, BECAUSE</label><div class="ptwhy">' +
      PT_WHY.map(function (w) { return '<button type="button" data-ptwhy="' + esc(w) + '">' + esc(w) + "</button>"; }).join("") + "</div>" +
      '<div class="pbtns"><button type="button" data-ptback>Back</button></div>';
    if (!$("panel").open) $("panel").showModal();
  }
  function ptTickWhy(r, why) {
    if (why === "Other") {
      why = (prompt("Why is PT being ticked without photos in the app?") || "").trim().slice(0, 120);
      if (!why) return toast("Say why, or take the photos.", true);
    }
    if (!r.pt_at) tapPick(r, "pt");
    bkReport(r.id, "PT ticked without photos in the app: " + why);
    if (pt && pt.id === r.id) { ptForget(pt.id); ptClear(); }
    $("panel").close();
    toast(ptCaption(r) + ": PT ticked (" + why + ")");
  }
  // Small previews (240 px) for the tiles: fifty full-size photos on screen
  // would need close to a gigabyte and cheaper phones would close the app.
  var PT_THUMB = 240;
  function ptThumb(src, w, h) {
    try {
      var k = PT_THUMB / Math.max(w, h), c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.7);
    } catch (e) { return ""; }
  }
  async function ptThumbOf(blob) {
    try { var im = await inTime(createImageBitmap(blob), 8000), t = ptThumb(im, im.width, im.height); if (im.close) im.close(); return t; } catch (e) { return ""; }
  }
  function ptImg(x, attrs) { return "<img" + (x.url ? ' src="' + x.url + '"' : "") + ' alt="" decoding="async"' + (attrs || "") + ">"; }

  // ── PT the WhatsApp-photos way ──
  var PT_BATCH = 10;
  var BIG_SHARE = IS_IOS;
  function openPtPhotos(r) {
    var num = (S.company && S.company.pt_whatsapp) || "", reg = ptCaption(r), n = pt.items.length, prep = ptCount("prep"), sent = pt.sent || 0;
    var b = ptBatch(), pick = '<input type="file" accept="image/*" multiple data-ptfile hidden>';
    // The way chosen in Settings: every photo in one PDF (one tap), or the
    // photos themselves (reg first, then 10 at a time on Android). If the PDF
    // can't be made on this phone, the photos way is there instead.
    var pdfWay = ptWantsPdf() && n && !prep && !sent && !pt.regSent, pdf = pdfWay ? ptPdfState() : null;
    if (pdf && pdf.failed) pdfWay = false;
    var regBtn = num ? '<a class="btn brand ptgo" href="https://wa.me/' + esc(num) + "?text=" + encodeURIComponent(reg) + '" target="_blank" rel="noopener" data-ptreg>1 · SEND ' + esc(reg) + " TO PT</a>"
      : '<button type="button" class="btn brand ptgo" data-ptregshare>1 · SEND ' + esc(reg) + " TO PT</button>";
    var step1 = !n || prep ? ""
      : pdfWay ? '<button type="button" class="btn brand ptgo" data-ptpdf' + (pdf.ready ? "" : " disabled data-keepoff") + ">" + esc(pdf.label) + "</button>" +
          '<p class="hint">Every photo in one file, with ' + esc(reg) + " as the message. Pick the PT chat and Send; PT ticks itself.</p>"
      : !pt.regSent ? regBtn
      : b ? '<button type="button" class="btn brand ptgo" data-ptshare>2 · ' + esc(ptShareLabel()) + "</button>" : "";
    // The send buttons come first, so they're never below a screenful of photos.
    var hint = '<p class="hint">' + (!n ? "" : prep ? "Getting " + prep + " photo" + (prep === 1 ? "" : "s") + " ready…"
        : pdfWay ? ""
        : !pt.regSent ? (ptWantsPdf() ? "The PDF couldn't be made, so send them as photos: " : "") + "opens the PT chat with " + esc(reg) + " typed; Send, come back, then the photos."
        : sent ? "Keep going: tap the button, pick the PT chat (top of the list), Send."
        : "Tap the button, pick the PT chat (top of the list), then Send. PT ticks itself.") + "</p>";
    $("panelBody").innerHTML = '<h2 id="panelTitle">PT · ' + esc(reg) + (r.num ? " <small>#" + r.num + "</small>" : "") + "</h2>" +
      (n && (pt.regSent || sent) ? '<div class="ptsteps"><span class="' + (pt.regSent ? "ok" : "") + '">' + (pt.regSent ? "✓" : "1") + " Reg</span><span class=\"" + (sent && sent >= n ? "ok" : "") + '">' + (sent >= n && n ? "✓" : "2") + " Photos " + sent + "/" + n + "</span></div>" : "") +
      step1 + hint +
      (sent || pt.pdfSent ? "" : '<button type="button" class="btn ' + (n ? "ghost" : "brand") + ' ptgo" data-ptcam>' + (n ? "+ TAKE MORE" : "TAKE PHOTOS") + "</button>" +
        '<label class="btn ghost ptpick">' + pick + (n ? "+ Add from gallery" : "Choose from gallery") + "</label>") +
      (n ? '<div class="ptthumbs">' + pt.items.map(function (x, i) { return ptImg(x, i < sent ? ' class="sent"' : x.state === "prep" ? ' class="wait"' : ""); }).join("") + "</div>" : "") +
      '<div class="pbtns"><button type="button" data-close>Close</button>' + (n ? '<button type="button" data-ptclear>Start again</button>' : "") + "</div>" +
      '<button type="button" class="link" data-ptmark>Tick PT without sending photos</button>';
    if (!$("panel").open) $("panel").showModal();
  }
  // Gallery photos are 4-8 MB each: made the same size as camera shots first,
  // so WhatsApp takes them quickly and the phone doesn't run out of memory.
  async function ptPrep(r, cur) {
    if (cur.prepping) return;
    cur.prepping = true;
    var x;
    while ((x = cur.items.filter(function (y) { return y.state === "prep"; })[0])) {
      x.file = await ptShrink(x.file, cur.reg); x.url = x.url || await ptThumbOf(x.file); x.state = "local";
      if (pt !== cur) return;
    }
    cur.prepping = false;
    // The copy starts once shooting's finished, so it's saved as one set.
    if (!camStream) bkQueueSet(cur.id, cur.token, cur.items.filter(function (y) { return y.state === "local"; }));
    ptStore(); ptRefresh();
  }

  // ── The copy kept for the app ──
  // In the WhatsApp-chat way a copy of the photos uploads quietly in the
  // background, so the car's panel can show them. PT still gets every full
  // photo on WhatsApp. Where the copy goes is companies.pt_copy_store:
  //   "r2"        Cloudflare R2: every photo, "good" quality (1280 px, about
  //               120 KB), kept 30 days: ~14 GB, a few pence a month over
  //               the free 10 GB. The pt-r2 function hands out upload
  //               addresses; paths start "r2:".
  //   otherwise   Supabase's store (100 GB on Pro), kept 30 days: 10 photos spread
  //               evenly round the car, small (800 px, about 35 KB).
  // It waits while the camera is open or PT's photos are still being sent:
  // making copies alongside the share sheet stopped PT on an iPhone.
  // A failed photo is tried again after 5 s, 15 s, 30 s, 1, 2, 5 and then every
  // 10 minutes, about 4 hours in all (PT is often done where the signal is
  // weak); straight away when the phone's connection comes back or the app
  // is opened again. After a dropped connection, one photo at a time.
  var BK_DELAYS = [5, 15, 30, 60, 120, 300, 600], BK_WARN_AT = 3, BK_WARNED = {}, bkSlow = false, bkOkRun = 0;
  var BK = [], bkActive = 0, BK_TRIES = 30, BK_MAX = 800, BK_Q = 0.5, BK_KEEP = 10, R2_MAX = 1280, R2_Q = 0.6;
  // Returns { blob, how }: "bitmap" or "img" (made small), "orig" (couldn't be).
  async function bkSmall(f, good) {
    var max = good ? R2_MAX : BK_MAX, q = good ? R2_Q : BK_Q;
    async function draw(src, w, h) {
      var k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
      var b = await jpegOf(c, q);
      c.width = c.height = 0;   // free the canvas memory at once (iPhones are strict about it)
      return b && b.size < f.size ? b : null;
    }
    try {
      var im = await inTime(createImageBitmap(f), 8000), b1 = await draw(im, im.width, im.height); if (im.close) im.close();
      if (b1) return { blob: b1, how: "bitmap" };
    } catch (e) {}
    var url = "";
    try {
      url = URL.createObjectURL(f);
      var img = new Image(); img.src = url;
      await (img.decode ? img.decode() : new Promise(function (ok, no) { img.onload = ok; img.onerror = no; }));
      var b2 = await draw(img, img.naturalWidth, img.naturalHeight);
      if (b2) return { blob: b2, how: "img" };
    } catch (e) {} finally { if (url) URL.revokeObjectURL(url); }
    return { blob: f, how: "orig" };
  }
  // In the store's cache setting, so a phone's copies can be checked: small or not.
  var BK_MARK = { bitmap: "3600", img: "3601", orig: "3602" };
  // The photos of a set kept as the copy: BK_KEEP of them, first to last.
  function bkR2() { return !!(S.company && S.company.pt_copy_store === "r2"); }
  function bkPath(rowId, token, n) { return (bkR2() ? "r2:" : "") + S.me.company_id + "/" + rowId + "/" + token + "/" + String(n).padStart(2, "0") + ".jpg"; }
  function bkPick(items) {
    var ns = items.map(function (x) { return x.n; }).sort(function (a, b) { return a - b; }), keep = {};
    if (bkR2() || ns.length <= BK_KEEP) { ns.forEach(function (n) { keep[n] = true; }); return keep; }
    for (var k = 0; k < BK_KEEP; k++) keep[ns[Math.round(k * (ns.length - 1) / (BK_KEEP - 1))]] = true;
    return keep;
  }
  function bkQueueSet(rowId, token, items) {
    var keep = bkPick(items);
    items.forEach(function (x) { if (keep[x.n]) bkQueue(rowId, token, x); else if (x.bk !== "done") { x.bk = "skip"; x.queued = true; } });
    // Every kept photo already up (from before a reload): save the set now.
    var mine = items.filter(function (x) { return keep[x.n]; });
    if (mine.length && mine.every(function (x) { return x.bk === "done"; })) {
      BK = BK.filter(function (y) { return y.token !== token; });
      bkSave(rowId, token, mine.map(function (x) { return x.path || bkPath(rowId, token, x.n); }), true, 0);
    }
  }
  // Tells the office why a car's copy didn't make it (database part 45): a
  // PT COPY line in the activity log. Never gets in the way if it fails.
  function bkReport(rowId, detail) {
    var dev = IS_IOS ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android" : "computer";
    try { sb.rpc("pt_copy_report", { p_booking: rowId, p_detail: detail + " · " + dev + " · app " + (appTag || "?").replace(/\W/g, "").slice(0, 8) }).then(function () {}, function () {}); } catch (e) {}
  }
  // Every photo sent to PT: in 3 minutes the car's copy must be saved or on its way.
  function bkWatch(rowId, token, cur) {
    setTimeout(function () {
      if (BK_SAVED[token] || BK.some(function (y) { return y.token === token; })) return;
      var items = (cur && cur.items) || [];
      bkReport(rowId, "copy never started: " + items.length + " photos, " +
        items.filter(function (x) { return x.state === "local"; }).length + " ready, " +
        items.filter(function (x) { return x.queued; }).length + " queued" +
        (camStream ? ", camera still open" : "") + (bkHold() ? ", waiting (PT screen open)" : "") + (cur && cur.prepping ? ", still preparing" : "") +
        ", store " + (bkR2() ? "Cloudflare" : "Supabase"));
    }, 180000);
  }
  // Connection back, or the app opened again: every photo waiting to retry goes now.
  function bkRetryNow() {
    var any = false;
    BK.forEach(function (y) { if (y.x.bk === "fail" && (y.x.tries || 0) < BK_TRIES) { y.x.bk = "wait"; any = true; } });
    if (any) bkPump();
  }
  window.addEventListener("online", function () { setTimeout(bkRetryNow, 2000); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") setTimeout(bkRetryNow, 2000); });
  function bkHold() { return !!camStream || !!(pt && pt.mode === "photos" && $("panel").open && (pt.sent || 0) < pt.items.length); }
  // Photos already up (before a reload) join the set too, so it's saved whole.
  function bkQueue(rowId, token, x) {
    if (x.queued) return;
    x.queued = true;
    x.path = bkPath(rowId, token, x.n);
    if (x.bk !== "done") x.bk = "wait";
    BK.push({ row: rowId, token: token, x: x }); bkPump();
  }
  function bkPump() {
    if (bkHold()) return;
    while (bkActive < (IS_IOS || bkSlow ? 1 : 2)) {
      var j = BK.filter(function (y) { return y.x.bk === "wait"; })[0]; if (!j) break;
      j.x.bk = "up"; bkActive++; bkUpload(j);
    }
  }
  async function bkUpload(j) {
    var x = j.x;
    try {
      var small = await bkSmall(x.file, /^r2:/.test(x.path));
      if (/^r2:/.test(x.path)) {
        var put = await timedFetch(await bkR2Url(j), { method: "PUT", body: small.blob, headers: { "Content-Type": "image/jpeg" } });
        x.bk = put.ok ? "done" : "fail";
        if (!put.ok) x.err = "Cloudflare refused (" + put.status + ")";
        if (put.status === 403) delete R2URLS[j.token];   // address too old: ask again
      } else {
        var up = await sb.storage.from("pt-photos").upload(x.path, small.blob, { contentType: "image/jpeg", cacheControl: BK_MARK[small.how] });
        x.bk = !up.error || /exist|duplicate/i.test(up.error.message || "") ? "done" : "fail";
        if (x.bk === "fail") x.err = "Supabase refused: " + (up.error.message || "");
      }
    } catch (e) { x.bk = "fail"; x.err = (e && e.message) || String(e); }
    bkActive--;
    if (x.bk === "done") { if (++bkOkRun >= 5) bkSlow = false; }
    if (x.bk === "fail") {
      x.tries = (x.tries || 0) + 1; bkOkRun = 0;
      if (isNetwork({ message: x.err })) bkSlow = true;
      if (x.tries < BK_TRIES) setTimeout(function () { if (x.bk === "fail") { x.bk = "wait"; bkPump(); } }, 1000 * BK_DELAYS[Math.min(x.tries - 1, BK_DELAYS.length - 1)]);
      // Told once per car: still trying, so the office knows why it's late.
      if (x.tries === BK_WARN_AT && !BK_WARNED[j.token]) { BK_WARNED[j.token] = true; bkReport(j.row, "copy delayed, still trying: " + x.err); }
    }
    var mine = BK.filter(function (y) { return y.token === j.token; });
    if (mine.length && mine.every(function (y) { return y.x.bk === "done" || (y.x.bk === "fail" && y.x.tries >= BK_TRIES); })) {
      BK = BK.filter(function (y) { return y.token !== j.token; });
      var paths = mine.filter(function (y) { return y.x.bk === "done"; }).map(function (y) { return y.x.path; });
      if (paths.length < mine.length) {
        var bad = mine.filter(function (y) { return y.x.bk !== "done"; })[0];
        bkReport(j.row, "copy failed: " + paths.length + " of " + mine.length + " photos saved; " + ((bad && bad.x.err) || "no reason given"));
      }
      bkSave(j.row, j.token, paths, paths.length === mine.length, 0);
    }
    bkPump();
  }
  // R2 upload addresses, asked for once per car (they last 15 minutes; asked
  // again after 10, or when one is missing or refused).
  var R2URLS = {};
  async function bkR2Url(j) {
    var name = j.x.path.split("/").pop(), c = R2URLS[j.token];
    if (!c || Date.now() - c.at > 10 * 60000) {
      var names = [name].concat(BK.filter(function (y) { return y.token === j.token && y.x.bk !== "done"; }).map(function (y) { return y.x.path.split("/").pop(); }).filter(function (n) { return n !== name; })).slice(0, 60);
      c = R2URLS[j.token] = { at: Date.now(), p: callFunction("pt-r2", { action: "upload", booking: j.row, token: j.token, names: names }, true).then(function (d) { return d.urls || {}; }) };
    }
    var urls;
    try { urls = await c.p; } catch (e) { if (R2URLS[j.token] === c) delete R2URLS[j.token]; throw e; }
    if (!urls[name]) { if (R2URLS[j.token] === c) delete R2URLS[j.token]; throw new Error("No upload address."); }
    return urls[name];
  }
  // The set is saved as one link; until that has worked the phone keeps its copy
  // (tried again a few times, then again next time the app opens).
  var BK_SAVED = {};
  async function bkSave(rowId, token, paths, allUp, tries) {
    if (paths.length) {
      var res; try { res = await sb.rpc("pt_link_save", { p_token: token, p_booking: rowId, p_paths: paths }); } catch (e) { res = { error: e }; }
      if (res.error) {
        if (tries < 5) setTimeout(function () { bkSave(rowId, token, paths, allUp, tries + 1); }, 5000 * Math.pow(2, tries));
        else bkReport(rowId, "copy uploaded but not saved: " + (res.error.message || res.error));
        return;
      }
    }
    if (allUp) BK_SAVED[token] = true;
    bkFinished(rowId, allUp);
  }
  // Everything for that car is up and saved: forget the phone's copy once all are sent too.
  async function bkFinished(rowId, allUp) {
    if (pt && pt.id === rowId) return ptStore();
    var rec = (await ptSaved()).filter(function (x) { return x.id === rowId; })[0];
    if (allUp && rec && rec.sent >= (rec.blobs || []).length) ptForget(rowId);
  }
  function bkPending(p) { return !BK_SAVED[p.token] || p.items.some(function (x) { return x.state === "local" && x.bk !== "done" && x.bk !== "skip"; }); }
  function ptBatch() {
    if (!pt) return null;
    var left = pt.items.slice(pt.sent || 0).filter(function (x) { return x.state === "local"; });
    if (!left.length) return null;
    return BIG_SHARE ? left : left.slice(0, PT_BATCH);
  }
  function ptShareLabel() {
    var b = ptBatch(), n = pt.items.length; if (!b) return "";
    if (b.length === n) return "SEND " + n + " PHOTO" + (n === 1 ? "" : "S");
    var from = (pt.sent || 0) + 1;
    return "SEND PHOTOS " + from + "–" + (from + b.length - 1) + " OF " + n;
  }
  function ptFiles(batch) {
    var reg = (pt.reg || "car").replace(/\s+/g, "");
    return batch.map(function (x) { return x.file instanceof File ? x.file : new File([x.file], reg + "-" + x.n + ".jpg", { type: x.file.type || "image/jpeg" }); });
  }
  // Photos only: text shared with photos lands on every one and stops WhatsApp
  // grouping them into an album. PT is ticked as the first photos go (the tick
  // is saved on the phone at once), and unticked if that first share is cancelled.
  async function ptShare(r, btn) {
    var batch = ptBatch(); if (!batch) return;
    var files = ptFiles(batch);
    try { await navigator.clipboard.writeText(ptCaption(r)); } catch (e) {}
    if (!navigator.canShare || !navigator.canShare({ files: files })) return toast("This phone can't pass photos to WhatsApp from the app. Send them from WhatsApp; the reg is copied.", true);
    btn.disabled = true;
    var row = S.rows.filter(function (x) { return x.id === r.id; })[0] || r, ticked = false;
    if (!row.pt_at) { tapPick(row, "pt"); ticked = true; }
    try { await navigator.share({ files: files }); }
    catch (e) {
      btn.disabled = false;
      if (ticked && !pt.sent && row.pt_at) tapPick(row, "pt");
      // Cancel is a person changing their mind, not the phone refusing the set.
      if (BIG_SHARE && batch.length > PT_BATCH && e.name !== "AbortError") { BIG_SHARE = false; toast("Too many photos in one go for this phone. Sending 10 at a time instead.", true); return openPt(r); }
      if (e.name !== "AbortError") toast("Couldn't open sharing: " + e.message, true);
      return;
    }
    pt.sent = (pt.sent || 0) + batch.length;
    if (pt.sent < pt.items.length) { ptStore(); toast(pt.sent + " of " + pt.items.length + " sent. Now the next ones."); return openPt(r); }
    if (bkPending(pt)) { ptStore(); bkWatch(pt.id, pt.token, pt); } else ptForget(pt.id);
    ptClear();
    toast(ptCaption(r) + ": all photos sent, PT done");
    $("panel").close();
  }

  // ── PT as one PDF ──
  // Every photo on its own page at 2000 px and 82%: sharp enough to zoom into
  // a scratch, about half the size of the photos as taken, so the PDF opens
  // quicker on WhatsApp. Made in the
  // background as soon as the photos are ready, because Chrome only lets a
  // page share within a few seconds of the tap. Android takes 50 MB in one
  // share, so a very big set becomes parts (each one tap).
  var PDF_PART_MAX = 45 * 1048576, PDF_MAX = 2000, PDF_Q = 0.82;
  function ptWantsPdf() { return ptMethod() === "pdf"; }
  function ptPdfState() {
    var n = pt.items.filter(function (x) { return x.state === "local"; }).length, P = pt.pdf;
    if (!P || P.count !== n) { ptPdfMake(pt); return { ready: false, label: ptPdfLabel(pt.pdfDone || 0, n) }; }
    if (P.error) return { failed: true };
    return { ready: true, label: P.parts.length === 1 ? "SEND AS ONE PDF (1 TAP)" : "SEND PDF PART " + ((P.sent || 0) + 1) + " OF " + P.parts.length };
  }
  // "Making the PDF… 12 of 33", so a big set doesn't look stuck.
  function ptPdfLabel(done, n) { return "Making the PDF… " + done + " of " + n; }
  async function ptPdfMake(cur) {
    var items = cur.items.filter(function (x) { return x.state === "local"; });
    if (cur.pdfMaking === items.length) return;
    cur.pdfMaking = items.length; cur.pdfDone = 0;
    var P = { count: items.length, parts: [], sent: cur.pdfSent || 0 };
    try {
      var jpgs = [];
      for (var i = 0; i < items.length; i++) {
        jpgs.push(await ptPdfItem(items[i]));
        if (cur.pdfMaking !== items.length) return;
        cur.pdfDone = i + 1;
        var btn = pt === cur && document.querySelector("#panelBody [data-ptpdf]");
        if (btn && btn.disabled) btn.textContent = ptPdfLabel(i + 1, items.length);
      }
      var group = [], size = 0;
      jpgs.forEach(function (j) { if (group.length && size + j.bytes.length > PDF_PART_MAX) { P.parts.push(group); group = []; size = 0; } group.push(j); size += j.bytes.length; });
      if (group.length) P.parts.push(group);
      var reg = (cur.reg || "car").replace(/\s+/g, "");
      P.parts = P.parts.map(function (g, k) {
        var name = reg + "-PT-" + items.length + "-photos" + (P.parts.length > 1 ? "-part" + (k + 1) : "") + ".pdf";
        return new File([ptPdfBlob(g, reg + " PT photos")], name, { type: "application/pdf" });
      });
      // A phone that can't hand a PDF to another app gets the photos way instead.
      if (!navigator.canShare || !navigator.canShare({ files: [P.parts[0]] })) P.error = true;
    } catch (e) { oopsLog(e); P.error = true; }
    if (pt !== cur || cur.pdfMaking !== items.length) return;
    cur.pdfMaking = 0; cur.pdf = P;
    if ($("panel").open && panelRow && panelRow.id === cur.id && !$("camVideo")) openPt(panelRow);
  }
  // Back in the app (from recent apps, a call, the screen going off): PT
  // carries on, and a PDF finished meanwhile shows its button.
  function ptWake() {
    var cur = pt, r = panelRow;
    if (!cur || !r || r.id !== cur.id || !$("panel").open || $("camVideo")) return;
    if (cur.mode !== "photos") ptPump(r);
    var b = $("panelBody").querySelector("[data-ptpdf]");
    if (b && b.disabled && cur.pdf && !cur.pdfMaking) openPt(r);
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") ptWake(); });
  window.addEventListener("focus", ptWake);
  // Each photo's PDF page is made once, and while the camera is still open
  // (one at a time, between shots), so Done has little left to do: 46 photos
  // took over a minute when all were made after Done (30 Sept).
  function ptPdfItem(x) {
    return x.pdfP || (x.pdfP = ptPdfJpeg(x.file).catch(function (e) { x.pdfP = null; throw e; }));
  }
  async function ptPdfWarm(cur) {
    if (!ptWantsPdf() || cur.pdfWarming) return;
    cur.pdfWarming = true;
    try {
      for (;;) {
        var next = cur.items.filter(function (x) { return x.state === "local" && !x.pdfP; })[0];
        if (!next || pt !== cur) break;
        try { await ptPdfItem(next); } catch (e) { break; }
        await new Promise(function (ok) { setTimeout(ok, 120); });   // let the camera have the phone
      }
    } finally { cur.pdfWarming = false; }
  }
  // The photo made PDF size; kept as it is when it's already small.
  async function ptPdfJpeg(b) {
    try {
      var im = await inTime(createImageBitmap(b), 8000), k = Math.min(1, PDF_MAX / Math.max(im.width, im.height));
      if (k === 1 && b.size < 700000) { if (im.close) im.close(); return await ptJpegBytes(b); }
      var c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); if (im.close) im.close();
      var j = await jpegOf(c, PDF_Q);
      c.width = c.height = 0;
      var bytes = new Uint8Array(await j.arrayBuffer()), d = jpegSize(bytes);
      if (d) return { bytes: bytes, w: d.w, h: d.h, c: d.c };
    } catch (e) {}
    return await ptJpegBytes(b);
  }
  // The photo as JPEG bytes with its size (anything else is turned into a JPEG).
  async function ptJpegBytes(b) {
    var bytes = new Uint8Array(await b.arrayBuffer()), d = jpegSize(bytes);
    if (d) return { bytes: bytes, w: d.w, h: d.h, c: d.c };
    var im = await inTime(createImageBitmap(b), 8000), c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    c.getContext("2d").drawImage(im, 0, 0); if (im.close) im.close();
    var j = await jpegOf(c, PT_Q);
    bytes = new Uint8Array(await j.arrayBuffer()); d = jpegSize(bytes);
    return { bytes: bytes, w: d.w, h: d.h, c: d.c };
  }
  function jpegSize(b) {
    if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
    for (var i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xFF) { i++; continue; }
      var m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { i += 2; continue; }
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], c: b[i + 9] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return null;
  }
  // A plain PDF: one A4-wide page per photo, the photo filling the page.
  function ptPdfBlob(jpgs, title) {
    var enc = new TextEncoder(), parts = [], pos = 0, offs = [], kids = [];
    function add(x) { var b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); pos += b.length; }
    function start(n) { offs[n] = pos; add(n + " 0 obj\n"); }
    add("%PDF-1.4\n");
    jpgs.forEach(function (j, i) {
      var page = 4 + i * 3, cont = page + 1, img = page + 2, W = 595, H = Math.round(595 * j.h / j.w);
      var cs = j.c === 1 ? "/DeviceGray" : j.c === 4 ? "/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]" : "/DeviceRGB";
      start(page); add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + W + " " + H + "] /Resources << /XObject << /Im0 " + img + " 0 R >> >> /Contents " + cont + " 0 R >>\nendobj\n");
      var body = "q " + W + " 0 0 " + H + " 0 0 cm /Im0 Do Q";
      start(cont); add("<< /Length " + body.length + " >>\nstream\n" + body + "\nendstream\nendobj\n");
      start(img); add("<< /Type /XObject /Subtype /Image /Width " + j.w + " /Height " + j.h + " /ColorSpace " + cs + " /BitsPerComponent 8 /Filter /DCTDecode /Length " + j.bytes.length + " >>\nstream\n");
      add(j.bytes); add("\nendstream\nendobj\n");
      kids.push(page + " 0 R");
    });
    start(1); add("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    start(2); add("<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + kids.length + " >>\nendobj\n");
    start(3); add("<< /Title (" + String(title).replace(/[()\\]/g, "") + ") /Producer (Parking Ops) >>\nendobj\n");
    var size = 4 + jpgs.length * 3, xref = pos, x = "xref\n0 " + size + "\n0000000000 65535 f \n";
    for (var n = 1; n < size; n++) x += String(offs[n]).padStart(10, "0") + " 00000 n \n";
    add(x + "trailer\n<< /Size " + size + " /Root 1 0 R /Info 3 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
    return new Blob(parts, { type: "application/pdf" });
  }
  async function ptSharePdf(r, btn) {
    var P = pt && pt.pdf; if (!P || P.error || !P.parts.length) return;
    var file = P.parts[P.sent || 0]; if (!file) return;
    var data = { files: [file], text: ptCaption(r) + (P.parts.length > 1 ? " (" + ((P.sent || 0) + 1) + " of " + P.parts.length + ")" : "") };
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) { P.error = true; toast("This phone can't pass a PDF to WhatsApp from the app. Send them as photos instead.", true); return openPt(r); }
    btn.disabled = true;
    var row = S.rows.filter(function (x) { return x.id === r.id; })[0] || r, ticked = false;
    if (!row.pt_at) { tapPick(row, "pt"); ticked = true; }
    try { await navigator.share(data); }
    catch (e) {
      btn.disabled = false;
      if (ticked && !P.sent && row.pt_at) tapPick(row, "pt");
      if (e.name !== "AbortError") toast("Couldn't open sharing: " + e.message, true);
      return;
    }
    P.sent = (P.sent || 0) + 1; pt.pdfSent = P.sent;
    if (P.sent < P.parts.length) { ptStore(); toast("Part " + P.sent + " of " + P.parts.length + " sent. Now the next part."); return openPt(r); }
    pt.sent = pt.items.length; pt.regSent = true;
    if (bkPending(pt)) { ptStore(); bkWatch(pt.id, pt.token, pt); } else ptForget(pt.id);
    ptClear();
    toast(ptCaption(r) + ": PDF sent, PT done");
    $("panel").close();
  }

  // Kept on the phone (IndexedDB) until every photo is sent: Android often
  // reloads the app while WhatsApp is open, and they'd be gone otherwise.
  var ptDbP = null, PT_KEEP_MS = 36 * 3600000;
  function ptDb() {
    return ptDbP || (ptDbP = new Promise(function (ok, no) {
      var q = indexedDB.open("takeoff-pt", 1);
      q.onupgradeneeded = function () { q.result.createObjectStore("pt", { keyPath: "id" }); };
      q.onsuccess = function () { ok(q.result); }; q.onerror = function () { no(q.error); };
    }));
  }
  async function ptStore() {
    if (!pt || pt.mode !== "photos") return;
    // Taken now, before anything can clear pt.
    var keep = pt.items.filter(function (x) { return x.state === "local"; });
    var rec = { id: pt.id, reg: pt.reg, at: Date.now(), regSent: !!pt.regSent, sent: pt.sent || 0, pdfSent: pt.pdfSent || 0, token: pt.token,
      blobs: keep.map(function (x) { return x.file; }), thumbs: keep.map(function (x) { return x.url || ""; }), bk: keep.map(function (x) { return x.bk === "done"; }) };
    try { (await ptDb()).transaction("pt", "readwrite").objectStore("pt").put(rec); } catch (e) {}
  }
  async function ptForget(id) { try { (await ptDb()).transaction("pt", "readwrite").objectStore("pt").delete(id); } catch (e) {} }
  async function ptSaved() {
    try {
      var db = await ptDb();
      return await new Promise(function (ok) { var q = db.transaction("pt").objectStore("pt").getAll(); q.onsuccess = function () { ok(q.result || []); }; q.onerror = function () { ok([]); }; });
    } catch (e) { return []; }
  }
  function ptRestore(rec) {
    ptClear();
    pt = { id: rec.id, reg: rec.reg, mode: "photos", token: rec.token || ptToken(), items: [], saved: 0, sent: rec.sent || 0, pdfSent: rec.pdfSent || 0, regSent: !!rec.regSent };
    (rec.blobs || []).forEach(function (b, i) { pt.items.push({ file: b, url: (rec.thumbs || [])[i] || "", state: "local", n: i + 1, ready: true, bk: (rec.bk || [])[i] ? "done" : undefined }); });
    bkQueueSet(pt.id, pt.token, pt.items);
  }
  // All sent but the app's copy didn't finish uploading before a reload: finish it quietly.
  function bkRestore(rec) {
    var token = rec.token; if (!token) return ptForget(rec.id);
    var items = (rec.blobs || []).map(function (b, i) { return { file: b, n: i + 1, bk: (rec.bk || [])[i] ? "done" : undefined }; });
    // All up already, but maybe not saved as a set before the reload: save it (saving twice is harmless).
    if (items.every(function (x) { return x.bk === "done"; })) {
      items.forEach(function (x) { x.path = bkPath(rec.id, token, x.n); });
      sb.rpc("pt_link_save", { p_token: token, p_booking: rec.id, p_paths: items.map(function (x) { return x.path; }) }).then(function (res) { if (!res.error) ptForget(rec.id); });
      return;
    }
    bkQueueSet(rec.id, token, items);
  }
  // Tapping PT on a car: carry on where it left off, or straight into the camera.
  async function ptStart(r) {
    companyFresh(true);
    if (!pt || pt.id !== r.id) {
      var rec = (await ptSaved()).filter(function (x) { return x.id === r.id && Date.now() - x.at < PT_KEEP_MS; })[0];
      if (rec && ptMethod() !== "link") ptRestore(rec);
    }
    openPt(r);
    if (!pt.items.length && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ptCamera(r);
  }
  // After a reload: open the PT that was half sent.
  async function ptResume() {
    var list = await ptSaved();
    list.forEach(function (x) { if (Date.now() - x.at >= PT_KEEP_MS) ptForget(x.id); });
    list = list.filter(function (x) { return Date.now() - x.at < PT_KEEP_MS && (x.blobs || []).length; });
    list.filter(function (x) { return x.sent >= x.blobs.length; }).forEach(bkRestore);
    var rec = list.filter(function (x) { return x.sent < x.blobs.length; })[0];
    var row = rec && S.rows.filter(function (x) { return x.id === rec.id; })[0];
    if (!row || pt || $("panel").open) return;
    ptRestore(rec); openPt(row);
    toast("Carrying on PT for " + ptCaption(row) + (rec.sent ? ": " + rec.sent + " of " + rec.blobs.length + " sent" : ""));
  }
  function tapPick(r, key, value) {
    var v = key === "intake" ? (r.intake === value ? "" : value) : key === "pt" ? (r.pt_at ? "" : "Done") : (r.pick_called === value ? "" : value);
    run("tap_pick", { p_booking: r.id, p_key: key, p_value: v }, r, function (x) {
      if (key === "intake") { x.intake = v; x.intake_at = v ? nowIso() : null; x.intake_by = v ? S.me.id : null; markBy(x, "intake_by"); }
      else if (key === "pt") { x.pt_at = v ? nowIso() : null; x.pt_by = v ? S.me.id : null; markBy(x, "pt_by"); }
      else { x.pick_called = v; x.pick_called_at = v ? nowIso() : null; }
    });
  }

  // ── car panel ─────────────────────────────
  var panelRow = null;
  // Booking files give UK mobiles as 447…, 7… or 07…; without the + or the 0
  // the phone can't dial them. Anything else is dialled as written.
  // Some bookings carry the number twice ("7868615571 7868615571") or two
  // numbers: take the first whole number (UK numbers are written in pieces,
  // "07868 615571", so pieces are joined until there are 10 digits).
  function firstPhone(p) {
    var acc = "";
    String(p || "").split(/[^\d+]+/).filter(Boolean).some(function (g) { acc += g; return acc.replace(/\D/g, "").length >= 10; });
    return acc;
  }
  function dialable(p) {
    var d = firstPhone(p).replace(/[^\d+]/g, "");
    if (/^44\d{10}$/.test(d)) return "+" + d;
    if (/^7\d{9}$/.test(d)) return "0" + d;
    return d;
  }
  function phoneLabel(p) {
    var d = dialable(p);
    if (/^\+447\d{9}$/.test(d)) return "+44 " + d.slice(3, 7) + " " + d.slice(7);
    if (/^07\d{9}$/.test(d)) return d.slice(0, 5) + " " + d.slice(5);
    return firstPhone(p) || String(p);
  }
  // ── early returns (database part 29) ──
  // Booked back on a later day but coming back early: the car moves onto the
  // DROPS sheet for the night picked (tonight unless changed; part 75), marked
  // EARLY. Undo puts it back.
  // The day of the sheet the car is on ("" when that sheet isn't loaded).
  function carSheetDay(r) { var s = S.sheets.concat(S.archiveSheet ? [S.archiveSheet] : []).filter(function (x) { return x.id === r.sheet_id; })[0]; return (s && s.day) || ""; }
  function canEarly(r) {
    if (r.kind !== "drops" || r.early || r.cleared_at || !can("called")) return false;
    var here = S.sheets.filter(function (x) { return x.id === r.sheet_id; })[0];
    return !!here && here.day > currentShiftKey();
  }
  // The night they're coming: tonight up to the night before the booked day.
  function earlyPickHtml(before, attr) {
    var today = currentShiftKey(), last = addDaysKey(before, -1);
    return fld('<label for="earlyDay">' + L("COMING BACK") + '</label><input id="earlyDay" type="date" value="' + today + '" min="' + today + '" max="' + last + '">', true) +
      '<button type="button" id="earlyTo" class="btn ghost ptgo" ' + attr + ">" + earlyLabel(today) + "</button>";
  }
  function earlyLabel(day) { return "EARLY RETURN · add to " + esc(sheetLabel({ kind: "drops", day: day })); }
  function earlyDay() {
    var el = $("earlyDay"), today = currentShiftKey();
    return el && /^\d{4}-\d{2}-\d{2}$/.test(el.value) && el.value > today ? el.value : today;
  }
  function earlyWhen(day) { return day === currentShiftKey() ? "tonight's sheet" : sheetLabel({ kind: "drops", day: day }); }
  function earlyHtml(r) {
    if (!can("called") || r.cleared_at) return "";
    if (r.early) {
      var from = S.sheets.filter(function (x) { return x.id === r.moved_from; })[0];
      return '<button type="button" class="link" data-undoearly>Undo early return' + (from ? " (back to " + esc(sheetLabel(from)) + ")" : "") + "</button>";
    }
    if (!canEarly(r)) return "";
    var here = S.sheets.filter(function (x) { return x.id === r.sheet_id; })[0];
    return earlyPickHtml(here.day, "data-early");
  }
  async function earlyMove(r, btn, undo, asked) {
    var day = asked ? currentShiftKey() : earlyDay();
    if (!undo && !asked && !confirm("Move " + (r.reg || "this car") + " to " + earlyWhen(day) + " as an early return?")) return;
    btn.disabled = true;
    var x = await sb.rpc(undo ? "undo_early_return" : "early_return", undo || asked ? { p_booking: r.id } : { p_booking: r.id, p_day: day });
    btn.disabled = false;
    if (x.error) return toast(x.error.message, true);
    $("panel").close();
    // Follow the car to the sheet it's on now.
    S.sheetId = x.data.sheet_id; S.q = ""; S.yardFilter = "";
    await loadSheets(); await loadRows(); flashId = x.data.id; render();
    toast((r.reg || "Car") + (undo ? " is back on its booked day." : " moved to " + earlyWhen(day) + " as an early return."));
  }
  // From the PICKS car (parts 74, 75): its booked day's DROPS sheet may not be
  // imported yet, so this makes its DROPS car on the night picked, marked EARLY.
  function pickEarlyHtml(r) {
    if (r.kind !== "picks" || r.intake !== "Collected" || !can("called") || !(returnDay(r) > currentShiftKey())) return "";
    return earlyPickHtml(returnDay(r), "data-pearly");
  }
  async function earlyFromPicks(r, btn) {
    var day = earlyDay();
    if (!confirm((r.reg || "This car") + " is booked back " + dayShort(r.return_at) + " " + hhmm(r.return_at) + ". Coming back early?\n\nOK adds it to " + earlyWhen(day) + " as an early return.")) return;
    btn.disabled = true;
    var x = await sb.rpc("early_return_from_picks", { p_picks: r.id, p_day: day });
    btn.disabled = false;
    if (x.error) return toast(x.error.message, true);
    $("panel").close();
    S.sheetId = x.data.sheet_id; S.q = ""; S.yardFilter = "";
    await loadSheets(); await loadRows(); flashId = x.data.id; render();
    toast((r.reg || "Car") + " added to " + earlyWhen(day) + " as an early return.");
  }
  // The office changes the return (the customer rang): DROPS cars, and PICKS cars, whose DROPS car follows (database part 78).
  function canReturn(r) { return can("import") && (r.kind === "picks" || (r.kind === "drops" && !r.early && !r.cleared_at)); }
  function openPanel(r) {
    if (S.switching || (r && r.sheet_id && S.sheetId && r.sheet_id !== S.sheetId)) return;
    // Operations Refined: drawn again after a tap that saves at once (yard, charge), it keeps what was typed.
    var draft = isRefined() && $("panel").open && panelRow && panelRow.id === r.id && $("carState") ? carDraft() : null;
    panelRow = r;
    var drops = r.kind === "drops";
    function by(at, who) { return at ? esc(hhmm(at)) + (who ? " · " + esc(who) : "") : "—"; }
    var det = [["NAME", esc(r.name) || "—"], ["CAR", /^[-\s.]*$/.test(r.make || "") ? "—" : esc(r.make)], ["REF", esc(r.ref) || "—"]];
    if (exitFee() > 0) det.push(["EXIT FEE", exitFree(r) ? "None for this booking" : r.exit_method ? money(r.exit_amount) + " paid, " + esc(r.exit_method) : money(exitFee())]);
    if (drops) {
      det.push(["MEET", r.drop_at ? esc(dayShort(r.drop_at) + " " + hhmm(r.drop_at)) : "—"]);
      det.push(["BACK", esc(dayShort(r.return_at) + " " + hhmm(r.return_at)) + (r.orig_return_at ? ' <span class="hint">· was ' + esc(dayShort(r.orig_return_at) + " " + hhmm(r.orig_return_at)) + "</span>" : "")]);
      det.push(["FLIGHT", esc(r.flight || "—") + (r.sched_time ? " · sched " + esc(r.sched_time) : "")]);
      if (r.est_time || r.flight_note) det.push(["ARRIVAL", (r.est_time ? "<b>" + esc(r.est_time) + "</b> " : "") + '<span class="hint">' + esc(r.flight_note) + "</span>"]);
      det.push(["SENT", by(r.sent_at, byName(r, "sent_by"))], [r.called_word === "Overstay" ? "OVERSTAY" : "CALLED", by(r.called_at, byName(r, "called_by"))]);
      if (atDesk(r)) det.push(["AT DESK", by(r.desk_at, byName(r, "desk_by"))]);
      det.push([r.clear_word === "COMPLAINT" ? "COMPLAINT" : "CLEAR", by(r.cleared_at, byName(r, "cleared_by"))]);
    } else {
      det.push(["DROP-OFF", esc(dayShort(r.drop_at) + " " + hhmm(r.drop_at))], ["BACK", esc(dayShort(r.return_at) + " " + hhmm(r.return_at))]);
      if (r.intake) det.push([esc(r.intake.toUpperCase()), by(r.intake_at, byName(r, "intake_by"))]);
    }
    // Operations: "Booking details" with the reg under it, the details in two
    // columns, and the boxes in sections, each with a plain name.
    var o = isOps(), desk = o && opsDesk(), R = "", rf = isRefined();
    var h = o ? '<button type="button" class="ops-x" data-close aria-label="Close">&times;</button><h2 id="panelTitle">Booking details</h2>' +
        (rf ? '<p class="sub"><b class="rf-reg">' + esc(r.reg || "NO REG") + "</b>" + (r.num ? ' <span class="rf-num">#' + r.num + "</span>" : "") + " · " + esc(refinedSheetLabel(sheet() || { day: "", kind: r.kind })) + "</p>"
          : '<p class="sub">' + esc(r.reg || "NO REG") + (r.num ? " #" + r.num : "") + " · " + esc(sheetLabel(sheet() || { day: "", kind: r.kind })) + "</p>")
      : '<h2 id="panelTitle">' + esc(r.reg || "NO REG") + (r.num ? " <small>#" + r.num + "</small>" : "") + "</h2>" +
      '<p class="sub">' + esc(sheetLabel(sheet() || { day: "", kind: r.kind })) + "</p>";
    var headEnd = h.length;
    var tel = r.phone ? '<a class="tel" href="tel:' + esc(dialable(r.phone)) + '">Call ' + esc(phoneLabel(r.phone)) + "</a>" : "";
    function detList(list) { return '<div class="det">' + list.map(function (x) { return "<div><b>" + L(x[0]) + "</b><span>" + x[1] + "</span></div>"; }).join("") + "</div>"; }
    // Operations Refined: a tap here saves at once, unlike the boxes saved by Save changes.
    var NOW = rf ? '<small class="rf-now">Saves when tapped</small>' : "";
    // A booking can come with no reg: the office can type or correct it, a
    // driver can fill in a missing one when the car comes in.
    var canReg = can("import") || (can("intake") && !r.reg);
    // Swipe instead of buttons: the buttons live here, to undo or fix a swipe.
    var steps = drops && swipeOnly() ? '<label>' + L("STEPS") + NOW + '</label>' + dropButtons(r, r.called_word === "Overstay", r.clear_word === "COMPLAINT", " pacts") : "";
    var parking = canReg || canReturn(r) || (drops ? can("yard") : picksYard() && can("intake")) || (drops ? can("flights") : canPickFlight());
    var regF = canReg ? fld('<label for="regText">' + L("REG") + '</label><input id="regText" value="' + esc(r.reg) + '" autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="Type the reg">', true) : "";
    // A customer rang to come back another day: the office changes it here too.
    // The first booked return is kept (WAS tag, charge), and the new day's file
    // finds this car rather than adding it again (database part 48).
    // The booking site moved the drop-off: the office moves the car to that day (part 102).
    var dropF = "", retF = "", yardF = "", flightF = "", pickFlightF = "";
    // Operations Refined: the date and the time as two boxes side by side, each named.
    function when(d, t, word, p) {
      return rf ? fld('<label for="' + d + '">' + word + ' date</label><input id="' + d + '" type="date" value="' + esc(p.key) + '">') + fld('<label for="' + t + '">' + word + " time</label>" + timeBox(t, p.time))
        : fld('<label for="' + d + '">' + L(word === "Drop-off" ? "DROP-OFF DATE AND TIME" : "BACK DATE AND TIME") + '</label><div class="when2"><input id="' + d + '" type="date" value="' + esc(p.key) + '">' + timeBox(t, p.time) + "</div>", true);
    }
    if (!drops && can("import") && !r.removed_at) {
      var dp = r.drop_at ? londonParts(new Date(r.drop_at)) : { key: "", time: "" }, onDay = carSheetDay(r);
      dropF = when("dropD", "dropT", "Drop-off", dp);
      // Added to another day's sheet (a desk booking with tomorrow's board open): Save moves it (part 114).
      if (dp.key && onDay && dp.key !== onDay) dropF += '<p class="dropday" id="dropDay">On the ' + esc(dayShort(onDay + "T12:00:00Z")) + " sheet. Save moves it to " + esc(dayShort(dp.key + "T12:00:00Z")) + ".</p>";
    }
    if (canReturn(r)) retF = when("retD", "retT", "Return", r.return_at ? londonParts(new Date(r.return_at)) : { key: "", time: "" });
    if (drops ? can("yard") : picksYard() && can("intake")) {
      yardF = fld('<label>' + L(drops ? "YARD" : "LOCATION") + NOW + '</label><div class="pseg yard">' + (S.company.yards || []).map(function (y) {
        return '<button type="button" data-setyard="' + esc(y) + '" class="' + (r.yard === y ? "on y-" + esc(y) : "") + '"' + (rf ? ' aria-pressed="' + (r.yard === y) + '"' : "") + ">" + esc(YARD_LABEL[y] || y) + "</button>";
      }).join("") + "</div>", true);
    }
    var flightNo = "", flightTime = "";
    if (drops && can("flights")) {
      flightNo = fld('<label for="flightText">' + L("FLIGHT NUMBER") + '</label><input id="flightText" value="' + esc(r.flight) + '" autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="or NO FLIGHT">');
      if (r.flight === "NO FLIGHT") flightTime = fld('<label for="collectText">' + L("COLLECTION TIME") + '</label>' + timeBox("collectText", /^\d{2}:\d{2}$/.test(r.est_time) ? r.est_time : ""));
      else flightTime = fld('<label for="schedText">' + L("SCHEDULED LANDING") + '</label>' + timeBox("schedText", /^\d{2}:\d{2}$/.test(r.sched_time) ? r.sched_time : ""));
      flightF = flightNo + flightTime;
    }
    // The return flight, when the booking came without one: it goes on to the DROPS car (database part 78).
    if (!drops && canPickFlight()) pickFlightF = fld('<label for="pickFlightText">' + L("RETURN FLIGHT") + '</label><input id="pickFlightText" value="' + esc(r.flight) + '" autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="e.g. W43451">');
    var docs = docBlockHtml(r);
    var noteF = can("note") ? fld('<label for="noteText">' + L("NOTE") + '</label><textarea id="noteText" maxlength="500">' + esc(r.note) + '</textarea>', true) : "";
    var extra = "", W = function (t) { return rf ? sentence(t) : t; }, AP = function (on) { return rf ? ' aria-pressed="' + on + '"' : ""; };
    if (drops) {
      // CALLED and AT DESK here too: the row's button goes CALLED ↔ AT DESK, so CALLED comes off here (part 112).
      if (can("called")) extra += '<button type="button" data-word="called:Called" class="' + (r.called_word === "Called" && r.called_at ? "on" : "") + '"' + AP(r.called_word === "Called" && !!r.called_at) + ">" + W("CALLED") + "</button>";
      // AT DESK needs its own permission only (part 115).
      if (can("desk") && r.called_word !== "Overstay") extra +=
        ('<button type="button" data-word="desk:" class="' + (atDesk(r) ? "on dk" : "") + '"' + AP(atDesk(r)) + ">" + W("AT DESK") + "</button>");
      if (can("called")) extra += '<button type="button" data-word="called:Overstay" class="' + (r.called_word === "Overstay" ? "on nb" : "") + '"' + AP(r.called_word === "Overstay") + ">" + W("OVERSTAY") + "</button>";
      if (can("clear")) extra += '<button type="button" data-word="clear:COMPLAINT" class="' + (r.clear_word === "COMPLAINT" ? "on cm" : "") + '"' + AP(r.clear_word === "COMPLAINT") + ">" + W("COMPLAINT") + "</button>";
    } else if (can("intake")) {
      extra += '<button type="button" data-pcall="Called" class="' + (r.pick_called === "Called" ? "on" : "") + '"' + AP(r.pick_called === "Called") + ">" + W("CALLED") + "</button>";
      extra += '<button type="button" data-pcall="New Booking" class="' + (r.pick_called === "New Booking" ? "on nb" : "") + '"' + AP(r.pick_called === "New Booking") + ">" + W("NEW BOOKING") + "</button>";
      if (picksYard()) extra += '<button type="button" data-pnoshow class="' + (r.intake === "No Show" ? "on n" : "") + '"' + AP(r.intake === "No Show") + ">" + W("NO SHOW") + "</button>";
    }
    var markF = extra ? fld('<label>' + L("MARK AS") + NOW + '</label><div class="pseg">' + extra + "</div>", true) : "";
    var exitP = drops ? exitPanelHtml(r) : "", pay = (drops ? chargePanelHtml(r) : "") + exitP;
    var early = drops ? earlyHtml(r) : pickEarlyHtml(r);
    // PT photos from when the car came in (PICKS), also on its DROPS row: same booking ref.
    var photos = '<div id="ptPhotos"></div>', texts = carTextsHtml(r);
    var rm = can("import") ? '<button type="button" class="link rmcar" data-removecar>Remove this car (no show, cancelled)</button>' : "";
    var saves = can("note") || can("flights") || (!drops && canPickFlight()) || canReg || canReturn(r);
    var hist = can("log") ? '<div id="carHist"></div>' : "";
    if (rf) h = refinedCar(r, h.slice(0, headEnd), { det: det, tel: tel, steps: steps, regF: regF, dropF: dropF, retF: retF, yardF: yardF, flightF: flightF, flightNo: flightNo, flightTime: flightTime, pickFlightF: pickFlightF,
      docs: docs, noteF: noteF, markF: markF, pay: pay, exitP: exitP, early: early, photos: photos, texts: texts, rm: rm, saves: saves, hist: hist, desk: desk, detList: detList });
    else {
      h += tel + opsSec("Customer & vehicle") + detList(det);
      if (steps) { if (desk) R += opsSec("Status") + steps; else h += steps; }
      if (parking) h += opsSec(drops ? "Return & parking" : "Parking");
      h += regF + dropF + retF + yardF + flightF + pickFlightF;
      if (!desk) h += docs;
      if (can("note")) h += opsSec("Notes & status") + noteF;
      // A wide screen: the booking, its return and notes on the left; status, payments, photos and the rest on the right.
      var side = "";
      if (extra) side += (desk || can("note") ? "" : opsSec("Status")) + markF;
      side += pay + early + (texts ? opsSec(carCommsTitle()) + texts : "") + photos + rm;
      if (desk) R = (R || opsSec("Status")) + side + (docs ? '<div class="ops-docs">' + opsSec("Documents") + docs + "</div>" : ""); else h += side;
      var foot = '<div class="pbtns' + (o ? " ops-foot2" : "") + '">' + (o && saves ? "<small>Changes saved only when confirmed</small>" : "") + '<button type="button" data-close>' + (o && saves ? "Cancel" : "Close") + "</button>" + (saves ? '<button type="button" class="save" data-savepanel>' + (o ? "Save changes" : "Save") + "</button>" : "") + "</div>";
      // Operations: the boxes in one white panel, the history under it, Cancel and Save always in view.
      h = desk ? h.slice(0, headEnd) + '<div class="ops-2col"><div class="ops-sheet">' + h.slice(headEnd) + '</div><div class="ops-sheet ops-carside">' + R + "</div></div>" + hist + foot
        : o ? h.slice(0, headEnd) + '<div class="ops-sheet">' + h.slice(headEnd) + "</div>" + hist + foot : h + foot + hist;
    }
    $("panelBody").innerHTML = h;
    $("panel").classList.toggle("ops-car", o);
    if (rf) { carInit = carFieldVals(); if (draft) Object.keys(draft).forEach(function (k) { if ($(k)) $(k).value = draft[k]; }); carState(); }
    if (o) opsMenuPlace();
    if (!$("panel").open) $("panel").showModal();
    ptPhotosList(r);
    carHistory(r);
    carTexts(r);
    carCalls(r);
    if ($("docBox")) fillDoc(r);
    if ($("exitImg")) fillExit(r);
  }
  // ── Operations Refined: Booking details in sections ──
  // Customer & vehicle, Return & parking, Notes & status, then payments,
  // documents and photos; the read-only details as text, the boxes Save changes
  // saves as fields, and what saves on a tap marked "Saves when tapped". The same
  // fields, buttons and saves as Operations; only where they sit changes.
  var CAR_PARK = { MEET: 1, BACK: 1, FLIGHT: 1, ARRIVAL: 1, "DROP-OFF": 1 }, CAR_STAMP = { SENT: 1, CALLED: 1, "AT DESK": 1, OVERSTAY: 1, CLEAR: 1, COMPLAINT: 1 };
  function refinedCar(r, head, P) {
    // A detail that has its own box below shows once, in the box.
    var skip = { NAME: 1, CAR: 1, REF: 1 }; if (P.retF) skip.BACK = 1; if (P.dropF) skip["DROP-OFF"] = 1; if (P.flightF) skip.FLIGHT = 1; if (P.exitP) skip["EXIT FEE"] = 1;
    var park = [], stat = [], fee = [];
    P.det.forEach(function (x) { if (skip[x[0]]) return; (CAR_PARK[x[0]] ? park : x[0] === "EXIT FEE" ? fee : stat).push(x); });
    // Read-only details: the name on the left, the value on the right, a line each.
    function lab(t) { var l = L(t); return l === t ? sentence(t) : l; }
    function kv(list) { list = list.filter(function (x) { return x[1] !== "—"; }); return list.length ? '<div class="rf-kv">' + list.map(function (x) { return "<div><span>" + lab(x[0]) + "</span><b>" + x[1] + "</b></div>"; }).join("") + "</div>" : ""; }
    // Sent / Called / Clear (or how the car came in): when and who, side by side.
    function stamps(list) { return list.length ? '<div class="rf-stamps">' + list.map(function (x) { var v = x[1].split(" · "); return '<div class="' + (x[1] === "—" ? "" : "on") + '"><span>' + lab(x[0]) + "</span><b>" + v[0] + "</b>" + (v[1] ? "<small>" + nice(v.slice(1).join(" · ")) + "</small>" : "") + "</div>"; }).join("") + "</div>" : ""; }
    var was = P.retF && r.orig_return_at ? '<p class="rf-hint">First booked back ' + esc(dayShort(r.orig_return_at) + " " + hhmm(r.orig_return_at)) + "</p>" : "";
    function sec(cls, title, body, aside) { return body ? '<section class="rf-sec ' + cls + '"><h3 class="rf-h">' + esc(title) + (aside ? "<small>" + esc(aside) + "</small>" : "") + '</h3><div class="ops-sheet rf-grid">' + body + "</div></section>" : ""; }
    var car = /^[-\s.]*$/.test(r.make || "") ? "" : niceMake(String(r.make).trim());
    var cv = '<div class="rf-cv"><div><small>Customer</small><b>' + (esc(nice(r.name)) || "—") + "</b>" + (P.tel ? '<span class="rf-tel">' + P.tel + "</span>" : "") + "</div>" +
      "<div><small>Vehicle</small><b>" + (esc(car) || "—") + '</b><span class="num">' + (esc(r.ref) || "No reference") + "</span></div></div>";
    // A wide screen: the booking and its return on the left; status, notes, payments and photos on the right.
    var A = sec("rf-cust", "Customer & vehicle", cv) +
      sec("rf-park", r.kind === "drops" ? "Return & parking" : "Drop-off & parking", P.regF.replace('class="ops-f wide"', 'class="ops-f"') + P.flightNo + P.pickFlightF + P.dropF + P.retF + was + P.flightTime + kv(park) + P.yardF + (P.early ? '<div class="rf-early">' + P.early + "</div>" : ""));
    var stampList = stat.filter(function (x) { return CAR_STAMP[x[0]] || r.kind !== "drops"; });
    var B = sec("rf-notes", "Notes & status", stamps(stampList) + P.steps + P.noteF + P.markF) +
      sec("rf-pay", "Payments", kv(fee) + P.pay, P.pay ? "Saves when tapped" : "") +
      sec("rf-texts", carCommsTitle(), P.texts) +
      sec("rf-docs", P.docs ? "Documents & photos" : "Photos", P.docs + P.photos) +
      (P.rm ? '<div class="rf-rm">' + P.rm + "</div>" : "");
    var foot = '<div class="pbtns ops-foot2 rf-foot">' + (P.saves ? '<small id="carState" class="rf-state" role="status" aria-live="polite">No unsaved changes</small><button type="button" data-close>Cancel</button><button type="button" class="save" data-savepanel>Save changes</button>'
      : '<button type="button" data-close>Close</button>') + "</div>";
    return head + (P.desk ? '<div class="ops-2col rf-2col"><div class="rf-col">' + A + '</div><div class="rf-col">' + B + "</div></div>" : A + B) +
      (P.hist ? '<section class="rf-sec rf-hist">' + P.hist + "</section>" : "") + foot;
  }
  // What's typed in the car's boxes and not saved yet (Operations Refined).
  var CAR_FIELDS = ["regText", "dropD", "dropT", "retD", "retT", "flightText", "collectText", "schedText", "pickFlightText", "noteText"], carInit = {};
  function carFieldVals() { var v = {}; CAR_FIELDS.forEach(function (id) { var el = $(id); if (el) v[id] = el.value; }); return v; }
  function carDraft() { var v = carFieldVals(), d = {}; Object.keys(v).forEach(function (k) { if (v[k] !== carInit[k]) d[k] = v[k]; }); return d; }
  function carState(msg) {
    var el = $("carState"); if (!el) return;
    var n = Object.keys(carDraft()).length;
    el.textContent = msg || (n ? "Unsaved changes" : "No unsaved changes");
    el.className = "rf-state" + (msg ? " bad" : n ? " dirty" : "");
  }
  // A box Save changes can't take: said in the footer too (Operations Refined), always as a message.
  function saveErr(m) { if (isRefined()) carState(m); return toast(m, true); }
  ["input", "change"].forEach(function (ev) { $("panelBody").addEventListener(ev, function (e) { if (isRefined() && $("carState") && e.target.id && CAR_FIELDS.indexOf(e.target.id) >= 0) carState(); }); });
  // A phone keyboard: the box being typed in stays above Cancel / Save changes.
  $("panelBody").addEventListener("focusin", function (e) {
    var t = e.target; if (!isRefined() || !$("carState") || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    setTimeout(function () { if (document.activeElement === t) t.scrollIntoView({ block: "nearest" }); }, 350);
  });
  // Operations' words, sections and two-column boxes for the car panel; the
  // other looks get exactly what they had.
  var OPS_LABEL = { NAME: "Customer name", CAR: "Car", REF: "Booking reference", "EXIT FEE": "Exit fee", MEET: "Meet", BACK: "Back", FLIGHT: "Flight", ARRIVAL: "Arrival", SENT: "Sent", CALLED: "Called", "AT DESK": "At desk", OVERSTAY: "Overstay", CLEAR: "Clear", COMPLAINT: "Complaint",
    "DROP-OFF": "Drop-off", REG: "Registration", "BACK DATE AND TIME": "Return date and time", "DROP-OFF DATE AND TIME": "Drop-off date and time", YARD: "Yard", LOCATION: "Location", "FLIGHT NUMBER": "Flight number", "RETURN FLIGHT": "Return flight", "COLLECTION TIME": "Collection time",
    "SCHEDULED LANDING": "Scheduled landing", "COMING BACK": "Coming back", NOTE: "Note", "MARK AS": "Mark as", STEPS: "Steps" };
  function L(t) { return isOps() && OPS_LABEL[t] || t; }
  function opsSec(t) { return isOps() ? '<div class="ops-psec">' + esc(t) + "</div>" : ""; }
  function fld(html, wide) { return isOps() ? '<div class="ops-f' + (wide ? " wide" : "") + '">' + html + "</div>" : html; }
  // Everything done to this car, who and when: this row and its other half
  // (the PICKS and DROPS rows of one booking share the ref). Office only,
  // like the activity log. "OFFICE" is the shared office login.
  async function carHistory(r) {
    var el = $("carHist"); if (!el) return;
    var ids = [r.id], kinds = {}; kinds[r.id] = r.kind;
    if (r.ref) {
      var tw = await sb.from("bookings").select("id, kind").eq("ref", r.ref).neq("id", r.id);
      (tw.data || []).forEach(function (x) { ids.push(x.id); kinds[x.id] = x.kind; });
    }
    var q = await sb.from("activity").select("at, action, value, staff_name, booking_id").in("booking_id", ids).order("at", { ascending: false }).limit(100);
    el = $("carHist"); if (!el || panelRow !== r) return;
    if (q.error) { el.innerHTML = '<label>HISTORY</label><p class="hint">Couldn\'t load the history.</p>'; return; }
    var list = q.data || [], both = ids.length > 1;
    el.innerHTML = '<label>HISTORY</label>' + (!list.length ? '<p class="hint">Nothing done to this car in the app yet.</p>' :
      '<div class="hist">' + list.map(function (a) {
        return '<div><span class="hw num">' + esc(dayShort(a.at) + " " + hhmm(a.at)) + '</span><span class="hb"><b>' + esc(a.staff_name || "System") + "</b> · " +
          esc(a.action) + (both ? ' <small class="hk">' + esc(String(kinds[a.booking_id] || "").toUpperCase()) + "</small>" : "") +
          (a.value ? '<span class="hv">' + esc(a.value) + "</span>" : "") + "</span></div>";
      }).join("") + "</div>");
  }
  // The car's PT photos (kept 30 days, in Supabase or Cloudflare). View opens the same page PT gets.
  async function ptPhotosList(r) {
    var res = await sb.rpc("pt_photos_for", { p_booking: r.id });
    var el = $("ptPhotos"); if (!el || panelRow !== r || res.error) return;
    var sets = res.data || [];
    if (!sets.length) { if (r.pt_at && r.kind === "picks") el.innerHTML = '<label>PT PHOTOS</label><p class="hint">No copy of the photos in the app for this car.</p>'; return; }
    el.innerHTML = "<label>PT PHOTOS</label>" + sets.map(function (x) {
      return '<a class="ptset" href="/p/' + esc(x.token) + '" target="_blank" rel="noopener"><span><b>' + x.n + " photo" + (x.n === 1 ? "" : "s") + "</b> · " + esc(dayShort(x.at) + " " + hhmm(x.at)) + (x.by ? " · " + esc(x.by) : "") + "</span><i>View ›</i></a>";
    }).join("");
  }
  $("panel").addEventListener("close", function () { $("panel").classList.remove("ops-car", "payment-sheet"); boardPaymentId = ""; var tv = document.querySelector("#panelBody video"); if (tv) tv.pause(); camStop(); panelRow = null; quick = null; staffEdit = null; render(); setTimeout(bkPump, 500); });
  // Closes on a tap outside only when the press started outside too: selecting
  // text in a box and letting go past the edge must not close it.
  var downOn = {};
  ["panel", "menu"].forEach(function (id) { $(id).addEventListener("pointerdown", function (e) { downOn[id] = e.target; }); });
  function outside(id, e) { var hit = e.target === $(id) && downOn[id] === $(id); downOn[id] = null; return hit; }
  $("panel").addEventListener("click", function (e) {
    if (outside("panel", e)) return $("panel").close();          // tap outside the sheet
    if (e.target === $("panel")) return;
    var t = e.target.closest("button"); if (!t) return;
    if (t.dataset.close !== undefined) return $("panel").close();
    if (t.dataset.pickflight && quick) return saveQuickFlight(t.dataset.pickflight, undefined, t.dataset.picksched);
    if (t.dataset.noflight !== undefined && quick) { quick.noFlight = true; drawQuickFlight(); setTimeout(function () { var i = $("collectTime"); if (i) i.focus(); }, 50); return; }
    if (t.dataset.flightback !== undefined && quick) { quick.noFlight = false; drawQuickFlight(); return; }
    if (t.dataset.copy === "returns" || t.dataset.copy === "stats") { e.stopPropagation(); return putOnClipboard(copyText(t.dataset.copy)); }
    if (t.dataset.restore) return restoreCar(t);
    if (t.dataset.gone) return removeGone([t.dataset.gone], t);
    if (t.dataset.undoimport) return undoImport(t.dataset.undoimport, t);
    if (t.dataset.goneall !== undefined) return removeGone(Array.prototype.map.call($("panelBody").querySelectorAll("[data-gone]"), function (b) { return b.dataset.gone; }), t);
    if (t.dataset.acting !== undefined) return setActing(t.dataset.acting, t);
    if (staffEdit && (t.dataset.saveaccess !== undefined || t.dataset.roledefault !== undefined || t.dataset.savepin !== undefined || t.dataset.removestaff !== undefined || t.dataset.savenames !== undefined)) return staffPanelAction(t);
    if (!panelRow) return;
    var r = S.rows.filter(function (x) { return x.id === panelRow.id; })[0] || panelRow;
    if (t.dataset.savepanel !== undefined) {
      var saved = false;
      // Check everything first: nothing is queued while any field is invalid.
      var pf = $("pickFlightText") ? normFlight($("pickFlightText").value).replace(/^NO FLIGHT$/, "") : null;
      if (pf && pf.length > 10) return saveErr("That does not look like a flight number.");
      var g = null;
      if ($("regText")) {
        g = $("regText").value.trim().toUpperCase().replace(/\s+/g, " ");
        if (g !== r.reg && !/^[A-Z0-9 ]{0,12}$/.test(g)) return saveErr("Check the reg: letters and numbers only.");
      }
      var rl = null;
      if ($("retD")) {
        var rt = readTime("retT"), old = r.return_at ? londonParts(new Date(r.return_at)) : { key: "", time: "" };
        if (rt === null) return saveErr("Type the time like 13:20 (or 1320).");
        if ($("retD").value !== old.key || (rt || "") !== old.time) {
          if (!$("retD").value || !rt) return saveErr("Enter when the car is back: the date and the time.");
          rl = $("retD").value + " " + rt;
        }
      }
      var dl = null;
      if ($("dropD")) {
        var dt = readTime("dropT"), od = r.drop_at ? londonParts(new Date(r.drop_at)) : { key: "", time: "" };
        if (dt === null) return saveErr("Type the time like 13:20 (or 1320).");
        if ($("dropD").value !== od.key || (dt || "") !== od.time || ($("dropD").value && carSheetDay(r) && $("dropD").value !== carSheetDay(r))) {
          if (!$("dropD").value || !dt) return saveErr("Enter the drop-off: the date and the time.");
          dl = $("dropD").value + " " + dt;
          if ((dl.slice(0, 10) !== od.key || dl.slice(0, 10) !== carSheetDay(r)) && !confirm("Move " + (r.reg || "this car") + " to PICKS " + biWhen(dl) + "?")) return;
        }
      }
      var f = null, ct, st;
      if ($("flightText")) {
        f = normFlight($("flightText").value); ct = readTime("collectText"); st = readTime("schedText");
        if (ct === null || st === null) return saveErr("Type the time like 13:20 (or 1320).");
      }
      if (pf !== null && pf !== r.flight) { run("set_pick_flight", { p_booking: r.id, p_flight: pf }, r, function (x) { x.flight = pf; }); saved = true; }
      if (g !== null && g !== r.reg) { run("set_reg", { p_booking: r.id, p_reg: g }, r, function (x) { x.reg = g; }); saved = true; }
      if (dl) {
        run("move_pick", { p_booking: r.id, p_drop_local: dl }, r, function (x) { x.drop_at = londonIso(dl); });
        saved = true;
      }
      if (rl) {
        if (r.kind === "picks") run("set_pick_return", { p_booking: r.id, p_return_local: rl }, r, function (x) { x.return_at = londonIso(rl); });
        else run("set_return", { p_booking: r.id, p_return_local: rl }, r);
        saved = true;
      }
      // The note first: turning a car into NO FLIGHT moves on to the
      // collection-time screen, and a note typed alongside must not be lost.
      if ($("noteText")) {
        var text = $("noteText").value.trim();
        if (text !== r.note) { run("set_note", { p_booking: r.id, p_note: text }, r, function (x) { x.note = text; }); saved = true; }
      }
      if (f !== null) {
        if (f === "NO FLIGHT" && r.flight !== "NO FLIGHT") { panelRow = null; quick = { id: r.id, chain: false, suggest: [], noFlight: true }; drawQuickFlight(); return; }
        // The old flight's time left in the box doesn't carry over to a new flight number.
        if (f !== r.flight && st === (r.sched_time || "")) st = undefined;
        if (f !== r.flight || (f === "NO FLIGHT" && ct !== undefined && ct !== (r.est_time || "")) || (st !== undefined && st !== (r.sched_time || ""))) { setFlight(r, f, ct, st); saved = true; }
      }
      if (saved) toast("Saved");
      return $("panel").close();
    }
    if (t.dataset.setyard) {
      var y = r.yard === t.dataset.setyard ? "" : t.dataset.setyard;
      run("set_yard", { p_booking: r.id, p_yard: y }, r, function (x) { x.yard = y; x.yard_before_t = ""; });
      return openPanel(r);
    }
    if (t.dataset.word) { var p = t.dataset.word.split(":"); tapDrop(r, p[0], p[1]); return $("panel").close(); }
    if (t.dataset.pcall) { tapPick(r, "called", t.dataset.pcall); return $("panel").close(); }
    if (t.dataset.pnoshow !== undefined) { tapPick(r, "intake", "No Show"); return $("panel").close(); }
    if (t.dataset.ptcam !== undefined) return ptCamera(r);
    if (t.dataset.shutter !== undefined) return ptShoot(r);
    if (t.dataset.camtorch !== undefined) return camToggleTorch();
    if (t.dataset.camlens !== undefined) return camLensNext();
    if (t.dataset.camtips) return camTipsSet(t.dataset.camtips === "on");
    if (t.dataset.camdone !== undefined) { t.disabled = true; t.textContent = "Saving…"; return camShots.then(function () { camStop(); openPt(r); ptStore(); ptPump(r); }); }
    if (t.dataset.ptretry !== undefined) return ptRetry(r);
    if (t.dataset.ptlinkshare !== undefined) {
      // No PT number in Settings: share the message and pick the chat.
      if (!navigator.share) return toast("Set the PT WhatsApp number in Settings.", true);
      navigator.share({ text: ptMessage(r) }).then(function () { ptSent(r); }).catch(function () {});
      return;
    }
    if (t.dataset.ptclear !== undefined) {
      if (pt) { var tk = pt.token; BK = BK.filter(function (y) { return y.token !== tk; }); ptForget(pt.id); }
      ptClear(); return openPt(r);
    }
    if (t.dataset.ptshare !== undefined) return ptShare(r, t);
    if (t.dataset.ptpdf !== undefined) return ptSharePdf(r, t);
    if (t.dataset.ptregshare !== undefined) {
      // No PT number in Settings: share the reg and pick the chat.
      if (!navigator.share) return toast("Set the PT WhatsApp number in Settings.", true);
      navigator.share({ text: ptCaption(r) }).then(function () { if (pt) { pt.regSent = true; ptStore(); } openPt(r); }).catch(function () {});
      return;
    }
    if (t.dataset.ptmark !== undefined) {
      if (r.pt_at) { ptClear(); return $("panel").close(); }
      if (pt && pt.id === r.id && pt.items.length) return ptTickKeep(r);
      return ptNoPhotos(r);
    }
    if (t.dataset.ptcamgo !== undefined) { if (pt && pt.id === r.id) { openPt(r); return ptCamera(r); } return ptStart(r); }
    if (t.dataset.ptback !== undefined) return pt && pt.id === r.id ? openPt(r) : $("panel").close();
    if (t.dataset.ptwhy) return ptTickWhy(r, t.dataset.ptwhy);
    if (t.dataset.charge) { recordCharge(r, t.dataset.charge); return openPanel(r); }
    if (t.dataset.chargeundo !== undefined) { recordCharge(r, ""); return openPanel(r); }
    if (t.dataset.exitshot) { $("exitFile").dataset.m = t.dataset.exitshot; $("exitFile").value = ""; return $("exitFile").click(); }
    if (t.dataset.exitundo !== undefined) return markExit(r, "");
    if (t.dataset.exitnophoto) return markExit(r, t.dataset.exitnophoto);
    if (t.dataset.chargeadd !== undefined) { S.chargeAdd = r.id; openPanel(r); var a = $("chgAmount"); if (a) a.focus(); return; }
    if (t.dataset.chargeagreed !== undefined) { setAgreed(r, t.dataset.chargeagreed); return openPanel(r); }
    if (t.dataset.removecar !== undefined) return askRemove(r);
    if (t.dataset.early !== undefined) return earlyMove(r, t, false);
    if (t.dataset.undoearly !== undefined) return earlyMove(r, t, true);
    if (t.dataset.pearly !== undefined) return earlyFromPicks(r, t);
    if (t.dataset.backcar !== undefined) return openPanel(r);
    if (t.dataset.removewhy) return removeCar(r, t.dataset.removewhy, t);
  });

  // ── add a car by hand, remove a no-show (office) ──
  // The reasons remove_booking accepts (setup 15, RTC and Early return from 110).
  var REMOVE_WHY = ["No show", "Cancelled", "Duplicate", "RTC", "Early return"];
  function removeWhyLine(by) {
    return REMOVE_WHY.map(function (k) { var n = by[k]; return n ? n + " " + (k === "RTC" ? k : k.toLowerCase()) : ""; }).filter(Boolean).join(" · ");
  }
  function askRemove(r) {
    // Two rows of buttons, so five reasons fit a phone in every look.
    var seg = function (ws, st) {
      return '<div class="pseg rmwhy"' + (st || "") + ">" + ws.map(function (w) {
        return '<button type="button" data-removewhy="' + w + '">' + w.toUpperCase() + "</button>";
      }).join("") + "</div>";
    };
    $("panelBody").innerHTML = '<h2 id="panelTitle">Remove ' + esc(r.reg || "this car") + "?</h2>" +
      '<p class="sub">It leaves the board and the counts, and is never carried over as an overstay. You can put it back from Menu, Removed cars.</p>' +
      "<label>WHY</label>" + seg(REMOVE_WHY.slice(0, 3)) + seg(REMOVE_WHY.slice(3), ' style="margin-top:6px"') + '<div class="pbtns"><button type="button" data-backcar>Back</button></div>';
  }
  async function removeCar(r, why, btn) {
    btn.disabled = true;
    var x = await sb.rpc("remove_booking", { p_booking: r.id, p_reason: why });
    if (x.error) { btn.disabled = false; return toast(x.error.message, true); }
    S.rows = S.rows.filter(function (y) { return y.id !== r.id; });
    dropRemoved(r.id); S.removed.push(x.data);
    toast(r.reg + " removed: " + why);
    $("panel").close();
  }
  function openRemoved() {
    var list = (S.removed || []).slice().sort(function (a, b) { return a.removed_at < b.removed_at ? 1 : -1; });
    $("panelBody").innerHTML = '<h2 id="panelTitle">Removed cars <small>' + esc(sheetName()) + "</small></h2>" +
      (list.length ? '<div class="rmlist">' + list.map(function (r) {
        return '<div><span><b>' + esc(r.reg || "NO REG") + "</b> " + esc(r.name) + '<small>' + esc(r.removed_reason) + " · " + esc(byName(r, "removed_by") || "") + " · " + esc(dayShort(r.removed_at) + " " + hhmm(r.removed_at)) +
          '</small></span><button type="button" data-restore="' + r.id + '">Put back</button></div>';
      }).join("") + "</div>" : '<p class="sub">Nothing removed from this sheet.</p>') +
      '<div class="pbtns"><button type="button" data-close>Close</button></div>';
    if (!$("panel").open) $("panel").showModal();
  }
  // Tutorials (Menu → Tutorials): short videos in public/tutorials, played
  // here. Terminal and bongo staff see their own; everyone else sees all.
  var TUTORIALS = [
    ["1-owner-every-option", "Every option in the app", "3:19", ""],
    ["2-terminal-setup", "Terminal: getting set up", "0:58", "terminal"],
    ["3-terminal-picks-and-pt", "Terminal: picks and PT", "1:39", "terminal"],
    ["4-terminal-drops", "Terminal: drops", "1:38", "terminal"],
    ["5-bongo-setup", "Bongo: getting set up", "0:58", "bongo"],
    ["6-bongo-picks-and-pt", "Bongo: picks and PT", "1:31", "bongo"],
    ["7-bongo-drops", "Bongo: drops", "1:38", "bongo"]
  ];
  function myTutorials() {
    var role = S.me && S.me.role;
    var own = TUTORIALS.filter(function (t) { return t[3] === role; });
    return own.length ? own : TUTORIALS;
  }
  function openTutorials(key) {
    var t = key && TUTORIALS.find(function (x) { return x[0] === key; });
    $("panelBody").innerHTML = t
      ? '<h2 id="panelTitle">' + esc(t[1]) + "</h2>" +
        '<video class="tutvid" src="/tutorials/' + t[0] + '.mp4" poster="/tutorials/' + t[0] + '.jpg" controls autoplay playsinline preload="metadata" style="display:block;height:68vh;max-width:100%;aspect-ratio:390/844;margin:0 auto;border-radius:10px;background:#000;object-fit:contain"></video>' +
        '<div class="pbtns"><button type="button" data-tutorials>All videos</button><button type="button" data-close>Close</button></div>'
      : '<h2 id="panelTitle">Tutorials</h2><div class="menu-list">' + myTutorials().map(function (x) {
          return '<button type="button" data-tutorial="' + x[0] + '">' + (hasFeatures() ? menuIcon("play") : "") + "<span>" + esc(x[1]) + " <small>" + x[2] + "</small></span></button>";
        }).join("") + '</div><div class="pbtns"><button type="button" data-close>Close</button></div>';
    if (!$("panel").open) $("panel").showModal();
  }
  async function restoreCar(btn) {
    btn.disabled = true;
    var x = await sb.rpc("restore_booking", { p_booking: btn.dataset.restore });
    if (x.error) { btn.disabled = false; return toast(x.error.message, true); }
    // The live update may have put it back already: replace, never add twice.
    dropRemoved(x.data.id);
    var at = S.rows.findIndex(function (y) { return y.id === x.data.id; });
    if (at >= 0) S.rows[at] = x.data; else S.rows.push(x.data);
    toast(x.data.reg + " is back on the board");
    openRemoved();
  }
  function openAddCar() {
    var sh = sheet(); if (!sh) return;
    var drops = sh.kind === "drops";
    function f(id, label, attrs) { return '<label for="' + id + '">' + label + '</label><input id="' + id + '" ' + (attrs || "") + ">"; }
    function when(id, label, day) { return '<label>' + label + '</label><div class="when2"><input id="' + id + 'D" type="date" value="' + esc(day || "") + '">' + timeBox(id + "T", "") + "</div>"; }
    $("panelBody").innerHTML = '<h2 id="panelTitle">Add a car <small>' + esc(sheetLabel(sh)) + "</small></h2>" +
      '<form id="addCarForm" novalidate>' +
      f("acReg", "REG", 'autocomplete="off" autocapitalize="characters" maxlength="12" required') +
      f("acName", "NAME", 'autocomplete="off" maxlength="80"') +
      f("acPhone", "PHONE", 'type="tel" autocomplete="off" maxlength="30"') +
      f("acMake", "CAR", 'autocomplete="off" maxlength="60" placeholder="Make and colour"') +
      f("acRef", "REF", 'autocomplete="off" maxlength="40" placeholder="Booking reference, if there is one"') +
      (drops ? when("acRet", "BACK", sh.day) + f("acFlight", "FLIGHT", 'autocomplete="off" autocapitalize="characters" maxlength="12"') +
        '<label for="acYard">YARD</label><select id="acYard"><option value="">None yet</option>' + (S.company.yards || []).map(function (y) { return '<option value="' + esc(y) + '">' + esc(YARD_LABEL[y] || y) + "</option>"; }).join("") + "</select>"
        : when("acDrop", "DROP-OFF", sh.day) + when("acRet", "BACK", "")) +
      '<label for="acNote">NOTE</label><textarea id="acNote" maxlength="500"></textarea>' +
      '<div class="pbtns"><button type="button" data-close>Cancel</button><button class="save" id="acGo">Add car</button></div></form>';
    if (!$("panel").open) $("panel").showModal();
    setTimeout(function () { $("acReg").focus(); }, 50);
  }
  // "" when no date; null when the typed time isn't one.
  function localWhen(id) {
    var d = $(id + "D"), t = readTime(id + "T");
    if (!d || !d.value) return "";
    if (t === null) return null;
    return d.value + " " + (t || "00:00");
  }
  async function addCar() {
    var sh = sheet(), reg = $("acReg").value.trim();
    if (!reg) return toast("Enter the registration.", true);
    var ret = localWhen("acRet"), drop = sh.kind === "picks" ? localWhen("acDrop") : "";
    if (ret === null || drop === null) return toast("Type the time like 13:20 (or 1320).", true);
    if (sh.kind === "drops") {
      if (!ret || !readTime("acRetT")) return toast("Enter when the car is back: the date and the time.", true);
      // The DROPS day runs to 06:00 next morning: 01:30 typed on the sheet's own
      // date means the early hours after it, not the morning before.
      var end = ((S.company && S.company.drops_day_end) || "06:00").slice(0, 5);
      if (ret.slice(0, 10) === sh.day && ret.slice(11) <= end) ret = addDaysKey(sh.day, 1) + ret.slice(10);
    }
    var p = { reg: reg, name: $("acName").value, phone: $("acPhone").value, make: $("acMake").value, ref: $("acRef").value, note: $("acNote").value,
      return_local: ret, drop_local: drop,
      flight: $("acFlight") ? normFlight($("acFlight").value) || "" : "", yard: $("acYard") ? $("acYard").value : "" };
    $("acGo").disabled = true;
    var x = await sb.rpc("add_booking", { p_sheet: sh.id, p: p });
    if (x.error) { $("acGo").disabled = false; return toast(x.error.message, true); }
    await loadRows();
    toast(x.data.reg + " added");
    $("panel").close();
    if (sh.kind === "picks") await askDrops([x.data.id]);
  }
  // A new PICKS car (added by hand, or new in a re-imported file) booked back
  // on a day whose DROPS sheet is already in isn't on that DROPS sheet: ask,
  // and put it there (database part 50).
  async function askDrops(ids) {
    if (!ids || !ids.length || !can("import")) return;
    var m = await sb.rpc("drops_missing", { p_ids: ids });
    var list = (m && m.data) || []; if (!list.length) return;
    function line(x) { return (x.reg || "NO REG") + (x.name ? " (" + x.name + ")" : "") + ", back " + dayShort(x.return_at) + " " + hhmm(x.return_at); }
    var q = list.length === 1
      ? line(list[0]) + ".\n\nThe DROPS sheet for " + sheetLabel({ day: list[0].day, kind: "drops" }).replace(/^DROPS /, "") + " is already in. Add this car to it too?"
      : list.length + " new cars are booked back on a day whose DROPS sheet is already in:\n\n" + list.map(line).join("\n") + "\n\nAdd them to DROPS too?";
    if (!confirm(q)) return;
    var done = [];
    for (var i = 0; i < list.length; i++) {
      var a = await sb.rpc("add_pick_to_drops", { p_booking: list[i].id });
      if (a.error) toast(a.error.message, true); else done.push(list[i].reg);
    }
    if (done.length) toast("Added to DROPS: " + done.join(", ") + ". Add the flight there.");
  }

  // ── PICKS: returns by day, stats by hour (as on the Sheet app) ──
  function ordinal(d) { var t = d % 10, h = d % 100; return t === 1 && h !== 11 ? "ST" : t === 2 && h !== 12 ? "ND" : t === 3 && h !== 13 ? "RD" : "TH"; }
  function carsWord(n) { return n + (n === 1 ? " CAR" : " CARS"); }
  function moneyIn(note) { var m = String(note || "").match(/£\s*(\d+(?:\.\d{2})?)/g); return m ? m.reduce(function (t, x) { return t + (parseFloat(x.replace(/[^\d.]/g, "")) || 0); }, 0) : 0; }
  // "cash" or "card" in the note; both words (or neither) stays unmarked.
  function payKind(note) { var t = String(note || ""), cash = /\bcash\b/i.test(t), card = /\bcard\b/i.test(t); return cash && !card ? "cash" : card && !cash ? "card" : ""; }
  function sheetName() { var sh = sheet(); return sh ? sheetLabel(sh) : ""; }

  function picksReturns() {
    var groups = {}, owed = [];
    S.rows.forEach(function (r) {
      var k = r.return_at ? londonParts(new Date(r.return_at)).key : "";
      if (!groups[k]) { var d = k ? +k.slice(8, 10) : 0; groups[k] = { key: k || "9999", label: k ? pad(d) + ordinal(d) : "NO RETURN DATE", n: 0 }; }
      groups[k].n++;
      if (moneyIn(r.note)) owed.push({ line: (r.reg || "(no reg)") + " · " + (r.name || ""), due: moneyIn(r.note), note: r.note.replace(/^!\s*/, ""), kind: payKind(r.note) });
    });
    return { days: Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return a.key < b.key ? -1 : 1; }), owed: owed, cars: S.rows.length };
  }
  function picksStats() {
    var sched = {}, done = {}, last30 = 0, last60 = 0, now = Date.now();
    S.rows.forEach(function (r) {
      // Both columns by the BOOKED hour: "of the cars due this hour, how many are in".
      var isIn = r.intake === "Collected" || r.intake === "RTC";
      if (r.drop_at) { var h = +londonParts(new Date(r.drop_at)).time.slice(0, 2); sched[h] = (sched[h] || 0) + 1; if (isIn) done[h] = (done[h] || 0) + 1; }
      // The rolling counts are cars actually taken in lately; RTC has already gone again.
      if (r.intake === "Collected" && r.intake_at) { var m = (now - new Date(r.intake_at).getTime()) / 60000; if (m >= 0 && m <= 30) last30++; if (m >= 0 && m <= 60) last60++; }
    });
    var hours = [], ts = 0, td = 0;
    for (var h = 0; h < 24; h++) {
      if (!sched[h] && !done[h]) continue;
      ts += sched[h] || 0; td += done[h] || 0;
      hours.push({ label: pad(h) + ":00–" + pad((h + 1) % 24) + ":00", sched: sched[h] || 0, done: done[h] || 0 });
    }
    return { hours: hours, totalSched: ts, totalDone: td, last30: last30, last60: last60 };
  }
  // DROPS by the booked return hour, in shift order (06:00 round to 05:59).
  // Overstays are older returns, so they get their own line, not an hour.
  function dropsStats() {
    var due = {}, sent = {}, done = {}, over = { due: 0, sent: 0, done: 0 }, last30 = 0, last60 = 0, now = Date.now();
    // Morning shift 06:00–17:30, night shift 17:31–05:59, by the booked return time.
    var morning = { due: 0, sent: 0, done: 0 }, night = { due: 0, sent: 0, done: 0 };
    var shift = (sheet() || {}).day, start = +((S.company && S.company.drops_day_end) || "06").slice(0, 2);
    S.rows.forEach(function (r) {
      var isSent = !!r.sent_at, isDone = !!r.cleared_at;
      var p = r.return_at ? londonParts(new Date(r.return_at)) : null;
      var old = r.overstay || !p || (p.key < shift) || (p.key === shift && +p.time.slice(0, 2) < start);
      if (old) { over.due++; if (isSent) over.sent++; if (isDone) over.done++; }
      else {
        // Hours since the shift began: 06:00 on the next morning is the shift's last slot, not its first.
        var later = Math.round((Date.parse(p.key) - Date.parse(shift)) / 86400000);
        var h = later * 24 + +p.time.slice(0, 2) - start;
        due[h] = (due[h] || 0) + 1; if (isSent) sent[h] = (sent[h] || 0) + 1; if (isDone) done[h] = (done[h] || 0) + 1;
        var mins = +p.time.slice(0, 2) * 60 + +p.time.slice(3, 5), sh2 = mins >= 360 && mins <= 1050 ? morning : night;
        sh2.due++; if (isSent) sh2.sent++; if (isDone) sh2.done++;
      }
      if (r.cleared_at) { var m = (now - new Date(r.cleared_at).getTime()) / 60000; if (m >= 0 && m <= 30) last30++; if (m >= 0 && m <= 60) last60++; }
    });
    var hours = [], t = { due: over.due, sent: over.sent, done: over.done };
    Object.keys(due).map(Number).sort(function (a, b) { return a - b; }).forEach(function (i) {
      var h = (start + i) % 24, nextDay = i >= 24 ? " (" + dayWord(addDaysKey(shift, Math.floor((start + i) / 24))) + ")" : "";
      t.due += due[i]; t.sent += sent[i] || 0; t.done += done[i] || 0;
      hours.push({ label: pad(h) + ":00–" + pad((h + 1) % 24) + ":00" + nextDay, due: due[i], sent: sent[i] || 0, done: done[i] || 0 });
    });
    return { hours: hours, over: over, total: t, morning: morning, night: night, last30: last30, last60: last60 };
  }
  function chargeTotals() {
    var t = { due: 0, dueCars: 0, cash: 0, card: 0, waived: 0 };
    S.rows.forEach(function (r) {
      if (r.charge_method) { t[r.charge_method] = (t[r.charge_method] || 0) + (+r.charge_amount || 0); return; }
      var d = chargeDue(r); if (d && d.amount > 0) { t.due += d.amount; t.dueCars++; }
    });
    return t;
  }
  function chargeLines() {
    if (!(+(S.company && S.company.overstay_rate))) return [];
    var t = chargeTotals();
    return [["Overstay: still owed (" + t.dueCars + ")", money(t.due), "owed"], ["Overstay paid: cash", money(t.cash), "cash"], ["Overstay paid: card", money(t.card), "card"], ["Overstay waived", money(t.waived), "waived"]];
  }
  function openDropsStats() {
    var D = dropsStats();
    function line(label, x, cls) { return '<div class="pst4' + (cls || "") + '"><b' + (cls ? "" : ' class="num"') + ">" + label + '</b><i class="num">' + x.due + '</i><i class="num">' + x.sent + '</i><i class="num' + (x.done ? " dn" : "") + '">' + x.done + "</i></div>"; }
    $("panelBody").innerHTML = '<h2 id="panelTitle">DROPS by hour <small>' + esc(sheetName()) + "</small></h2>" +
      '<div class="pst4 head"><b>Due back</b><i>Due</i><i>Sent</i><i>Collected</i></div>' +
      D.hours.map(function (h) { return line(h.label, h); }).join("") +
      (D.over.due ? line("Overstays", D.over, " sec2") : "") +
      line("TOTAL", D.total, " tot") +
      line("Morning 06:00–17:30", D.morning, " shift") + line("Night 17:31–05:59", D.night, " shift") +
      (D.over.due ? '<div class="hint">Overstays are counted on their own, not in a shift.</div>' : "") +
      '<div class="pst4"><b>Collected, last 30 min</b><i class="num">' + D.last30 + '</i><i></i><i></i></div><div class="pst4"><b>Collected, last 60 min</b><i class="num">' + D.last60 + "</i><i></i><i></i></div>" +
      chargeLines().map(function (x, i) { return '<div class="pst4' + (i === 0 ? " owed" : "") + '"><b>' + esc(x[0]) + '</b><i></i><i></i><i class="num">' + x[1] + "</i></div>"; }).join("") +
      '<div class="pbtns"><button type="button" data-close>Close</button><button type="button" class="save" data-copy="stats">Copy</button></div>';
    panelRow = null; if (!$("panel").open) $("panel").showModal();
  }
  function catLines() {
    var sh = sheet(), n = catCounts();
    return CATS.filter(function (c) { return sh && (sh.short_until || c[0] === "same" || c[0] === "next"); })
      .map(function (c) { return [c[1] + (c[0] === "short" ? " (to " + dayWord(sh.short_until) + ")" : ""), n[c[0]]]; });
  }
  function catPanelHtml() {
    var lines = catLines();
    return "<label>CATEGORIES</label>" + '<div class="sumlist">' + lines.map(function (x) { return '<div class="sumrow"><b>' + esc(x[0]) + "</b><span>" + carsWord(x[1]) + "</span></div>"; }).join("") + "</div>" +
      (sheet() && !sheet().short_until ? '<div class="hint">Short dates not set.</div>' : "");
  }
  function openReturns() {
    var R0 = picksReturns();
    $("panelBody").innerHTML = '<h2 id="panelTitle">Returns <small>' + esc(sheetName()) + "</small></h2>" +
      "<label>BY DAY (" + R0.days.length + ")</label>" +
      (R0.days.length ? '<div class="sumlist">' + R0.days.map(function (d) { return '<div class="sumrow"><b>' + esc(d.label) + " RTNS</b><span>" + carsWord(d.n) + "</span></div>"; }).join("") + "</div>" : '<div class="hint">No cars on this sheet.</div>') +
      '<div class="hint">' + carsWord(R0.cars) + " on the sheet.</div>" + catPanelHtml() +
      "<label>MONEY NOTED (" + R0.owed.length + ")</label>" +
      (R0.owed.length ? '<div class="sumlist">' + R0.owed.map(function (x) {
        return '<div class="sumrow"><b>' + esc(x.line) + "</b><span>" + (x.kind ? '<b class="pay ' + x.kind + '">' + x.kind.toUpperCase() + "</b> " : "") + esc(x.note) + "</span></div>";
      }).join("") + "</div>" : '<div class="hint">None noted.</div>') +
      '<div class="pbtns"><button type="button" data-close>Close</button><button type="button" class="save" data-copy="returns">Copy</button></div>';
    panelRow = null; if (!$("panel").open) $("panel").showModal();
  }
  function openPicksStats() {
    var P = picksStats();
    $("panelBody").innerHTML = '<h2 id="panelTitle">PICKS stats <small>' + esc(sheetName()) + "</small></h2>" +
      '<div class="pst head"><b>Hour</b><i>Scheduled</i><i>Completed</i></div>' +
      P.hours.map(function (h) { return '<div class="pst"><b class="num">' + h.label + '</b><i class="num">' + h.sched + '</i><i class="num' + (h.done ? " dn" : "") + '">' + h.done + "</i></div>"; }).join("") +
      '<div class="pst tot"><b>TOTAL</b><i class="num">' + P.totalSched + '</i><i class="num dn">' + P.totalDone + "</i></div>" +
      '<div class="pst sec"><b>PICKS STATS</b></div>' +
      '<div class="pst"><b>Last 30 min</b><i class="num">' + P.last30 + '</i><i></i></div><div class="pst"><b>Last 60 min</b><i class="num">' + P.last60 + "</i><i></i></div>" +
      catLines().map(function (x) { return '<div class="pst"><b>' + x[0] + '</b><i class="num">' + x[1] + "</i><i></i></div>"; }).join("") +
      '<div class="pbtns"><button type="button" data-close>Close</button><button type="button" class="save" data-copy="stats">Copy</button></div>';
    panelRow = null; if (!$("panel").open) $("panel").showModal();
  }
  // ── Operations: Hourly stats and Shift summary as pages (ops.css) ──
  function opsSub(sh) {
    // Operations Refined names the shift and its hours on a phone too.
    if (opsDesk() || isRefined()) return '<div class="ops-scopewrap">' + opsScope(sh) + "</div>";
    return '<p class="ops-sub">' + (sh.kind === "drops" ? "Drops" : "Picks") + " · " + esc(new Date(sh.day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })) + "</p>";
  }
  // Numbers side by side in one panel: [[label, value], …].
  // x[2], when given, is the tile's tap: attributes from tileAttr() or flTileAttr().
  function opsStrip(items) { return '<div class="ops-strip">' + items.map(function (x) { return "<div" + (x[2] ? ' class="tap"' + x[2] : "") + "><span>" + esc(x[0]) + '</span><strong class="num">' + x[1] + "</strong></div>"; }).join("") + "</div>"; }
  function opsPanel(title, aside, body, foot) {
    return '<section class="ops-card"><header><strong>' + esc(title) + "</strong>" + (aside ? "<small>" + esc(aside) + "</small>" : "") + "</header>" + body + (foot ? '<p class="ops-foot">' + esc(foot) + "</p>" : "") + "</section>";
  }
  // A table: the first cell is the label (trusted HTML), the rest numbers.
  // A row with .tap (attributes from tileAttr) opens its cars.
  function opsTable(head, rows, total) {
    function line(c, cls) { return '<div class="ops-tr' + (cls ? " " + cls : "") + (c.tap ? ' tap"' + c.tap : '"') + ' style="--cols:' + (c.length - 1) + '">' + c.map(function (x, i) { return i ? '<i class="num">' + x + "</i>" : "<b>" + x + "</b>"; }).join("") + "</div>"; }
    return (head ? line(head, "th") : "") + rows.map(function (r) { return line(r); }).join("") + (total ? line(total, "tot") : "");
  }
  // ── Operations on a wide screen (900 px and up, ops.css "wide screen") ──
  // The DROPS board as a table (time, car, flight, customer, yard, status,
  // buttons) and Flights as tables. Phones and narrow windows keep the rows
  // above exactly as they are; going across 900 px redraws.
  var OPS_DESK_MQ = window.matchMedia ? window.matchMedia("(min-width: 900px)") : null;
  function opsDesk() { return isOps() && !!OPS_DESK_MQ && OPS_DESK_MQ.matches; }
  function longDate(key) { return new Date(key + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }); }
  function weekdayOf(key) { return new Date(key + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }); }
  function minsOf(t) { return /^\d{2}:\d{2}$/.test(t || "") ? +t.slice(0, 2) * 60 + +t.slice(3) : null; }
  // Minutes from the timetable time to the latest estimate (across midnight too); 0 when either is missing.
  function lateMins(r) { var s = minsOf(r.sched_time), e = minsOf(r.est_time); return s === null || e === null ? 0 : (e - s + 1440 + 720) % 1440 - 720; }
  // Which shift the open sheet is, worked out from now (never assumed).
  function opsShiftWord(sh) {
    if (sh.kind === "drops") return { "CURRENT NIGHT SHIFT": "Current shift", "NEXT SHIFT": "Next shift", "COMING UP": "Coming up", "PAST SHIFT": "Past shift" }[shiftTag(sh)] || "";
    var today = londonParts(new Date()).key;
    return sh.day === today ? "Today" : sh.day === addDaysKey(today, 1) ? "Tomorrow" : sh.day === addDaysKey(today, -1) ? "Yesterday" : sh.day > today ? "Coming up" : "Past day";
  }
  // "DROPS · Wednesday 14 October · 06:00 Wed to 05:59 Thu · Current shift": the
  // sheet, its full date and the hours it covers (the company's day end), London time.
  function opsScope(sh) {
    if (!sh || !sh.day) return "";
    var bits = [isRefined() && !opsDesk() ? refinedDay(sh.day) : longDate(sh.day)];
    if (sh.kind === "drops") {
      var end = ((S.company && S.company.drops_day_end) || "06:00").slice(0, 5), last = (minsOf(end) + 1439) % 1440;
      var lastDay = end === "00:00" ? sh.day : addDaysKey(sh.day, 1);
      bits.push(end + " " + weekdayOf(sh.day) + " to " + pad(Math.floor(last / 60)) + ":" + pad(last % 60) + " " + weekdayOf(lastDay));
    } else bits.push("Meet day");
    var tag = opsShiftWord(sh);
    return '<p class="ops-scope"><b>' + (sh.kind === "drops" ? "DROPS" : "PICKS") + "</b> · " + esc(bits.join(" · ")) + (tag ? ' <em class="ops-badge">' + esc(tag) + "</em>" : "") + "</p>";
  }
  // A check's time with its own date unless it was today.
  function whenLabel(ts) { return londonParts(new Date(ts)).key === londonParts(new Date()).key ? "today " + hhmm(ts) : dayShort(ts) + " " + hhmm(ts); }
  function opsHeadHtml(sh) { return '<h1>Operations board</h1>' + opsScope(sh); }
  function opsColHead() {
    return ["Return", "Registration · vehicle", "Flight", "Customer · ref", "Yard", "Status", swipeOnly() ? "Done" : "Actions"].map(function (x) { return "<span>" + x + "</span>"; }).join("");
  }
  // What's happening to the car, in words, from the same times the buttons show.
  function opsDropState(r, overWord, cmpl) {
    if (r.cleared_at) return ['<b class="st-x">' + (cmpl ? "Complaint" : "Cleared") + ' <span class="num">' + esc(hhmm(r.cleared_at)) + "</span></b>"];
    if (atDesk(r)) { var dw = Math.max(0, Math.floor(minsSince(r.desk_at))); return ['<b class="st-d">At desk <span class="num">' + esc(hhmm(r.desk_at)) + " · " + dw + " min</span></b>",
      r.sent_at ? 'Sent <span class="num">' + esc(hhmm(r.sent_at)) + "</span>" : '<span class="num">waiting ' + Math.max(0, Math.floor(minsSince(r.called_at))) + " min</span>"]; }
    if (r.sent_at) return ['<b class="st-s">Sent <span class="num">' + esc(hhmm(r.sent_at)) + "</span></b>"];
    if (overWord || inOverstayBlock(r)) return ['<b class="st-o">Overstay' + (r.called_at ? ' <span class="num">' + esc(hhmm(r.called_at)) + "</span>" : "") + "</b>"];
    if (r.called_at) { var w = Math.max(0, Math.floor(minsSince(r.called_at))); return ['<b class="st-c">Called <span class="num">' + esc(hhmm(r.called_at)) + "</span></b>", '<span class="num">waiting ' + w + " min</span>"]; }
    return ['<span class="st-n">Not called</span>'];
  }
  // The flight's own state, from the flight check only.
  function opsFlightState(r, canc) {
    if (canc) return '<span class="fx bad">Flight cancelled</span>';
    var late = lateMins(r);
    if (r.est_time === "DELAY" || r.flight_status === "delayed" || (r.flight_status === "expected" && late > 0)) return '<span class="fx bad">Delayed' + (late > 0 ? " +" + late + " min" : "") + "</span>";
    if (r.flight_status === "expected") return '<span class="fx warn">Running late</span>';
    if (r.flight_status === "landed") return '<span class="fx ok">Landed</span>';
    if (r.flight_status === "airborne") return '<span class="fx">In the air</span>';
    return "";
  }
  function checkWord(r) {
    return /^Not in the timetable/.test(r.flight_note) ? "CHECK MANUALLY" : /over 6 h from the booked time/.test(r.flight_note) && r.return_at ? "CHECK FLIGHT · BOOKED " + esc(hhmm(r.return_at)) : "CHECK FLIGHT NO.";
  }
  // The flight number alone; tapping it changes it (as the car's FLIGHT NUMBER does).
  function flightCell(r) {
    var noFl = r.flight === "NO FLIGHT" || r.flight_status === "noflight";
    return noFl ? (can("flights") ? '<button type="button" class="flno mut" data-addflight title="Change flight">No flight</button>' : '<span class="mut">No flight</span>')
      : r.flight ? (can("flights") ? '<button type="button" class="flno num" data-addflight title="Change flight">' + esc(r.flight) + "</button>" : '<b class="num">' + esc(r.flight) + "</b>")
      : can("flights") ? '<button type="button" class="addflight" data-addflight>+ FLIGHT</button>' : '<span class="mut">No flight number</span>';
  }
  function opsDeskRow(r, cls, overWord, cmpl, canc, over) {
    var noFl = r.flight === "NO FLIGHT" || r.flight_status === "noflight";
    // Return: the time they booked to be back. An early return was booked for
    // another day (its EARLY line says when); with no flight number, the
    // collection time staff typed in is under it, named as such.
    var t = r.early ? '<b class="num">' + esc(r.sched_time || "—") + '</b><small>Early return</small>'
      : '<b class="num">' + esc(r.return_at ? hhmm(r.return_at) : "—") + "</b>" + (noFl && r.est_time ? '<small>Collect <span class="num">' + esc(r.est_time) + "</span></small>" : "");
    var mk = String(r.make || "").trim(), fl = flightCell(r);
    // The flight's times sit in Status, beside what the flight check says.
    var landed = !noFl && !canc && r.flight_status === "landed" && r.est_time && r.est_time !== "DELAY";
    var fstate = landed ? '<span class="fx ok">Landed <span class="num">' + esc(r.est_time) + "</span></span>" : opsFlightState(r, canc);
    var times = [];
    if (!noFl && r.sched_time) times.push('Sch <span class="num">' + esc(r.sched_time) + "</span>");
    if (!noFl && !canc && !landed && r.est_time && r.est_time !== "DELAY") times.push('Est <span class="num">' + esc(r.est_time) + "</span>");
    var ftimes = times.length ? '<span class="ftm">' + times.join(" · ") + "</span>" : r.flight && !noFl && !fstate && !r.sent_at && !r.cleared_at ? '<span class="mut">No times yet</span>' : "";
    var state = opsDropState(r, overWord, cmpl);
    var extra = [fstate, ftimes, flightToCheck(r) ? '<span class="tag ck">' + checkWord(r) + "</span>" : "", over && !overWord && !inOverstayBlock(r) ? '<span class="tag ov">OVERSTAY</span>' : "",
      chargeTag(r).replace(/^ · /, ""), exitTag(r)].filter(Boolean);
    var notes = earlyLine(r) + noteLine(r);
    return '<div class="row drow' + cls + (S.pending[r.id] ? " busy" : "") + '" data-id="' + r.id + '">' +
      '<div class="dc dc-t" data-open>' + t + "</div>" +
      '<div class="dc dc-r"><div class="l1"><button type="button" class="reg" data-open>' + esc(r.reg || "NO REG") + "</button>" + (r.num ? '<span class="dn num">#' + r.num + "</span>" : "") + keyBox(r) + catTag(r) + wasTag(r) + "</div>" +
        '<div class="sub" data-open title="' + esc(mk) + '">' + (mk ? esc(niceMake(mk)) : '<span class="mut">No vehicle details</span>') + "</div></div>" +
      '<div class="dc dc-f" data-open><div class="l1">' + fl + "</div></div>" +
      '<div class="dc dc-c" data-open><div class="l1" title="' + esc(r.name) + '">' + esc(nice(r.name) || "—") + '</div><div class="sub num" title="' + esc(r.ref) + '">' + esc(r.ref || "") + "</div></div>" +
      '<div class="dc dc-y">' + (yardChip(r) || '<span class="mut">—</span>') + "</div>" +
      '<div class="dc dc-s" data-open><div class="l1">' + state[0] + "</div>" + (state[1] || extra.length ? '<div class="sub">' + [state[1]].concat(extra).filter(Boolean).join(" ") + "</div>" : "") + "</div>" +
      (notes ? '<div class="dc dc-n" data-open>' + notes + "</div>" : "") +
      (swipeOnly() ? stepStatus(r) : dropButtons(r, overWord, cmpl)) + "</div>";
  }
  // PICKS on a wide screen: when the car arrives, the car, the customer, when
  // and how they come back, and what's been done with it. Where it's parked is
  // the location button among COLL / RTC / PT, as on the phone.
  function opsPickColHead() {
    return ["Arrival", "Registration · vehicle", "Customer · ref", "Return", "Return flight", "Status", "Actions"].map(function (x) { return "<span>" + x + "</span>"; }).join("");
  }
  function opsDeskPickRow(r, cls) {
    var mk = String(r.make || "").trim(), by = function (who) { var n = nice(String(who || "").trim().split(/\s+/)[0]); return n ? " · " + esc(n) : ""; };
    var state = !r.intake ? '<span class="st-n">Not in yet</span>' : r.intake === "Collected" ? '<b class="st-s">Taken in <span class="num">' + esc(hhmm(r.intake_at)) + "</span></b>"
      : r.intake === "No Show" ? '<b class="st-x">No show</b>' : r.intake === "RTC" ? '<b class="st-o">RTC</b>' : "<b>" + esc(r.intake) + "</b>";
    var extra = [r.intake === "Collected" ? (r.pt_at ? '<span class="fx ok">PT done <span class="num">' + esc(hhmm(r.pt_at)) + "</span>" + by(byName(r, "pt_by")) + "</span>" : '<span class="fx warn">PT photos to take</span>') : "",
      S.ptUnsaved[r.id] && r.pt_at ? '<span class="tag due">PT NOT SAVED</span>' : "",
      r.pick_called ? '<span class="tag' + (r.pick_called === "New Booking" ? ' nb">NEW BOOKING' : '">' + esc(r.pick_called)) + "</span>" : "",
      r.doc_path ? '<span class="fx">Docket photo</span>' : ""].filter(Boolean);
    var back = r.return_at ? '<b class="num">' + esc(dayShort(r.return_at)) + '</b><div class="sub num">' + esc(hhmm(r.return_at)) + " " + catTag(r) + "</div>" : '<span class="mut">No return date</span>';
    return '<div class="row drow prow' + cls + (S.pending[r.id] ? " busy" : "") + '" data-id="' + r.id + '">' +
      '<div class="dc dc-t" data-open><b class="num">' + esc(hhmm(r.drop_at) || "—") + "</b></div>" +
      '<div class="dc dc-r"><div class="l1"><button type="button" class="reg" data-open>' + esc(r.reg || "NO REG") + "</button>" + (r.num ? '<span class="dn num">#' + r.num + "</span>" : "") + "</div>" +
        '<div class="sub" data-open title="' + esc(mk) + '">' + (mk ? esc(niceMake(mk)) : '<span class="mut">No vehicle details</span>') + "</div></div>" +
      '<div class="dc dc-c" data-open><div class="l1" title="' + esc(r.name) + '">' + esc(nice(r.name) || "—") + '</div><div class="sub num" title="' + esc(r.ref) + '">' + esc(r.ref || "") + "</div></div>" +
      '<div class="dc dc-b" data-open>' + back + "</div>" +
      '<div class="dc dc-f" data-open>' + (r.flight ? '<b class="num">' + esc(r.flight) + "</b>" : '<span class="mut">Not given</span>') + "</div>" +
      '<div class="dc dc-s" data-open><div class="l1">' + state + "</div>" + (extra.length ? '<div class="sub">' + extra.join(" ") + "</div>" : "") + "</div>" +
      (r.note ? '<div class="dc dc-n" data-open>' + noteLine(r) + "</div>" : "") + pickActs(r) + "</div>";
  }
  // Under the board: what the numbers mean.
  function opsBoardFoot() {
    var sh = sheet(); if (!opsDesk() || !sh || !S.rows.length) return "";
    if (sh.kind === "picks") {
      var c = function (v) { return S.rows.filter(function (r) { return (r.intake || "") === v; }).length; };
      return '<p class="ops-bfoot"><span class="num">' + c("") + "</span> not in yet · <span class=\"num\">" + c("Collected") + "</span> taken in · " + c("No Show") + " no show · " + c("RTC") + " RTC · " + S.rows.length + " cars · All times Europe/London</p>";
    }
    var done = S.rows.filter(function (r) { return !outstanding(r); }).length;
    return '<p class="ops-bfoot"><span class="num">' + S.rows.filter(waiting).length + "</span> not sent yet · <span class=\"num\">" + done + "</span> done (sent and clear) · " + S.rows.length + " cars · All times Europe/London</p>";
  }

  // Flights on a wide screen: what needs a person first, then each flight's
  // times and state. Every number says what it counts (bookings or flights).
  var FL_FILTERS = [["all", "All"], ["attention", "Needs attention"], ["scheduled", "Scheduled"], ["delayed", "Delayed"], ["landed", "Landed"], ["cancelled", "Cancelled"], ["unchecked", "Not checked"]];
  function flKind(r) {
    var st = r.flight_status || "";
    if (r.flight === "NO FLIGHT" || st === "noflight") return "noflight";
    if (st === "cancelled") return "cancelled";
    if (st === "landed") return "landed";
    if (st === "delayed" || r.est_time === "DELAY" || (st === "expected" && lateMins(r) > 0)) return "delayed";
    if (st === "scheduled" || st === "expected" || st === "airborne") return "scheduled";
    return "unchecked";
  }
  // Why a booking needs a look, only from what the app knows.
  function flIssue(r) {
    if (!r.flight) return ["No flight number recorded", "Missing", "warn"];
    if (/^Not in the timetable/.test(r.flight_note)) return ["Not found in the timetable", "Lookup failed", "bad"];
    if (/over 6 h from the booked time/.test(r.flight_note)) return [r.flight_note.replace(/ · check the flight number$/, ""), "Check time", "warn"];
    if (!/^([A-Z0-9]{2}\d{1,5}|[A-Z]{3}\d{1,4})$/.test(r.flight)) return ["Not a valid flight number", "Invalid", "bad"];
    return [r.flight_note ? r.flight_note.replace(/ · check the flight number$/, "") : "Needs checking", "Check", "warn"];
  }
  function flMatch(r) {
    var q = String(S.flQ || "").toUpperCase().replace(/\s+/g, "");
    return !q || [r.reg, r.flight, r.ref, r.name].join("").toUpperCase().replace(/\s+/g, "").indexOf(q) !== -1;
  }
  function flCar(r) { return '<b class="num">' + esc(r.reg || "NO REG") + '</b> <small class="num" title="' + esc(r.ref) + '">' + esc(r.ref || "") + "</small>"; }
  function flTablesHtml() {
    var all = S.rows.filter(function (r) { return r.kind === "drops"; }).sort(function (a, b) { return orderAt(a) < orderAt(b) ? -1 : 1; });
    var att = all.filter(function (r) { return !r.cleared_at && (!r.flight || flightToCheck(r)); }), rest = all.filter(function (r) { return r.flight && !flightToCheck(r); });
    var f = S.flFilter || "all", h = "";
    if (f === "all" || f === "attention") {
      var rows = att.filter(flMatch);
      h += '<section class="ops-card fd-card"><header><strong>Needs attention</strong><small>' + att.length + (att.length === 1 ? " booking" : " bookings") + "</small>" +
        (missingFlights().length && can("flights") ? '<button type="button" class="btn ghost small" data-fillflights>Add flight numbers</button>' : "") + "</header>" +
        '<div class="fd-tr fd-a th"><span>Return</span><span>Vehicle · ref</span><span>Flight</span><span>Issue</span><span>Status</span><span>Action</span></div>' +
        (rows.length ? rows.map(function (r) {
          var is = flIssue(r), act = !r.flight && can("flights") ? '<button type="button" class="btn ghost small" data-addflight>Add flight</button>'
            : '<button type="button" class="btn ghost small" data-open>' + (can("flights") ? "Edit flight" : "View") + "</button>";
          return '<div class="fd-tr fd-a" data-id="' + r.id + '"><span class="num" data-open>' + esc(hhmm(r.return_at) || "—") + '</span><span class="fd-car" data-open>' + flCar(r) + "</span>" +
            '<span class="num" data-open>' + esc(r.flight || "—") + '</span><span data-open>' + esc(is[0]) + '</span><span><em class="ops-badge ' + is[2] + '">' + esc(is[1]) + "</em></span><span>" + act + "</span></div>";
        }).join("") : '<p class="ops-foot">' + (att.length ? "No match for the search." : "Every booking has a flight number the check can use.") + "</p>") + "</section>";
    }
    if (f !== "attention") {
      var list = rest.filter(function (r) { return (f === "all" || flKind(r) === f) && flMatch(r); }), tt = (S.runs || []).filter(function (x) { return x.source === "schedule"; })[0];
      h += '<section class="ops-card fd-card"><header><strong>Flight status</strong><small>' + (tt ? "Timetable checked " + esc(whenLabel(tt.at)) : "Timetable not checked yet") + "</small></header>" +
        '<div class="fd-tr fd-s th"><span>Return</span><span>Vehicle · ref</span><span>Flight</span><span>Scheduled</span><span>Estimated</span><span>Status</span><span>Action</span></div>' +
        (list.length ? list.map(function (r) {
          var k = flKind(r), late = lateMins(r), st = r.flight_status || "";
          var word = k === "noflight" ? "No flight number" : k === "delayed" ? "Delayed" + (late > 0 ? " +" + late + " min" : "") : k === "unchecked" ? "Not checked yet" : k === "cancelled" ? "Cancelled" : FLIGHT_WORD[st] || sentence(st);
          var tone = k === "landed" ? "ok" : k === "cancelled" ? "bad" : k === "delayed" ? "warn" : "";
          var est = k === "noflight" ? (r.est_time ? 'Collect <span class="num">' + esc(r.est_time) + "</span>" : "—") : r.est_time === "DELAY" ? "Delayed" : r.est_time ? (k === "landed" ? "Landed " : "") + '<span class="num">' + esc(r.est_time) + "</span>" : "—";
          return '<div class="fd-tr fd-s fs-' + esc(k) + '" data-id="' + r.id + '"><span class="num" data-open>' + esc(hhmm(r.return_at) || "—") + '</span><span class="fd-car" data-open>' + flCar(r) + "</span>" +
            '<span class="num" data-open>' + esc(k === "noflight" ? "—" : r.flight) + '</span><span class="num" data-open>' + esc(k === "noflight" ? "—" : r.sched_time || "—") + "</span><span data-open>" + est + "</span>" +
            '<span><em class="ops-badge ' + tone + '"' + (r.flight_note ? ' title="' + esc(r.flight_note) + '"' : "") + ">" + esc(word) + "</em></span>" +
            '<span><button type="button" class="btn ghost small" data-open>View</button></span></div>';
        }).join("") : '<p class="ops-foot">' + (rest.length ? "No flights match." : "No flight numbers on this sheet yet.") + "</p>") + "</section>";
    }
    return h;
  }
  function opsFlightsDesk(sh) {
    var all = S.rows.filter(function (r) { return r.kind === "drops"; });
    var withFl = all.filter(function (r) { return r.flight && r.flight !== "NO FLIGHT"; }), uniq = {};
    // Different flights: the real flight numbers only (TBC and the like aren't one).
    withFl.forEach(function (r) { if (/^([A-Z0-9]{2}\d{1,5}|[A-Z]{3}\d{1,4})$/.test(r.flight)) uniq[r.flight] = 1; });
    var att = all.filter(function (r) { return !r.cleared_at && (!r.flight || flightToCheck(r)); }), rest = all.filter(function (r) { return r.flight && !flightToCheck(r); });
    var count = function (k) { return k === "all" ? att.length + rest.length : k === "attention" ? att.length : rest.filter(function (r) { return flKind(r) === k; }).length; };
    function run(src) { return (S.runs || []).filter(function (x) { return x.source === src; })[0]; }
    function last(src, word) {
      var x = run(src); if (!x) return word + " not checked yet";
      return word + " checked " + esc(whenLabel(x.at)) + (x.result && x.result.error ? ' · <span class="bad">' + esc(x.result.error) + "</span>" : "");
    }
    var cell = function (label, n, unit, tone) { return '<div' + (tone && n ? ' class="' + tone + '"' : "") + "><span>" + esc(label) + '</span><strong class="num">' + n + "</strong><small>" + unit + "</small></div>"; };
    var missing = all.filter(function (r) { return !r.flight && !r.cleared_at; }).length;
    return opsScope(sh) +
      '<div class="fd-check"><p>' + last("schedule", "Timetable") + " · " + last("live", "Live positions") + "</p>" +
      (canCheckFlights() ? '<div class="fd-btns">' + checksLeftHtml() + '<button type="button" class="btn ghost small" data-filltimes>Fill times · AeroData</button><button type="button" class="btn small" data-checkflights>Check flights</button></div>' : "") + "</div>" +
      '<div class="ops-strip fd-strip">' + cell("With a flight number", withFl.length, "bookings") + cell("Different flights", Object.keys(uniq).length, "flights") +
        cell("No flight number", missing, "bookings", "warn") + cell("Need checking", att.length - missing, "bookings", "warn") +
        cell("Delayed", count("delayed"), "bookings", "warn") + cell("Landed", count("landed"), "bookings") + cell("Cancelled", count("cancelled"), "bookings", "bad") + "</div>" +
      '<div class="fd-tools"><div class="fd-tabs" role="group" aria-label="Show">' + FL_FILTERS.map(function (x) {
        var on = (S.flFilter || "all") === x[0];
        return '<button type="button" data-flfilter="' + x[0] + '" aria-pressed="' + on + '"' + (on ? ' class="on"' : "") + ">" + x[1] + ' <span class="num">' + count(x[0]) + "</span></button>";
      }).join("") + '</div><span class="fd-unit">Counts are bookings</span><input type="search" id="flQ" placeholder="Registration, flight or reference" aria-label="Search flights" autocomplete="off" value="' + esc(S.flQ || "") + '"></div>' +
      '<div id="flTables">' + flTablesHtml() + "</div>";
  }
  // ── Shared key checks (part 93). Only the display switch stays on the phone. ──
  var KEYMODE_KEY = "takeoff_keymode", keyLoadSeq = 0, keyLiveTimer = null;
  function keyAllowed() { var sh = sheet(); return !!(sh && sh.kind === "drops" && S.me && S.me.role !== "view" && (S.me.extra || []).indexOf("-keycheck") < 0 && (!isCards() || isBoard())); }
  function keyOn() { return keyAllowed() && keyModeChoice(); }
  function keyCurrent() { var k = S.keys; return k && S.company && k.company === S.company.id && k.sheet === S.sheetId ? k : null; }
  function keyGrey() { var k = keyCurrent(); return keyAllowed() && !!(k && !k.error && k.session && k.session.status === "active"); }
  function keyModeChoice() { try { return localStorage.getItem(KEYMODE_KEY) === "1"; } catch (e) { return false; } }
  function keyModeSet(on) { try { if (on) localStorage.setItem(KEYMODE_KEY, "1"); else localStorage.removeItem(KEYMODE_KEY); } catch (e) {} }
  async function toggleKeyMode() { keyModeSet(!keyOn()); S.keyFilter = "all"; render(); if (keyOn()) await loadKeys(S.sheetId); }
  function keyEntry(r) { var k = keyCurrent(); return k && k.entries[r.id] || { state: "unchecked", revision: 0 }; }
  function keyFound(r) { return keyEntry(r).state === "found"; }
  function keyBox() { return ""; } // The normal operations rows never mix key and delivery actions.
  function keyState(r) { return r.sent_at ? "driver" : keyEntry(r).state; }
  function keyCars() { return S.rows.filter(function (r) { return r.kind === "drops" && !r.cleared_at && !r.removed_at; }); }
  function keyCounts() {
    var c = { all: 0, found: 0, unchecked: 0, missing: 0, driver: 0 };
    keyCars().forEach(function (r) { var s = keyState(r); c[s]++; if (s !== "driver") c.all++; }); return c;
  }
  function keyTake(want, company, data) {
    var entries = {}; (data.entries || []).forEach(function (e) { entries[e.booking_id] = e; });
    S.keys = { sheet: want, company: company, session: data.session || null, entries: entries, error: "", busy: false };
  }
  async function loadKeys(want) {
    var sh = sheet(), company = S.company && S.company.id;
    if (!want || want !== S.sheetId || !company || !sh || sh.kind !== "drops" || !keyAllowed()) return;
    var seq = ++keyLoadSeq, old = keyCurrent();
    if (!old) { S.keys = { sheet: want, company: company, entries: {}, session: null, loading: true }; S.keyFilter = "all"; S.keyYard = ""; }
    var r; try { r = await sb.rpc("key_check_get", { p_sheet: want }); } catch (e) { r = { error: e }; }
    if (seq !== keyLoadSeq || !S.company || company !== S.company.id || want !== S.sheetId) return;
    if (r.error || !r.data) {
      S.keys = { sheet: want, company: company, entries: {}, session: null, error: isDown(r) ? "Can't load key checks. Check your signal and try again." : "Key check isn't available yet. Speak to the office." };
    } else keyTake(want, company, r.data);
    if (S.view === "board" && !S.switching && !$("panel").open && !yardOpen()) render();
  }
  function keyChanged(payload) {
    var r = payload.new || payload.old || {};
    if (r.sheet_id && r.sheet_id !== S.sheetId) return;
    clearTimeout(keyLiveTimer); keyLiveTimer = setTimeout(function () { loadKeys(S.sheetId); }, 100);
  }
  // Reconcile missed realtime events, including after a phone wakes or reconnects.
  setInterval(function () { if (S.me && keyOn() && S.view === "board" && document.visibilityState === "visible") loadKeys(S.sheetId); }, 30000);
  async function keyMutate(fn, args) {
    var k = keyCurrent(), want = S.sheetId, company = S.company && S.company.id;
    if (!k || k.loading || k.error || S.keySaving || S.offline || !navigator.onLine) { toast("Connect to the internet to check keys.", true); return false; }
    S.keySaving = true; render();
    var r; try { r = await sb.rpc(fn, args); } catch (e) { r = { error: e }; }
    S.keySaving = false;
    if (!S.company || S.company.id !== company || S.sheetId !== want) { if (S.me) render(); return false; }
    if (r.error) toast(isDown(r) ? "Key check wasn't confirmed. Reconnect and check its status before retrying." : r.error.message, true);
    await loadKeys(want); return !r.error;
  }
  function startKeyCheck(restart) {
    var k = keyCurrent(); if (!k) return;
    if (restart && !confirm("Start a new shared key check? Everyone will see unchecked keys. This check stays in the history.")) return;
    return keyMutate("key_check_start", { p_sheet: S.sheetId, p_restart: !!restart, p_previous: k.session ? k.session.id : null });
  }
  function tickKey(id, state) {
    var k = keyCurrent(), r = S.rows.filter(function (x) { return x.id === id; })[0];
    if (!k || !k.session || k.session.status !== "active" || !r || r.sent_at || r.cleared_at) return;
    var e = keyEntry(r);
    return keyMutate("key_check_set", { p_session: k.session.id, p_booking: id, p_state: state || (e.state === "found" ? "unchecked" : "found"), p_revision: e.revision });
  }
  async function finishKeyCheck() {
    var k = keyCurrent(), c = keyCounts(); if (!k || !k.session) return;
    if (!c.all || c.unchecked || c.missing) { S.keyFilter = c.missing ? "missing" : "unchecked"; render(); return toast("Check every remaining key before finishing.", true); }
    if (await keyMutate("key_check_finish", { p_session: k.session.id })) toast("Key check completed.");
  }
  function renderKeyBtn() {
    var can0 = keyAllowed(), on = keyOn(), k = keyCurrent(), c = keyCounts();
    show("keyBtn", can0); document.body.classList.toggle("keymode", keyGrey());
    document.body.classList.toggle("keychecking", on && S.view === "board");
    if (!can0) return;
    $("keyBtn").classList.toggle("on", on); $("keyBtn").setAttribute("aria-pressed", on);
    $("keyBtn").innerHTML = "<b>" + (opsDesk() ? "Key check" : isRefined() ? "Keys" : "K") + "</b>" + (k && k.session && !k.error ? ' <span class="num">' + c.found + "/" + c.all + "</span>" : "");
    $("keyBtn").setAttribute("aria-label", "Key check" + (k && k.session ? ", " + c.found + " of " + c.all + " found" : ""));
    $("keyBtn").title = "Key check: tick each car once its key is found in the cabinet";
    if (on) { $("tabTodo").classList.remove("on"); $("tabAll").classList.remove("on"); $("tabTodo").setAttribute("aria-pressed", "false"); $("tabAll").setAttribute("aria-pressed", "false"); }
  }
  function keyStrip() { return ""; }
  function renderKeyBoard() {
    var k = keyCurrent(), sh = sheet(), c = keyCounts(), disabled = S.keySaving || S.offline || !navigator.onLine;
    if (!k || k.loading) return '<div class="msg" role="status">Loading shared key check…</div>';
    if (k.error) return '<div class="msg" role="alert">' + esc(k.error) + ' <button type="button" class="btn small" data-keyretry>Try again</button></div>';
    var s = k.session, active = s && s.status === "active", closed = s && !active;
    var head = '<section class="kc" aria-label="Shift key check"><div class="kc-head"><div><b>Shift key check</b><span class="kc-session">' +
      (s ? (active ? "Started " : "Completed ") + hhmm(active ? s.started_at : s.finished_at) + " · " + esc(active ? s.started_by_name : s.finished_by_name) : "Shared with the team") + '</span></div><div class="kc-head-actions">' +
      (sh.archived_at ? '<span class="note">Archived shift</span>' : s ? '<button type="button" data-keynew' + (disabled ? ' disabled' : '') + '>New check</button>' + (active ? '<button type="button" class="kc-primary" data-keyfinish' + (disabled ? ' disabled' : '') + '>Finish check</button>' : '') : '<button type="button" class="kc-primary" data-keystart' + (disabled || !c.all ? ' disabled' : '') + '>Start check</button>') + '</div></div>';
    if (!s) return head + '<div class="kc-ready">' + c.all + ' keys to check' + (c.driver ? " · " + c.driver + " with drivers" : "") + '.</div></section>';
    head += '<div class="kc-counts">' + [["all","Expected"],["found","Found"],["unchecked","Unchecked"],["missing","Missing"]].map(function (x) {
      return '<button type="button" class="kc-count kc-' + x[0] + '" data-keyfilter="' + x[0] + '" aria-pressed="' + ((S.keyFilter || "all") === x[0]) + '"><b class="num">' + c[x[0]] + '</b><span>' + x[1] + '</span></button>';
    }).join("") + '</div><div class="kc-progress" role="progressbar" aria-label="Keys confirmed found" aria-valuemin="0" aria-valuemax="' + c.all + '" aria-valuenow="' + c.found + '"><div style="width:' + (c.all ? c.found / c.all * 100 : 0) + '%"></div></div>' +
      '<div class="kc-filters"><label>Yard <select id="keyYard" aria-label="Filter key check by yard"><option value="">All yards</option>' +
      (S.company.yards || []).map(function (y) { return '<option value="' + esc(y) + '"' + (S.keyYard === y ? ' selected' : '') + '>' + esc(YARD_LABEL[y] || y) + '</option>'; }).join("") + '<option value="-"' + (S.keyYard === "-" ? ' selected' : '') + '>No yard</option></select></label><span class="kc-order">Unchecked and missing first</span>' +
      (c.driver ? '<button type="button" data-keyfilter="driver" aria-pressed="' + (S.keyFilter === "driver") + '">With driver <b class="num">' + c.driver + '</b></button>' : '') + '<span class="kc-shared" role="status" aria-live="polite">' + (S.keySaving ? 'Saving…' : 'Shared team check') + '</span></div></section>';
    if (closed) head += '<div class="kc-completed" role="status">Check completed · ' + s.found_count + '/' + s.expected_count + ' keys confirmed.' + (c.unchecked || c.missing ? ' Shift changed — start a new check for the remaining keys.' : '') + '</div>';
    if (S.offline || !navigator.onLine) head += '<div class="kc-warning" role="status">Offline · reconnect before confirming keys.</div>';
    var q = S.q.trim().toUpperCase().replace(/\s/g,""), rank = { unchecked:0, missing:1, found:2, driver:3 };
    var rows = keyCars().filter(function (r) {
      return ((!S.keyFilter || S.keyFilter === "all") || keyState(r) === S.keyFilter) && (!S.keyYard || (S.keyYard === "-" ? !r.yard : r.yard === S.keyYard)) &&
        (!q || [r.reg,r.make,r.num,r.name,r.ref,r.phone,r.note,r.flight].join("").toUpperCase().replace(/\s/g,"").indexOf(q) >= 0);
    }).sort(function (a,b) { return rank[keyState(a)] - rank[keyState(b)] || (a.return_at || "").localeCompare(b.return_at || "") || (a.num || 0) - (b.num || 0); });
    head += '<div class="kc-columns"><span>RETURN</span><span>REGISTRATION · VEHICLE</span><span>FLIGHT</span><span>CUSTOMER · REF</span><span>YARD</span><span>KEY STATUS</span><span>CHECKED BY</span><span>CONFIRM KEY</span></div>';
    return head + (rows.length ? rows.map(function (r) {
      var st = keyState(r), e = keyEntry(r), locked = disabled || !active || st === "driver" || sh.archived_at;
      return '<div class="row kc-row kc-row-' + st + '" data-id="' + r.id + '"><div class="kc-time num">' + hhmm(r.return_at) + '</div><div class="kc-car"><button type="button" class="reg" data-open>' + esc(r.reg || "NO REG") + '</button>' + (r.num ? '<span class="kc-num num">#' + r.num + '</span>' : '') + '<div class="kc-meta">' + esc(r.make ? (isRefined() ? niceMake(String(r.make).trim()) : r.make) : "No vehicle details") + '</div></div>' +
        '<div class="kc-fl">' + flightCell(r) + (r.name ? '<span class="kc-meta kc-flcu" title="' + esc(r.name) + '">' + esc(nice(r.name)) + '</span>' : '') + '</div>' +
        '<div class="kc-cu"><div class="kc-name" title="' + esc(r.name) + '">' + esc(nice(r.name) || "—") + '</div><div class="kc-meta num">' + esc(r.ref || "") + '</div></div>' +
        '<div class="kc-yard">' + (yardChip(r, true) || '<span class="kc-meta">No yard</span>') + '</div><div class="kc-state"><span class="kc-status kc-status-' + st + '">' + ({found:"Found",unchecked:"Unchecked",missing:"Missing",driver:"With driver"}[st]) + '</span></div><div class="kc-person">' + (st === "driver" ? "Sent by " + esc(byName(r, "sent_by") || "staff") + '<small>' + hhmm(r.sent_at) + '</small>' : e.checked_at ? esc(e.checked_by_name || "Staff") + '<small>' + hhmm(e.checked_at) + '</small>' : '—') + '</div><div class="kc-actions">' + (st === "unchecked" && active ? '<button type="button" data-keymissing="' + r.id + '"' + (locked ? ' disabled' : '') + '>Missing</button>' : '') + (st === "driver" ? '<span class="kc-meta">Sent ' + hhmm(r.sent_at) + '</span>' : '<button type="button" class="kbox' + (st === "found" ? ' on' : '') + '" data-keytick="' + r.id + '" aria-pressed="' + (st === "found") + '" aria-label="' + (st === "found" ? 'Unconfirm' : 'Confirm') + ' key for ' + esc(r.reg) + '"' + (locked ? ' disabled' : '') + '></button>') + '</div></div>';
    }).join("") : '<div class="msg">No keys match this view.</div>') + '<div class="kc-foot">Showing ' + rows.length + ' of ' + keyCars().length + ' cars on this shift.</div>';
  }

  function renderStats() {
    var sh = sheet();
    if (!sh) return '<div class="msg">Choose a sheet first.</div>';
    var desk = opsDesk(), h = opsSub(sh) + '<div class="ops-acts"><button type="button" class="btn ghost small" data-copy="stats">Copy stats</button></div>';
    if (sh.kind === "drops") {
      var D = dropsStats(), owed = chargeLines();
      h += opsStrip([["Due back", D.total.due, tileAttr("")], ["Sent", D.total.sent, tileAttr("sentall")], ["Collected", D.total.done, tileAttr("back")], ["Still to collect", D.total.due - D.total.done, tileAttr("left")]]) + statsCols(
        opsPanel("Returns by booked hour", desk ? "Due and collected" : "", (desk ? statBars(D.hours.map(function (x) { return [x.label, x.due, x.done]; })) : "") + opsTable(["Hour", "Due", "Sent", "Collected"],
          D.hours.map(function (x) { return [esc(x.label), x.due, x.sent, x.done]; }).concat(D.over.due ? [["Overstays", D.over.due, D.over.sent, D.over.done]] : []),
          ["Total", D.total.due, D.total.sent, D.total.done]), D.over.due ? "Overstays are separate from the morning and night shifts." : ""),
        opsPanel("Shift breakdown", "Collected / due", opsTable(null, [["Morning<small>06:00–17:30</small>", D.morning.done + " / " + D.morning.due], ["Night<small>17:31–05:59</small>", D.night.done + " / " + D.night.due]])) +
        opsPanel("Collected lately", "", opsTable(null, [["Last 30 minutes", D.last30], ["Last 60 minutes", D.last60]])) +
        (owed.length ? opsPanel("Overstay money", "", opsTable(null, owed.map(function (x) { var l = [esc(x[0]), x[1]]; l.tap = tileAttr(x[2]); return l; }))) : ""));
    } else {
      var P = picksStats(), cats = catLines();
      h += opsStrip([["Scheduled", P.totalSched, tileAttr("")], ["Completed", P.totalDone, tileAttr("pdone")], ["Last 30 min", P.last30], ["Last 60 min", P.last60]]) + statsCols(
        opsPanel("Arrivals by booked hour", desk ? "Scheduled and completed" : "", (desk ? statBars(P.hours.map(function (x) { return [x.label, x.sched, x.done]; })) : "") + opsTable(["Hour", "Scheduled", "Completed"], P.hours.map(function (x) { return [esc(x.label), x.sched, x.done]; }), ["Total", P.totalSched, P.totalDone]),
          "Completed counts Collected and RTC, by booked arrival hour."),
        (cats.length ? opsPanel("Return groups", "", opsTable(null, cats.map(function (x) { return [esc(x[0]), x[1]]; }))) : ""));
    }
    return h;
  }
  // A wide screen: the hourly panel on the left, the rest beside it.
  function statsCols(main, side) { return opsDesk() ? '<div class="st-desk"><div class="st-main">' + main + '</div><div class="st-side">' + side + "</div></div>" : main + side; }
  // Bars for the same hourly numbers as the table under them: [label, all, done] per hour.
  function statBars(rows) {
    var max = rows.reduce(function (m, x) { return Math.max(m, +x[1] || 0, +x[2] || 0); }, 0) || 1;
    return '<div class="st-bars" role="img" aria-label="Bars by hour, the same numbers as the table">' + rows.map(function (x) {
      return '<div class="st-bar"><span class="st-n num">' + (+x[1] || "") + '</span><div class="st-col"><i class="st-all" style="height:' + Math.round((+x[1] || 0) / max * 100) + '%"></i><i class="st-done" style="height:' + Math.round((+x[2] || 0) / max * 100) + '%"></i></div><small class="num">' + esc(String(x[0]).slice(0, 2)) + "</small></div>";
    }).join("") + "</div>";
  }
  function copyText(kind) {
    var lines;
    if (kind === "returns") {
      var R0 = picksReturns();
      lines = ["RETURNS — " + sheetName(), ""].concat(R0.days.map(function (d) { return d.label + " RTNS " + carsWord(d.n); }), ["", carsWord(R0.cars) + " on the sheet", ""],
        catLines().map(function (x) { return x[0] + " " + carsWord(x[1]); }));
      if (R0.owed.length) {
        lines.push("", "MONEY NOTED (" + R0.owed.length + ")");
        R0.owed.forEach(function (x) { lines.push("  " + x.line + " - " + (x.kind ? x.kind.toUpperCase() + " - " : "") + x.note); });
        lines.push("TOTAL £" + R0.owed.reduce(function (t, x) { return t + x.due; }, 0).toFixed(2));
      }
    } else if ((sheet() || {}).kind === "drops") {
      var D = dropsStats();
      lines = ["DROPS BY HOUR — " + sheetName(), "", "Due back   Due   Sent   Collected"].concat(D.hours.map(function (h) { return h.label + "   " + h.due + "   " + h.sent + "   " + h.done; }),
        D.over.due ? ["Overstays   " + D.over.due + "   " + D.over.sent + "   " + D.over.done] : [],
        ["TOTAL   " + D.total.due + "   " + D.total.sent + "   " + D.total.done, "",
          "Morning 06:00–17:30   " + D.morning.due + "   " + D.morning.sent + "   " + D.morning.done,
          "Night 17:31–05:59   " + D.night.due + "   " + D.night.sent + "   " + D.night.done, "", "Collected last 30 min   " + D.last30, "Collected last 60 min   " + D.last60],
        chargeLines().length ? [""].concat(chargeLines().map(function (x) { return x[0] + "   " + x[1]; })) : []);
    } else {
      var P = picksStats();
      lines = ["PICKS STATS — " + sheetName(), "", "Hour   Scheduled   Completed"].concat(P.hours.map(function (h) { return h.label + "   " + h.sched + "   " + h.done; }),
        ["TOTAL   " + P.totalSched + "   " + P.totalDone, "", "Last 30 min   " + P.last30, "Last 60 min   " + P.last60], catLines().map(function (x) { return x[0] + "   " + x[1]; }));
    }
    return lines.join("\n");
  }
  // Clipboard first; if the phone refuses, the text goes on screen to long-press.
  async function putOnClipboard(text) {
    try { await navigator.clipboard.writeText(text); toast("Copied"); return; } catch (e) {}
    try {
      var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.top = "-1000px";
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove();
      if (ok) { toast("Copied"); return; }
    } catch (e) {}
    $("panelBody").innerHTML = '<h2 id="panelTitle">Copy this</h2><textarea id="copyBox" style="height:46vh" readonly>' + esc(text) + '</textarea><div class="pbtns"><button type="button" data-close>Close</button></div>';
    var box = $("copyBox"); box.focus(); box.setSelectionRange(0, text.length);
  }

  // Landing and collection times are typed, not picked: "1320", "13:20",
  // "13.20" and "920" all mean what they say. "" is no time; null is not a time.
  function timeBox(id, value, extra) {
    return '<input id="' + id + '" class="timebox" type="text" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="e.g. 13:20" value="' + esc(value || "") + '"' + (extra || "") + ">";
  }
  function cleanTime(v) {
    var t = String(v || "").trim(); if (!t) return "";
    var m = t.match(/^(\d{1,2})[:.\s]?(\d{2})$/) || t.replace(/\D/g, "").match(/^(\d{1,2})(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    return pad(+m[1]) + ":" + m[2];
  }
  function readTime(id) { var el = $(id); return el ? cleanTime(el.value) : undefined; }
  // "no flight", "no flight no.", "NOFLIGHT" all mean NO FLIGHT.
  function normFlight(v) { var f = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return /^NOFLIGHT/.test(f) ? "NO FLIGHT" : f; }
  // A time on the day nearest the booked return (00:30 on a 23:30 booking is
  // the next morning); for an early return, nearest when it was brought forward.
  // Same rule as set_collect_time / set_sched_time in the database (part 31).
  function collectAt(r, time) {
    var base = r.early ? (r.early_at || nowIso()) : r.return_at;
    if (!base) return null;
    var booked = hhmm(base), diff = (+time.slice(0, 2) * 60 + +time.slice(3)) - (+booked.slice(0, 2) * 60 + +booked.slice(3));
    if (diff < -720) diff += 1440; if (diff > 720) diff -= 1440;
    var t = new Date(base).getTime() + diff * 60000;
    // Over 6 h from the booking and outside the sheet's night (06:00 to 06:00):
    // the same time on the other day is the one meant. 00:22 typed on a car
    // booked for 12:00 is tonight's 00:22, not last night's (part 83).
    var sh = S.sheets.concat(S.archiveSheet ? [S.archiveSheet] : []).filter(function (s) { return s.id === r.sheet_id; })[0];
    if (sh && sh.kind === "drops" && Math.abs(diff) > 360) {
      var end = ((S.company && S.company.drops_day_end) || "06:00").slice(0, 5);
      var w0 = new Date(londonIso(sh.day + " " + end)).getTime(), w1 = new Date(londonIso(addDaysKey(sh.day, 1) + " " + end)).getTime();
      var inNight = function (x) { return x >= w0 && x < w1; };
      if (!inNight(t)) { if (inNight(t + 864e5)) t += 864e5; else if (inNight(t - 864e5)) t -= 864e5; }
    }
    return new Date(t).toISOString();
  }
  // sched: the scheduled landing time typed by hand (HH:MM, "" clears it),
  // for when the flights check can't find the flight.
  function setFlight(r, f, collect, sched) {
    if (f !== r.flight) run("set_flight", { p_booking: r.id, p_flight: f }, r, function (x) { x.flight = f; x.sched_at = null; x.sched_time = ""; x.est_at = null; x.est_time = ""; x.flight_status = f === "NO FLIGHT" ? "noflight" : ""; x.flight_note = ""; });
    if (f === "NO FLIGHT" && collect !== undefined && collect !== (r.est_time || "")) run("set_collect_time", { p_booking: r.id, p_time: collect }, r, function (x) { x.est_time = collect; x.est_at = collect ? collectAt(x, collect) : null; x.flight_status = "noflight"; });
    if (f && f !== "NO FLIGHT" && sched !== undefined && sched !== (r.sched_time || "")) run("set_sched_time", { p_booking: r.id, p_time: sched }, r, function (x) {
      x.sched_time = sched; x.sched_at = sched ? collectAt(x, sched) : null;
      if (/check the flight number$/.test(x.flight_note)) x.flight_note = "";
      if (sched && !x.flight_status) x.flight_status = "scheduled"; else if (!sched && x.flight_status === "scheduled") x.flight_status = "";
    });
  }

  // ── quick flight number ───────────────────
  // One car at a time: type it, or tap one of the flights landing near the
  // customer's booked time (from the timetable the flight check keeps).
  var quick = null;
  function missingFlights() {
    return S.rows.filter(function (r) { return r.kind === "drops" && !r.flight && !r.cleared_at; })
      .sort(function (a, b) { return (a.return_at || "9") < (b.return_at || "9") ? -1 : 1; });
  }
  async function openQuickFlight(r, chain) {
    // A car that has a flight starts with its number and landing time in the boxes.
    quick = { id: r.id, chain: !!chain, suggest: null, noFlight: false, start: r.flight && r.flight !== "NO FLIGHT" ? { f: r.flight, s: /^\d{2}:\d{2}$/.test(r.sched_time) ? r.sched_time : "" } : null };
    drawQuickFlight();
    if (!$("panel").open) $("panel").showModal();
    setTimeout(function () { var i = $("quickFlight"); if (i) i.focus(); }, 50);
    if (!r.return_at) { quick.suggest = []; return drawQuickFlight(true); }
    var t = new Date(r.return_at).getTime();
    var res = await sb.from("timetable").select("flight, sched_at, origin, status")
      .gte("sched_at", new Date(t - 60 * 60000).toISOString()).lte("sched_at", new Date(t + 60 * 60000).toISOString()).limit(60);
    if (!quick || quick.id !== r.id) return;
    quick.suggest = res.error ? [] : res.data.sort(function (a, b) { return Math.abs(new Date(a.sched_at) - t) - Math.abs(new Date(b.sched_at) - t); }).slice(0, 8);
    drawQuickFlight(true);
  }
  function drawQuickFlight(keepInput) {
    var r = S.rows.filter(function (x) { return x.id === quick.id; })[0]; if (!r) return;
    var st0 = quick.start || { f: "", s: "" };
    var typed = keepInput && $("quickFlight") ? $("quickFlight").value : st0.f, typedSched = keepInput && $("quickSched") ? $("quickSched").value : st0.s;
    var left = missingFlights().filter(function (x) { return x.id !== r.id; }).length;
    var chips = quick.suggest === null ? '<div class="hint">Looking for flights near ' + esc(hhmm(r.return_at)) + "…</div>"
      : quick.suggest.length ? '<div class="suggest">' + quick.suggest.map(function (f) {
          return '<button type="button" data-pickflight="' + esc(f.flight) + '" data-picksched="' + esc(hhmm(f.sched_at)) + '"' + (f.status === "cancelled" ? ' class="cx"' : "") + '><b>' + esc(f.flight) + '</b><span class="num">' + esc(hhmm(f.sched_at)) + "</span><small>" + esc(f.origin || "") + (f.status === "cancelled" ? " · cancelled" : "") + "</small></button>";
        }).join("") + "</div>" : "";
    var saveWord = quick.chain && left ? "Save & next (" + left + " left)" : "Save";
    var head = '<h2 id="panelTitle">' + esc(r.reg || "NO REG") + (r.num ? " <small>#" + r.num + "</small>" : "") + "</h2>" +
      '<p class="sub">' + esc(r.name) + " · back " + esc(hhmm(r.return_at)) + "</p>";
    if (quick.noFlight) {
      $("panelBody").innerHTML = head + '<form id="quickForm" novalidate><label for="collectTime">NO FLIGHT NUMBER · COLLECTION TIME</label>' +
        timeBox("collectTime", hhmm(r.return_at), " required") +
        '<div class="pbtns"><button type="button" data-flightback>Back</button><button class="save">' + saveWord + "</button></div></form>";
      return;
    }
    $("panelBody").innerHTML = head +
      '<form id="quickForm" novalidate><label for="quickFlight">FLIGHT NUMBER</label><input id="quickFlight" value="' + esc(typed) + '" autocomplete="off" autocapitalize="characters" maxlength="10" placeholder="e.g. W43451">' +
      '<label for="quickSched">SCHEDULED LANDING (IF KNOWN)</label>' + timeBox("quickSched", typedSched) +
      (chips ? "<label>LANDING NEAR " + esc(hhmm(r.return_at)) + "</label>" + chips : "") +
      '<button type="button" class="noflight" data-noflight>NO FLIGHT NUMBER</button>' +
      '<div class="pbtns"><button type="button" data-close>' + (quick.chain ? "Stop" : "Close") + '</button><button class="save">' + saveWord + "</button></div></form>";
  }
  function saveQuickFlight(value, collect, sched) {
    var r = S.rows.filter(function (x) { return x.id === quick.id; })[0];
    var f = normFlight(value);
    if (!r) return;
    if (!f) { toast("Type the flight number or tap one below.", true); return; }
    if (f === "NO FLIGHT" && !/^\d{2}:\d{2}$/.test(collect || "")) { quick.noFlight = true; drawQuickFlight(); return; }
    if (f === "NO FLIGHT" || !/^\d{2}:\d{2}$/.test(sched || "")) sched = undefined;
    // The old flight's time left in the box doesn't carry over to a new flight number.
    if (quick.start && f !== r.flight && sched === quick.start.s) sched = undefined;
    setFlight(r, f, collect, sched);
    toast(r.reg + " · " + f + (collect ? " · " + collect : sched ? " · sched " + sched : ""));
    var next = quick.chain ? missingFlights()[0] : null;
    if (next) return openQuickFlight(next, true);
    quick = null; $("panel").close();
  }

  // ── flights ───────────────────────────────
  var FLIGHT_WORD = { noflight: "No flight number · collection time", "": "Not checked yet", scheduled: "Scheduled", expected: "Running late", airborne: "In the air", delayed: "DELAY", landed: "Landed", cancelled: "CANCELLED" };
  // A tapped number on a phone's Flights page shows only those flights (S.flTile; "" = all).
  function flTileOk(r) { var t = S.flTile || "", st = r.flight_status; return !t || st === t || (t === "delayed" && st === "expected"); }
  function flTileAttr(k) { var on = (S.flTile || "") === k; return ' data-fltile="' + k + '" role="button" tabindex="0" aria-pressed="' + on + '"'; }
  function renderFlights() {
    var sh = sheet();
    if (!sh || sh.kind !== "drops") return '<div class="msg">Choose a DROPS sheet at the top to see its flights.</div>';
    if (!S.runs) loadRuns();
    var all = S.rows.filter(function (r) { return r.flight; }).sort(function (a, b) { return orderAt(a) < orderAt(b) ? -1 : 1; });
    var manual = all.filter(flightToCheck), rows = all.filter(function (r) { return !flightToCheck(r); }), shown = rows.filter(flTileOk);
    function n(st) { return rows.filter(function (r) { return r.flight_status === st; }).length; }
    function last(src) {
      var run0 = (S.runs || []).filter(function (x) { return x.source === src; })[0];
      if (!run0) return "never";
      var res = run0.result || {};
      return esc(dayShort(run0.at) + " " + hhmm(run0.at)) + (res.error ? ' · <span class="bad">' + esc(res.error) + "</span>" : "");
    }
    if (opsDesk()) return opsFlightsDesk(sh);
    if (isOps()) return opsFlights(sh, all, rows, manual, n, shown);
    var h = '<div class="pad"><h2 class="title">' + esc(sheetLabel(sh)) + "</h2>" +
      '<div class="stats"><div class="stat tap"' + flTileAttr("") + '><span>Flights</span><strong class="num">' + all.length + '</strong></div><div class="stat tap"' + flTileAttr("landed") + '><span>Landed</span><strong class="num">' + n("landed") +
      '</strong></div><div class="stat tap"' + flTileAttr("delayed") + '><span>Delayed or late</span><strong class="num">' + (n("delayed") + n("expected")) + '</strong></div><div class="stat tap"' + flTileAttr("cancelled") + '><span>Cancelled</span><strong class="num">' + n("cancelled") +
      '</strong></div></div><p class="note">Timetable last checked: ' + last("schedule") + "<br>Live positions last checked: " + last("live") + "</p>" +
      (canCheckFlights() ? '<div class="row-actions">' + checksLeftHtml() + '<button type="button" class="btn small" data-filltimes>Fill times · AeroData</button><button type="button" class="btn small" data-checkflights>Check flights now</button></div>' : "") +
      "</div>" + missingHtml() + manualHtml(manual) + (missingFlights().length || manual.length ? '<div class="sec">WITH FLIGHT NUMBERS</div>' : "");
    return h + (shown.length ? shown.map(function (r) {
      return '<div class="row frow' + (r.flight_status === "cancelled" || r.flight_status === "delayed" ? " late" : r.flight_status === "landed" ? " done" : "") + (r.flight_status ? " fs-" + esc(r.flight_status) : "") + '" data-id="' + r.id + '"><div class="left" data-open><div class="l1"><span class="reg">' + esc(r.flight) + '</span><span class="dn">' + esc(r.reg) + '</span><span class="pin">' + esc(nice(r.name)) + "</span></div>" +
        '<div class="l2 num"><span class="l2a">' + esc(FLIGHT_WORD[r.flight_status] || r.flight_status) + (r.flight_note ? " · " + esc(r.flight_note) : "") + '</span><span class="l2b">' + (isPremium() ? "" : " · ") + esc(r.sched_time || hhmm(r.return_at)) +
        (r.est_time ? ' &rarr; <span class="eta' + (r.est_time === "DELAY" ? " dly" : "") + '">' + esc(r.est_time) + "</span>" : "") + "</span></div></div></div>";
    }).join("") : '<div class="msg">' + (rows.length ? "No flights like that now." : "No flight numbers on this sheet.") + "</div>");
  }
  // Operations: the numbers in a strip, then each flight with its times and a status badge.
  function opsFlights(sh, all, rows, manual, n, shown) {
    function run(src) { return (S.runs || []).filter(function (x) { return !src || x.source === src; })[0]; }
    var lastRun = run(), tt = run("schedule");
    var h = opsSub(sh) + '<div class="ops-acts ops-check"><span class="ops-dot' + (lastRun ? "" : " never") + '">' + (lastRun ? "Checked at " + esc(hhmm(lastRun.at)) : "Not checked yet") + "</span>" +
      (canCheckFlights() ? checksLeftHtml() + '<button type="button" class="btn ghost small" data-filltimes>Fill times · AeroData</button><button type="button" class="btn small" data-checkflights>Check flights</button>' : "") + "</div>" +
      opsStrip([["Flights", all.length, flTileAttr("")], ["Landed", n("landed"), flTileAttr("landed")], ["Delayed", n("delayed") + n("expected"), flTileAttr("delayed")], ["Cancelled", n("cancelled"), flTileAttr("cancelled")]]) +
      missingHtml() + manualHtml(manual);
    function mins(t) { return /^\d{2}:\d{2}$/.test(t || "") ? +t.slice(0, 2) * 60 + +t.slice(3) : null; }
    var list = shown.map(function (r) {
      var st = r.flight_status || "", sched = r.sched_time || hhmm(r.return_at), est = r.est_time || "";
      var late = mins(est) !== null && mins(sched) !== null ? (mins(est) - mins(sched) + 1440 + 720) % 1440 - 720 : 0;
      var word = st === "landed" ? "Landed" : st === "cancelled" ? "Cancelled" : (st === "delayed" || st === "expected") && late > 0 ? "Delayed +" + late + " min" : st === "delayed" ? "Delayed" : FLIGHT_WORD[st] || st;
      var tone = st === "landed" ? "ok" : st === "cancelled" ? "bad" : st === "delayed" || st === "expected" ? "warn" : "";
      return '<div class="ops-fl fs-' + esc(st || "none") + '" data-id="' + r.id + '"><div class="ops-flin" data-open>' +
        '<b class="num">' + esc(r.flight) + '</b><span class="ops-flcar"><span class="num">' + esc(r.reg) + "</span><small>" + esc(nice(r.name)) + "</small></span>" +
        // Operations Refined: a flight per line on a phone, in the board's words (Sch, Est).
        '<span class="ops-flt"><small>' + (isRefined() ? "Sch" : "Scheduled") + '</small><span class="num">' + esc(sched || "—") + "</span></span>" +
        (est ? '<span class="ops-flt"><small>' + (st === "landed" ? "Landed" : isRefined() ? "Est" : "Expected") + '</small><span class="num">' + esc(est === "DELAY" ? "Delayed" : est) + "</span></span>" : "<span></span>") +
        '<em class="ops-badge ' + tone + '">' + (isRefined() && r.flight_note && st !== "landed" && r.flight_note.indexOf(word) === 0 ? "" : esc(word) + (r.flight_note && st !== "landed" ? " · " : "")) + (r.flight_note && st !== "landed" ? esc(r.flight_note) : "") + "</em></div></div>";
    }).join("");
    return h + opsPanel("Flight status", tt ? "Timetable updated at " + hhmm(tt.at) : "", list || '<p class="ops-foot">' + (rows.length ? "No flights like that now." : "No flight numbers on this sheet.") + "</p>");
  }
  // Fill times and Check flights: owners, managers and the office any time;
  // drivers and terminal staff 2 an hour between both (the server counts).
  var FLIGHT_CHECKS_PER_HOUR = 2;
  function canCheckFlights() { return !!S.me && S.me.role !== "view"; }
  function flightChecksLimited() { return canCheckFlights() && !can("flights") && !can("settings"); }
  function checksLeftHtml() {
    if (!flightChecksLimited()) return "";
    var hourAgo = Date.now() - 3600e3, used = (S.runs || []).filter(function (x) { return x.result && x.result.by === S.me.id && new Date(x.at).getTime() > hourAgo; }).length;
    var left = Math.max(0, FLIGHT_CHECKS_PER_HOUR - used);
    // Styled inline: every look shows it the same, and no look's stylesheet changes.
    return '<span class="checks-left" style="align-self:center;font-size:13px;font-weight:600;opacity:.85' + (left ? "" : ";color:#b42318;opacity:1") + '">' + left + " of " + FLIGHT_CHECKS_PER_HOUR + " checks left this hour</span>";
  }
  // Flight numbers the timetable can't find (or TBC): the office checks these by hand.
  function manualHtml(list) {
    if (!list.length) return "";
    return '<div class="sec old">NEED TO CHECK MANUALLY <b class="num">' + list.length + "</b></div>" +
      list.map(function (r) {
        var why = /check the flight number$/.test(r.flight_note) ? r.flight_note.replace(/ · check the flight number$/, "") : "Not a flight number";
        return '<div class="row cmpl" data-id="' + r.id + '"><div class="left" data-open><div class="l1"><span class="reg">' + esc(r.flight) + '</span><span class="dn">' + esc(r.reg) + '</span><span class="pin">' + esc(r.name) + "</span></div>" +
          '<div class="l2 num"><span class="l2a">' + esc(why) + '</span><span class="l2b"> · back ' + esc(hhmm(r.return_at)) + "</span></div></div></div>";
      }).join("");
  }
  function missingHtml() {
    var miss = missingFlights();
    if (!miss.length) return "";
    return '<div class="sec old">NO FLIGHT NUMBER <b class="num">' + miss.length + "</b>" + (can("flights") ? '<span><button type="button" class="btn small" data-fillflights>Add flight numbers</button></span>' : "") + "</div>" +
      miss.map(function (r) {
        return '<div class="row" data-id="' + r.id + '"><div class="left"><div class="l1"><span class="reg">' + esc(r.reg || "NO REG") + "</span>" + (r.num ? '<span class="dn num">#' + r.num + "</span>" : "") + '<span class="pin">' + esc(r.name) + "</span></div>" +
          '<div class="l2 num"><span class="l2a">' + esc(r.make) + '</span><span class="l2b">back ' + esc(hhmm(r.return_at)) + "</span></div></div>" +
          (can("flights") ? '<button type="button" class="addflight" data-addflight>+ FLIGHT</button>' : "") + "</div>";
      }).join("");
  }
  async function loadRuns() {
    S.runs = [];
    var r = await sb.from("flight_runs").select("at, source, trigger, result").order("at", { ascending: false }).limit(20);
    S.runs = r.error ? [] : r.data;
    if (S.view === "flights") render();
  }
  async function fillTimes(btn) {
    var sh = sheet();
    if (!sh || sh.kind !== "drops") return toast("Choose a DROPS sheet first.", true);
    if (btn) btn.disabled = true;
    toast("Checking the timetable (AeroData)…");
    try {
      var s = (await callFunction("flights", { action: "timetable", day: sh.day }, true)).schedule || {};
      var bits = [];
      if (s.skipped) bits.push(s.skipped);
      bits.push((s.filled || 0) + " filled", (s.moved || 0) + " changed");
      if (s.cancelled) bits.push(s.cancelled + " cancelled");
      if (s.expected) bits.push(s.expected + " running late");
      if (s.notfound) bits.push(s.notfound + " not found (check flight no.)");
      if (s.error) bits.push("Problem: " + s.error);
      toast(s.skipped ? s.skipped : bits.join(" · "), !!(s.error || s.skipped));
      S.runs = null; await loadRows(); render();
    } catch (err) { toast(err.message, true); }
    finally { if (btn) btn.disabled = false; }
  }
  async function checkFlights(btn) {
    if (btn) btn.disabled = true;
    toast("Checking flights…");
    try {
      var r = await callFunction("flights", { action: "check" }, true);
      // Live positions only (FlightRadar24); the timetable is Fill times.
      var bits = [], l = r.live || {};
      if (l.skipped) bits.push(l.skipped);
      if (l.written) bits.push(l.written + " live ETAs");
      if (l.landed) bits.push(l.landed + " landed");
      if (l.delayed) bits.push(l.delayed + " late");
      if (l.error) bits.push("Problem: " + l.error);
      toast(bits.length ? bits.join(" · ") : "Checked. Nothing new: no flights due in the next 90 minutes.", !!l.error);
      S.runs = null; await loadRows(); render();
    } catch (err) { toast(err.message, true); }
    finally { if (btn) btn.disabled = false; }
  }

  // ── summary + activity ────────────────────
  function renderSummary() {
    var sh = sheet(), h = "";
    if (sh && can("summary")) {
      if (sh.kind === "drops") {
        var d = S.rows;
        var due = d.filter(function (r) { return /£/.test(r.note); }), D = dropsStats();
        var back = d.filter(function (r) { return r.cleared_at; }).length;
        if (isOps()) h += opsSub(sh) + '<div class="stats">' + kstat("back", "Cars back", back + " / " + d.length, progressBar(back, d.length), "big") + "</div>" +
          opsStrip([["On the way", d.filter(function (r) { return r.sent_at && !r.cleared_at; }).length, tileAttr("way")], ["Overstays", d.filter(function (r) { return r.overstay; }).length, tileAttr("over")], ["Complaints", d.filter(function (r) { return r.clear_word === "COMPLAINT" || /^!/.test(r.note); }).length, tileAttr("comp")]]) +
          (isRefined() ? opsPanel("Shift progress", "Collected", opsTable(null, [rfPart("Morning", "06:00–17:30", D.morning), rfPart("Night", "17:31–05:59", D.night)]))
            : opsPanel("Shift progress", "Collected / due", opsTable(null, [["Morning<small>06:00–17:30</small>", D.morning.done + " / " + D.morning.due], ["Night<small>17:31–05:59</small>", D.night.done + " / " + D.night.due]])));
        else h += '<h2 class="title">' + esc(sheetLabel(sh)) + '</h2><div class="stats">' +
          kstat("back", "Cars back", back + " / " + d.length, progressBar(back, d.length), hasFeatures() ? "big" : "") +
          kstat("way", "On the way", d.filter(function (r) { return r.sent_at && !r.cleared_at; }).length, "", "", "way") +
          kstat("over", "Overstays", d.filter(function (r) { return r.overstay; }).length, "", "", "over") +
          kstat("comp", "Complaints", d.filter(function (r) { return r.clear_word === "COMPLAINT" || /^!/.test(r.note); }).length, "", "", "comp") +
          kstat("morn", "Morning 06:00–17:30", D.morning.done + " / " + D.morning.due, miniBar(D.morning.done, D.morning.due)) +
          kstat("night", "Night 17:31–05:59", D.night.done + " / " + D.night.due, miniBar(D.night.done, D.night.due)) + "</div>";
        h += (due.length ? '<div class="section-label">Money due</div><div class="box">' + due.map(function (r) { return '<div class="rowline"><div class="grow"><strong>' + esc(r.reg) + "</strong> · " + esc(r.name) + '<div class="note">' + esc(r.note) + "</div></div></div>"; }).join("") + "</div>" : "");
      } else {
        var p = S.rows, hours = {};
        p.filter(function (r) { return r.intake === "Collected"; }).forEach(function (r) { var k = hhmm(r.intake_at).slice(0, 2); hours[k] = (hours[k] || 0) + 1; });
        var cin = p.filter(function (r) { return r.intake === "Collected"; }).length;
        if (isOps()) h += opsSub(sh) + '<div class="stats">' + kstat("back", "Cars in", cin + " / " + p.length, progressBar(cin, p.length), "big") + "</div>" +
          opsStrip([["Still to come", p.filter(function (r) { return !r.intake; }).length, tileAttr("come")], ["No shows", p.filter(function (r) { return r.intake === "No Show"; }).length, tileAttr("noshow")], ["RTC", p.filter(function (r) { return r.intake === "RTC"; }).length, tileAttr("rtc")]]) +
          opsPanel("Cars in by collection hour", "", hourBars(hours), "By the time each car was taken in. Hourly stats uses the booked arrival time.");
        else h += '<h2 class="title">' + esc(sheetLabel(sh)) + '</h2><div class="stats">' +
          kstat("back", "Cars in", cin + " / " + p.length, progressBar(cin, p.length), hasFeatures() ? "big" : "") +
          kstat("noshow", "No shows", p.filter(function (r) { return r.intake === "No Show"; }).length, "", "", "noshow") +
          kstat("rtc", "RTC", p.filter(function (r) { return r.intake === "RTC"; }).length, "", "", "rtc") +
          kstat("come", "Still to come", p.filter(function (r) { return !r.intake; }).length, "", "", "come") + "</div>" +
          '<div class="section-label">Cars in by hour</div>' + (hasFeatures() ? hourBars(hours) : '<div class="box">' + (Object.keys(hours).sort().map(function (k) { return '<div class="rowline"><span class="num grow">' + k + ':00</span><strong class="num">' + hours[k] + "</strong></div>"; }).join("") || '<div class="empty">None yet.</div>') + "</div>");
      }
    }
    var mid = h.length;
    // Operations Refined: the activity in its own panel, the filters in it.
    if (can("log") && isRefined()) {
      h += '<section class="ops-card rf-act"><header><strong>Activity</strong>' + (S.activity ? "<small>" + S.activity.length + " lines</small>" : "") + "</header>" +
        (S.activity ? activityPremiumHtml() : '<div class="empty">Loading…</div>') + "</section>";
      if (!S.activity) loadActivity();
    } else if (can("log")) {
      h += '<div class="section-label">Activity</div>';
      if (!S.activity) { loadActivity(); h += '<div class="empty">Loading…</div>'; }
      else if (hasFeatures()) h += activityPremiumHtml();
      else h += S.activity.length ? '<div class="box">' + S.activity.map(function (a) {
        return '<div class="rowline"><span class="num note">' + esc(dayShort(a.at)) + " " + esc(hhmm(a.at)) + '</span><div class="grow"><strong>' + esc(a.action) + "</strong>" + (a.reg ? " · " + esc(a.reg) : "") +
          '<div class="note">' + esc(a.staff_name || "System") + (a.value ? " · " + esc(a.value) : "") + "</div></div></div>";
      }).join("") + '</div><div class="row-actions"><button type="button" class="btn ghost small" data-reloadlog>Refresh</button></div>' : '<div class="empty">Nothing yet.</div>';
    }
    // A wide screen: the shift's numbers on the left, the activity beside them.
    if (opsDesk() && mid && h.length > mid) return '<div class="sum-desk"><div class="sum-l">' + h.slice(0, mid) + '</div><div class="sum-r">' + h.slice(mid) + "</div></div>";
    return h || '<div class="empty">Nothing to show for your role.</div>';
  }
  // Premium: cars in by hour as bars, every hour from the first to the last
  // (quiet hours show as gaps), the busiest hour in the brand colour.
  function hourBars(hours) {
    var keys = Object.keys(hours).sort();
    if (!keys.length) return '<div class="box"><div class="empty">None yet.</div></div>';
    var max = Math.max.apply(null, keys.map(function (k) { return hours[k]; })), out = [];
    for (var hr = +keys[0]; hr <= +keys[keys.length - 1]; hr++) out.push(("0" + hr).slice(-2));
    return '<div class="box hbars">' + out.map(function (k) {
      var n = hours[k] || 0;
      return '<div class="hbar' + (n === max ? " top" : "") + (n ? "" : " zero") + '"><span class="num hh">' + k + ':00</span><span class="track"><i style="width:' + (n ? Math.max(4, Math.round(n / max * 100)) : 0) + '%"></i></span><b class="num">' + n + "</b></div>";
    }).join("") + "</div>";
  }
  // Premium: a coloured dot on each activity line, the board's button colours.
  function actDot(a) {
    var v = String(a.value || "").toUpperCase();
    switch (a.action) {
      case "SENT": return /CLEARED|OFF/.test(v) ? "x" : "s";
      case "CALLED": return /CLEARED|OFF/.test(v) ? "x" : /OVERSTAY/.test(v) ? "o" : "c";
      case "DESK": return /CLEARED|OFF/.test(v) ? "x" : "d";
      case "CLEAR": return /COMPLAINT/.test(v) ? "r" : /CLEARED|OFF/.test(v) ? "x" : "s";
      case "INTAKE": return /RTC/.test(v) ? "r" : /NO SHOW/.test(v) ? "o" : /COLLECTED/.test(v) ? "s" : "x";
      case "PT": case "PT PHOTOS": case "PT COPY": return "p";
      case "NOTE": case "CHARGE": case "OVERSTAYS": case "EARLY RETURN": return "o";
      case "REMOVED": case "CANCELLED": case "SHEET DELETED": return "r";
      case "FLIGHT": case "RETURN CHANGED": case "COLLECTION TIME": case "SCHEDULED": return "c";
      default: return "x";
    }
  }
  // Standard with features: each number box has its own colour and icon
  // (stdplus.css); a box at 0 goes grey. Other looks hide the icons.
  var KICON = {
    back: '<path d="M5 17h14M6 17l1.5-5h9L18 17M8 12l1-3h6l1 3"/><circle cx="8" cy="17.5" r="1.5"/><circle cx="16" cy="17.5" r="1.5"/>',
    way: '<path d="M4 12h13M13 7l5 5-5 5"/>',
    over: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    comp: '<path d="M12 4 3 19h18z"/><path d="M12 10v4M12 16.5v.5"/>',
    morn: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
    night: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
    noshow: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 19c.6-3.3 3.2-5 6.5-5M16 14l5 5M21 14l-5 5"/>',
    rtc: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    come: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5h4"/>',
    parked: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3"/>',
    added: '<path d="M12 5v14M5 12h14"/>',
    money: '<path d="M15 6.5A3.5 3.5 0 0 0 8.5 8v4.5H7M8.5 12.5c0 2.5-.5 4-2 5.5H16"/>',
    owed: '<path d="M7 4h10M7 20h10M8 4c0 4 8 4 8 8s-8 4-8 8M16 4c0 3-8 5-8 8"/>',
    unpaid: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5M12 15.5v.5"/>',
    waived: '<circle cx="12" cy="12" r="8"/><path d="m7 7 10 10"/>',
    removed: '<path d="M6 6l12 12M18 6 6 18"/>',
    early: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>'
  };
  // tile: a QUEUES name, so tapping the number opens those cars on the board.
  function kstat(k, label, value, extra, cls, tile) {
    var zero = /^(0|£0|0 \/ 0)$/.test(String(value));
    return '<div class="stat k-' + k + (zero ? " zero" : "") + (cls ? " " + cls : "") + (tile ? ' tap"' + tileAttr(tile) : '"') + '><svg class="ki" viewBox="0 0 24 24" aria-hidden="true">' + (KICON[k] || "") + "</svg><span>" + label + '</span><strong class="num">' + value + "</strong>" + (extra || "") + "</div>";
  }
  // Operations Refined's shift line: the part of the day and its hours, a thin bar, and "3 of 12".
  function rfPart(name, hours, x) { return [name + "<small>" + hours + "</small>" + miniBar(x.done, x.due), x.done + " of " + x.due]; }
  function miniBar(done, all) { return '<span class="mbar" aria-hidden="true"><i style="width:' + (all ? Math.round(done / all * 100) : 0) + '%"></i></span>'; }
  function progressBar(done, all) {
    if (!hasFeatures() || !all) return "";
    var pc = Math.round(done / all * 100);
    return '<div class="pbar" role="progressbar" aria-valuemin="0" aria-valuemax="' + all + '" aria-valuenow="' + done + '"><i style="width:' + pc + '%"></i></div><small class="pbar-pc">' + pc + "% done" + (isRefined() ? " · " + (all - done) + " to go" : "") + '</small><div class="pring" aria-hidden="true" style="--pc:' + pc + '" data-pc="' + pc + '%"></div>';
  }
  // Which part of the work an activity line is about, for the filter chips.
  var PICK_ACTIONS = { INTAKE: 1, PT: 1, "PT PHOTOS": 1, "PT COPY": 1, "SHORT DATES": 1, "COLLECTION TIME": 1 };
  function actKind(a) {
    if (a.action === "STAFF" || a.action === "SIGN IN") return "staff";
    if (a.action === "SETTINGS") return "settings";
    var sh = a.sheet_id && S.sheets.filter(function (x) { return x.id === a.sheet_id; })[0];
    if (sh) return sh.kind;
    if (PICK_ACTIONS[a.action]) return "picks";
    return a.sheet_id || a.booking_id ? "drops" : "other";
  }
  var ACT_FILTERS = [["all", "All"], ["drops", "Drops"], ["picks", "Picks"], ["staff", "Staff"], ["settings", "Settings"]];
  function activityPremiumHtml() {
    var f = S.actFilter || "all";
    return '<div class="actbar"><div class="chips" role="group" aria-label="Show">' + ACT_FILTERS.map(function (x) {
        return '<button type="button" data-actf="' + x[0] + '" class="' + (f === x[0] ? "on" : "") + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + "</button>";
      }).join("") + '</div><input type="search" id="actQ" placeholder="Search reg or name" autocomplete="off" aria-label="Search activity" value="' + esc(S.actQ || "") + '"></div>' +
      '<div id="actList">' + activityListHtml() + '</div><div class="row-actions"><button type="button" class="btn ghost small" data-reloadlog>Refresh</button></div>';
  }
  function activityListHtml() {
    var f = S.actFilter || "all", q = (S.actQ || "").trim().toUpperCase().replace(/\s+/g, "");
    var rows = S.activity.filter(function (a) {
      if (f !== "all" && actKind(a) !== f) return false;
      return !q || [a.reg, a.customer, a.staff_name, a.action, a.value].join(" ").toUpperCase().replace(/\s+/g, "").indexOf(q) >= 0;
    });
    if (!rows.length) return '<div class="empty">' + (S.activity.length ? "Nothing matches." : "Nothing yet.") + "</div>";
    var today = londonParts(new Date()).key, h = "", last = "";
    rows.forEach(function (a) {
      var key = londonParts(new Date(a.at)).key;
      if (key !== last) {
        if (last) h += "</div>";
        var near = key === today ? "Today" : key === addDaysKey(today, -1) ? "Yesterday" : "";
        h += '<div class="actday">' + (opsDesk() ? (near ? near + " · " : "") + esc(longDate(key)) : near || esc(longDay(key))) + '</div><div class="box actbox">';
        last = key;
      }
      h += '<div class="actrow k-' + actKind(a) + '"><span class="num at">' + esc(hhmm(a.at)) + '</span><i class="adot d-' + actDot(a) + '" aria-hidden="true"></i><div class="grow"><strong>' + esc(a.reg ? a.reg + " · " : "") + esc(nice(a.action).replace(/\bPt\b/g, "PT")) + "</strong>" +
        '<div class="note">' + esc(a.staff_name || "System") + (a.value ? " · " + esc(a.value) : "") + "</div></div></div>";
    });
    return h + "</div>";
  }
  async function loadActivity() {
    var r = await sb.from("activity").select("*").order("at", { ascending: false }).limit(200);
    S.activity = r.error ? [] : r.data; if (r.error) toast(r.error.message, true);
    if (S.view === "summary") render();
  }

  // ── dashboard (owner and managers) ───────
  // Over the last 24 hours, 7 or 30 days: cars added at the desk (Add a car,
  // and PICKS cars marked NEW BOOKING by hand), money taken and waived, money
  // still owed (cars here now, and cars that left with no payment recorded),
  // removed cars and complaints. One read: owner_dashboard() (setup part 66).
  var DASH_PERIODS = [["1", "24 hours"], ["7", "7 days"], ["30", "30 days"]];
  var dashRequest = 0;
  async function loadDash() {
    var days = +(S.dashDays || "7"), want = S.dashDays || "7", request = ++dashRequest;
    var r = await sb.rpc("owner_dashboard", { p_since: new Date(Date.now() - days * 86400000).toISOString() });
    if ((S.dashDays || "7") !== want || request !== dashRequest) return;
    if (r.error) { S.dash = { error: r.error.message }; } else S.dash = r.data || {};
    S.dashUpdated = r.error ? null : new Date().toISOString();
    if (S.view === "dashboard") render();
  }
  function owedNow(r) {
    if (r.charge_agreed != null) return { amount: +r.charge_agreed, days: 0 };
    return overstayDue(r) || { amount: 0, days: 0 };
  }
  // Capacity (Settings, database part 71): "of 400 · 370 free", or how many over.
  function capLine(n, cap) { return "of " + cap + " · " + (n > cap ? '<b class="late">' + (n - cap) + " over</b>" : cap - n + " free"); }
  function yardNum(y) {
    var c = y.yard && +((S.company.yard_capacity || {})[y.yard]) || 0;
    return '<strong class="num' + (c && y.n > c ? " late" : "") + '">' + y.n + (c ? '<small class="note"> / ' + c + "</small>" : "") + "</strong>";
  }
  function renderDashboard() {
    if (!can("settings")) return '<div class="empty">Nothing to show for your role.</div>';
    var f = S.dashDays || "7";
    var h = '<div class="ops-dashboard"><div class="dash-toolbar"><div class="dash-heading"><span class="dash-eyebrow">OFFICE / OVERVIEW</span><h1>Operations dashboard</h1></div><div class="dchips" role="group" aria-label="Period">' + DASH_PERIODS.map(function (x) {
      return '<button type="button" data-dashp="' + x[0] + '" class="' + (f === x[0] ? "on" : "") + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + "</button>";
    }).join("") + "</div></div>";
    // Standard with features and Operations: the loading and error states keep the loaded page's head, so the period bar doesn't change look.
    if (isStdPlus() && (!S.dash || S.dash.error)) {
      if (!S.dash) loadDash();
      return '<div class="ops-dashboard ops-v2 od">' + odHead(S.dash ? "" : "Loading…", !S.dash) + (S.dash ? '<div class="od-err" role="alert">' + esc(S.dash.error) + "</div>" : "") + "</div>";
    }
    if (!S.dash) { loadDash(); return h + '<div class="empty">Loading…</div></div>'; }
    if (S.dash.error) return h + '<div class="alert">' + esc(S.dash.error) + '</div><button type="button" class="btn ghost small" data-dashreload>Try again</button></div>';
    var D = S.dash, sum = function (a, k) { return a.reduce(function (t, x) { return t + (+x[k] || 0); }, 0); };
    var added = D.added || [], paid = D.paid || [], removed = D.removed || [], complaints = D.complaints || [];
    var taken = paid.filter(function (x) { return x.charge_method !== "waived"; }), waived = paid.filter(function (x) { return x.charge_method === "waived"; });
    // True totals for the period come from the database (part 85); the lists below stop at 300 rows.
    var tt = D.totals || {}, tn = function (k, fb) { return tt[k] != null ? +tt[k] : fb; };
    var cash = tn("cash", sum(taken.filter(function (x) { return x.charge_method === "cash"; }), "charge_amount")), card = tn("card", sum(taken.filter(function (x) { return x.charge_method === "card"; }), "charge_amount"));
    var N = { added: tn("added", added.length), addedDesk: tn("added_desk", added.filter(function (a) { return a.action === "ADDED"; }).length), taken: tn("taken_n", taken.length), waived: tn("waived_n", waived.length), waivedSum: tn("waived", sum(waived, "charge_amount")),
      removed: tn("removed", removed.length), complaints: tn("complaints", complaints.length), owed: tn("owed_n", (D.owed || []).length) };
    // RTC and Early return have no database total yet, so they count the list (up to 300 rows).
    N.removedBy = {};
    REMOVE_WHY.forEach(function (k) { N.removedBy[k] = tn(k.toLowerCase().replace(/ /g, "_"), removed.filter(function (r) { return r.removed_reason === k; }).length); });
    var owed = (D.owed || []).map(function (r) { var o = owedNow(r); return Object.assign({}, r, { due: o.amount, days: o.days }); }).filter(function (r) { return r.due > 0; });
    var here = owed.filter(function (r) { return !r.cleared_at; }), left = owed.filter(function (r) { return r.cleared_at; });
    var when = function (ts) { return esc(dayShort(ts)) + " " + esc(hhmm(ts)); };
    var TK = { "Parked now": "parked", "Added at the desk": "added", "Money taken": "money", "Owed now": "owed", "Left unpaid": "unpaid", Waived: "waived", Removed: "removed", Complaints: "comp", "Early returns": "early" };
    var tile = function (label, big, small, cls) { return kstat(TK[label] || "x", label, big, small ? "<small>" + small + "</small>" : "", cls); };
    var PK = D.parked || { total: 0, late: 0, days: [] }, todayKey = currentShiftKey();
    var dayName = function (k) { return k === todayKey ? "Today" : k === addDaysKey(todayKey, 1) ? "Tomorrow" : longDay(k); };
    var cap = +S.company.capacity || 0;
    h += '<div class="stats dstats">' +
      tile("Parked now", +PK.total || 0, (cap ? capLine(+PK.total || 0, cap) + " · " : "") + (+PK.late ? PK.late + " past their return · " : "") + "right now, whatever the period", "wide" + (cap && +PK.total > cap ? " warn" : "")) +
      tile("Added at the desk", N.added, N.addedDesk + " added · " + (N.added - N.addedDesk) + " NEW BOOKING") +
      tile("Money taken", money(cash + card), "cash " + money(cash) + " · card " + money(card)) +
      tile("Owed now", money(sum(here, "due")), here.length + (here.length === 1 ? " car" : " cars") + " here") +
      tile("Left unpaid", money(sum(left, "due")), left.length + (left.length === 1 ? " car" : " cars"), left.length ? "warn" : "") +
      tile("Waived", money(N.waivedSum), N.waived + (N.waived === 1 ? " car" : " cars")) +
      tile("Removed", N.removed, removeWhyLine(N.removedBy)) +
      tile("Complaints", N.complaints, "") +
      tile("Early returns", +D.early || 0, (+D.changed || 0) + " return changes") + "</div>";
    var records = {};
    var list = function (title, rows, line, total) {
      var n = total != null && total > rows.length ? total : rows.length;
      var body = rows.length ? rows.map(line).join("") + (n > rows.length ? '<div class="note">Showing the latest ' + rows.length + " of " + n + ".</div>" : "") : '<div class="empty">None.</div>';
      records[title] = { count: n, body: body };
      return '<div class="section-label">' + title + " (" + n + ')</div><div class="box dlist">' + body + "</div>";
    };
    // Parked now, by yard (database part 70): each yard's count, then its next return days.
    var yards = PK.yards || [];
    if (yards.length) {
      var order = (S.company.yards || []);
      yards = yards.slice().sort(function (a, b) { return (a.yard ? 0 : 1) - (b.yard ? 0 : 1) || b.n - a.n || order.indexOf(a.yard) - order.indexOf(b.yard); });
      h += '<div class="section-label">Parked now, by yard</div><div class="box dlist dyard">' + yards.map(function (y) {
        var ds = y.days || [], shown = ds.slice(0, 4), rest = ds.slice(4).reduce(function (t, d) { return t + d.n; }, 0);
        var line = shown.map(function (d) { return (d.day ? esc(dayName(d.day)) : '<b class="late">past return</b>') + " " + d.n; }).join(" · ") + (rest ? " · later " + rest : "");
        return '<div class="rowline"><div class="grow"><strong>' + (y.yard ? esc(YARD_LABEL[y.yard] || y.yard) : "No yard yet") + '</strong><div class="note">' + line + '</div></div>' + yardNum(y) + "</div>";
      }).join("") + "</div>";
    }
    h += '<div class="section-label">Cars on site, next 14 days</div><div class="box dlist booked">' + bookedBody(D, PK) + "</div>";
    var pdays = (PK.late ? [{ late: true, n: PK.late }] : []).concat(PK.days || []);
    h += '<div class="section-label">Parked now, by return day</div><div class="box dlist dpark">' + (pdays.length ? pdays.map(function (d) {
      if (d.late) return '<details class="latebox"><summary class="rowline late"><div class="grow"><strong>Past their return</strong><div class="note">Return time gone, not handed back yet · tap to see them</div></div><strong class="num">' + d.n + "</strong></summary>" + lateBody(PK) + "</details>";
      return '<div class="rowline"><div class="grow"><strong>' + esc(dayName(d.day)) + '</strong></div><strong class="num">' + d.n + "</strong></div>";
    }).join("") : '<div class="empty">No cars in.</div>') + "</div>";
    if (left.length) h += list("Left with no payment recorded", left, function (r) {
      return '<div class="rowline"><div class="grow"><strong>' + esc(r.reg) + "</strong> · " + esc(r.name) + '<div class="note">Cleared ' + when(r.cleared_at) + (r.charge_reason ? " · " + esc(r.charge_reason) : r.days ? " · " + r.days + (r.days === 1 ? " day" : " days") + " over" : "") + '</div></div><strong class="num due">' + money(r.due) + "</strong></div>";
    });
    h += list("Added at the desk", added, function (a) {
      return '<div class="rowline"><span class="num note">' + when(a.at) + '</span><div class="grow"><strong>' + esc(a.reg || "NO REG") + "</strong>" + (a.customer ? " · " + esc(a.customer) : "") +
        '<div class="note">' + (a.action === "ADDED" ? "Added to " + esc(String(a.kind || "").toUpperCase() || "the sheet") : "Marked NEW BOOKING") + " · " + esc(a.staff_name || "—") + "</div></div></div>";
    }, N.added);
    h += list("Money taken", taken, function (x) {
      return '<div class="rowline"><span class="num note">' + when(x.charge_at) + '</span><div class="grow"><strong>' + esc(x.reg) + "</strong> · " + esc(x.name) + '<div class="note">' + esc(String(x.charge_method).toUpperCase()) + (x.charge_reason ? " · " + esc(x.charge_reason) : "") + " · " + esc(x.by_name || "—") + '</div></div><strong class="num">' + money(x.charge_amount) + "</strong></div>";
    }, N.taken);
    h += list("Owed now", here, function (r) {
      return '<div class="rowline"><div class="grow"><strong>' + esc(r.reg) + "</strong> · " + esc(r.name) + '<div class="note">Due back ' + when(r.orig_return_at || r.return_at) + (r.charge_reason ? " · " + esc(r.charge_reason) : r.days ? " · " + r.days + (r.days === 1 ? " day" : " days") + " over" : "") + '</div></div><strong class="num">' + money(r.due) + "</strong></div>";
    });
    if (waived.length) h += list("Waived", waived, function (x) {
      return '<div class="rowline"><span class="num note">' + when(x.charge_at) + '</span><div class="grow"><strong>' + esc(x.reg) + "</strong> · " + esc(x.name) + '<div class="note">' + esc(x.by_name || "—") + '</div></div><strong class="num">' + money(x.charge_amount) + "</strong></div>";
    }, N.waived);
    h += list("Removed", removed, function (x) {
      return '<div class="rowline"><span class="num note">' + when(x.removed_at) + '</span><div class="grow"><strong>' + esc(x.reg || "NO REG") + "</strong> · " + esc(x.name) + '<div class="note">' + esc(x.removed_reason) + " · " + esc(String(x.kind || "").toUpperCase()) + " · " + esc(x.by_name || "—") + "</div></div></div>";
    }, N.removed);
    if (complaints.length) h += list("Complaints", complaints, function (a) {
      return '<div class="rowline"><span class="num note">' + when(a.at) + '</span><div class="grow"><strong>' + esc(a.reg) + "</strong>" + (a.customer ? " · " + esc(a.customer) : "") + '<div class="note">' + esc(a.staff_name || "—") + "</div></div></div>";
    }, N.complaints);
    if (isStdPlus()) return renderOpsDashboard({ N: N, D: D, PK: PK, records: records, yards: yards, added: added, taken: taken, cash: cash, card: card, here: here, left: left, waived: waived, removed: removed, complaints: complaints, sum: sum, dayName: dayName, today: todayKey });
    return h + '<div class="row-actions"><button type="button" class="btn ghost small" data-dashreload>Refresh</button></div></div>';
  }

  // Standard with features and Operations: the dashboard laid out as the office
  // works it. What needs attention first, then cars parked against capacity, the
  // work coming up, payments, tonight's queues and the checks; the full records
  // last. Every figure comes from owner_dashboard() or tonight's sheets.
  // Exit fees (database part 84) show once the database sends them.
  function dashSheetFor(kind, day) { return (S.sheets || []).filter(function (s) { return s.kind === kind && s.day === day; })[0] || null; }
  var dashLiveRequest = 0;
  // Tonight's DROPS and today's PICKS, read fresh for the Live queues and Checks panels.
  async function loadDashLive() {
    var request = ++dashLiveRequest, d = dashSheetFor("drops", currentShiftKey()), p = dashSheetFor("picks", londonParts(new Date()).key);
    var get = function (sh) { return sh ? fetchSheetRows(sh.id, sh).then(function (r) { return r.error ? null : (r.data || []).filter(function (x) { return !x.removed_at; }); }, function () { return null; }) : Promise.resolve(null); };
    var got = await Promise.all([get(d), get(p)]);
    if (request !== dashLiveRequest) return;
    S.dashLive = { drops: d, dropsRows: got[0], picks: p, picksRows: got[1] };
    if (S.view === "dashboard") render();
  }
  // The handover note: written by the owner or a manager, read by the next shift.
  function handoverHtml(H) {
    if (!H) return "";
    var d = S.handoverDraft != null ? S.handoverDraft : (H.note || "");
    return '<div class="od-handover"><label for="handoverText">Handover note</label><textarea id="handoverText" rows="3" maxlength="2000" placeholder="What the next shift needs to know">' + esc(d) + '</textarea>' +
      '<div class="od-hrow"><small>' + (H.at ? "Written " + esc(dayShort(H.at) + " " + hhmm(H.at)) + (H.by ? " by " + esc(H.by) : "") : "No note yet") + '</small><button type="button" class="od-save" data-savehandover>Save note</button></div></div>';
  }
  async function saveHandover(btn) {
    var ta = $("handoverText"); if (!ta) return;
    var text = ta.value.trim();
    btn.disabled = true;
    var r = await sb.rpc("set_handover_note", { p_note: text });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    S.handoverDraft = null;
    if (S.dash) S.dash.handover = r.data || { note: text };
    toast(text ? "Handover note saved" : "Handover note cleared"); render();
  }
  // The dashboard head: updated line, Refresh and the period bar, the same while loading as when loaded.
  function odHead(updated, busy) {
    return '<div class="od-head"><h1>Dashboard</h1><div class="od-tools"><span class="od-updated ops-updated">' + esc(updated) + '</span><button type="button" class="od-refresh" data-dashreload' + (busy ? " disabled" : "") + '>Refresh</button><div class="dchips" role="group" aria-label="Period">' + DASH_PERIODS.map(function (p) {
      var on = p[0] === (S.dashDays || "7");
      return '<button type="button" data-dashp="' + p[0] + '" class="' + (on ? "on" : "") + '" aria-pressed="' + on + '">' + p[1] + "</button>";
    }).join("") + "</div></div></div>";
  }
  function renderOpsDashboard(x) {
    var cap = +S.company.capacity || 0, PK = x.PK, D = x.D, total = +PK.total || 0, late = +PK.late || 0;
    var period = DASH_PERIODS.filter(function (p) { return p[0] === (S.dashDays || "7"); })[0][1];
    var cars = function (n) { return n + (n === 1 ? " car" : " cars"); };
    var goTag = function (target, label) { return '<span class="od-go">' + label + ' <span aria-hidden="true">→</span></span>'; };
    var countOn = function (day) { return (PK.days || []).reduce(function (n, d) { return n + (d.day === day ? +d.n : 0); }, 0); };
    var tomorrow = addDaysKey(x.today, 1);
    if (S.dashLive === undefined) { S.dashLive = null; loadDashLive(); }
    var L = S.dashLive || {};

    // Exit fees (part 84): shown when a fee is set or fees were taken in the period.
    var E = D.exit || null, fee = exitFee() || +(E && E.fee) || 0;
    var showExit = !!E && (fee > 0 || +E.paid > 0), exitReview = showExit ? (+E.unpaid || 0) + (+E.no_photo || 0) : 0;
    var unpaidSum = x.sum(x.left, "due"), taken = x.taken;

    var h = '<div class="ops-dashboard ops-v2 od">' + odHead("Updated " + hhmm(S.dashUpdated));

    // Needs attention: only what someone has to act on.
    var items = [];
    if (late) items.push('<button type="button" class="od-attn-item" data-dashjump="late"><b class="od-n bad">' + late + '</b><span>' + (late === 1 ? "car" : "cars") + " past their return</span>" + goTag("late", "Open cars") + "</button>");
    if (x.left.length) items.push('<button type="button" class="od-attn-item" data-dashjump="unpaid"><b class="od-n bad">' + money(unpaidSum) + '</b><span>left unpaid · ' + cars(x.left.length) + "</span>" + goTag("unpaid", "Review") + "</button>");
    if (exitReview) items.push('<button type="button" class="od-attn-item" data-dashjump="exit"><b class="od-n warn">' + exitReview + '</b><span>exit ' + (exitReview === 1 ? "fee" : "fees") + " to check</span>" + goTag("exit", "Review") + "</button>");
    h += '<section class="od-card od-attn ops-attention" aria-label="Needs attention"><h2>Needs attention</h2>' + (items.length ? '<div class="od-attn-list">' + items.join("") + "</div>" : '<p class="od-none">Nothing needs attention.</p>') + "</section>";

    // Parked now against capacity, and Upcoming workload.
    var pct = cap ? Math.round(total / cap * 100) : 0;
    h += '<div class="od-row od-row-top"><section class="od-parked k-parked" aria-label="Parked now"><div class="od-ptop"><span>Parked now</span>' + (cap ? '<span class="od-free">' + (total > cap ? (total - cap) + " over" : (cap - total) + " free") + "</span>" : "") + '</div><div class="od-pbig"><strong class="num">' + total + "</strong>" + (cap ? "<small>of " + cap + "</small>" : "") + "</div>" +
      (cap ? '<div class="od-bar ops-capbar' + (total > cap ? " over" : "") + '" role="img" aria-label="' + pct + '% full"><i style="width:' + Math.min(100, pct) + '%"></i></div>' : "") +
      '<div class="od-pfoot"><span class="od-pnote">' + [cap ? pct + "% occupied" : "", late ? late + " past their return" : ""].filter(Boolean).join(" · ") + '</span><span class="od-pday"><small>Returning today</small><b class="num">' + countOn(x.today) + '</b></span><span class="od-pday"><small>Tomorrow</small><b class="num">' + countOn(tomorrow) + "</b></span></div></section>";
    var onsite = D.onsite || [], dayLabel = function (k) { return k === x.today ? "Today" : k === tomorrow ? "Tomorrow" : longDay(k); };
    var work = onsite.length ? onsite.map(function (r) { return { day: r.day, n: (+r.in || 0) + (+r.out || 0), note: (+r.out || 0) + " returning · " + (+r.in || 0) + " arriving" }; })
      : (PK.days || []).map(function (d) { return { day: d.day, n: +d.n || 0, note: cars(+d.n || 0) + " returning" }; });
    var shownWork = S.dashAllDates ? work : work.slice(0, 2);
    h += '<section class="od-card od-work" id="dash-work" tabindex="-1"><h2>Upcoming workload</h2><div class="od-list">' + (shownWork.length ? shownWork.map(function (w) {
      return '<div class="od-line' + (w.day === x.today ? " today" : "") + '"><span class="od-label">' + esc(dayLabel(w.day)) + '<small>' + w.note + '</small></span><b class="num">' + w.n + "</b></div>";
    }).join("") : '<p class="od-none">No bookings ahead yet.</p>') + "</div>" +
      (work.length > 2 ? '<button type="button" class="od-more" data-dashdates aria-expanded="' + !!S.dashAllDates + '">' + (S.dashAllDates ? "Show today and tomorrow" : "Open schedule, next " + work.length + " days") + ' <span aria-hidden="true">→</span></button>' : "") + "</section></div>";

    // Payments: what came in over the period, and what still needs collecting.
    var cell = function (label, v, cls) { return '<span class="od-c' + (cls ? " " + cls : "") + '"><small>' + label + "</small>" + v + "</span>"; };
    var dash = '<span class="od-dash">—</span>';
    var rows = "";
    if (showExit) rows += '<div class="od-tr"><span class="od-c od-name"><b>Exit fees</b><small>' + (fee ? money(fee) + " a car" : "Off now") + "</small></span>" +
      cell("Collected", "<b>" + money((+E.cash || 0) + (+E.card || 0)) + "</b> · " + cars(+E.paid || 0), "od-coll") + cell("Cash", money(E.cash)) + cell("Card", money(E.card)) +
      cell("To check", exitReview ? '<b class="warn">' + cars(exitReview) + "</b>" : dash, "od-rev") + "</div>";
    rows += '<div class="od-tr"><span class="od-c od-name"><b>Overstay and charges</b><small>Money taken at the desk</small></span>' +
      cell("Collected", "<b>" + money(x.cash + x.card) + "</b> · " + cars(x.N.taken), "od-coll") + cell("Cash", money(x.cash)) + cell("Card", money(x.card)) +
      cell("Left unpaid", x.left.length ? '<b class="bad">' + money(unpaidSum) + "</b> · " + cars(x.left.length) : dash, "od-rev") + "</div>";
    var foot = [];
    if (showExit) foot.push((E.paid_cars ? '<button type="button" class="od-link" data-dashjump="exitpaid">' : "<span>") + (+E.paid || 0) + " exit " + (+E.paid === 1 ? "fee" : "fees") + " paid" + (E.paid_cars ? "</button>" : "</span>"), (+E.exempt || 0) + " exempt");
    foot.push("Owed now " + money(x.sum(x.here, "due")) + " (" + cars(x.here.length) + " here)", "Waived " + money(x.N.waivedSum));
    h += '<section class="od-card od-pay" aria-label="Payments"><div class="od-cardhead"><h2>Payments</h2><small>Last ' + period + '</small></div><div class="od-table"><div class="od-tr od-th"><span>Payment</span><span>Collected</span><span>Cash</span><span>Card</span><span>To check</span></div>' + rows + '</div><div class="od-foot"><span>' + foot.join(" · ") + '</span><button type="button" class="od-more" data-dashjump="records">Payment records <span aria-hidden="true">→</span></button></div></section>';

    // Live queues (tonight's DROPS) and Checks.
    var dr = L.dropsRows;
    var qline = function (label, n, sheetId, act, queue) {
      return '<button type="button" class="od-line od-tap"' + (sheetId ? ' data-dashsheet="' + esc(sheetId) + '"' + (queue ? ' data-dashqueue="' + queue + '"' : "") : " disabled") + '><span class="od-label">' + label + '</span><b class="num">' + n + "</b>" + (sheetId ? goTag("", act) : "") + "</button>";
    };
    h += '<div class="od-row"><section class="od-card od-queues" aria-label="Live queues"><div class="od-cardhead"><h2>Live queues</h2><small>' + (L.drops ? esc(sheetLabel(L.drops)) : "Tonight's DROPS") + "</small></div><div class=\"od-list\">";
    if (S.dashLive === null) h += '<p class="od-none">Loading…</p>';
    else if (!L.drops) h += '<p class="od-none">No DROPS sheet for tonight yet.</p>';
    else if (!dr) h += '<p class="od-none">Couldn\'t load tonight\'s DROPS.</p>';
    else {
      var drops = dr.filter(function (r) { return r.kind === "drops"; });
      h += ["called", "sent", "soon"].map(function (k) { return qline(QUEUES[k][0], drops.filter(QUEUES[k][1]).length, L.drops.id, "Open queue", k); }).join("");
    }
    h += "</div></section>";
    var noYard = (x.yards || []).filter(function (y) { return !y.yard; }).reduce(function (n, y) { return n + (+y.n || 0); }, 0);
    var pr = L.picksRows, checks = "";
    checks += '<button type="button" class="od-line od-tap" data-dashjump="yards"' + ((x.yards || []).length ? "" : " disabled") + '><span class="od-label">Parked with no yard</span><b class="num' + (noYard ? " warn" : "") + '">' + noYard + "</b>" + goTag("", "Yards") + "</button>";
    if (L.picks && pr) checks += '<button type="button" class="od-line od-tap" data-dashsheet="' + esc(L.picks.id) + '"><span class="od-label">PT photos not taken<small>' + esc(sheetLabel(L.picks)) + '</small></span><b class="num">' + pr.filter(function (r) { return r.intake === "Collected" && !r.pt_at; }).length + "</b>" + goTag("", "Open PICKS") + "</button>";
    if (L.picks && pr) {
      var noDocket = pr.filter(function (r) { return r.pick_called === "New Booking" && !r.doc_path; }).length;
      checks += '<button type="button" class="od-line od-tap" data-dashsheet="' + esc(L.picks.id) + '"><span class="od-label">Desk bookings with no docket photo<small>' + esc(sheetLabel(L.picks)) + '</small></span><b class="num' + (noDocket ? " warn" : "") + '">' + noDocket + "</b>" + goTag("", "Open PICKS") + "</button>";
    }
    checks += '<button type="button" class="od-line od-tap" data-view="summary"><span class="od-label">Shift summary and activity log</span>' + goTag("", "Open") + "</button>";
    h += '<section class="od-card od-checks" aria-label="Checks"><div class="od-cardhead"><h2>Checks and handover</h2></div><div class="od-list">' + checks + "</div>" + handoverHtml(D.handover) + "</section></div>";

    // Desk activity and cars on site (each folds away), parked by yard, then the records.
    var NN = x.N;
    h += '<div class="od-row">' + foldOpen("desk", "Desk activity", "Last " + period, NN.added + " added · " + NN.removed + " removed · " + NN.complaints + (NN.complaints === 1 ? " complaint" : " complaints"), "", "od-fold") + '<div class="od-list">' +
      [["added", "Added at the desk", NN.added, NN.addedDesk + " added · " + (NN.added - NN.addedDesk) + " NEW BOOKING"],
        ["removed", "Removed", NN.removed, removeWhyLine(NN.removedBy)],
        ["complaints", "Complaints", NN.complaints, ""],
        ["", "Early returns", +D.early || 0, (+D.changed || 0) + " return changes"]].map(function (a) {
        return "<" + (a[0] ? 'button type="button" class="od-line od-tap" data-dashjump="' + a[0] + '"' : 'div class="od-line"') + '><span class="od-label">' + a[1] + (a[3] ? "<small>" + a[3] + "</small>" : "") + '</span><b class="num">' + a[2] + "</b>" + (a[0] ? "</button>" : "</div>");
      }).join("") + "</div>" + FOLD_END +
      foldOpen("onsite", "Cars on site", "Next 14 days", onsiteSummary(D), "", "od-fold ops-booked") + '<div class="booked">' + bookedBody(D, PK) + "</div>" + FOLD_END + "</div>";
    if (x.yards.length) h += '<section class="od-card od-yards ops-yards" id="dash-yards" tabindex="-1"><div class="od-cardhead"><h2>Parked now, by yard</h2></div><div class="dlist">' + x.yards.map(function (y) {
      var ds = y.days || [], shown = ds.slice(0, 4), rest = ds.slice(4).reduce(function (n, d) { return n + d.n; }, 0);
      var line = shown.map(function (d) { return (d.day ? esc(x.dayName(d.day)) : '<b class="late">past return</b>') + " " + d.n; }).join(" · ") + (rest ? " · later " + rest : "");
      return '<div class="rowline"><div class="grow"><strong>' + (y.yard ? esc(YARD_LABEL[y.yard] || y.yard) : "No yard yet") + '</strong><div class="note">' + line + "</div></div>" + yardNum(y) + "</div>";
    }).join("") + "</div></section>";

    var rec = x.records;
    rec["Past their return"] = { count: late, body: '<div class="dlist">' + lateBody(PK) + "</div>" };
    if (showExit) {
      var ec = E.cars || [];
      rec["Exit fees to check"] = { count: exitReview, body: ec.length ? ec.map(function (c) {
        return '<div class="rowline"><span class="num note">' + esc(dayShort(c.exit_at || c.cleared_at)) + " " + esc(hhmm(c.exit_at || c.cleared_at)) + '</span><div class="grow"><strong>' + esc(c.reg || "NO REG") + "</strong>" + (c.name ? " · " + esc(c.name) : "") + '<div class="note">' + (c.exit_method ? esc(c.exit_method.toUpperCase()) + ", no photo · " + esc(c.by_name || "—") : "Handed back, no exit fee recorded" + (c.ref ? " · " + esc(c.ref) : "")) + "</div></div></div>";
      }).join("") + (exitReview > ec.length ? '<div class="note">Showing the first ' + ec.length + " of " + exitReview + ".</div>" : "") : '<div class="empty">None.</div>' };
    }
    if (showExit && E.paid_cars) {
      var pc = E.paid_cars || [], pn = +E.paid || 0;
      rec["Exit fees paid"] = { count: pn, body: pc.length ? pc.map(function (c) {
        return '<div class="rowline"><span class="num note">' + esc(dayShort(c.exit_at)) + " " + esc(hhmm(c.exit_at)) + '</span><div class="grow"><strong>' + esc(c.reg || "NO REG") + "</strong>" + (c.name ? " · " + esc(c.name) : "") +
          '<div class="note">' + esc(String(c.exit_method || "").toUpperCase()) + (c.photo ? " · photo kept" : " · no photo") + " · " + esc(c.by_name || "—") + (c.ref ? " · " + esc(c.ref) : "") + '</div></div><strong class="num">' + money(c.exit_amount) + "</strong></div>";
      }).join("") + (pn > pc.length ? '<div class="note">Showing the latest ' + pc.length + " of " + pn + ".</div>" : "") : '<div class="empty">None.</div>' };
    }
    var detail = function (id, title) {
      var r = rec[title] || { count: 0, body: '<div class="empty">None.</div>' };
      return '<details id="dash-' + id + '" class="ops-record"><summary>' + title + " <small>(" + r.count + ")</small></summary>" + (r.body.indexOf('<div class="dlist">') === 0 ? r.body : '<div class="dlist">' + r.body + "</div>") + "</details>";
    };
    h += '<section class="od-card od-records ops-details" id="dash-records" tabindex="-1"><div class="od-cardhead"><h2>Records</h2><small>Last ' + period + "</small></div>" +
      detail("late", "Past their return") + detail("unpaid", "Left with no payment recorded") + (showExit ? detail("exit", "Exit fees to check") + (E.paid_cars ? detail("exitpaid", "Exit fees paid") : "") : "") + detail("money", "Money taken") + detail("owed", "Owed now") + detail("waived", "Waived") + detail("added", "Added at the desk") + detail("removed", "Removed") + detail("complaints", "Complaints") + "</section>";
    return h + "</div>";
  }

  // ── whose app this is ─────────────────────────────────────────────────────
  // One codebase, several parking companies. Each carries its own name, colour
  // and logo in companies.brand, and the page wears them the moment someone
  // signs in — a driver at Airport Parking Bay should never see the word
  // another company's name. Nothing here is per-company code; it is all data.
  var BRAND_KEY = "takeoff_brand";
  var PRODUCT = "Parking Ops";
  function brandName() {
    if (S.company) return String((S.company.brand && S.company.brand.short) || S.company.name || PRODUCT);
    try {
      var c = JSON.parse(localStorage.getItem(BRAND_KEY) || "null");
      if (c) return String((c.brand && c.brand.short) || c.name || PRODUCT);
    } catch (e) {}
    return PRODUCT;
  }
  // Light or dark (Cards look): the phone's own setting unless
  // this phone has picked one in the menu. Kept on the phone only.
  var MODE_KEY = "takeoff_mode", darkMq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function getMode() { try { return localStorage.getItem(MODE_KEY) || "auto"; } catch (e) { return "auto"; } }
  function applyMode() {
    var m = getMode(), dark = isCards() && (m === "dark" || (m === "auto" && !!darkMq && darkMq.matches));
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && isCards()) meta.setAttribute("content", dark ? "#0A111D" : getComputedStyle(document.documentElement).getPropertyValue(isPremium() ? "--pchrome" : "--chrome").trim() || "#0E3F7E");
  }
  function setMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) {} applyMode(); }
  if (darkMq && darkMq.addEventListener) darkMq.addEventListener("change", applyMode);
  function modeHtml() {
    if (!isCards()) return "";
    var m = getMode();
    return '<label>DISPLAY</label><div class="pseg mode">' + [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(function (x) {
      return '<button type="button" data-mode="' + x[0] + '" class="' + (m === x[0] ? "on" : "") + '" aria-pressed="' + (m === x[0]) + '">' + x[1] + "</button>";
    }).join("") + '</div><p class="hint">Auto follows this phone\'s own light or dark setting.</p>';
  }
  function applyBrand(co) {
    var b = (co && co.brand) || {};
    applyYardColours(co);
    // Remembered on this phone so the NEXT sign-in screen already wears the
    // right name and colour. Without it an Airport Parking Bay driver opens
    // their app and is greeted by another company.
    try { if (co) localStorage.setItem(BRAND_KEY, JSON.stringify({ name: co.name, brand: co.brand || {} })); } catch (e) {}
    var name = String((co && co.name) || b.name || PRODUCT).trim();
    var short = String(b.short || name).trim();

    document.title = name;
    var t = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (t) t.setAttribute("content", short);

    // The look is the company's choice, in its brand (Clients → Edit → LOOK):
    // theme "pro" wears pro.css, "cards" cards.css, "premium" premium.css, "board" premium.css + board.css, none is Standard.
    // Cards and Premium share the card-per-car layout (isCards) but each wears
    // only its own stylesheet: html.cards → cards.css, html.premium → premium.css.
    // Premium Board is Premium plus board.css (html.premium + html.pboard).
    var board = b.theme === "board", premium = b.theme === "premium" || board, cards = b.theme === "cards", pro = b.theme === "pro" || cards || premium;
    document.documentElement.classList.toggle("pro", b.theme === "pro");
    document.documentElement.classList.toggle("cards", cards);
    document.documentElement.classList.toggle("premium", premium);
    document.documentElement.classList.toggle("pboard", board);
    // Standard with features: Standard plus the bottom bar (stdplus.css).
    // Operations is Standard with features plus its own chrome (ops.css): html.stdplus + html.ops.
    // Operations Refined is Standard with features plus ops-refined.css only (html.stdplus + html.ops-refined):
    // the Operations pages and features (isOps), never ops.css.
    document.documentElement.classList.toggle("stdplus", b.theme === "stdplus" || b.theme === "ops" || b.theme === "ops-refined");
    document.documentElement.classList.toggle("ops", b.theme === "ops");
    document.documentElement.classList.toggle("ops-refined", b.theme === "ops-refined");
    var mark = String(b.mark || short.charAt(0) || "P").slice(0, 2);
    // Only the wordmark and the board button. NOT ".brand" on its own: the
    Array.prototype.forEach.call(document.querySelectorAll("span.brand, .tobrand"), function (el) {
      var isGateScreen = el.closest(".gate") !== null;
      el.textContent = isGateScreen ? name : short;
      el.setAttribute("data-mark", mark);
      if (el.classList.contains("tobrand")) el.setAttribute("aria-label", name + " menu");
    });

    if (b.colour) {
      var root = document.documentElement.style;
      root.setProperty("--brand", b.colour);
      if (b.ink) root.setProperty("--brand-ink", b.ink);
      if (b.soft) root.setProperty("--brand-soft", b.soft);
      if (b.text) root.setProperty("--brand-text", b.text);
      // The pro look's bar: the brand's own dark colour, else its text colour.
      if (b.chrome || b.text) root.setProperty("--chrome", b.chrome || b.text);
      // Premium's header: only a colour the brand names for it, else navy.
      if (b.chrome) root.setProperty("--brand-chrome", b.chrome); else root.removeProperty("--brand-chrome");
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", pro ? (b.chrome || b.text || b.colour) : b.colour);
    }
    if (b.logo) {
      Array.prototype.forEach.call(document.querySelectorAll('link[rel="apple-touch-icon"], link[rel="icon"]'), function (l) { l.href = b.logo; });
    }
    applyMode();
  }

  // Wear the remembered brand immediately, before anyone signs in.
  try {
    var cached = JSON.parse(localStorage.getItem(BRAND_KEY) || "null");
    if (cached) applyBrand({ name: cached.name, brand: cached.brand });
  } catch (e) {}

  // Then ask the server whose app this actually is, by the address it is served
  // from or the company named in a #setup link. A phone that has never signed
  // in has nothing remembered, and nobody should meet another firm name on
  // their own sign-in screen. Only the name and colour come back.
  async function brandFromServer(key) {
    if (!key) return;
    try {
      var r = await sb.rpc("public_brand", { p_key: key });
      if (r && r.data && r.data.name) applyBrand({ name: r.data.name, brand: r.data.brand });
    } catch (e) {}
  }

  var R = window.TakeoffReader;
  function newImport(kind) { return { kind: kind || "drops", excelFile: null, pdfFile: null, stage: "pick", error: "", cutoff: kind === "picks" ? "00:00" : (S.company.drops_day_end || "06:00").slice(0, 5) }; }
  function shiftKey(dt, cutoff) {
    if (!dt) return "";
    if (!dt.time || cutoff === "00:00" || dt.time > cutoff) return dt.key;
    return addDaysKey(dt.key, -1);
  }
  // ── import ────────────────────────────────
  // Booking import, "Auto import" tab: bookings from the connected booking site, by hand only.
  // "Check bookings" shows what would change and writes nothing; "Import N bookings" then imports
  // exactly that (same hash check as before). Shown only for a company that has it set up on the
  // platform. The schedule is off.
  var BI_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var BI_FIELD = { reg: "Registration", name: "Name", phone: "Phone", make: "Vehicle", drop: "Drop-off", "return": "Return", flight: "Flight", note: "Note", day: "Sheet day" };
  var BI_STATUS = { "new": "New", changed: "Updated", review: "Review", unchanged: "Unchanged", invalid: "Can't read" };
  function biDay(k) { var m = String(k || "").match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? (+m[3]) + " " + BI_MON[+m[2] - 1] : String(k || ""); }
  function biWhen(v) { var m = String(v || "").match(/^(\d{4}-\d\d-\d\d)(?: (\d\d:\d\d))?/); return m ? biDay(m[1]) + (m[2] ? " " + m[2] : "") : String(v || ""); }
  function biStamp(ts) { return ts ? (dayShort(ts) === dayShort(Date.now()) ? hhmm(ts) : dayShort(ts) + " " + hhmm(ts)) : ""; }
  function biChange(c) {
    var f = c.field, a = c.from, b = c.to;
    if (f === 'drop_at' || f === 'return_at') { return (f === 'drop_at' ? 'Drop-off' : 'Return') + ': ' + (a ? dayShort(a) + ' ' + hhmm(a) : '–') + ' → ' + (b ? dayShort(b) + ' ' + hhmm(b) : '–'); }
    if (f === "phone") return "Phone number updated";
    if (f === "drop" || f === "return") {
      var pa = String(a || "").match(/^(\S+) (\d\d:\d\d)$/), pb = String(b || "").match(/^(\S+) (\d\d:\d\d)$/);
      if (pa && pb && pa[1] === pb[1]) return (f === "return" ? "Return time" : "Drop-off time") + ": " + pa[2] + " → " + pb[2];
      return BI_FIELD[f] + ": " + (a ? biWhen(a) : "–") + " → " + biWhen(b);
    }
    if (f === "day") return "Sheet day: " + biDay(a) + " → " + biDay(b);
    return (BI_FIELD[f] || f) + ": " + (a || "–") + " → " + (b || "–");
  }
  function biQ(ref, reg) { return (String(ref || "") + String(reg || "")).toLowerCase().replace(/\s+/g, ""); }
  // The preview as one list of rows: new, changed, held for review, can't be read; the unchanged ones when the check sent them.
  function biRows(P) {
    var rows = [], conflict = {};
    (P.reviews || []).forEach(function (r) { if (r.kind === "conflict" && r.detail) conflict[(r.detail.kind || "") + "|" + r.ref] = r; });
    (P.items || []).forEach(function (i) {
      var r = { key: i.kind + "|" + i.ref, board: String(i.kind).toUpperCase(), date: biDay(i.day), ref: i.ref, reg: i.reg || "", status: i.status, lines: [], sub: [], explain: "" };
      if (i.status === "new") r.lines = ["New booking"];
      else if (i.status === "changed") r.lines = (i.changes || []).map(biChange);
      else if (i.status === "review") {
        var rv = conflict[i.kind + "|" + i.ref], why = rv && rv.detail && rv.detail.why ? String(rv.detail.why).replace(/\b\d{4}-\d\d-\d\d\b/g, biDay) : "";
        r.lines = [why ? why.charAt(0).toUpperCase() + why.slice(1) : "Needs an office decision"];
        r.sub = (i.changes || []).map(biChange);
        r.explain = "Held back. This booking stays out of the import until the office decides.";
        r.acts = revActs(i.kind, i.ref, rv && rv.detail && rv.detail.why, i.changes, revId(i.kind, i.ref));
      }
      r.selectable = !!P.selection_supported && (r.status === "new" || r.status === "changed");
      r.attention = i.attention || ""; r.location = [i.lane ? "Lane " + i.lane + (i.position ? " · Position " + i.position : "") : i.yard ? "Yard " + i.yard : "", i.number ? "Key/board number " + i.number : ""].filter(Boolean).join(" · ");
      if (i.booking_id && !r.acts) r.acts = revActs(i.kind, i.ref, "", i.changes, "");
      rows.push(r);
    });
    (P.reviews || []).forEach(function (r) {
      if (r.kind !== "cancelled") return;
      var d = r.detail || {};
      rows.push({ key: "x|" + (d.kind || "") + "|" + r.ref, board: String(d.kind || "").toUpperCase(), date: d.on_sheet ? biDay(d.on_sheet) : "", ref: r.ref, reg: d.reg || "", status: "review",
        lines: [d.missing ? "Not on the booking site any more" : "Cancellation requires review"], sub: d.name ? [d.name] : [],
        explain: (d.missing ? "The booking site no longer lists it: cancelled, deleted or moved to another day." : "Cancelled on the booking site.") + " Nothing is removed here; check the car and remove it by hand if it really is cancelled.",
        acts: revActs(d.kind || "", r.ref, "", [], revId(d.kind || "", r.ref, "cancelled"), true) });
    });
    (P.invalid || []).forEach(function (i) { rows.push({ key: "i|" + (i.kind || "") + "|" + (i.ref || ""), board: String(i.kind || "").toUpperCase(), date: "", ref: i.ref || "No reference", reg: "", status: "invalid", lines: [i.reason || "Can't be read"], sub: [], explain: "Fix this record on the booking site, then check again." }); });
    return rows;
  }
  function biUnchangedRows(P) {
    return (P.unchanged || []).map(function (i) { return { key: "u|" + i.kind + "|" + i.ref, board: String(i.kind).toUpperCase(), date: biDay(i.day), ref: i.ref, reg: i.reg || "", status: "unchanged", lines: ["No changes"], sub: [], explain: "" }; });
  }
  function biRowHtml(r, open, hide) {
    var more = r.lines.slice(1).concat(r.sub || []);
    return '<div class="bi-row s-' + r.status + (r.selectable ? ' bi-selectable' : '') + (open ? " open" : "") + '" data-biq="' + esc(biQ(r.ref, r.reg)) + '"' + (hide ? " hidden" : "") + ">" +
      (r.selectable ? '<label class="bi-select"><input type="checkbox" data-biselect="' + esc(r.key) + '" aria-label="Select ' + esc(r.ref) + '"' + (S.bi.selected && S.bi.selected[r.key] ? ' checked' : '') + (S.autoImport.running || S.autoImport.checking ? ' disabled' : '') + '></label>' : '') +
      '<button type="button" class="bi-hd" data-birow="' + esc(r.key) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
      '<span class="bi-board">' + esc(r.board) + '</span><span class="bi-date">' + esc(r.date) + '</span><span class="bi-ref">' + esc(r.ref) + '</span><span class="bi-reg">' + esc(r.reg) + "</span>" +
      '<span class="bi-chg"><span class="bi-main">' + esc(r.lines[0] || "") + "</span>" + (more.length ? '<span class="bi-more">' + more.map(function (x) { return "<small>" + esc(x) + "</small>"; }).join("") + "</span>" : "") + "</span>" +
      '<span class="bi-st"><em class="bi-pill s-' + r.status + '">' + esc(BI_STATUS[r.status] || r.status) + '</em></span><span class="bi-chev" aria-hidden="true"></span></button>' +
      (r.attention ? '<p class="bi-attention">' + esc(r.attention) + '</p>' : "") + (r.location ? '<p class="bi-ex">' + esc(r.location) + '</p>' : "") +
      (r.explain ? '<p class="bi-ex bi-more">' + esc(r.explain) + "</p>" : "") + (r.acts ? '<div class="bi-ex bi-more bi-racts">' + r.acts + "</div>" : "") + "</div>";
  }
  function biConn(a) {
    if (a.running) return { cls: "busy", text: "Importing…" };
    if (a.checking) return { cls: "busy", text: "Checking…" };
    if (a.blocked_until) return { cls: "bad", text: "Paused", note: "Sign-in failed. Paused until " + hhmm(a.blocked_until) + ". Check the saved login." };
    if (a.error && !a.stale) return { cls: "bad", text: a.failed === "import" ? "Import failed" : "Check failed" };
    if (a.last_error && !a.checked_at) return { cls: "bad", text: "Last try failed", note: String(a.last_error).slice(0, 160) };
    if (a.checked_at || a.last_ok) return { cls: "ok", text: "Connected" };
    return { cls: "idle", text: "Not checked yet" };
  }
  function biReport(P) {
    if (!P.report) return "";
    return ["picks", "drops"].map(function (k) {
      var X = P.report[k]; if (!X) return "";
      return "<p>" + esc("On the booking site, " + k + ": " + X.rows + " · " + Object.keys(X.by_day).sort().map(function (d) { return d.slice(8) + "th " + X.by_day[d] + (X.site && X.site[d] != null ? " of " + X.site[d] : ""); }).join(" · ") + " · " + Object.keys(X.by_status).map(function (x) { return x + " " + X.by_status[x]; }).join(", ")) + "</p>" +
        (X.form ? "<p>" + esc("Search form: " + X.form) + "</p>" : "");
    }).join("") + (P.report.flights ? (function (F) {
      return "<p>" + esc("Return flights: " + F.matched + " of " + F.cars + " drops matched · Return Report " + F.rows + " · " + Object.keys(F.by_day || {}).sort().map(function (d) { return d.slice(8) + "th " + F.by_day[d]; }).join(" · ")) + "</p>" +
        (F.head && F.head.length ? "<p>" + esc("Return Report columns: " + F.head.join(" | ")) + "</p>" : "") +
        (F.sample && F.sample.length ? "<p>" + esc("Read as: " + F.sample.join(" · ")) + "</p>" : "");
    })(P.report.flights) : "");
  }
  function biChecked(P) {
    var seen = 0, ok = true;
    ["picks", "drops"].forEach(function (k) { var X = P.report && P.report[k]; if (!X) return; seen++; if (!X.site || !Object.keys(X.site).length) ok = false; });
    return seen && ok;
  }
  function biToday() { return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); }
  // The dates the check reads: today and the next two days unless the office picks its own (up to 14 days).
  function biRange(a) { return a.custom ? { from: a.from, to: a.to } : { from: biToday(), to: addDaysKey(biToday(), 2) }; }
  function biRangeHtml(a, busy) {
    var r = biRange(a), t = biToday(), dis = busy ? " disabled" : "";
    return '<div class="bi-range" data-birange><label>From <input type="date" id="biFrom" value="' + esc(r.from) + '" min="' + addDaysKey(t, -30) + '" max="' + addDaysKey(t, 60) + '"' + dis + "></label>" +
      '<label>To <input type="date" id="biTo" value="' + esc(r.to) + '" min="' + addDaysKey(t, -30) + '" max="' + addDaysKey(t, 60) + '"' + dis + "></label>" +
      '<span class="bi-presets">' + [[1,"Today"],[3,"Next 3 days"],[7,"Next 7 days"]].map(function(x){return '<button type="button" class="btn ghost small" data-bipreset="'+x[0]+'" aria-pressed="'+(r.from===t && r.to===addDaysKey(t,x[0]-1))+'"'+dis+'>'+x[1]+'</button>';}).join("") + '</span>' +
      (a.custom ? '<button type="button" class="link" data-birangereset' + dis + ">Today and next 2 days</button>" : '<span class="bi-hint">Today and the next 2 days. Up to 14 days at a time.</span>') + "</div>";
  }
  // Scheduled import: everyone who can import sees whether it is on and how the last run went; owners and managers set it.
  function biSchedHtml(a) {
    var sc = a.schedule || {}, on = !!sc.on, times = sc.times || [], last = sc.last, D = a.schedDraft, edit = S.me.role === "owner" || S.me.role === "manager";
    var lastTxt = !last ? "" : last.outcome === "imported" ? "Last run " + last.slot.slice(11) + ": imported."
      : last.outcome === "held" ? "Last run " + last.slot.slice(11) + ": not imported, " + last.why + "."
      : "Last run " + last.slot.slice(11) + ": didn't run, " + last.why;
    var clock = new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()), sortedTimes=times.slice().sort(), nextTime=sortedTimes.filter(function(t){return t>clock;})[0];
    if(on && sortedTimes.length) lastTxt = 'Next scheduled: ' + (nextTime?'today '+nextTime:'tomorrow '+sortedTimes[0]) + ' (London).' + (lastTxt?' '+lastTxt:'');
    var h = '<details class="bi-sched" data-bisched' + (D ? " open" : "") + '><summary><span>Scheduled import</span><span class="bi-chk' + (on ? "" : " off") + '">' + (on ? "On · " + esc(times.join(", ")) : "Off") + "</span></summary>";
    h += '<div class="bi-schedbody"><p class="bi-hint">At the saved times it checks the bookings and imports them only if nothing needs a decision.' + (sc.by && on ? " Imports are recorded as " + esc(sc.by) + "." : "") + "</p>";
    if (lastTxt) h += '<p class="bi-hint" data-bischedlast>' + esc(lastTxt) + "</p>";
    if (edit) {
      var d = D || { on: on, times: times.slice() };
      h += '<label class="bi-sw"><input type="checkbox" id="schedOn"' + (d.on ? " checked" : "") + '> Import automatically at these times</label><div class="bi-times">' +
        d.times.map(function (t, i) { return '<span class="bi-time"><input type="time" data-schedtime="' + i + '" value="' + esc(t) + '" aria-label="Time ' + (i + 1) + '"><button type="button" class="link" data-schedrm="' + i + '" aria-label="Remove ' + esc(t) + '">Remove</button></span>'; }).join("") +
        (d.times.length < 6 ? '<button type="button" class="btn ghost small" data-schedadd>Add a time</button>' : "") + "</div>" +
        '<div><button type="button" class="btn brand small" data-schedsave' + (D ? "" : " disabled") + ">Save schedule</button></div>";
    }
    return h + "</div></details>";
  }
  function biSchedChange(a, fn) { var sc = a.schedule || {}; a.schedDraft = a.schedDraft || { on: !!sc.on, times: (sc.times || []).slice() }; fn(a.schedDraft); render(); }
  async function biSchedSave(a) {
    var d = a.schedDraft; if (!d) return;
    var times = d.times.filter(Boolean);
    if (d.on && !times.length) return toast("Add at least one time.", true);
    var r = await sb.rpc("swift_schedule_set", { p_times: times, p_on: !!d.on });
    if (r.error) return toast(r.error.message, true);
    a.schedDraft = null; toast(d.on ? "Scheduled import on." : "Scheduled import off."); loadAutoImport();
  }
  function autoPanel(a) {
    var P = a.preview, busy = a.running || a.checking, c = (P && P.counts) || {}, B = S.bi;
    var conn = biConn(a), nImp = P && P.selection_supported ? autoSelected(P).length : (c["new"] || 0) + (c.changed || 0);
    var canGo = !busy && P && P.can_apply && !a.stale && (nImp > 0 || c.review > 0);
    var go = a.running ? "Importing…" : !P ? "Import bookings" : nImp ? "Import " + nImp + (nImp === 1 ? (P.selection_supported ? " selected" : " booking") : (P.selection_supported ? " selected" : " bookings")) : c.review ? "Save review list" : "Nothing to import";
    var h = '<div class="bi-panel" data-autobox>' +
      '<div class="bi-status"><span class="bi-conn ' + conn.cls + '"><i class="bi-dot"></i>' + esc(conn.text) + "</span>" +
      "<span>Last checked " + (a.checked_at ? esc(biStamp(a.checked_at)) : "–") + "</span><span>Last imported " + (a.last_ok ? esc(biStamp(a.last_ok)) : "–") + "</span>" +
      (conn.note ? '<span class="bi-note">' + esc(conn.note) + "</span>" : "") + "</div>" +
      '<div class="bi-act"><button type="button" class="btn ghost" data-autopreview' + (busy ? " disabled" : "") + ">" + (a.checking ? "Checking…" : "Check bookings") + "</button>" +
      '<button type="button" class="btn brand" data-autorun' + (canGo ? "" : " disabled") + ">" + esc(go) + "</button></div>" +
      biRangeHtml(a, busy) + biSchedHtml(a) + '<div class="bi-body">' + (P ? biSteps(1).replace(/Files/g,"Check") + biProtected() : "");
    if (a.result) h += autoResultHtml(a.result);
    if (a.error) h += '<div class="alert" role="alert">' + esc(a.error) + "</div>";
    // A failed import keeps the check so it can be tried again: the import reads the site afresh and stops if anything changed.
    if (a.error && P && a.failed === "import" && !a.stale) h += '<p class="bi-hint" data-autokept>Nothing was imported. The check below is from ' + esc(a.checked_at ? biStamp(a.checked_at) : "earlier") + '. Import reads the booking site again first and stops if anything changed.</p>';
    if (!P) {
      if (!a.error && !busy && !a.result) h += '<p class="bi-hint">Check bookings to see what would change. Nothing is saved until you import.</p>';
    } else {
      var rows = biRows(P), un = biUnchangedRows(P), f = B.f || "all";
      var list = f === "unchanged" ? un : f === "all" ? rows : rows.filter(function (r) { return r.status === f; });
      var q = String(B.q || "").toLowerCase().replace(/\s+/g, "");
      h += biCoverage(P);
      h += '<div class="bi-counts" data-autopreviewsum role="group" aria-label="Check result">' +
        [["new", "New"], ["changed", "Updated"], ["review", "Needs review"], ["unchanged", "Unchanged"]].map(function (x) { return '<div class="' + (x[0] === "review" && c.review ? "warn" : "") + '"><b class="num">' + (c[x[0]] || 0) + "</b><span>" + x[1] + "</span></div>"; }).join("") + "</div>";
      if (c.invalid) h += '<div class="alert" role="alert">' + c.invalid + (c.invalid === 1 ? " record can't" : " records can't") + " be read. Fix " + (c.invalid === 1 ? "it" : "them") + " on the booking site before importing.</div>";
      if (c.review) h += '<div class="bi-warn" role="status">' + c.review + (c.review === 1 ? " booking needs" : " bookings need") + " an office decision. These will stay out of this import.</div>";
      var tabs = [["all", "All changes", rows.length], ["new", "New", c["new"] || 0], ["changed", "Updated", c.changed || 0], ["review", "Needs review", c.review || 0]];
      if (c.unchanged) tabs.push(["unchanged", "Unchanged", c.unchanged]);
      h += '<div class="bi-filters" role="group" aria-label="Filter the check result">' + tabs.map(function (x) {
        return '<button type="button" class="bi-chip" data-bifilter="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + ' <span class="num">' + x[2] + "</span></button>";
      }).join("") + '<input type="search" id="biQ" class="bi-search" placeholder="Reference or reg" aria-label="Search by reference or registration" autocomplete="off" value="' + esc(B.q || "") + '"></div>';
      if (P.selection_supported) h += '<label class="mi-selectall"><input type="checkbox" data-biselectall' + (autoSelected(P).length === (c.new || 0) + (c.changed || 0) && nImp ? " checked" : "") + (busy ? " disabled" : "") + '> Select all ready changes</label><p class="bi-hint">' + nImp + " selected · " + (c.review || 0) + " held for review</p>";
      if (!list.length) {
        h += '<p class="bi-hint" data-autoitems>' + (f === "unchanged" ? (c.unchanged ? "This check didn't list the " + c.unchanged + " unchanged bookings. They already match the app." : "No unchanged bookings.")
          : f === "all" && !rows.length ? "No booking changes. Everything on the booking site already matches the app." : "Nothing in this view.") + "</p>";
      } else {
        h += '<div class="bi-tbl" data-autoitems><div class="bi-th" aria-hidden="true"><span>Board</span><span>Date</span><span>Reference</span><span>Registration</span><span>Change</span><span>Status</span><span></span></div>' +
          list.map(function (r) { return biRowHtml(r, !!B.open[r.key], q && biQ(r.ref, r.reg).indexOf(q) < 0); }).join("") + "</div>";
        h += '<p class="bi-hint" id="biShown">' + ("") + "</p>";
      }
      h += '<details class="bi-diag"><summary><span>Import details & checks</span>' + (biChecked(P) ? '<span class="bi-chk">Report checks passed</span>' : '<span class="bi-chk off">Report counts not verified</span>') + '</summary><div class="bi-diagbody" data-autoreport>' + biReport(P) + "</div></details>";
    }
    if (a.reviews && a.reviews.length) {
      h += '<div class="bi-held"><h3>Held for the office</h3><div data-autoreviews>' + a.reviews.map(function (r) {
        var d = r.detail || {}, b = S.revCars[(d.kind || "") + "|" + r.ref], reg = (b && b.reg) || d.reg || "";
        var why = r.kind === "cancelled" ? ((d.name || "") + " · " + (d.kind || "")) : String(d.why || "").replace(/\b\d{4}-\d\d-\d\d\b/g, biDay).replace(/^./, function (x) { return x.toUpperCase(); });
        var chg = r.kind === "cancelled" ? [] : (d.changes || []).map(biChange);
        return '<div class="bi-hr"><span>' + esc((r.kind === "cancelled" ? (d.missing ? "Not on the site · " : "Cancelled · ") : "Changed · ") + r.ref) + (reg ? ' · <b class="bi-hreg">' + esc(reg) + "</b>" : "") + "<small>" + esc(why) + "</small>" +
          (chg.length ? "<small>" + esc(chg.join(" · ")) + "</small>" : "") + '</span><span class="bi-acts">' + revActs(d.kind || "", r.ref, r.kind === "cancelled" ? "" : d.why, d.changes, r.id, r.kind === "cancelled") +
          '<button type="button" class="btn ghost small" data-reviewdone="' + esc(r.id) + '">Done</button></span></div>';
      }).join("") + "</div></div>";
    } else if (a.open_reviews) h += '<p class="bi-hint">' + a.open_reviews + " to check.</p>";
    return h + '<p class="bi-hint">It only reads from the booking site. Cancelled or changed bookings are listed for you; nothing is removed.</p></div></div>';
  }
  // The recent imports of the last 24 hours, newest first, for both tabs. Undo only where the backend says it can still be undone.
  function recentImportsHtml() {
    if (!S.recentImports) loadRecentImports();
    var groups = importGroups(S.recentImports || []);
    return '<section class="bi-recent" aria-labelledby="biRecent"><div class="bi-rh"><h3 id="biRecent">Recent imports</h3><button type="button" class="link" data-bitab="history">View history</button></div>' +
      (groups.length ? groups.slice(0,3).map(importGroupHtml).join('') : '<p class="bi-hint">No imports in the last 24 hours.</p>') + '</section>';
  }
  function autoInfo() {
    if (S.autoImport === undefined) { S.autoImport = null; loadAutoImport(); }
    var a = S.autoImport;
    return a && a.available && can("import") ? a : null;
  }
  async function loadAutoImport() {
    var r = await sb.rpc("auto_import_status");
    var d = r && !r.error ? (r.data || {}) : {};
    var keep = S.autoImport || {};
    S.autoImport = { available: !!d.available, blocked_until: d.blocked_until, last_ok: d.last_ok, last_error: d.last_error, open_reviews: d.open_reviews || 0, preview: keep.preview, error: keep.error, failed: keep.failed, stale: keep.stale, checked_at: keep.checked_at, reviews: keep.reviews, custom: keep.custom, from: keep.from, to: keep.to, schedule: d.schedule, schedDraft: keep.schedDraft, result: keep.result, running: !!d.running || !!keep.running, checking: keep.checking };
    if (d.available && d.open_reviews) {
      var rv = await sb.rpc("swift_reviews_open");
      S.autoImport.reviews = rv && !rv.error ? rv.data : null;
    } else S.autoImport.reviews = null;
    if (S.view === "import") render();
  }
  async function previewAutoImport() {
    var a = S.autoImport; if (!a || a.checking || a.running) return;
    a.checking = true; a.error = ""; a.failed = ""; a.preview = null; a.result = null; render();
    var r;
    r = await callBookings(Object.assign({ action: "preview" }, a.custom ? biRange(a) : {}));
    a.checking = false;
    var out = r && r.data;
    a.failed = "check";
    if ((r && r.error) || !out) a.error = "Couldn't reach the booking import. Try again in a minute.";
    else if (out.ok === false) a.error = out.error || "The booking site didn't answer.";
    else if (out.error) a.error = out.error;
    else { a.failed = ""; a.preview = out.preview; a.checked_at = Date.now(); a.stale = false; S.bi.open = {}; S.bi.selected = {}; (out.preview.items || []).forEach(function(i){if(i.status === "new" || i.status === "changed") S.bi.selected[i.kind + "|" + i.ref] = true;}); }
    render(); loadAutoImport();
  }
  async function runAutoImport(btn) {
    var a = S.autoImport; if (!a || !a.preview || !a.preview.can_apply) return;
    if (a.preview.selection_supported && !autoSelected(a.preview).length && !a.preview.counts.review) return;
    a.running = true; a.error = ""; a.failed = ""; render();
    toast("Getting bookings… this can take a moment.");
    var r;
    r = await callBookings(Object.assign(Object.assign({ action: "apply", expect_hash: a.preview.hash }, a.preview.selection_supported ? { selected: autoSelected(a.preview) } : {}), a.custom ? biRange(a) : {}));
    a.running = false;
    var out = r && r.data;
    if ((r && r.error) || !out || out.ok === false) {
      a.error = (out && out.error) || "The import response was lost. Check bookings again to confirm the result before retrying.";
      a.stale = out && /changed since the preview/.test(a.error); a.failed = "import";
      toast(a.error, true); render(); return loadAutoImport();
    }
    var days = (out.summary && out.summary.days) || [];
    var added = days.reduce(function (n, d) { return n + (d.added || 0); }, 0);
    var updated = days.reduce(function (n, d) { return n + (d.updated || 0); }, 0);
    a.result = out.summary; a.preview = null; a.stale = false;
    await loadSheets(); await loadRows();
    toast("✓ Bookings in: " + added + " added, " + updated + " updated across " + days.length + " sheet(s).");
    S.recentImports = null; loadAutoImport();
  }
  // Held bookings (19 Oct): the car each one is about, so the reg shows beside the
  // reference and the office can open it, or move it to the booking site's night
  // with the app's own EARLY RETURN (an earlier night) or return change (a later one).
  S.revCars = {};
  function loadRevCars(list) {
    var want = list.filter(function (x) { return x.ref && S.revCars[x.kind + "|" + x.ref] === undefined; });
    if (!want.length) return;
    want.forEach(function (x) { S.revCars[x.kind + "|" + x.ref] = null; });
    var refs = want.map(function (x) { return x.ref; }).filter(function (x, i, l) { return l.indexOf(x) === i; });
    sb.from("bookings").select("id, sheet_id, kind, ref, reg, name, cleared_at, removed_at, early, return_at, sheets!bookings_sheet_id_fkey(day, kind)").in("ref", refs).then(function (r) {
      if (r.error) { want.forEach(function (x) { delete S.revCars[x.kind + "|" + x.ref]; }); return; }
      want.forEach(function (x) { S.revCars[x.kind + "|" + x.ref] = false; });
      // One car per booking: one still on a board before a removed one, then the latest night.
      (r.data || []).forEach(function (b) {
        var k = b.kind + "|" + b.ref, cur = S.revCars[k], day = (b.sheets || {}).day || "";
        if (!cur || (cur.removed_at && !b.removed_at) || (!cur.removed_at === !b.removed_at && day > ((cur.sheets || {}).day || ""))) S.revCars[k] = b;
      });
      if (S.view === "import") render();
    }, function () { want.forEach(function (x) { delete S.revCars[x.kind + "|" + x.ref]; }); });
  }
  // The open held review for this booking, if there is one (its Done button).
  function revId(kind, ref, type) {
    var a = S.autoImport, m = ((a && a.reviews) || []).filter(function (r) { return r.ref === ref && (r.detail || {}).kind === kind && (!type || r.kind === type); })[0];
    return m ? m.id : "";
  }
  // The move the app can make safely: a car not gone; DROPS not already early;
  // PICKS to the booking site's new drop-off, by the office (part 102).
  function revMove(kind, why, changes, b) {
    var m = /moved from sheet (\d{4}-\d\d-\d\d) to (\d{4}-\d\d-\d\d)/.exec(why || "");
    if (m && kind === "picks" && b && !b.removed_at && can("import") && (b.sheets || {}).day !== m[2]) {
      var dr = (changes || []).filter(function (c) { return c.field === "drop"; })[0];
      return dr && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(dr.to || "") && dr.to.slice(0, 10) === m[2] ? { day: m[2], drop: dr.to } : null;
    }
    if (!m || kind !== "drops" || !b || b.cleared_at || b.removed_at || b.early) return null;
    var to = m[2], here = (b.sheets || {}).day || m[1];
    if (to < here) return to >= currentShiftKey() && can("called") ? { day: to } : null;
    var ret = (changes || []).filter(function (c) { return c.field === "return"; })[0];
    if (to > here && can("import") && ret && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(ret.to || "")) return { day: to, ret: ret.to };
    return null;
  }
  S.revCtx = {};
  var revWant = [], revTimer = null;
  // A cancelled review whose car is still on a board gets Remove (24 Oct: a review marked Done left LLHGPC on PICKS).
  function revActs(kind, ref, why, changes, rid, cancelled) {
    var k = kind + "|" + ref, b = S.revCars[k];
    if (b === undefined) { revWant.push({ kind: kind, ref: ref }); clearTimeout(revTimer); revTimer = setTimeout(function () { var w = revWant; revWant = []; loadRevCars(w); }, 0); }
    if (!b) return "";
    var mv = revMove(kind, why, changes, b);
    S.revCtx[k] = { mv: mv, rid: rid };
    return (cancelled && !b.removed_at && can("import") ? '<button type="button" class="btn small" data-rvremove="' + esc(k) + '">Remove as cancelled</button>' : "") + (mv ? '<button type="button" class="btn small" data-rvmove="' + esc(k) + '">Move to ' + esc(sheetLabel({ kind: kind, day: mv.day }).replace(/^(DROPS|PICKS) /, "")) + "</button>" : "") +
      '<button type="button" class="btn ghost small" data-rvopen="' + esc(k) + '">' + (b.removed_at ? "Removed cars" : "Open") + "</button>";
  }
  async function revOpen(k) {
    var b = S.revCars[k]; if (!b) return;
    await openArchived(b.sheet_id, b.removed_at ? "" : b.reg);
    if (S.sheetId !== b.sheet_id) return;
    if (b.removed_at) return openRemoved();
    var row = S.rows.filter(function (x) { return x.id === b.id; })[0];
    if (row) openPanel(row);
  }
  async function revMoveGo(k, btn) {
    var b = S.revCars[k], c = S.revCtx[k], mv = c && c.mv; if (!b || !mv) return;
    var to = sheetLabel({ kind: b.kind, day: mv.day });
    if (!confirm("Move " + (b.reg || "this car") + " to " + to + (mv.drop ? ", drop-off " + biWhen(mv.drop) + "?" : mv.ret ? ", back " + biWhen(mv.ret) + "?" : " as an early return?"))) return;
    btn.disabled = true;
    var x = mv.drop ? await sb.rpc("move_pick", { p_booking: b.id, p_drop_local: mv.drop }) : mv.ret ? await sb.rpc("set_return", { p_booking: b.id, p_return_local: mv.ret }) : await sb.rpc("early_return", { p_booking: b.id, p_day: mv.day });
    btn.disabled = false;
    if (x.error) return toast(x.error.message, true);
    if (c.rid) await sb.rpc("swift_review_resolve", { p_id: Number(c.rid) });
    delete S.revCars[k];
    toast((b.reg || "Car") + (x.data && x.data.sheet_id !== b.sheet_id ? " moved to " + to + "." : " stays on its night as staying longer until " + to + " is imported."));
    await loadSheets(); loadAutoImport();
  }
  async function revRemoveGo(k, btn) {
    var b = S.revCars[k], c = S.revCtx[k] || {}; if (!b || b.removed_at) return;
    var on = sheetLabel({ kind: b.kind, day: (b.sheets || {}).day });
    if (!confirm("Remove " + (b.reg || "this car") + " (" + b.ref + ") from " + on + " as cancelled?")) return;
    btn.disabled = true;
    var x = await sb.rpc("remove_booking", { p_booking: b.id, p_reason: "Cancelled" });
    btn.disabled = false;
    if (x.error) return toast(x.error.message, true);
    if (c.rid) await sb.rpc("swift_review_resolve", { p_id: Number(c.rid) });
    S.rows = S.rows.filter(function (y) { return y.id !== b.id; });
    dropRemoved(b.id); if (b.sheet_id === S.sheetId) S.removed.push(x.data);
    delete S.revCars[k];
    toast((b.reg || "Car") + " removed from " + on + " as cancelled");
    loadAutoImport();
  }
  async function reviewDone(id) {
    var rv = ((S.autoImport && S.autoImport.reviews) || []).filter(function (x) { return String(x.id) === String(id); })[0], d = (rv && rv.detail) || {};
    var b = rv && rv.kind === "cancelled" ? S.revCars[(d.kind || "") + "|" + rv.ref] : null;
    if (b && !b.removed_at && !confirm((b.reg || "This car") + " is still on " + sheetLabel({ kind: b.kind, day: (b.sheets || {}).day }) + ". Done closes this without removing it. Close it?")) return;
    var r = await sb.rpc("swift_review_resolve", { p_id: Number(id) });
    if (r.error) return toast(r.error.message, true);
    loadAutoImport();
  }
  function renderImport() {
    var I = S.imp || (S.imp = newImport("drops")), B = S.bi || (S.bi = { tab: "", f: "all", q: "", open: {} });
    var auto = autoInfo(), tab = B.tab === 'history' ? 'history' : auto ? (B.tab || 'auto') : 'manual';
    var h = '<div class="bi">';
    h += '<div class="bi-tabs" role="tablist" aria-label="Booking source">' +
      (auto ? '<button type="button" role="tab" data-bitab="auto" aria-selected="' + (tab === 'auto') + '">Auto import</button>' : '') +
      '<button type="button" role="tab" data-bitab="manual" aria-selected="' + (tab === 'manual') + '">Manual import</button><button type="button" role="tab" data-bitab="history" aria-selected="' + (tab === 'history') + '">History</button></div>';
    if (tab === "history") return h + importHistoryHtml() + "</div>";
    if (tab === "auto") return h + autoPanel(auto) + recentImportsHtml() + "</div>";
    return h + manualPanel(I) + "</div>";
  }

  function openGone(gone, undoId) {
    panelRow = null;
    var top = '<div class="pbtns top"><button type="button" data-close>Keep them all</button>' + (undoId ? '<button type="button" class="undo" data-undoimport="' + esc(undoId) + '">Undo this import</button>' : "") + "</div>";
    $("panelBody").innerHTML = '<button type="button" class="pclose" data-close aria-label="Close">✕</button><h2 id="panelTitle">' + gone.length + (gone.length === 1 ? " car isn't" : " cars aren't") + " in this file any more</h2>" +
      '<p class="sub">They were in an earlier import but this file no longer lists them: cancelled, or the date was changed to another day. Only remove cars you know are cancelled.' +
        (gone[0] && gone[0].kind === "drops" ? " A car whose return moved to another day goes there, with its yard and notes, when that day is imported; removing it here loses them." : "") + '</p>' +
      (undoId ? '<p class="sub"><b>Wrong file?</b> Undo this import puts the sheet back as it was before.</p>' : "") + top +
      '<div class="rmlist">' + gone.map(function (r) {
        return '<div><span><b>' + esc(r.reg || "NO REG") + "</b>" + (r.num ? " #" + r.num : "") + " " + esc(r.name) + "<small>Ref " + esc(r.ref) + (r.drop_at ? " · drop " + esc(dayShort(r.drop_at) + " " + hhmm(r.drop_at)) : "") + (r.return_at ? " · back " + esc(dayShort(r.return_at) + " " + hhmm(r.return_at)) : "") +
          '</small></span><button type="button" data-gone="' + r.id + '">Remove as cancelled</button></div>';
      }).join("") + "</div>" +
      '<div class="pbtns"><button type="button" data-close>Keep them</button>' + (gone.length > 1 ? '<button type="button" class="save" data-goneall>Remove all ' + gone.length + " as cancelled</button>" : "") + "</div>";
    if (!$("panel").open) $("panel").showModal();
  }
  // Undo an import (database part 44): cars it added go, what it changed comes back.
  async function undoImport(id, btn) {
    var it = (S.recentImports || []).filter(function (x) { return String(x.id) === String(id); })[0];
    var preview = await sb.rpc("reviewed_import_undo_preview", {p_id:+id});
    if (preview.error) return toast(preview.error.message,true);
    var detail = preview.data || {}, details = (detail.changed || []).map(function(x){return (x.ref || x.reg) + ': ' + (x.changes || []).map(biChange).join('; ');}).concat((detail.added || []).map(function(x){return 'Added booking: ' + (x.ref || '') + ' ' + (x.reg || '');}));
    if (!confirm("Undo this import?" + (it ? "\n\n" + it.kind.toUpperCase() + " " + it.day + ", imported " + hhmm(it.at) + " by " + it.by + ": " + it.added + " cars added, " + it.changed + " changed." : "") +
      "\n\n" + details.slice(0,20).join("\n") + (details.length>20?"\n… and more":"") + "\n\nThe cars it added are taken off, and what it changed goes back to how it was. Taps made since are kept.")) return;
    btn.disabled = true;
    var r = await sb.rpc("undo_import", { p_id: +id });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    toast("Import undone: " + r.data.removed + " cars taken off, " + r.data.restored + " put back" + (r.data.kept ? ", " + r.data.kept + " kept (already worked on)" : "") + ".");
    S.recentImports = null;
    if ($("panel").open) $("panel").close();
    await loadSheets();
    if (r.data.sheet_gone && S.sheetId === r.data.sheet_id) S.sheetId = null;
    if (!S.sheetId) pickDefaultSheet();
    await loadRows(); render();
  }
  async function loadRecentImports() {
    S.recentImports = [];
    var r = await sb.rpc("recent_imports");
    S.recentImports = r.error ? [] : (r.data || []);
    if (S.view === "import") render();
  }
  async function removeGone(ids, btn) {
    btn.disabled = true;
    for (var i = 0; i < ids.length; i++) {
      var x = await sb.rpc("remove_booking", { p_booking: ids[i], p_reason: "Cancelled" });
      if (x.error) { btn.disabled = false; return toast(x.error.message, true); }
      S.rows = S.rows.filter(function (y) { return y.id !== ids[i]; });
      dropRemoved(ids[i]); S.removed.push(x.data);
    }
    toast(ids.length + (ids.length === 1 ? " car" : " cars") + " removed as cancelled");
    var left = Array.prototype.map.call($("panelBody").querySelectorAll("[data-gone]"), function (b) { return b.dataset.gone; }).filter(function (id) { return ids.indexOf(id) === -1; });
    if (!left.length) return $("panel").close();
    var u = $("panelBody").querySelector("[data-undoimport]");
    openGone(S.rows.filter(function (y) { return left.indexOf(y.id) !== -1; }), u ? u.dataset.undoimport : null);
  }

  // Reviewed manual imports: parsing stays on the device. Checking sends only
  // booking columns to a read-only RPC, and applying rechecks its snapshot.
  function local(dt) { return dt ? dt.key + ' ' + (dt.time || '') : ''; }
  function biProtected() { return '<p class="bi-protected">Operational details protected <small>Keys, lane positions, drivers, payments and staff notes are kept.</small></p>'; }
  function biSteps(stage) { return '<ol class="bi-progress" aria-label="Import progress">' + ['Files','Review','Import'].map(function(x,i){ return '<li' + (i===stage ? ' aria-current="step"' : '') + '><span>' + (i+1) + '</span>' + x + '</li>'; }).join('') + '</ol>'; }
  function manualFiles(I) { return I.bookingFiles || (I.excelFile ? [I.excelFile] : []); }
  function manualFileHtml(I) {
    var checked = I.stage === 'preview' || I.stage === 'done', listCount=(I.fileInfo || manualFiles(I)).length;
    var h = checked ? '<details class="mi-files"' + (window.innerWidth>=720?' open':'') + '><summary>Files checked · '+listCount+'</summary>' : '<section class="mi-files" aria-label="Import files">';
    h += '<div class="bi-rh">' + (checked?'':'<h3>Choose files</h3>') + '<label class="mi-add">' + (checked ? 'Replace files' : 'Add files') + '<input type="file" data-file="excel" multiple accept=".xls,.xlsx,.csv,.txt,.pdf"' + (I.saving || I.checking || I.stage==='reading' ? ' disabled' : '') + '></label></div>';
    var files = I.fileInfo || manualFiles(I).map(function(f){ return {name:f.name, detail:'Ready to check', type:/\.pdf$/i.test(f.name) ? 'PDF' : 'Spreadsheet'}; });
    if (!files.length) h += '<p class="bi-hint">Choose booking spreadsheets or Joblist PDFs. You can add several files together.</p>';
    files.forEach(function(f){ h += '<div class="mi-file"><span><b>' + esc(f.name) + '</b><small>' + esc((f.type || '') + ' · ' + (f.detail || '')) + '</small></span><span class="bi-pill' + (f.ok ? ' s-new' : '') + '">' + (f.ok ? 'Checked' : 'Selected') + '</span></div>'; });
    if (I.pdfFile && !files.some(function(f){ return f.name===I.pdfFile.name; })) h += '<div class="mi-file"><span><b>' + esc(I.pdfFile.name) + '</b><small>Return flight report</small></span></div>';
    if (I.kind === 'drops' && !checked && !manualFiles(I).every(function(f){return /\.pdf$/i.test(f.name);})) h += '<label class="mi-add mi-flight">' + (I.pdfFile ? 'Replace flight report' : 'Add flight report (optional)') + '<input type="file" data-file="pdf" accept=".pdf"></label><p class="bi-hint">Skip this if your booking files already contain flight numbers.</p>';
    return h + (I.flightCheck?'<p class="bi-hint">'+esc(I.flightCheck)+'</p>':'') + (checked?'</details>':'</section>');
  }
  function manualPanel(I) {
    var busy = I.saving || I.stage === 'reading', h = biSteps(I.stage==='done'?2:I.stage==='preview'?1:0);
    if (I.stage === 'done') return h + manualResultHtml(I);
    if (I.stage !== 'preview') h += '<div class="toolbar"><div class="seg" role="group" aria-label="Sheet type">' + ['drops','picks'].map(function(k){return '<button type="button" data-impkind="' + k + '" aria-pressed="' + (I.kind===k) + '"' + (busy?' disabled':'') + '>' + (k==='drops'?'Drops':'Picks') + '</button>';}).join('') + '</div></div>';
    h += manualFileHtml(I);
    if (I.error) h += '<div class="alert" role="alert">' + esc(I.error) + '</div>';
    if (I.stage !== 'preview') return h + '<div class="row-actions"><button type="button" class="btn brand" data-read' + (!manualFiles(I).length || busy ? ' disabled' : '') + '>' + (busy ? 'Checking files…' : 'Check files') + '</button></div>' + recentImportsHtml();
    var P=I.plan, counts=P && P.counts || {}, selected=manualSelected(I), f=I.filter || 'all';
    h += '<div class="inline-selects"><label for="impDate">Review sheet</label><select id="impDate" data-impdate><option value="all"' + (I.reviewDay==='all'?' selected':'') + '>All dates (' + I.real.dates.length + ')</option>' + I.real.dates.map(function(k){return '<option value="' + k + '"' + (I.reviewDay===k?' selected':'') + '>' + esc(R.boardName(k,I.kind)) + ' · ' + I.real.counts[k] + '</option>';}).join('') + '</select>' + (I.kind==='drops'?'<label for="impCut">Day ends at</label><select id="impCut" data-impcut>' + ['04:00','05:00','06:00','07:00'].map(function(t){return '<option' + (t===I.cutoff?' selected':'') + '>' + t + '</option>';}).join('') + '</select>':'') + '</div>';
    h += '<p class="bi-hint">' + esc(I.real.dates.map(function(k){ return biDay(k) + ': ' + I.real.counts[k] + ' ' + I.kind; }).join(' · ')) + '</p>' + biProtected();
    if (I.issues && I.issues.length) h += '<details class="mi-issues" open><summary>' + I.issues.length + ' file issue(s) held for review</summary>' + I.issues.map(function(x){return '<p>' + esc(x) + '</p>';}).join('') + '</details>';
    if (I.checking) return h + '<p role="status">Comparing with existing bookings…</p>';
    if (!P) return h + '<button type="button" class="btn brand" data-manualcheck>Check against board</button>';
    h += '<h3>Review import</h3><div class="bi-counts">' + [['new','New'],['changed','Updated'],['review','Needs review'],['unchanged','Unchanged']].map(function(x){return '<div><b class="num">' + (counts[x[0]] || 0) + '</b><span>' + x[1] + '</span></div>';}).join('') + '</div>';
    if(counts.invalid) h += '<p class="bi-warn">' + counts.invalid + ' invalid booking(s) held back. Correct the file and check it again.</p>';
    h += '<div class="bi-filters">' + [['all','Changes'],['review','Needs review'],['unchanged','Unchanged']].map(function(x){return '<button type="button" class="bi-chip" data-manualfilter="' + x[0] + '" aria-pressed="' + (x[0]===f) + '">' + x[1] + '</button>';}).join('') + '<input type="search" id="miQ" class="bi-search" placeholder="Reference or registration" aria-label="Search manual import" value="' + esc(I.q || '') + '"></div>';
    var items=P.items.filter(function(i){return (I.reviewDay==='all' || i.day===I.reviewDay) && (f==='all' ? i.status!=='unchanged' : f==='review' ? i.status==='review'||i.status==='invalid':i.status==='unchanged');});
    h += '<label class="mi-selectall"><input type="checkbox" data-manualall' + (selected.length && selected.length===P.items.filter(manualReady).length?' checked':'') + (busy?' disabled':'') + '> Select all ready changes across all dates</label><div class="mi-rows">';
    items.forEach(function(i){
      var ready=manualReady(i), q=biQ(i.ref,i.reg), hidden=I.q && q.indexOf(I.q.toLowerCase().replace(/\s+/g,''))<0;
      h += '<article class="mi-row s-' + i.status + '" data-miq="' + esc(q) + '"' + (hidden?' hidden':'') + '><label class="mi-select"><input type="checkbox" data-manualselect="' + esc(i.key) + '" aria-label="Select ' + esc(i.ref || 'unreadable booking') + '"' + (ready && I.selected[i.key]?' checked':'') + (!ready||busy?' disabled':'') + '></label><div class="mi-detail"><div><b>' + esc(i.ref || 'No reference') + ' · ' + esc(i.reg || 'No registration') + '</b><em class="bi-pill s-' + i.status + '">' + esc(BI_STATUS[i.status]) + '</em></div><small>' + esc(i.kind.toUpperCase() + ' · ' + biDay(i.day) + (i.source?' · '+i.source:'')) + '</small>';
      h += '<p>' + esc(i.reason || (i.status==='new'?'New booking':i.status==='unchanged'?'No changes':(i.changes||[]).map(biChange).join(' · '))) + '</p>';
      if (i.status==='review' && i.changes && i.changes.length) h += '<p>' + esc(i.changes.map(biChange).join(' · ')) + '</p>';
      if(i.attention) h += '<p class="bi-attention">' + esc(i.attention) + '</p>';
      if(i.lane || i.yard || i.number) h += '<small>' + esc([i.lane?'Lane '+i.lane+(i.position?' · Position '+i.position:''):i.yard?'Yard '+i.yard:'',i.number?'Board #'+i.number:''].filter(Boolean).join(' · ')) + '</small>';
      if(i.booking_id) h += '<div class="bi-racts"><button type="button" class="link" data-manualopen="' + esc(i.key) + '">Open booking</button>' + (i.can_resolve?'<button type="button" class="link" data-manualincoming="'+esc(i.key)+'">Use incoming values</button>':'') + (i.status==='review'?'<button type="button" class="link" data-manualkeep="' + esc(i.key) + '">Keep current</button>':'') + '</div>';
      h += '</div></article>';
    });
    h += (items.length?'':'<p class="bi-hint">No bookings in this view.</p>') + '</div><details class="bi-diag"><summary>View extracted bookings</summary><div class="table-wrap"><table><thead><tr><th>File / row</th><th>Ref</th><th>Reg</th><th>Customer</th><th>Car</th><th>Drop-off</th><th>Back</th><th>Flight</th></tr></thead><tbody>' + I.preview.rows.map(function(r,i){return '<tr><td>' + esc(r._source || '') + '</td><td>' + esc(r.ref) + '</td><td>' + esc(r.reg) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.make) + '</td><td>' + esc(local(r.meet)) + '</td><td>' + esc(local(r.ret)) + '</td><td>' + (I.kind==='drops'?'<input data-fix="' + i + '" value="' + esc(r.flight || '') + '" placeholder="Flight" aria-label="Flight for ' + esc(r.reg) + '">':esc(r.flight || '')) + '</td></tr>';}).join('') + '</tbody></table></div></details>';
    h += '<div class="mi-action" role="group" aria-label="Import actions"><span>' + selected.length + ' selected · ' + ((counts.review||0)+(counts.invalid||0)+(I.issues||[]).length) + ' held for review</span><div><button type="button" class="btn ghost" data-manualcheck' + (busy?' disabled':'') + '>Check again</button><button type="button" class="btn brand" data-create' + (!selected.length||busy?' disabled':'') + '>' + (I.saving?'Importing…':I.failed?'Retry '+selected.length+' selected':'Import '+selected.length+' selected') + '</button></div></div><button type="button" class="link" data-restart' + (busy?' disabled':'') + '>Start again</button>';
    return h;
  }
  function manualReady(i) { return i.status==='new'||i.status==='changed'; }
  function manualSelected(I) { return I.plan ? I.plan.items.filter(function(i){return manualReady(i)&&I.selected[i.key];}).map(function(i){return i.key;}) : []; }
  async function readImport() {
    var I=S.imp; if(!I || I.stage==='reading'||I.saving) return;
    I.stage='reading'; I.error=''; I.plan=null; I.fileInfo=[]; I.issues=[]; I.real={all:[]}; render();
    try {
      var reports=[], files=manualFiles(I), bookingCount=0;
      if(!files.length) throw new Error('Choose a booking file first.');
      if(files.length>20 || files.reduce(function(n,f){return n+f.size;},0)>40*1024*1024)throw new Error('Check up to 20 files totalling 40 MB at a time.');
      for(var i=0;i<files.length;i++) {
        var file=files[i], got, type=/\.pdf$/i.test(file.name)?'Joblist PDF':'Spreadsheet';
        if(file.size>10*1024*1024) throw new Error(file.name+': choose a file smaller than 10 MB.');
        if(/\.pdf$/i.test(file.name)) {
          try {got=await R.readJoblistPdf(file);} catch(err) {
            try {reports.push(await R.readPdf(file)); I.fileInfo.push({name:file.name,type:'Flight report',detail:'Will match by booking reference',ok:true}); continue;}
            catch(reportError){throw new Error(file.name+': '+err.message);}
          }
        } else got=await R.readExcel(file);
        if(got.kind && got.kind!==I.kind) throw new Error(file.name+': this is a '+got.kind.toUpperCase()+' report. Switch the selected board type and check again.');
        if(!got.rows.length) throw new Error(file.name+': no bookings could be read.');
        bookingCount++;
        got.rows.forEach(function(r,idx){r._source=file.name+' · '+(r.source_page?'Page '+r.source_page:'Row '+(r.source_row || idx+1)); I.real.all.push(r);});
        var dates={}; got.rows.forEach(function(r){var d=r[I.kind==='drops'?'ret':'meet'];if(d) dates[d.key]=1;});
        I.fileInfo.push({name:file.name,type:type,detail:I.kind.toUpperCase()+' · '+Object.keys(dates).sort().map(biDay).join(', ')+' · '+got.rows.length+' bookings',ok:true});
      }
      if(!bookingCount) throw new Error('Only flight reports were found. Add a booking spreadsheet or Joblist PDF.');
      if(I.pdfFile) reports.push(await R.readPdf(I.pdfFile));
      var flights=[].concat.apply([],reports);
      if(flights.length) {
        var refs={}; I.real.all.forEach(function(r){if(r.ref) refs[r.ref]=true;});
        var matched=flights.filter(function(r){return r.ref && refs[r.ref];}).length;
        if(!matched) throw new Error('The flight report has no booking references matching these files. Choose the report for the same dates.');
        var flightMap={}; flights.forEach(function(r){if(!r.ref||!r.flight) return; if(flightMap[r.ref] && flightMap[r.ref]!==r.flight) throw new Error('The flight reports disagree for '+r.ref+'. Choose the correct report.'); flightMap[r.ref]=r.flight;});
        var byRef={};I.real.all.forEach(function(r){byRef[r.ref]=r;});flights.forEach(function(r){if(r.report_date && byRef[r.ref] && byRef[r.ref].ret && r.report_date!==byRef[r.ref].ret.key)throw new Error('Flight report date does not match booking '+r.ref+'. Choose the report for the same return dates.');});
        I.flightCheck=flights.some(function(r){return r.report_date;})?'Flight references and available report dates checked.':'Flights matched by reference. This report has no readable dates to verify.';
        R.matchFlights(I.real.all,flights,'flightIn');
        if(matched< Object.keys(refs).length) I.issues.push('Flight report matched '+matched+' report rows. Unmatched bookings keep their existing flight; check missing flight numbers.');
      }
      var field=I.kind==='drops'?'ret':'meet', times={};
      I.real.all.forEach(function(r){if(r[field]) times[r[field].time||'none']=1;else I.issues.push(r._source+': missing or unreadable '+(I.kind==='drops'?'return':'drop-off')+' date; this booking is held back.');});
      if(I.real.all.length>=5&&Object.keys(times).length===1) throw new Error('Every car in this file has the same '+(I.kind==='drops'?'return':'drop-off')+' time ('+Object.keys(times)[0]+'), so the times could not be verified. Nothing was imported.');
      groupImport(); if(!I.real.dates.length) throw new Error('No usable booking dates were found. Nothing was imported.');
      I.reviewDay='all'; buildPreview('all'); await checkManualImport();
    }catch(err){I.stage='pick';I.error=err.message||String(err);I.fileInfo=null;render();}
  }
  function groupImport(){ var I=S.imp, counts={}; I.real.all.forEach(function(r){var k=shiftKey(r[I.kind==='drops'?'ret':'meet'],I.cutoff);if(k) counts[k]=(counts[k]||0)+1;});I.real.counts=counts;I.real.dates=Object.keys(counts).sort(); }
  function buildPreview(day) {
    var I=S.imp; I.reviewDay=day||'all';
    I.preview={dateKey:I.reviewDay,rows:I.real.all.filter(function(r){return I.reviewDay==='all'||shiftKey(r[I.kind==='drops'?'ret':'meet'],I.cutoff)===I.reviewDay;})};
    I.preview.rows.forEach(function(r){if(r.flight===undefined) r.flight=I.kind==='drops'?(r.flightIn||''):'';});
    I.stage='preview';render();
  }
  function manualBatches(I) {
    return I.real.dates.map(function(day){return {kind:I.kind,day:day,cutoff:I.cutoff,rows:I.real.all.filter(function(r){return shiftKey(r[I.kind==='drops'?'ret':'meet'],I.cutoff)===day;}).map(function(r){return {ref:r.ref,reg:r.reg,name:r.name,phone:r.phone,make:r.make,drop_local:local(r.meet),return_local:local(r.ret),flight:r.flight===undefined?r.flightIn||'':r.flight,note:r.note||'',source:r._source||'',cancelled:!!r.cancelled};})};});
  }
  async function checkManualImport() {
    var I=S.imp; if(!I || I.saving || I.checking) return;
    I.checking=true;I.error='';I.plan=null;I.pending=null;I.failed=false;render();
    try {
      var batches=manualBatches(I), r=await sb.rpc('reviewed_import_preview',{p_batches:batches});
      if(r.error) throw new Error(/reviewed_import_preview/.test(r.error.message)?'Reviewed imports need the prepared database update before they can be used. Nothing was imported.':r.error.message);
      if(S.imp!==I) return;
      if(!r.data||!Array.isArray(r.data.items))throw new Error('The review service returned no booking details. Nothing was imported.');I.plan=r.data;I.batches=batches;I.selected={};I.plan.items.forEach(function(x){if(manualReady(x)) I.selected[x.key]=true;});I.request=crypto.randomUUID();
    }catch(err){I.error=err.message||String(err);}finally{I.checking=false;if(S.imp===I)render();}
  }
  async function createSheet() {
    var I=S.imp;if(!I||I.saving||!I.plan)return;
    var selected=manualSelected(I);if(!selected.length)return;
    I.saving=true;I.error='';render();
    // Keep this exact payload after a lost response: request IDs are idempotent.
    var args=I.pending || {p_batches:I.batches,p_hash:I.plan.hash,p_selected:selected,p_request:I.request,p_source:{files:(I.fileInfo||[]).map(function(f){return {name:f.name,type:f.type};}),excel:I.excelFile&&I.excelFile.name,pdf:I.pdfFile&&I.pdfFile.name}};
    I.pending=args;
    try {
      var r=await sb.rpc('reviewed_import_apply',args);
      if(r.error) throw new Error(r.error.message);
      I.result=r.data;I.stage='done';I.pending=null;S.recentImports=null;S.importHistory=null;
      await loadSheets();await loadRows();
    }catch(err){I.error=err.message||String(err);I.failed=true;}
    finally{I.saving=false;render();}
  }
  function manualResultHtml(I) {
    var days=I.result.days||[], added=0,updated=0;days.forEach(function(d){added+=d.added||0;updated+=d.updated||0;});
    return '<section class="mi-result" role="status"><h3>Import complete</h3><p>'+added+' added · '+updated+' updated across '+days.length+' sheet(s).</p><p>Unselected and held bookings were left for review.</p><div class="row-actions">'+days.map(function(d){return '<button type="button" class="btn ghost" data-importboard="'+esc(d.sheet_id)+'">View '+esc(d.kind.toUpperCase()+' '+biDay(d.day))+'</button>';}).join('')+'<button type="button" class="btn" data-importreview>Review remaining</button><button type="button" class="btn ghost" data-restart>New import</button></div></section>'+biProtected()+recentImportsHtml();
  }
  async function manualOpen(key){var I=S.imp,item=I.plan&&I.plan.items.filter(function(i){return i.key===key;})[0];if(!item||!item.booking_id)return;var r=await sb.from('bookings').select('*').eq('id',item.booking_id).maybeSingle();if(r.error||!r.data)return toast('Could not open this booking.',true);await openArchived(r.data.sheet_id,r.data.reg);var b=S.rows.filter(function(x){return x.id===item.booking_id;})[0];if(b)openPanel(b);}
  function autoSelected(P){return (P.items||[]).filter(function(i){return (i.status==='new'||i.status==='changed')&&S.bi.selected&&S.bi.selected[i.kind+'|'+i.ref];}).map(function(i){return i.kind+'|'+i.ref;});}
  function biCoverage(P){var reports=P.report||{},days={};['drops','picks'].forEach(function(k){var r=reports[k];Object.keys(r&&r.by_day||{}).forEach(function(d){(days[d]=days[d]||{})[k]=r.by_day[d];});});var keys=Object.keys(days).sort();return keys.length?'<details class="bi-diag bi-coverage"><summary>Date coverage · '+keys.length+' date(s)</summary><div class="bi-diagbody">'+keys.map(function(d){return '<p>'+esc(biDay(d)+': '+(days[d].drops||0)+' drops · '+(days[d].picks||0)+' picks')+'</p>';}).join('')+'<p>Counts use report calendar dates. Drops sheets use your day-end cutoff.</p></div></details>':'';}
  function autoResultHtml(R){var days=R.days||[];return '<section class="mi-result" role="status"><h3>Import complete</h3><p>'+days.reduce(function(n,d){return n+(d.added||0);},0)+' added · '+days.reduce(function(n,d){return n+(d.updated||0);},0)+' updated · '+(R.reviews||0)+' held for review</p><div class="row-actions">'+days.filter(function(d){return d.sheet_id;}).map(function(d){return '<button type="button" class="btn ghost small" data-importboard="'+esc(d.sheet_id)+'">View '+esc(d.kind.toUpperCase()+' '+biDay(d.day))+'</button>';}).join('')+'</div></section>';}
  function importGroups(list){var groups=[],map={};list.forEach(function(x){var key=x.run_id || (x.source ? x.at+'|'+x.by+'|'+x.source : 'single|'+x.id), g=map[key];if(!g){g={key:key,at:x.at,by:x.by,source:x.source,items:[]};map[key]=g;groups.push(g);}g.items.push(x);});return groups;}
  function importGroupHtml(g){var added=0,changed=0;g.items.forEach(function(x){added+=x.added||0;changed+=x.changed||0;});return '<details class="bi-run"><summary><span><b>'+esc(biStamp(g.at))+'</b> · '+esc(g.by||'')+'<small>'+esc(g.source==='auto'?'Auto import':g.source==='manual'?'Manual import':'Import')+' · '+g.items.length+' sheet(s)</small></span><span>'+esc(added||changed?added+' added · '+changed+' updated':'No changes')+'</span></summary><div class="bi-diagbody">'+g.items.map(function(x){return '<div class="bi-rr"><span class="bi-bd">'+esc(x.kind.toUpperCase()+' '+biDay(x.day))+'</span><span class="bi-res">'+esc(x.undone?'Undone':(x.added||x.changed)?x.added+' added · '+x.changed+' updated':'No changes')+'</span>'+(x.latest&&!x.undone&&(x.added||x.changed)?'<button type="button" class="link bi-undo" data-undoimport="'+esc(x.id)+'">Review undo</button>':'')+'</div>';}).join('')+'</div></details>';}
  function importHistoryHtml(){if(!S.recentImports)loadRecentImports();if(S.importHistory===undefined)loadImportHistory();var list=S.importHistory||[],q=S.bi.historyQ||'';function matches(x){var src=x.source&&typeof x.source==='object'?(x.source.auto?'auto':'manual'):x.source||'',date=x.at?new Date(x.at).toLocaleDateString('en-CA',{timeZone:TZ}):'';return (!S.bi.historyMethod||src===S.bi.historyMethod)&&(!S.bi.historyDay||date===S.bi.historyDay)&&(!q||JSON.stringify(x).toLowerCase().indexOf(q.toLowerCase())>=0);}return '<section class="mi-history"><h3>Import history</h3><div class="bi-filters"><select data-historymethod aria-label="Import method">'+[['','All methods'],['manual','Manual'],['auto','Auto']].map(function(x){return '<option value="'+x[0]+'"'+(S.bi.historyMethod===x[0]?' selected':'')+'>'+x[1]+'</option>';}).join('')+'</select><input type="date" data-historyday aria-label="Import date" value="'+esc(S.bi.historyDay||'')+'"><input id="biHistoryQ" type="search" class="bi-search" placeholder="Filename, reference or staff" aria-label="Search import history" value="'+esc(q)+'"><button type="button" class="btn ghost small" data-importlog>Activity log</button></div><p class="bi-hint">Recent sheets include undo where available. Reviewed runs retain filenames and booking changes.</p>'+importGroups((S.recentImports||[]).filter(matches)).map(importGroupHtml).join('')+list.filter(matches).map(function(x){return '<details class="bi-run"><summary><span><b>'+esc(biStamp(x.at))+'</b> · '+esc(x.by||'')+'<small>'+esc(((x.source||{}).files||[]).map(function(f){return f.name;}).join(' · ')||'Auto import')+'</small></span><span>'+esc((x.result.selected||0)+' selected')+'</span></summary><div class="bi-diagbody">'+(x.result.changes||[]).map(function(i){return '<p><b>'+esc(i.ref||'')+'</b> · '+esc(i.status==='new'?'New booking':(i.changes||[]).map(biChange).join(' · '))+'</p>';}).join('')+'</div></details>';}).join('')+(!list.length?'<p class="bi-hint">'+esc(S.importHistoryError||'No reviewed runs recorded yet.')+'</p>':'')+'</section>';}
  async function loadImportHistory(){S.importHistory=[];var r=await sb.rpc('reviewed_import_history');if(r.error)S.importHistoryError='Reviewed history is unavailable until the prepared database update is installed.';else S.importHistory=r.data||[];if(S.view==='import')render();}

  async function manualIncoming(key){var I=S.imp,item=I.plan&&I.plan.items.filter(function(i){return i.key===key;})[0];if(!item||!item.can_resolve||I.saving||I.checking)return;if(!confirm('Apply these booking corrections?\n\n'+item.ref+'\n'+item.changes.map(biChange).join('\n')+'\n\nRegistration and return corrections are saved with your name. Other updates remain for import.'))return;I.saving=true;render();try{var r=await sb.rpc('reviewed_import_resolve',{p_batches:I.batches,p_hash:I.plan.hash,p_key:key});if(r.error)throw new Error(r.error.message);I.saving=false;await checkManualImport();}catch(err){I.saving=false;I.error=err.message;render();}}
  // ── staff ─────────────────────────────────
  var ROLE_LABEL = { owner: "Owner", office: "Office", manager: "Manager", bongo: "Bongo driver", terminal: "Terminal", view: "View only" };
  function issuedHtml(x, appName) {
    var msg = "Your " + (appName || brandName()) + " app: " + x.link + " (open it on your phone) Your PIN: " + x.pin;
    return '<div class="issued"><strong>' + esc(x.name) + " · " + esc(ROLE_LABEL[x.role] || x.role) + '</strong><span class="note">Send them this link and PIN. It is shown only once.</span><code>' + esc(x.link) + '</code><div>PIN <span class="pin num">' + esc(x.pin) + "</span></div>" +
      '<div class="row-actions" style="margin:0"><button type="button" class="btn small" data-copy="' + esc(msg) + '">Copy message</button>' +
      '<a class="btn ghost small" href="https://wa.me/?text=' + encodeURIComponent(msg) + '" target="_blank" rel="noopener">WhatsApp</a></div></div>';
  }
  // ── Clients (product owner only, database part 19) ──
  // Counts only: this page never sees a client's customers.
  // The looks a client's app can wear (brand.theme): "pro" is pro.css, "cards" is cards.css, "premium" is premium.css, "board" is premium.css + board.css.
  var LOOKS = [["", "Standard"], ["pro", "Airport Parking Bay UI"], ["cards", "Cards (light and dark)"], ["premium", "Premium UI"], ["board", "Premium Board"], ["stdplus", "Standard with features"], ["ops", "Operations"], ["ops-refined", "Operations Refined"]];
  function lookName(b) { var l = LOOKS.filter(function (x) { return x[0] === ((b && b.theme) || ""); })[0]; return l ? l[1] : "Standard"; }
  function renderClients() {
    if (S.clients === undefined) { S.clients = null; loadClients(); }
    var list = S.clients;
    var hw = (S.health && S.health.warnings) || [];
    var h = '<div class="clienthead"><h2 class="title">Clients</h2><button type="button" class="btn ghost" data-health>Health</button><button type="button" class="btn ghost" data-usage>Usage</button><button type="button" class="btn brand" data-clientedit="new">Add a client</button></div>' +
      (hw.length ? '<button type="button" class="hwarnline" data-health>' + hw.length + (hw.length === 1 ? " thing needs" : " things need") + " a look · Health</button>" : "");
    if (list === null) return h + '<p class="note">Loading…</p>';
    if (list === false) return h + '<div class="msg">Couldn\'t load the clients. Refresh to try again.</div>';
    if (!list.length) return h + '<p class="note">No clients yet.</p>';
    return h + '<div class="clients">' + list.map(function (c) {
      var b = c.brand || {}, host = b.host || "parking-ops.vercel.app";
      var status = c.suspended_at ? '<span class="cstat off">Suspended</span>' : !c.has_owner ? '<span class="cstat wait">Waiting for owner</span>' : '<span class="cstat on">Active</span>';
      var last = c.last_activity ? dayShort(c.last_activity) + " " + hhmm(c.last_activity) : "never";
      return '<div class="client' + (c.suspended_at ? " off" : "") + '"><div class="cl1"><span class="swatch" style="background:' + esc(b.colour || "#334155") + '"></span><strong>' + esc(c.name) + "</strong>" + status + "</div>" +
        '<div class="cmeta">' + esc(c.slug) + " · " + esc(host) + " · yards " + esc((c.yards || []).join(", ")) + " · " + esc(lookName(b)) + "</div>" +
        '<div class="cnums"><div><b class="num">' + c.staff + "</b><span>staff</span></div><div><b class=\"num\">" + c.cars_7d + "</b><span>cars, last 7 days</span></div><div><b class=\"num\">" + c.sheets_7d + "</b><span>sheets, last 7 days</span></div><div><b>" + esc(last) + "</b><span>last activity</span></div></div>" +
        '<div class="row-actions">' + (c.suspended_at ? "" : '<button type="button" class="btn brand small" data-clientopen="' + c.id + '">Open board</button>') +
        '<button type="button" class="btn ghost small" data-clientedit="' + c.id + '">Edit</button>' +
        (!c.has_owner && !c.suspended_at ? '<button type="button" class="btn brand small" data-clientowner="' + c.id + '">Create first owner</button>' : "") +
        '<button type="button" class="btn ghost small' + (c.suspended_at ? "" : " warn") + '" data-clientsuspend="' + c.id + '">' + (c.suspended_at ? "Resume" : "Suspend") + "</button></div></div>";
    }).join("") + "</div>";
  }
  async function loadClients() {
    var both = await Promise.all([sb.rpc("admin_clients"), sb.rpc("admin_health")]);
    S.clients = both[0].error ? false : both[0].data || [];
    S.health = both[1].error ? null : both[1].data;
    if (S.view === "clients") render();
  }
  function hexMix(hex, withHex, amt) {
    var a = parseInt(hex.slice(1), 16), b = parseInt(withHex.slice(1), 16);
    var ch = function (x, y) { return Math.round(x + (y - x) * amt); };
    var r = ch(a >> 16 & 255, b >> 16 & 255), g = ch(a >> 8 & 255, b >> 8 & 255), bl = ch(a & 255, b & 255);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1).toUpperCase();
  }
  // Yard colours (Settings, owners only, database part 77): each yard's tag,
  // PICKS location button and car-panel yard button filled with its colour.
  // A yard with no colour keeps the look's own.
  function yardColour(y) { var c = ((S.company && S.company.yard_colours) || {})[y]; return /^#[0-9A-Fa-f]{6}$/.test(c || "") ? c.toUpperCase() : ""; }
  function applyYardColours(co) {
    var yc = (co && co.yard_colours) || {}, css = "";
    Object.keys(yc).forEach(function (y) {
      var c = yc[y];
      if (!/^[A-Za-z0-9_-]+$/.test(y) || !/^#[0-9A-Fa-f]{6}$/.test(c || "")) return;
      var ink = lightColour(c) ? "#1F1A00" : "#FFFFFF", line = hexMix(c, "#000000", 0.15);
      css += "html body .code." + y + ",html body select.code.pick." + y + ",html body .acts .pyard.on.y-" + y + ",html body .pseg.yard button.on.y-" + y +
        "{background:" + c + ";border-color:" + line + ";color:" + ink + ";}";
      // Operations (and Operations Refined) on a wide screen: a dot of the yard's colour by its count.
      css += "html.ops body.ops-desk #tally button[data-tally=\"" + y + "\"] span::before,html.ops-refined body.ops-desk #tally button[data-tally=\"" + y + "\"] span::before{display:inline-block;background:" + c + ";}";
    });
    var el = document.getElementById("yardColours");
    if (!el) { el = document.createElement("style"); el.id = "yardColours"; document.head.appendChild(el); }
    el.textContent = css;
  }
  function lightColour(hex) { var n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) > 160; }
  function openClient(id) {
    var c = id === "new" ? null : (S.clients || []).filter(function (x) { return x.id === id; })[0];
    var b = (c && c.brand) || {};
    var f = function (key, label, val, attrs, hint) { return '<label for="' + key + '">' + label + '</label><input id="' + key + '" value="' + esc(val || "") + '" autocomplete="off" ' + (attrs || "") + ">" + (hint ? '<p class="hint">' + hint + "</p>" : ""); };
    $("panelBody").innerHTML = '<h2 id="panelTitle">' + (c ? "Edit " + esc(c.name) : "Add a client") + '</h2><form id="clientForm" novalidate data-id="' + (c ? c.id : "") + '">' +
      f("clName", "COMPANY NAME", c && c.name, 'maxlength="80"') +
      f("clShort", "SHORT NAME FOR THE TOP BAR", b.short, 'maxlength="24"', "Leave empty to use the company name.") +
      (c ? '<label>SHORT CODE</label><p class="sub">' + esc(c.slug) + " (fixed: their links are built from it)</p>"
         : f("clSlug", "SHORT CODE", "", 'maxlength="40" autocapitalize="off" placeholder="e.g. airport-parking-bay"', "Lower-case letters, numbers and dashes. Can't be changed later.")) +
      f("clYards", "YARDS", c ? (c.yards || []).join(", ") : "", 'autocapitalize="characters" placeholder="e.g. GS, MY, T"', "Codes separated by commas, 1 to 4 letters each. Add T for the terminal.") +
      f("clEnd", "DROPS DAY ENDS AT", c ? String(c.drops_day_end || "06:00").slice(0, 5) : "06:00", 'type="time"') +
      '<label for="clColour">COLOUR</label><div class="when2"><input id="clColour" type="color" value="' + esc(b.colour || "#334155") + '"><select id="clInk"><option value="#FFFFFF"' + (b.ink !== "#16181D" ? " selected" : "") + '>White text on it</option><option value="#16181D"' + (b.ink === "#16181D" ? " selected" : "") + ">Dark text on it</option></select></div>" +
      '<label for="clLook">LOOK</label><select id="clLook">' + LOOKS.map(function (l) { return '<option value="' + l[0] + '"' + ((b.theme || "") === l[0] ? " selected" : "") + ">" + l[1] + "</option>"; }).join("") + "</select>" +
      '<p class="hint">How their app looks to their team. Their phones change the next time the app refreshes.</p>' +
      '<label class="check"><input type="checkbox" id="clPicksYard"' + (b.picks_yard ? " checked" : "") + "> Location on PICKS (instead of NO SHOW)</label>" +
      '<label class="check"><input type="checkbox" id="clLanes"' + (b.lane_planner ? " checked" : "") + "> Yard planner (add-on)</label>" +
      '<label class="check"><input type="checkbox" id="clCollections"' + (b.collections ? " checked" : "") + "> Collections on DROPS (add-on)</label>" +
      '<label class="check"><input type="checkbox" id="clTexts"' + (b.texts ? " checked" : "") + "> Customer texts (add-on)</label>" +
      '<label class="check"><input type="checkbox" id="clCalls"' + (b.calls ? " checked" : "") + "> Calls (add-on)</label>" +
      '<label class="check"><input type="checkbox" id="clVoice"' + (b.voice ? " checked" : "") + "> Voice calls: caller menu and calls in the app (add-on, needs Calls)</label>" +
      f("clHost", "WEB ADDRESS", b.host, 'autocapitalize="off" placeholder="e.g. clientname-ops.vercel.app"', "Add the same address in Vercel (Settings, Domains) or it won't open.") +
      '<div class="pbtns"><button type="button" data-close>Cancel</button><button class="save" id="clGo">' + (c ? "Save" : "Add client") + "</button></div></form>";
    if (!$("panel").open) $("panel").showModal();
    if (!c) {
      $("clColour").addEventListener("input", function () { $("clInk").value = lightColour(this.value) ? "#16181D" : "#FFFFFF"; });
      $("clName").addEventListener("input", function () { if (!$("clSlug").dataset.touched) $("clSlug").value = this.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40); });
      $("clSlug").addEventListener("input", function () { this.dataset.touched = "1"; });
      setTimeout(function () { $("clName").focus(); }, 50);
    }
  }
  async function saveClient() {
    var id = $("clientForm").dataset.id, colour = $("clColour").value.toUpperCase();
    var was = id ? ((S.clients || []).filter(function (x) { return x.id === id; })[0] || {}).brand || {} : {};
    var p = { id: id, name: $("clName").value, slug: $("clSlug") ? $("clSlug").value.trim() : "", drops_day_end: $("clEnd").value,
      yards: $("clYards").value.split(/[\s,]+/).filter(Boolean),
      brand: { short: $("clShort").value, colour: colour, ink: $("clInk").value, soft: hexMix(colour, "#FFFFFF", 0.88), text: hexMix(colour, "#000000", 0.35), host: $("clHost").value.trim().toLowerCase(), theme: $("clLook").value, picks_yard: $("clPicksYard").checked, lane_planner: $("clLanes").checked, collections: $("clCollections").checked, texts: $("clTexts").checked, calls: $("clCalls").checked, voice: $("clVoice").checked } };
    // Same colour as before: keep their hand-picked tints rather than recalculating.
    if (was.colour && was.colour.toUpperCase() === colour) { p.brand.soft = was.soft || p.brand.soft; p.brand.text = was.text || p.brand.text; }
    $("clGo").disabled = true;
    var r = await sb.rpc("admin_save_client", { p: p });
    $("clGo").disabled = false;
    if (r.error) return toast(r.error.message, true);
    await loadClients();
    if (id) { toast("Saved"); return $("panel").close(); }
    var host = (r.data.brand && r.data.brand.host) || "parking-ops.vercel.app";
    $("panelBody").innerHTML = '<h2 id="panelTitle">' + esc(r.data.name) + " added</h2>" +
      '<p class="sub">Next steps:</p><ol class="steps"><li>' + (r.data.brand && r.data.brand.host ? "In Vercel, add <b>" + esc(host) + "</b> under Settings, Domains." : "No web address set: they'll use parking-ops.vercel.app.") + "</li>" +
      "<li>On the Clients page, tap <b>Create first owner</b> on " + esc(r.data.name) + ", enter their boss's name, and send the boss the link and PIN it shows.</li></ol>" +
      '<div class="pbtns"><button type="button" data-close>Done</button></div>';
  }
  function askClientOwner(id) {
    var c = (S.clients || []).filter(function (x) { return x.id === id; })[0]; if (!c) return;
    $("panelBody").innerHTML = '<h2 id="panelTitle">First owner for ' + esc(c.name) + '</h2>' +
      '<p class="sub">Their boss. They get a personal link and PIN, and add the rest of their team themselves.</p>' +
      '<form id="clientOwnerForm" data-id="' + c.id + '" novalidate><label for="coName">NAME</label><input id="coName" maxlength="60" autocomplete="off">' +
      '<div class="pbtns"><button type="button" data-close>Cancel</button><button class="save" id="coGo">Create owner</button></div></form><div id="coDone"></div>';
    if (!$("panel").open) $("panel").showModal();
    setTimeout(function () { $("coName").focus(); }, 50);
  }
  async function createClientOwner() {
    var form = $("clientOwnerForm"), name = $("coName").value.trim();
    if (!name) return toast("Enter their boss's name.", true);
    $("coGo").disabled = true;
    try {
      var r = await callFunction("manage-staff", { action: "client_owner", company_id: form.dataset.id, name: name, app_url: location.origin + "/" }, true);
      form.remove();
      var cl = (S.clients || []).filter(function (x) { return x.id === form.dataset.id; })[0] || {};
      $("coDone").innerHTML = issuedHtml(r, (cl.brand && cl.brand.short) || cl.name) + '<div class="pbtns"><button type="button" data-close>Done</button></div>';
      loadClients();
    } catch (err) { $("coGo").disabled = false; toast(err.message, true); }
  }
  async function suspendClient(btn) {
    var c = (S.clients || []).filter(function (x) { return x.id === btn.dataset.clientsuspend; })[0]; if (!c) return;
    var on = !c.suspended_at;
    if (!confirm(on ? "Suspend " + c.name + "? Everyone at " + c.name + " is locked out straight away. Nothing is deleted, and Resume lets them back in." : "Resume " + c.name + "? Their team can sign in again.")) return;
    btn.disabled = true;
    var r = await sb.rpc("admin_suspend_client", { p_id: c.id, p_suspend: on });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    toast(c.name + (on ? " suspended" : " resumed"));
    loadClients();
  }

  // ── Open a client's app (database part 56) ──
  // The product owner signs in as their own "(Parking Ops)" owner inside the
  // client: the client's board, Settings and Staff, exactly as their owner has
  // them. The Parking Ops sign-in is kept on this phone for the way back.
  var HOME_KEY = "po_home";
  function homeSaved() { try { return JSON.parse(localStorage.getItem(HOME_KEY) || "null"); } catch (e) { return null; } }
  async function openClientBoard(btn) {
    var c = (S.clients || []).filter(function (x) { return x.id === btn.dataset.clientopen; })[0]; if (!c) return;
    if (!confirm("Open " + c.name + "'s app? You'll be their owner, shown as \"" + S.me.name + " (Parking Ops)\" in their Staff list and activity. Tap ‹ PARKING OPS at the top to come back.")) return;
    btn.disabled = true;
    try {
      var s = (await sb.auth.getSession()).data.session;
      if (!s) throw new Error("Sign in again.");
      var r = await callFunction("manage-staff", { action: "client_open", company_id: c.id, app_url: location.origin + "/" }, true);
      try { localStorage.setItem(HOME_KEY, JSON.stringify({ a: s.access_token, r: s.refresh_token })); } catch (e) {}
      var v = await sb.auth.verifyOtp({ type: "magiclink", token_hash: r.token_hash });
      if (v.error) { try { localStorage.removeItem(HOME_KEY); } catch (e) {} await sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token }); throw v.error; }
      location.reload();
    } catch (err) { btn.disabled = false; toast(err.message || String(err), true); }
  }
  async function backToPlatform() {
    var h = homeSaved(); if (!h) return;
    $("homeBtn").disabled = true;
    try { await sb.auth.signOut({ scope: "local" }); } catch (e) {}
    var r = await sb.auth.setSession({ access_token: h.a, refresh_token: h.r });
    try { localStorage.removeItem(HOME_KEY); } catch (e) {}
    if (r.error) { toast("Sign in to Parking Ops again with your link and PIN.", true); return showSignIn(); }
    location.reload();
  }
  // ── Usage (database part 56): what each client uses, last 30 days ──
  var FR24_CREDITS = 39;   // about this many credits per live check, from the FR24 account
  function mb(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(2) + " GB" : (n / 1048576).toFixed(1) + " MB"; }
  async function openUsage() {
    $("panelBody").innerHTML = '<h2 id="panelTitle">Usage</h2><p class="note">Loading…</p>';
    if (!$("panel").open) $("panel").showModal();
    var r = await sb.rpc("admin_usage");
    if (r.error) { $("panelBody").innerHTML = '<h2 id="panelTitle">Usage</h2><div class="msg">' + esc(r.error.message) + '</div><div class="pbtns"><button type="button" data-close>Close</button></div>'; return; }
    var u = r.data || {}, rows = function (list) { return list.map(function (x) { return "<tr><th>" + x[0] + "</th><td class=\"num\">" + x[1] + "</td></tr>"; }).join(""); };
    $("panelBody").innerHTML = '<h2 id="panelTitle">Usage</h2>' +
      '<h3 class="usehead">Everyone</h3><table class="usage">' + rows([
        ["Database", esc(mb(u.db_bytes || 0)) + " of 8 GB"],
        ["Supabase file store", esc(mb(u.store_bytes || 0)) + " of 100 GB · " + (u.store_files || 0) + " files"]]) + "</table>" +
      '<p class="hint">Download traffic (egress, 250 GB a month on Pro) is only on the <a href="https://supabase.com/dashboard/project/_/settings/billing/usage" target="_blank" rel="noopener">Supabase usage page</a>. PT copies are in Cloudflare R2, counted below.</p>' +
      (u.clients || []).map(function (c) {
        var tt = c.timetable_last_error ? '<span class="warnt">' + esc(c.timetable_last_error.slice(0, 90)) + "</span>" : c.timetable_last_ok ? "working · last " + esc(dayShort(c.timetable_last_ok) + " " + hhmm(c.timetable_last_ok)) : "not used";
        return '<h3 class="usehead">' + esc(c.name) + '</h3><table class="usage">' + rows([
          ["Cars (30 days)", c.cars_30d], ["Sheets (30 days)", c.sheets_30d],
          ["PT sets / photos (30 days)", c.pt_sets_30d + " / " + c.pt_photos_30d],
          ["FR24 checks today", c.fr24_calls_today + " · about " + (c.fr24_calls_today * FR24_CREDITS).toLocaleString("en-GB") + " credits"],
          ["FR24 checks (30 days)", c.fr24_calls_30d + " · about " + (c.fr24_calls_30d * FR24_CREDITS).toLocaleString("en-GB") + " credits"],
          ["AeroDataBox (30 days)", c.timetable_runs_30d + " checks"], ["AeroDataBox now", tt],
          ["Taps and changes (30 days)", c.activity_30d]]) + "</table>";
      }).join("") + '<div class="pbtns"><button type="button" data-close>Close</button></div>';
  }

  // ── Health (database part 100): what runs on its own, and errors on phones ──
  function agoText(iso) {
    if (!iso) return "never";
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : dayShort(iso) + " " + hhmm(iso);
  }
  async function openHealth() {
    $("panelBody").innerHTML = '<h2 id="panelTitle">Health</h2><p class="note">Loading…</p>';
    if (!$("panel").open) $("panel").showModal();
    var r = await sb.rpc("admin_health");
    if (r.error) { $("panelBody").innerHTML = '<h2 id="panelTitle">Health</h2><div class="msg">' + esc(r.error.message) + '</div><div class="pbtns"><button type="button" data-close>Close</button></div>'; return; }
    S.health = r.data || {};
    if (S.view === "clients") render();
    var h = S.health, w = h.warnings || [], ad = h.aerodata || {}, calls = h.calls || {}, bk = h.backup || {};
    var bad = function (t) { return '<span class="warnt">' + t + "</span>"; };
    var n = function (x) { return Number(x || 0).toLocaleString("en-GB"); };
    var rows = function (list) { return list.map(function (x) { return "<tr><th>" + x[0] + "</th><td>" + x[1] + "</td></tr>"; }).join(""); };
    var oldBackup = !bk.last || Date.now() - new Date(bk.last).getTime() > 30 * 3600000;
    $("panelBody").innerHTML = '<h2 id="panelTitle">Health</h2>' +
      (w.length ? '<div class="hwarn"><strong>Needs a look</strong><ul>' + w.map(function (x) { return "<li>" + esc(x.text) + "</li>"; }).join("") + "</ul></div>"
        : '<p class="hok">Nothing needs a look.</p>') +
      '<h3 class="usehead">Everyone</h3><table class="usage health">' + rows([
        ["Last backup", oldBackup ? bad(esc(agoText(bk.last))) : esc(agoText(bk.last))],
        ["Server calls, last hour", n(calls.ok) + " worked" + (calls.failed ? " · " + bad(n(calls.failed) + " failed") : "")],
        ["AeroDataBox units this month", "about " + n(ad.units) + " of " + n(ad.cap) + " (" + n(ad.pct) + "%)"],
        ["AeroDataBox calls this month", n(ad.calls) + (ad.counted_from ? " since " + esc(dayShort(ad.counted_from)) : "")],
        ["Notifications that failed, 24 h", h.push_failed_24h ? bad(n(h.push_failed_24h)) : "0"]]) + "</table>" +
      '<h3 class="usehead">Timers</h3><table class="usage health">' + rows((h.timers || []).map(function (t) {
        return [esc(t.name), (t.failed_24h ? bad(n(t.failed_24h) + " failed in 24 h") + " · " : "") + (t.active ? "last ran " + esc(agoText(t.last_ok)) : "switched off")];
      })) + "</table>" +
      (h.clients || []).map(function (c) {
        var ai = c.auto_import, aiBad = ai && ai.last_error && (!ai.last_ok || ai.last_ok < ai.last_run);
        return '<h3 class="usehead">' + esc(c.name) + '</h3><table class="usage health">' + rows([
          ["Live flight times (FR24)", c.live_error ? bad(esc(c.live_error.slice(0, 90))) : "last " + esc(agoText(c.live_last))],
          ["Timetable (AeroDataBox)", c.timetable_error ? bad(esc(c.timetable_error.slice(0, 90))) : "last " + esc(agoText(c.timetable_last))],
          ["AeroDataBox calls this month", n(c.aerodata_calls_month)],
          ["Booking import", "last " + esc(agoText(c.import_last)) + (ai ? " · scheduled " + (ai.enabled ? "on" : "off") + (aiBad ? " · " + bad(esc(ai.last_error)) : "") : "")],
          ["Phones online now", n(c.online)], ["Phones with notifications", n(c.phones_push)],
          ["Last tap or change", esc(agoText(c.last_activity))],
          ["App errors, 24 h", c.errors_24h ? bad(n(c.errors_24h)) : "0"]]) + "</table>" +
          ((c.errors || []).length ? '<details class="herr"><summary>Latest app errors (' + c.errors.length + ")</summary><ul>" + c.errors.map(function (e) {
            return "<li><b>" + esc(dayShort(e.at) + " " + hhmm(e.at)) + (e.n > 1 ? " ×" + e.n : "") + "</b> " + esc(e.m) +
              '<span class="note">' + esc([e.who, e.view, e.device, e.version ? "app " + e.version : ""].filter(Boolean).join(" · ")) + "</span></li>";
          }).join("") + "</ul></details>" : "");
      }).join("") + '<div class="pbtns"><button type="button" data-health>Refresh</button><button type="button" data-close>Close</button></div>';
  }

  // Mirrors can() in database parts 3 and 105: defaults before per-person changes.
  var ROLE_CAN = { sent: ["office", "manager", "bongo"], called: ["office", "manager"], desk: ["office", "manager", "terminal"], clear: ["office", "manager", "terminal"], yard: ["office", "manager"],
    summary: ["office", "manager"], log: ["office", "manager"], flights: ["office"], rtc: ["office", "manager", "bongo"], picksinfo: ["office", "manager", "terminal"],
    import: ["office", "manager"], staff: ["office", "manager"], settings: ["manager"], collections: ["office", "manager"] };
  var PERMS = [["sent", "DROPS: press SENT"], ["called", "DROPS: press CALLED and OVERSTAY"], ["desk", "DROPS: press AT DESK"], ["clear", "DROPS: press CLEAR and COMPLAINT"], ["yard", "Set yards"],
    ["note", "Write notes"], ["flights", "Enter and check flight numbers"], ["intake", "PICKS: Collected, No show, PT"], ["rtc", "PICKS: RTC"],
    ["picksinfo", "Hourly stats, and PICKS returns"], ["summary", "Summary"], ["log", "Activity log and archive"], ["import", "Import, add and remove cars"],
    ["collections", "View board collections"], ["staff", "Staff: add people, new links, switch off"], ["settings", "Settings"]];
  // "View board collections" only where the client has the Collections add-on.
  function permShown(x) { return x[0] !== "collections" || !!(S.company && S.company.brand && S.company.brand.collections === true); }
  function roleCan(role, a) { if (role === "owner") return true; var l = ROLE_CAN[a]; return l ? l.indexOf(role) !== -1 : role !== "view"; }
  function personCan(p, a) { var x = p.extra || []; if (x.indexOf("-" + a) !== -1) return false; if (x.indexOf(a) !== -1) return true; return roleCan(p.role, a) || (a === "desk" && p.role !== "view" && personCan(p, "called")); }
  // New link / switch off: the same rule as manage-staff (owners by an owner, managers by a manager or owner).
  function canChange(p) { return p.id !== S.me.id && (p.role !== "owner" || S.me.role === "owner") && (p.role !== "manager" || S.me.role === "owner" || S.me.role === "manager"); }
  function canManage(p) { return (S.me.role === "manager" || S.me.role === "owner") && p.id !== S.me.id && (p.role !== "owner" || S.me.role === "owner"); }
  async function reloadStaff() {
    var list = await sb.from("staff").select("*").order("name");
    if (!list.error) { S.staff = {}; list.data.forEach(function (p) { S.staff[p.id] = p; }); }
  }
  var staffEdit = null;
  function openStaffPanel(id) {
    var p = S.staff[id]; if (!p) return;
    staffEdit = id;
    $("panelBody").innerHTML = '<h2 id="panelTitle">' + esc(p.name) + " <small>" + esc(ROLE_LABEL[p.role] || p.role) + "</small></h2>" +
      '<label>WHAT ' + esc(p.name.toUpperCase()) + ' CAN DO</label><div class="acc">' + PERMS.filter(permShown).map(function (x) {
        var d = roleCan(p.role, x[0]);
        return '<label class="chk"><input type="checkbox" data-perm="' + x[0] + '"' + (personCan(p, x[0]) ? " checked" : "") + "><span>" + esc(x[1]) +
          "<small>" + esc(ROLE_LABEL[p.role] || p.role) + " default: " + (d ? "yes" : "no") + "</small></span></label>";
      }).join("") + '</div><div class="pseg" style="margin-top:8px"><button type="button" data-saveaccess>SAVE ACCESS</button><button type="button" data-roledefault>ROLE DEFAULTS</button></div>' +
      '<label for="spPin">SET A NEW PIN</label><div class="when2"><input id="spPin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="4 numbers"><button type="button" class="btn ghost" data-savepin>Set PIN</button></div>' +
      '<p class="hint">Their link stays the same. Tell them the new PIN.</p>' +
      '<label for="spNames">NAMES ON THIS LOGIN</label><textarea id="spNames" rows="3" placeholder="One per line, e.g. RAKESH.O">' + esc((p.desk_names || []).join("\n")) + "</textarea>" +
      '<div class="pseg" style="margin-top:8px"><button type="button" data-savenames>SAVE NAMES</button></div>' +
      '<p class="hint">For a shared login: whoever is working picks their name with Switch name.</p>' +
      '<button type="button" class="link rmcar" data-removestaff>Remove ' + esc(p.name) + '</button>' +
      '<div class="pbtns"><button type="button" data-close>Close</button></div>';
    if (!$("panel").open) $("panel").showModal();
  }
  async function staffPanelAction(t) {
    var p = S.staff[staffEdit]; if (!p) return;
    if (t.dataset.roledefault !== undefined) {
      Array.prototype.forEach.call($("panelBody").querySelectorAll("[data-perm]"), function (c) { c.checked = roleCan(p.role, c.dataset.perm); });
      return;
    }
    var r;
    t.disabled = true;
    if (t.dataset.saveaccess !== undefined) {
      var extra = [];
      Array.prototype.forEach.call($("panelBody").querySelectorAll("[data-perm]"), function (c) {
        var a = c.dataset.perm, d = roleCan(p.role, a);
        if (c.checked && !d) extra.push(a); else if (!c.checked && d) extra.push("-" + a);
      });
      // A hidden switch keeps what was saved for it, ready for when the add-on comes back.
      (p.extra || []).forEach(function (x) { if (!permShown([x.replace(/^-/, "")])) extra.push(x); });
      r = await sb.rpc("set_staff_access", { p_staff: p.id, p_extra: extra });
      if (!r.error) toast("Access saved for " + p.name + ". It applies next time they open the app.");
    } else if (t.dataset.savepin !== undefined) {
      var pin = $("spPin").value;
      if (!/^\d{4}$/.test(pin)) { t.disabled = false; return toast("The PIN must be 4 numbers.", true); }
      r = await sb.rpc("set_staff_pin", { p_staff: p.id, p_pin: pin });
      if (!r.error) { $("spPin").value = ""; toast("New PIN set for " + p.name + "."); }
    } else if (t.dataset.savenames !== undefined) {
      var names = $("spNames").value.split(/[\n,]/).map(function (x) { return x.trim(); }).filter(Boolean);
      r = await sb.rpc("set_desk_names", { p_staff: p.id, p_names: names });
      if (!r.error) toast(names.length ? "Names saved for " + p.name + "." : "Names cleared for " + p.name + ".");
    } else if (t.dataset.removestaff !== undefined) {
      if (!confirm("Remove " + p.name + "? Their link and PIN stop working for good. Their name stays on everything they did.")) { t.disabled = false; return; }
      r = await sb.rpc("remove_staff", { p_staff: p.id });
      if (!r.error) { toast(p.name + " removed"); await reloadStaff(); $("panel").close(); render(); return; }
    }
    t.disabled = false;
    if (r && r.error) return toast(r.error.message, true);
    await reloadStaff();
  }
  // Online / Offline (setup 99): the app checks in every minute while it is on
  // screen; anyone seen or who changed something in the last 5 minutes is Online.
  var SEEN_ONLINE = 5 * 60000;
  async function loadSeen() {
    S.seenAt = Date.now();
    var r = await sb.rpc("staff_seen");
    if (r.error || !Array.isArray(r.data)) return;
    S.seen = {}; r.data.forEach(function (x) { S.seen[x.id] = x; });
    if (S.view === "staff" && !$("panel").open && !document.querySelector(".ops-dd[open]") && document.activeElement !== $("newName")) render();
  }
  function seenHtml(p) {
    var x = (S.seen || {})[p.id] || {}, t = Math.max(x.seen_at ? Date.parse(x.seen_at) : 0, x.acted_at ? Date.parse(x.acted_at) : 0);
    if (p.id === S.me.id || (t && Date.now() - t < SEEN_ONLINE)) return '<b class="seen on">Online</b>';
    if (!t) return '<b class="seen">Offline</b>';
    var d = new Date(t), today = londonParts(d).key === londonParts(new Date()).key;
    return '<b class="seen">Offline · ' + esc(today ? hhmm(d) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: TZ })) + "</b>";
  }
  setInterval(function () {
    if (!S.me || document.visibilityState !== "visible") return;
    sb.rpc("i_am_here").then(function () {}, function () {});
    if (S.view === "staff" && isOps()) loadSeen();
  }, 60000);
  document.addEventListener("visibilitychange", function () { if (S.me && document.visibilityState === "visible") sb.rpc("i_am_here").then(function () {}, function () {}); });
  function renderStaff() {
    var people = Object.keys(S.staff).map(function (k) { return S.staff[k]; }).filter(function (p) { return !p.removed_at; }).sort(function (a, b) { return (b.active - a.active) || a.name.localeCompare(b.name); });
    if (isOps()) return opsStaff(people);
    return '<h2 class="title">Staff</h2>' + (S.issued ? issuedHtml(S.issued) + "<br>" : "") +
      '<form class="box" id="addStaff" style="padding:12px;margin-bottom:14px" novalidate><strong>Add a person</strong>' +
      '<label class="field">Name<input id="newName" maxlength="60" autocomplete="off"></label>' +
      '<label class="field">Role<select id="newRole">' + ["bongo", "terminal", "office", "view"].concat(S.me.role === "owner" || S.me.role === "manager" ? ["manager"] : [], S.me.role === "owner" ? ["owner"] : []).map(function (r) { return '<option value="' + r + '">' + ROLE_LABEL[r] + "</option>"; }).join("") + "</select></label>" +
      '<button class="btn brand" id="addGo">Add and get link</button></form>' +
      '<div class="box staffbox">' + people.map(function (p) {
        return '<div class="rowline' + (p.active ? "" : " off") + '" data-initial="' + esc((p.name || "?").trim().charAt(0).toUpperCase()) + '"><div class="grow"><strong>' + esc(p.name) + '</strong><div class="note">' + esc(ROLE_LABEL[p.role] || p.role) + (p.active ? "" : " · switched off") + "</div></div>" +
          (p.id === S.me.id ? '<span class="note">You</span>' : '<div class="sbtns">' + (canManage(p) ? '<button type="button" class="btn ghost small" data-manage="' + p.id + '">PIN and access</button>' : "") +
            (canChange(p) ? '<button type="button" class="btn ghost small" data-reset="' + p.id + '">New link</button><button type="button" class="btn ghost small" data-onoff="' + p.id + '">' + (p.active ? "Switch off" : "Switch on") + "</button>" : "") + "</div>") + "</div>";
      }).join("") + "</div>";
  }
  // Operations: Staff & access. "Add person" opens the form; each person's
  // PIN and access, New link and Switch off sit in one Actions menu.
  function opsStaff(people) {
    if (!S.seenAt || Date.now() - S.seenAt > 30000) loadSeen();
    var roles = ["bongo", "terminal", "office", "view"].concat(S.me.role === "owner" || S.me.role === "manager" ? ["manager"] : [], S.me.role === "owner" ? ["owner"] : []);
    return '<p class="ops-sub">Manage your team and their permissions</p>' + (S.issued ? issuedHtml(S.issued) + "<br>" : "") +
      (S.addPerson ? '<form class="ops-card ops-add" id="addStaff" novalidate><header><strong>Add a person</strong><button type="button" class="ops-x" data-addperson aria-label="Close">&times;</button></header>' +
        '<div class="ops-fields"><label class="field">Name<input id="newName" maxlength="60" autocomplete="off"></label>' +
        '<label class="field">Role<select id="newRole">' + roles.map(function (r) { return '<option value="' + r + '">' + ROLE_LABEL[r] + "</option>"; }).join("") + "</select></label></div>" +
        '<div class="ops-btns"><button class="btn" id="addGo">Add and get link</button></div></form>'
        : '<div class="ops-acts"><button type="button" class="btn" data-addperson>Add person</button></div>') +
      opsPanel("Team members", people.length + (people.length === 1 ? " person" : " people"), '<div class="staffbox ops-team">' + (opsDesk() ? '<div class="ops-person ops-th" aria-hidden="true"><i></i><div class="grow"><strong>Person</strong><small>Account</small><span>Role</span></div><div class="ops-side"><em>Status</em><b class="seen">Online</b><b>Actions</b></div></div>' : "") + people.map(function (p) {
        var acts = p.id === S.me.id ? "" : (canManage(p) ? '<button type="button" data-manage="' + p.id + '">PIN and access</button>' : "") +
          (canChange(p) ? '<button type="button" data-reset="' + p.id + '">New link</button><button type="button" data-onoff="' + p.id + '">' + (p.active ? "Switch off" : "Switch on") + "</button>" : "");
        return '<div class="ops-person' + (p.active ? "" : " off") + '"><i>' + esc((p.name || "?").trim().charAt(0).toUpperCase()) + "</i>" +
          '<div class="grow"><strong>' + esc(p.name) + "</strong><small>" + (p.id === S.me.id ? "Your account" : "Staff member") + "</small><span>" + esc(ROLE_LABEL[p.role] || p.role) + "</span></div>" +
          '<div class="ops-side"><em class="' + (p.active ? "on" : "") + '">' + (p.active ? "Active" : "Inactive") + "</em>" + (p.active ? seenHtml(p) : "") +
          (acts ? '<details class="ops-dd"><summary>Actions</summary><div>' + acts + "</div></details>" : "") + "</div></div>";
      }).join("") + "</div>");
  }
  // An Actions menu that would open under the bottom bar (the last people on a phone) opens upward,
  // so Switch on / Switch off stays in view.
  document.addEventListener("toggle", function (e) {
    var d = e.target; if (!d || !d.classList || !d.classList.contains("ops-dd")) return;
    d.classList.remove("up"); if (!d.open) return;
    var m = d.querySelector(":scope > div"), bn = $("bnav"), low = innerHeight, b = bn && bn.getBoundingClientRect();
    if (b && b.height && b.top > innerHeight / 2) low = Math.min(low, b.top);
    var r = m.getBoundingClientRect();
    if (r.bottom > low - 8 && d.getBoundingClientRect().top - r.height - 4 > 0) d.classList.add("up");
  }, true);
  async function staffAction(body, busyEl) {
    if (busyEl) busyEl.disabled = true;
    try {
      body.app_url = location.origin + "/";
      var r = await callFunction("manage-staff", body, true);
      var list = await sb.from("staff").select("*").order("name");
      if (!list.error) { S.staff = {}; list.data.forEach(function (p) { S.staff[p.id] = p; }); }
      return r;
    } catch (err) { toast(err.message, true); return null; }
    finally { if (busyEl) busyEl.disabled = false; }
  }

  // ── archive (owner, manager, office) ──────
  function renderArchive() {
    if (!can("log")) return '<div class="msg">Only the office can open the archive.</div>';
    var A = S.arch || (S.arch = { q: "", results: null, days: null });
    if (!A.days) loadArchiveDays();
    var h = '<form class="box" id="archSearch" style="padding:14px;max-width:640px" novalidate><strong>Find a car on any day</strong><div style="height:8px"></div>' +
      '<div class="toolbar" style="margin:0"><input type="search" id="archQ" value="' + esc(A.q) + '" placeholder="e.g. AB12CDE or LFFLGT" autocomplete="off" style="flex:1 1 180px;min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:var(--r);font-size:16px">' +
      '<button class="btn small" id="archGo">Search</button></div></form>';
    if (A.results) {
      h += '<div class="section-label">' + (A.results.length ? A.results.length + (A.results.length === 50 ? "+" : "") + " found" : "Nothing found") + "</div>";
      if (A.results.length && opsDesk()) h += '<div class="box ops-tbl arch-tbl"><div class="ot-tr ot-th"><span>Registration</span><span>Customer</span><span>Reference</span><span>Board</span><span>Day</span><span>Time</span><span></span></div>' + A.results.map(function (r) {
        var sh = r.sheets || {}, kind = sh.kind || r.kind;
        return '<div class="ot-tr"><span><b>' + esc(r.reg || "NO REG") + "</b></span><span>" + esc(r.name || "(details removed)") + '</span><span class="num">' + esc(r.ref) + "</span><span>" + esc(String(kind || "").toUpperCase()) + "</span><span>" + esc(sh.day ? longDate(sh.day) + " " + sh.day.slice(0, 4) : "") +
          "</span><span>" + esc(r.kind === "picks" ? "drop-off " + hhmm(r.drop_at) : "back " + hhmm(r.return_at)) + '</span><span><button type="button" class="btn ghost small" data-archopen="' + r.sheet_id + '" data-archq="' + esc(r.reg || r.ref) + '">Open day</button></span></div>';
      }).join("") + "</div>";
      else if (A.results.length) h += '<div class="box">' + A.results.map(function (r) {
        var sh = r.sheets || {};
        return '<div class="rowline"><div class="grow"><strong>' + esc(r.reg || "NO REG") + "</strong> · " + esc(r.name || "(details removed)") + '<div class="note">' + esc(sheetLabel({ day: sh.day, kind: sh.kind || r.kind })) + " · " + esc(r.ref) +
          " · " + esc(r.kind === "picks" ? "drop-off " + hhmm(r.drop_at) : "back " + hhmm(r.return_at)) + '</div></div><button type="button" class="btn ghost small" data-archopen="' + r.sheet_id + '" data-archq="' + esc(r.reg || r.ref) + '">Open day</button></div>';
      }).join("") + "</div>";
    }
    var hand = (S.handArchived || []).slice().sort(function (a, b) { return a.day < b.day ? 1 : -1; });
    if (hand.length) {
      h += '<div class="section-label">Archived by hand</div><div class="box">' + hand.map(function (d) {
        return '<div class="rowline"><span class="grow">' + esc(sheetLabel(d)) + '</span><button type="button" class="btn ghost small" data-archopen="' + d.id + '">Open</button>' +
          (can("import") ? '<button type="button" class="btn ghost small" data-unarchive="' + d.id + '">Bring back</button>' : "") + "</div>";
      }).join("") + "</div>";
    }
    h += '<div class="section-label">Days older than ' + PICKER_DAYS + " days</div>";
    if (!A.days || A.daysState === "loading") h += '<div class="msg">Loading…</div>';
    else if (A.daysState === "fail") h += '<p class="note">Couldn\'t load the older days. <button type="button" class="link" data-archretry>Try again</button></p>';
    else if (!A.days.length) h += '<p class="note">None yet.</p>';
    else {
      var months = {};
      A.days.forEach(function (d) { (months[d.day.slice(0, 7)] = months[d.day.slice(0, 7)] || []).push(d); });
      h += Object.keys(months).sort().reverse().map(function (m) {
        return '<details class="box" style="margin-bottom:8px"><summary style="padding:12px;font-weight:700;cursor:pointer">' + new Date(m + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) +
          ' <span class="note">· ' + months[m].length + " sheets</span></summary>" + months[m].map(function (d) {
            return '<div class="rowline"><span class="grow">' + esc(sheetLabel(d)) + '</span><button type="button" class="btn ghost small" data-archopen="' + d.id + '">Open</button></div>';
          }).join("") + "</details>";
      }).join("");
    }
    return h;
  }
  async function loadArchiveDays() {
    S.arch.days = []; S.arch.daysState = "loading";
    var r = await sb.from("sheets").select("id, kind, day").lt("day", addDaysKey(londonParts(new Date()).key, -PICKER_DAYS)).order("day", { ascending: false }).order("kind").limit(2000);
    S.arch.days = r.error ? [] : r.data; S.arch.daysState = r.error ? "fail" : "ok";
    if (S.view === "archive") render();
  }
  async function searchArchive() {
    var raw = $("archQ").value.trim(), q = raw.replace(/[^A-Za-z0-9 '-]/g, "").trim(), tight = q.replace(/[\s'-]/g, "").toUpperCase();
    S.arch.q = raw;
    if (tight.length < 3) { toast("Type at least 3 letters or numbers.", true); return; }
    $("archGo").disabled = true;
    var r = await sb.from("bookings").select("id, sheet_id, kind, reg, name, ref, drop_at, return_at, sheets!bookings_sheet_id_fkey(day, kind)")
      .or('reg.ilike."%' + tight + '%",ref.ilike."%' + tight + '%",name.ilike."%' + q + '%"').order("updated_at", { ascending: false }).limit(50);
    if (r.error) { toast(r.error.message, true); $("archGo").disabled = false; return; }
    S.arch.results = r.data.sort(function (a, b) { return ((b.sheets || {}).day || "") < ((a.sheets || {}).day || "") ? -1 : 1; });
    render();
  }
  async function openArchived(sheetId, q) {
    var arch = null;
    if (!S.sheets.some(function (s) { return s.id === sheetId; })) {
      arch = (S.handArchived || []).filter(function (x) { return x.id === sheetId; })[0];
      if (!arch) {
        var r = await sb.from("sheets").select("id, kind, day, imported_at, source").eq("id", sheetId).maybeSingle();
        if (r.error || !r.data) { toast("Couldn't open that day.", true); return; }
        arch = r.data;
      }
    }
    if ($("menu").open) $("menu").close();
    return switchSheet(sheetId, { archive: arch, q: q || "", filter: "all", force: true });
  }
  async function archiveSheet(id, on) {
    var sh = S.sheets.concat(S.handArchived || [], S.archiveSheet ? [S.archiveSheet] : []).filter(function (x) { return x.id === id; })[0];
    if (!sh) return;
    if (on && !confirm("Archive " + sheetLabel(sh) + "? It leaves the list at the top and stays in Archive.")) return;
    if ($("menu").open) $("menu").close();
    var r = await sb.rpc("archive_sheet", { p_sheet: id, p_archive: on });
    if (r.error) { toast(/archive_sheet/.test(r.error.message) ? "Archiving needs database part 8 first." : r.error.message, true); return; }
    S.archiveSheet = null;
    if (S.arch) S.arch.days = null;
    await loadSheets();
    if (on) { S.sheetId = null; pickDefaultSheet(); await loadRows(); S.view = "board"; }
    else { S.sheetId = id; await loadRows(); }
    render(); toast(sheetLabel(sh) + (on ? " archived" : " is back in the list"));
  }
  async function deleteSheet(id) {
    var sh = S.sheets.concat(S.handArchived || [], S.archiveSheet ? [S.archiveSheet] : []).filter(function (x) { return x.id === id; })[0];
    if (!sh) return;
    var cars = sh.id === S.sheetId ? S.rows.length : null;
    if (!confirm("Delete " + sheetLabel(sh) + (cars !== null ? " and its " + cars + " car(s)" : "") + "?\n\nThis can't be undone. It only works if nobody has tapped, set a yard or typed a note on it.")) return;
    if ($("menu").open) $("menu").close();
    var r = await sb.rpc("delete_sheet", { p_sheet: id });
    if (r.error) { toast(/delete_sheet/.test(r.error.message) ? "Deleting needs database part 8 first." : r.error.message, true); return; }
    if (S.archiveSheet && S.archiveSheet.id === id) S.archiveSheet = null;
    if (S.arch) S.arch.days = null;
    await loadSheets();
    S.sheetId = null; pickDefaultSheet(); await loadRows(); S.view = "board";
    render(); toast(sheetLabel(sh) + " deleted");
  }

  // ── settings (owner and manager) ─────────
  // Flight check timings. The database refuses anything not offered here.
  var TIMING_DEFAULT = { enabled: true, live_every_min: 30, schedule_every_hours: 2, active_from: 6, active_to: 24, before_min: 90, after_hours: 5 };
  function timing() { return Object.assign({}, TIMING_DEFAULT, (S.company && S.company.flight_settings) || {}); }
  function hourName(h) { return h === 24 ? "Midnight (end of day)" : pad(h) + ":00"; }
  function renderSettings() {
    if (!can("settings")) return '<div class="msg">Only an owner or manager can change settings.</div>';
    var T = S.settingsDraft || (S.settingsDraft = timing());
    function sel(key, opts, label) {
      return '<label class="field">' + label + '<select data-setting="' + key + '">' + opts.map(function (o) {
        return '<option value="' + o[0] + '"' + (String(T[key]) === String(o[0]) ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("") + "</select></label>";
    }
    // Operations: shorter words, so two boxes fit side by side; a note when there are unsaved changes.
    var o = isOps(), base = timing(), dirty = o && Object.keys(T).some(function (k) { return String(T[k]) !== String(base[k]); });
    var hrs = []; for (var h = 0; h <= 24; h++) hrs.push([h, o && h === 24 ? "Midnight" : hourName(h)]);
    // Operations Refined says it in the Flight checks box itself, beside its Save.
    // Looks with features (Operations Refined aside, which says it in each box): a bar names what isn't saved yet.
    var rf = isRefined(), unsaved = hasFeatures() && !rf ? '<div id="setUnsaved" class="setdirty' + (o ? " ops-unsaved" : "") + '"' + (flightsDirty() ? "" : " hidden") + "><span>Unsaved changes" + (flightsDirty() ? " in Flight checks" : "") + '</span><button type="button" class="btn small" data-savedirty>Save changes</button></div>' : "";
    var flights = setBox("flights", "Flight checks", "Automatic checks " + (String(T.enabled) === "false" ? "off" : "on"), '<div class="box fchecks" style="padding:14px;margin-top:14px;max-width:560px">',
      (o ? '<p class="note">Set when to check live landing times.</p>' : "") +
      sel("enabled", [["true", "On"], ["false", o ? "Off" : "Off: no automatic checks"]], "Automatic checks") +
      (String(T.enabled) === "false" ? "" :
        '<div class="section-label">Live landing times (FlightRadar24)</div>' +
        sel("live_every_min", [[10, "Every 10 minutes"], [15, "Every 15 minutes"], [20, "Every 20 minutes"], [30, "Every 30 minutes"], [45, "Every 45 minutes"], [60, "Every hour"], [90, "Every 90 minutes"], [120, "Every 2 hours"]].map(function (x) { return o ? [x[0], x[1].replace("Every ", "").replace("minutes", "min").replace(/^hour$/, "1 hour")] : x; }), "Check every") +
        '<div class="pair">' + sel("active_from", hrs.slice(0, 24), "From") + sel("active_to", hrs.slice(1), "Until") + "</div>" +
        sel("before_min", o ? [[30, "30 min before"], [60, "1 hour before"], [90, "90 min before"], [120, "2 hours before"], [180, "3 hours before"], [240, "4 hours before"]]
          : [[30, "30 minutes before landing"], [60, "1 hour before"], [90, "90 minutes before"], [120, "2 hours before"], [180, "3 hours before"], [240, "4 hours before"]], o ? "Start watching" : "Start watching a flight") +
        sel("after_hours", [[1, "1 hour after its time"], [2, "2 hours after"], [3, "3 hours after"], [4, "4 hours after"], [5, "5 hours after"], [6, "6 hours after"]].map(function (x) { return o && x[0] === 1 ? [1, "1 hour after"] : x; }), o ? "Stop watching" : "Give up on a flight not seen")) +
      '<div class="row-actions">' + (rf ? '<span class="rf-dirty" role="status">' + (dirty ? "Unsaved changes" : "") + "</span>" : "") + '<button type="button" class="btn ghost" data-resetsettings>' + (o ? "Restore defaults" : "Back to defaults") + '</button><button type="button" class="btn brand" data-savesettings>' + (o ? "Save flight settings" : "Save") + "</button></div>", "fchecks");
    var cap = capacityHtml(), disc = discordHtml(), ptn = ptNumberHtml(), ovr = overstayRateHtml(), ycol = yardColoursHtml(), exit = exitFeeHtml(), bsite = bookingSiteHtml(), txt = textsHtml(), cls = callsHtml(), back = backupHtml();
    if (!opsDesk() && !rf) return unsaved + cap + flights + disc + ptn + ovr + ycol + exit + bsite + txt + cls + back;
    // A wide screen: the same boxes in groups, with a list of them on the left.
    var groups = [["parking", "Parking & yards", cap + ycol, "Parking"], ["flights", "Flight checks", flights, "Flights"], ["charges", "Exit fees & charges", exit + ovr, "Charges"],
      ["alerts", "Alerts & photos", disc + ptn, "Alerts"], ["texts", "Customer texts", txt, "Texts"], ["calls", "Calls", cls, "Calls"], ["bookings", "Booking website", bsite, "Booking website"], ["data", "Backup", back, "Backup"]].filter(function (g) { return g[2]; });
    // Operations Refined on a phone or tablet: the sections as tabs, one open at a time
    // (the others stay on the page, hidden, so nothing typed is lost by switching).
    if (!opsDesk()) {
      var cur = groups.some(function (g) { return g[0] === S.setTab; }) ? S.setTab : groups[0][0];
      return unsaved + '<div class="set-tabs" role="tablist" aria-label="Settings sections">' + groups.map(function (g) {
        return '<button type="button" role="tab" id="settab-' + g[0] + '" data-settab="' + g[0] + '" aria-controls="set-' + g[0] + '" aria-selected="' + (g[0] === cur) + '">' + esc(g[3]) + "</button>";
      }).join("") + "</div>" + groups.map(function (g) {
        return '<section class="set-group" id="set-' + g[0] + '" role="tabpanel" aria-labelledby="settab-' + g[0] + '"' + (g[0] === cur ? "" : " hidden") + ">" + g[2] + "</section>";
      }).join("") +
        // Under the open section, the others in a line each with what they're set to; a tap opens one.
        '<div class="set-more">' + groups.map(function (g) {
          var c = S.company || {}, what = {
            parking: [c.capacity ? c.capacity + " spaces" : "", (c.yards || []).length ? c.yards.length + " yards" : ""],
            flights: ["Automatic checks " + (String(T.enabled) === "false" ? "off" : "on")],
            texts: [textsOn() ? "On" : "Off"],
            calls: [callsOn() ? "On" : "Off"],
            charges: [exitFee() > 0 ? "Exit fee " + money(exitFee()) : "", +c.overstay_rate ? money(c.overstay_rate) + " a day" : ""]
          }[g[0]] || [];
          return '<button type="button" data-settab="' + g[0] + '"' + (g[0] === cur ? " hidden" : "") + "><b>" + esc(g[1]) + "</b><small>" + esc(what.filter(Boolean).join(" · ")) + "</small></button>";
        }).join("") + "</div>";
    }
    return unsaved + '<div class="set-desk"><nav class="set-nav" aria-label="Settings sections">' + groups.map(function (g) { return '<button type="button" data-setgo="' + g[0] + '">' + esc(g[1]) + "</button>"; }).join("") + "</nav>" +
      '<div class="set-body">' + groups.map(function (g) { return '<section class="set-group" id="set-' + g[0] + '" aria-labelledby="set-' + g[0] + '-h"><h2 class="set-gh" id="set-' + g[0] + '-h">' + esc(g[1]) + "</h2>" + g[2] + "</section>"; }).join("") + "</div></div>";
  }
  // A settings box's title; Operations adds what it's set to on the right.
  function boxTitle(t, aside) { return "<strong>" + esc(t) + (isOps() && aside ? "<small>" + esc(aside) + "</small>" : "") + "</strong>"; }
  // A settings section. Looks with features on a phone (not Operations Refined,
  // which has tabs, nor the Operations desktop, which has groups): a header (title,
  // what it's set to) that opens it, one at a time. Those two keep their boxes,
  // marked so unsaved changes are noticed. Other looks: the box exactly as before.
  function setFold() { return hasFeatures() && !opsDesk() && !isRefined(); }
  function setBox(key, title, aside, open0, inner, cls) {
    if (!hasFeatures()) return open0 + boxTitle(title, aside) + inner + "</div>";
    if (!setFold()) return open0.replace('<div class="box', '<div data-sec="' + key + '" data-title="' + esc(title) + '" class="box') + boxTitle(title, aside) + inner + "</div>";
    var open = S.setOpen === key;
    return '<section class="box setsec' + (cls ? " " + cls : "") + (open ? " open" : "") + '" data-sec="' + key + '" data-title="' + esc(title) + '">' +
      '<button type="button" class="sethead" data-setsec="' + key + '" aria-expanded="' + open + '"><b>' + esc(title) + "</b><small>" + esc(aside || "") + "</small></button>" +
      '<div class="setbody"' + (open ? "" : " hidden") + ">" + inner + "</div></section>";
  }
  // Unsaved changes: the flight checks draft, or a field typed in and not saved.
  function flightsDirty() { var T = S.settingsDraft, base = timing(); return !!T && Object.keys(T).some(function (k) { return String(T[k]) !== String(base[k]); }); }
  function setFields(sec) { return Array.prototype.slice.call(sec.querySelectorAll("input:not([type=file]):not([type=checkbox]):not([data-nodirty]),textarea")); }
  function fieldEdited(el) {
    if (el.dataset.ycol !== undefined) return el.hasAttribute("data-off") !== el.hasAttribute("data-offdef") || (!el.hasAttribute("data-off") && el.value.toLowerCase() !== el.defaultValue.toLowerCase());
    return el.value !== el.defaultValue;
  }
  function secDirty(sec) { return sec.dataset.sec === "flights" ? flightsDirty() : setFields(sec).some(fieldEdited); }
  function dirtySecs() {
    if (S.view !== "settings" || !hasFeatures()) return [];
    return Array.prototype.filter.call(document.querySelectorAll("#main [data-sec]"), secDirty);
  }
  // Back to what's saved: the fields as they were drawn.
  function discardSec(sec) {
    if (sec.dataset.sec === "flights") S.settingsDraft = null;
    setFields(sec).forEach(function (el) { el.value = el.defaultValue; if (el.dataset.ycol !== undefined) el.toggleAttribute("data-off", el.hasAttribute("data-offdef")); });
  }
  // Saved: the section's fields (on the page now; it may have been redrawn while saving) start again from what's saved.
  function savedSec(btn) { var s0 = btn.closest("[data-sec]"), sec = s0 && document.querySelector('#main [data-sec="' + s0.dataset.sec + '"]'); if (sec) discardSec(sec); }
  function showUnsaved() {
    var bar = $("setUnsaved"); if (!bar) return;
    var d = dirtySecs();
    bar.hidden = !d.length;
    if (d.length) bar.firstChild.textContent = "Unsaved changes in " + d.map(function (s) { return s.dataset.title; }).join(", ");
  }
  // Leaving Settings (or closing a section) with something not saved asks first.
  function leaveOk(secs) {
    var d = secs || dirtySecs();
    return !d.length || confirm("Unsaved changes in " + d.map(function (s) { return s.dataset.title; }).join(", ") + ". Leave without saving?");
  }
  function toggleSec(key) {
    var cur = S.setOpen && document.querySelector('#main [data-sec="' + S.setOpen + '"]');
    if (cur && secDirty(cur)) { if (!leaveOk([cur])) return; discardSec(cur); }
    S.setOpen = S.setOpen === key ? null : key; render();
    var h = document.querySelector('#main [data-setsec="' + key + '"]'); if (h && h.getBoundingClientRect().top < 0) h.scrollIntoView();
  }
  // A redraw while a field is being typed in (a live update) keeps what was typed.
  function setEdits() {
    var out = [];
    document.querySelectorAll("#main [data-sec]").forEach(function (sec) {
      setFields(sec).forEach(function (el, i) { if (fieldEdited(el)) out.push({ sec: sec.dataset.sec, i: i, def: el.defaultValue, val: el.value, off: el.hasAttribute("data-off") }); });
    });
    return out;
  }
  function settingsDrawn(keep) {
    (keep || []).forEach(function (k) {
      var sec = document.querySelector('#main [data-sec="' + k.sec + '"]'), el = sec && setFields(sec)[k.i];
      if (!el || el.defaultValue !== k.def) return;
      el.value = k.val;
      if (el.dataset.ycol !== undefined) { if (k.off) yardOff(el); else el.dispatchEvent(new Event("input", { bubbles: true })); }
    });
    showUnsaved();
  }
  // Car park capacity (database part 71): how many cars fit, in all and per
  // yard. The dashboard shows Parked now against it.
  function capacityHtml() {
    var C = S.company || {}, cap = +C.capacity || 0, yc = C.yard_capacity || {}, ys = C.yards || [];
    return setBox("cap", "Car park capacity", cap ? cap + " spaces" : "Not set", '<div class="box" style="padding:14px;max-width:560px">',
      '<p class="note">How many cars you can park. Now: <b>' + (cap ? cap + " cars" : "not set") + "</b>.</p>" +
      '<label class="field">Total spaces<input id="capTotal" type="number" inputmode="numeric" min="0" step="1" placeholder="e.g. 400" value="' + (cap || "") + '"></label>' +
      (ys.length ? '<div class="section-label">Per yard (optional)</div><div class="capyards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:0 10px">' + ys.map(function (y) {
        return '<label class="field">' + esc(YARD_LABEL[y] || y) + '<input data-capyard="' + esc(y) + '" type="number" inputmode="numeric" min="0" step="1" value="' + (+yc[y] || "") + '"></label>';
      }).join("") + "</div>" : "") +
      '<div class="row-actions"><button type="button" class="btn brand" data-savecap>Save capacity</button></div>');
  }
  async function saveCapacity(btn) {
    var yards = {}, bad = "";
    document.querySelectorAll("[data-capyard]").forEach(function (i) { var v = i.value.trim(); if (v && !/^\d+$/.test(v)) bad = i.dataset.capyard; yards[i.dataset.capyard] = v; });
    var t = $("capTotal").value.trim();
    if (bad || (t && !/^\d+$/.test(t))) return toast("Enter whole numbers of spaces.", true);
    btn.disabled = true;
    var r = await sb.rpc("set_capacity", { p_total: t ? +t : null, p_yards: yards });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.capacity = r.data.capacity; S.company.yard_capacity = r.data.yard_capacity || {}; S.dash = null;
    toast(r.data.capacity ? "Saved: " + r.data.capacity + " spaces" : "Capacity cleared"); render();
  }
  // Operations dashboard panels fold open and closed; each person's choice is kept on their phone.
  function foldIsOpen(id) { try { var m = JSON.parse(localStorage.getItem("takeoff_dash_fold") || "{}"); return m[id] !== false; } catch (e) { return true; } }
  function foldSave(id, open) { try { var m = JSON.parse(localStorage.getItem("takeoff_dash_fold") || "{}"); m[id] = !!open; localStorage.setItem("takeoff_dash_fold", JSON.stringify(m)); } catch (e) {} }
  function foldOpen(id, title, note, summary, attrs, cls) {
    return '<details class="ops-panel ops-fold' + (cls ? " " + cls : "") + '" data-fold="' + id + '"' + (attrs ? " " + attrs : "") + (foldIsOpen(id) ? " open" : "") + '><summary class="ops-panelhead"><span class="ops-foldtitle"><strong>' + title + "</strong>" + (note ? "<small>" + note + "</small>" : "") + '</span><span class="ops-foldsum">' + summary + '</span><i class="ops-chev" aria-hidden="true"></i></summary><div class="ops-foldbody">';
  }
  var FOLD_END = "</div></details>";
  document.addEventListener("toggle", function (e) { var d = e.target; if (d && d.dataset && d.dataset.fold) foldSave(d.dataset.fold, d.open); }, true);
  // Cars on site per day (database part 82): counted by the app from its own cars, against capacity.
  function onsiteSummary(D) {
    var r = (D.onsite || [])[0], cap = +S.company.capacity || 0;
    return r ? "Tonight " + r.here + (cap ? " of " + cap : "") : "";
  }
  function bookedBody(D, PK) {
    var rows = (D.onsite || []).slice(0, 14), cap = +S.company.capacity || 0, today = currentShiftKey();
    var k0 = function (k) { return k === today ? "Today" : k === addDaysKey(today, 1) ? "Tomorrow" : longDay(k); };
    if (!rows.length) return '<div class="empty">No cars yet.</div>';
    var max = Math.max.apply(null, rows.map(function (r) { return +r.here || 0; }).concat([cap, 1])), peak = rows[0];
    rows.forEach(function (r) { if (r.here > peak.here) peak = r; });
    var h = '<div class="booked-top"><span>Busiest: <b>' + esc(k0(peak.day)) + "</b> " + peak.here + (cap ? " of " + cap : "") + "</span><span>Cars staying the night</span></div>";
    h += '<div class="booked-rows">' + rows.map(function (r) {
      var n = +r.here || 0, pct = Math.round(n / max * 100), lvl = !cap ? "" : n > cap ? " over" : n >= cap * 0.9 ? " near" : "";
      var note = cap ? (n > cap ? (n - cap) + " over" : (cap - n) + " free") : "";
      return '<div class="booked-row' + lvl + '"><span class="booked-day">' + esc(k0(r.day)) + '</span><span class="booked-bar" role="img" aria-label="' + n + (cap ? " of " + cap : "") + '"><i style="width:' + pct + '%"></i>' + (cap && cap < max ? '<u style="left:' + Math.round(cap / max * 100) + '%"></u>' : "") + '</span><strong class="num">' + n + "</strong><small>" + note + '</small><em class="booked-flow">+' + (+r.in || 0) + " in · " + (+r.out || 0) + " out</em></div>";
    }).join("") + "</div>";
    return h + '<p class="note">Counted from the bookings in the app. Later days fill in as their bookings are imported.</p>';
  }
  function overstayRateHtml() {
    var rate = +(S.company && S.company.overstay_rate) || 0;
    return setBox("overstay", "Overstay charges", rate ? money(rate) + " a day" : "Off", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<p class="note">Booked back before ' + esc(((S.company.drops_day_end) || "06:00").slice(0, 5)) + ": free until 12:00 that day, then one day's rate and one more every midnight. Booked back later: free until " + esc(((S.company.drops_day_end) || "06:00").slice(0, 5)) + " the next morning, then one day's rate and one more every morning at that time. 0 switches charging off." + (rate ? " Now: <b>" + money(rate) + " a day</b>." : " Now: <b>off</b>.") + "</p>" +
      '<label class="field">Daily rate (£)<input id="ovRate" type="number" inputmode="decimal" min="0" step="0.5" value="' + rate + '"></label>' +
      '<div class="row-actions"><button type="button" class="btn brand" data-saverate>Save rate</button></div>');
  }
  // Yard colours (database part 77): owners only.
  function yardColoursHtml() {
    var ys = (S.company && S.company.yards) || [];
    if (!S.me || S.me.role !== "owner" || !ys.length) return "";
    var set = ys.filter(function (y) { return yardColour(y); }).length;
    return setBox("ycol", "Yard colours", set ? set + " of " + ys.length + " set" : "Not set", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<div class="ycols">' + ys.map(function (y) {
        var c = yardColour(y);
        return '<div class="ycol"><span class="code ' + esc(y) + '">' + esc(YARD_LABEL[y] || y) + '</span><input type="color" data-ycol="' + esc(y) + '" aria-label="Colour for ' + esc(YARD_LABEL[y] || y) + '" value="' + (c || "#9AA0A6") + '"' + (c ? "" : " data-off" + (hasFeatures() ? " data-offdef" : "")) + '>' +
          (c ? '<button type="button" class="link" data-ycoff="' + esc(y) + '">No colour</button>' : '<span class="note">Not set</span>') + "</div>";
      }).join("") + "</div>" +
      '<div class="row-actions"><button type="button" class="btn brand" data-saveycol>Save colours</button></div>');
  }
  // "No colour": the yard's tag goes back to the look's own.
  function yardOff(yi) {
    yi.setAttribute("data-off", "");
    var yt = yi.parentNode.querySelector(".code"); if (yt) yt.removeAttribute("style");
    var b = yi.parentNode.querySelector("[data-ycoff]"); if (b) b.outerHTML = '<span class="note">Not set</span>';
  }
  async function saveYardColours(btn) {
    var cols = {};
    document.querySelectorAll("[data-ycol]").forEach(function (i) { cols[i.dataset.ycol] = i.hasAttribute("data-off") ? "" : i.value; });
    btn.disabled = true;
    var r = await sb.rpc("set_yard_colours", { p_colours: cols });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.yard_colours = r.data.yard_colours || {}; applyYardColours(S.company);
    toast("Saved: yard colours"); render();
  }
  // Exit fee (database part 76): owners only.
  function exitFeeHtml() {
    if (!S.me || S.me.role !== "owner") return "";
    var fee = exitFee(), free = S.company.exit_free || [];
    return setBox("exit", "Exit fee", fee ? money(fee) : "Off", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<label class="field">Exit fee (£)<input id="exitFee" type="number" inputmode="decimal" min="0" max="999" step="0.01" placeholder="0 = off" value="' + (fee || "") + '"></label>' +
      '<label class="field">No exit fee for references starting with<input id="exitFree" autocomplete="off" autocapitalize="characters" placeholder="e.g. CAP, APD, VIP APB-1147" value="' + esc(free.join(", ")) + '"></label>' +
      '<p class="note">Agent codes or whole references, separated by commas.</p>' +
      '<div class="row-actions"><button type="button" class="btn brand" data-saveexit>Save exit fee</button></div>');
  }
  async function saveExitFee(btn) {
    var fee = $("exitFee").value.trim(), free = $("exitFree").value.split(/[,\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (fee && !(+fee >= 0)) return toast("Check the exit fee.", true);
    btn.disabled = true;
    var r = await sb.rpc("set_exit_fee", { p_fee: +fee || 0, p_free: free });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.exit_fee = r.data.exit_fee; S.company.exit_free = r.data.exit_free || [];
    toast(+r.data.exit_fee ? "Saved: exit fee " + money(r.data.exit_fee) : "Exit fee off"); render();
  }
  async function saveOverstayRate(btn) {
    btn.disabled = true;
    var r = await sb.rpc("set_overstay_rate", { p_rate: parseFloat($("ovRate").value) || 0 });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.overstay_rate = r.data; toast(r.data ? "Saved: " + money(r.data) + " a day" : "Overstay charges off"); render();
  }
  // Owner only: the company's own data, to keep a copy outside the app.
  function backupHtml() {
    if (!S.me || S.me.role !== "owner") return "";
    return setBox("backup", "Backup", "Download a copy", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<p class="note">A copy of everything is kept automatically every night for 7 days. To keep one of your own as well, download it and save it somewhere safe, like OneDrive. PINs, links and Discord links are not included.</p>' +
      '<div class="row-actions"><button type="button" class="btn ghost" data-backup>Download a backup</button></div>');
  }
  // Booking website (database part 101): owners only. The address and login the automatic
  // import signs in with; the password is never sent back, only whether one is saved.
  function bookingSiteHtml() {
    if (!S.me || S.me.role !== "owner") return "";
    if (S.bsite === undefined) { S.bsite = null; sb.rpc("booking_site_status").then(function (r) { S.bsite = r.error ? false : r.data; if (S.view === "settings") render(); }); }
    if (S.bsite === false) return "";
    var B = S.bsite || {}, set = !!(B.login && B.has_pass);
    return setBox("bsite", "Booking website", !S.bsite ? "" : set ? "Saved" : "Not set", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<label class="field">Website address<input id="bsUrl" type="url" autocomplete="off" placeholder="https://" value="' + esc(B.url || "") + '"></label>' +
      '<label class="field">Login name<input id="bsLogin" autocomplete="off" autocapitalize="none" spellcheck="false" value="' + esc(B.login || "") + '"></label>' +
      '<label class="field">Password <span class="note">' + (S.bsite ? (B.has_pass ? "✓ saved" : "not set") : "…") + '</span><input id="bsPass" type="password" autocomplete="new-password" placeholder="' + (B.has_pass ? "Type a new one to replace it" : "") + '"></label>' +
      (set && B.saved_at ? '<p class="note">Saved by ' + esc(B.saved_by) + " " + esc(dayShort(B.saved_at)) + " " + esc(hhmm(B.saved_at)) + ".</p>" : "") +
      '<div class="row-actions">' + (set ? '<button type="button" class="btn ghost small" data-bsclear>Remove login</button>' : "") + '<button type="button" class="btn brand" data-bssave>Save login</button></div>');
  }
  async function saveBookingSite(btn, clear) {
    var u = clear ? "" : $("bsUrl").value.trim(), l = clear ? "" : $("bsLogin").value.trim(), p = clear ? "" : ($("bsPass").value || null);
    btn.disabled = true;
    var r = await sb.rpc("booking_site_set", { p_url: u, p_login: l, p_password: p });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.bsite = r.data; toast(clear ? "Booking website login removed" : "Saved: booking website login"); render();
  }
  async function downloadBackup(btn) {
    btn.disabled = true;
    var r = await sb.rpc("download_my_company");
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    var blob = new Blob([JSON.stringify(r.data)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (S.company.slug || "company") + "-backup-" + londonParts(new Date()).key + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    S.lastDownload = new Date().toISOString(); if (S.view === "board") render();
    toast("Backup downloaded: " + (r.data.bookings || []).length + " cars. Save it somewhere safe, like OneDrive.");
  }
  function ptNumberHtml() {
    var n = (S.company && S.company.pt_whatsapp) || "";
    return setBox("pt", "PT photos: WhatsApp number", n ? "+" + n : "Not set", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<p class="note">PT opens this chat with the reg typed, before the photos are sent.' + (n ? " Now: <b>+" + esc(n) + "</b>" : " Not set.") + "</p>" +
      '<label class="field">Number<input id="ptNumber" type="tel" autocomplete="off" placeholder="07932 029349 or +44 7932 029349" value="' + esc(n ? "+" + n : "") + '"></label>' +
      '<div class="row-actions"><button type="button" class="btn brand" data-savept>Save number</button></div>' +
      '<label class="field" style="margin-top:14px">How PT gets the photos<select data-ptmethod>' +
      '<option value="photos"' + (S.company.pt_method !== "link" && S.company.pt_method !== "pdf" ? " selected" : "") + ">In the WhatsApp chat: reg, then the photos (10 at a time on Android)</option>" +
      '<option value="pdf"' + (S.company.pt_method === "pdf" ? " selected" : "") + ">As one PDF with all the photos (one tap)</option>" +
      '<option value="link"' + (S.company.pt_method === "link" ? " selected" : "") + ">As one link to all the photos (only once PT has agreed)</option></select></label>" +
      ptIosSelect(S.company.pt_method_ios || S.company.pt_method));
  }
  // iPhones have their own choice (part 49); the one above is for every other phone.
  function ptIosSelect(now) {
    function o(v, t) { return '<option value="' + v + '"' + (now === v || (v === "photos" && now !== "pdf" && now !== "link") ? " selected" : "") + ">" + t + "</option>"; }
    return '<label class="field" style="margin-top:14px">How PT gets the photos on iPhones<select data-ptmethod="ios">' +
      o("photos", "In the WhatsApp chat: reg, then the photos") + o("pdf", "As one PDF with all the photos (one tap)") +
      o("link", "As one link to all the photos (only once PT has agreed)") + "</select></label>";
  }
  async function savePtMethod(sel) {
    var ios = sel.dataset.ptmethod === "ios";
    var r = await sb.rpc(ios ? "set_pt_method_ios" : "set_pt_method", { p_method: sel.value });
    if (r.error) { toast(r.error.message, true); return render(); }
    S.company[ios ? "pt_method_ios" : "pt_method"] = r.data;
    toast((ios ? "iPhones: " : "") + (r.data === "link" ? "PT photos now go as a link" : r.data === "pdf" ? "PT photos now go as one PDF" : "PT photos now go in the WhatsApp chat"));
  }
  async function savePtNumber(btn) {
    btn.disabled = true;
    var r = await sb.rpc("set_pt_whatsapp", { p_number: $("ptNumber").value });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.pt_whatsapp = r.data || "";
    toast(r.data ? "Saved: +" + r.data : "Number removed"); render();
  }
  // Discord links work like passwords for the channel, so the app never shows
  // them back: it only knows whether each one is set.
  function discordHtml() {
    if (S.discord === undefined) { S.discord = null; sb.rpc("discord_status").then(function (r) { S.discord = r.error ? false : r.data; if (S.view === "settings") render(); }); }
    if (S.discord === false) return "";
    var D = S.discord || {};
    function field(key, label) {
      return '<label class="field">' + label + ' <span class="note">' + (S.discord ? (D[key] ? "✓ set" : "not set") : "…") + '</span><input data-discord="' + key + '" type="url" autocomplete="off" placeholder="' + (D[key] ? "Paste a new link to replace it" : "https://discord.com/api/webhooks/…") + '"></label>';
    }
    return setBox("discord", "Discord alerts", !S.discord ? "" : D.drops || D.picks ? [D.drops && "Drops", D.picks && "Picks"].filter(Boolean).join(" and ") + " set" : "Not set", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      field("drops", "DROPS channel") + field("picks", "PICKS channel") +
      '<div class="row-actions">' + (D.drops || D.picks ? '<button type="button" class="btn ghost small" data-discordtest>Send a test to Discord</button><button type="button" class="btn ghost small" data-discordclear>Remove both</button>' : "") +
      '<button type="button" class="btn brand" data-discordsave>Save links</button></div>');
  }
  async function saveDiscord(btn, clear) {
    var d = clear ? "" : (document.querySelector('[data-discord="drops"]').value.trim() || null);
    var p = clear ? "" : (document.querySelector('[data-discord="picks"]').value.trim() || null);
    if (!clear && d === null && p === null) { toast("Paste a Discord link first.", true); return; }
    btn.disabled = true;
    var r = await sb.rpc("set_discord", { p_drops: d, p_picks: p });
    btn.disabled = false;
    if (r.error) { toast(r.error.message, true); return; }
    savedSec(btn); S.discord = r.data; toast(clear ? "Discord links removed" : "Saved"); render();
  }
  async function saveSettings(btn) {
    var T = S.settingsDraft; btn.disabled = true;
    var body = { enabled: String(T.enabled) !== "false" };
    ["live_every_min", "schedule_every_hours", "active_from", "active_to", "before_min", "after_hours"].forEach(function (k) { body[k] = Number(T[k]); });
    var r = await sb.rpc("set_flight_settings", { p: body });
    btn.disabled = false;
    if (r.error) { toast(r.error.message, true); return; }
    S.company.flight_settings = r.data; S.settingsDraft = null;
    toast("Saved. The next automatic check uses the new times.");
    render();
  }

  // ── phone notifications ───────────────────
  // Web push: Android in Chrome, iPhone only when the app is opened from the
  // Home Screen (iOS 16.4+). This public key pairs with VAPID_PRIVATE_KEY, a
  // secret held only by the send-alerts Edge Function.
  var VAPID_PUBLIC_KEY = "BIUvnDQXjj4nWd2EIx7kLAGTTWamJ0oM1V806Ubh7HeiUJfaZWRxwvlUrP7pZTVULpFOYBbWrKtmSC1AmdNtnWw";
  var ALERT_KINDS = [["drops", "DROPS: CALLED, AT DESK, OVERSTAY, 20 min waits and COMPLAINT"], ["picks", "PICKS: RTC"], ["flights", "Flight cancelled"]];
  function pushSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  function iosOutsideHomeScreen() { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator.standalone === true || matchMedia("(display-mode: standalone)").matches); }
  function keyBytes(k) { var raw = atob((k + "=".repeat((4 - k.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, function (c) { return c.charCodeAt(0); }); }
  async function currentSubscription() {
    if (!pushSupported()) return null;
    var reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? reg.pushManager.getSubscription() : null;
  }
  // S.notify: null until loaded; {ready:false} when part 4 hasn't been run yet.
  async function loadNotify() {
    var prefs = await sb.from("alert_prefs").select("*").maybeSingle();
    var sub = null; try { sub = await currentSubscription(); } catch (e) {}
    S.notify = { ready: !prefs.error, prefs: prefs.data || {}, on: !!sub && pushSupported() && Notification.permission === "granted" };
    if (S.view === "me") render();
  }
  function notifyHtml() {
    var N = S.notify;
    if (!N) { loadNotify(); return '<div class="box" style="padding:14px;margin-top:14px"><strong>Phone notifications</strong><p class="note">Checking…</p></div>'; }
    if (!N.ready) return "";
    var text, canOn = false;
    if (iosOutsideHomeScreen()) text = "On iPhone, add " + brandName() + " to your Home Screen (Share, then Add to Home Screen) and open it from there to get notifications.";
    else if (!pushSupported()) text = "This browser can't show notifications. On Android use Chrome; on iPhone open " + brandName() + " from your Home Screen.";
    else if (Notification.permission === "denied") text = "Notifications are blocked for " + brandName() + ". Allow them in your phone's settings, then come back here.";
    else if (N.on) text = "On for this phone.";
    else { text = "Off for this phone."; canOn = true; }
    return '<div class="box" style="padding:14px;margin-top:14px;max-width:560px"><strong>Phone notifications</strong><p class="note" style="margin:4px 0 10px">' + esc(text) + "</p>" +
      (N.on ? ALERT_KINDS.map(function (k) {
        return '<label class="check"><input type="checkbox" data-alertpref="' + k[0] + '"' + (N.prefs[k[0]] === false ? "" : " checked") + "> " + esc(k[1]) + "</label>";
      }).join("") : "") +
      '<div class="row-actions">' + (canOn ? '<button type="button" class="btn brand" data-notifyon>Turn on notifications</button>' : "") +
      (N.on ? '<button type="button" class="btn ghost small" data-notifytest>Send me a test</button><button type="button" class="btn ghost small" data-notifyoff>Turn off</button>' : "") + "</div></div>";
  }
  async function turnOnNotifications(btn) {
    btn.disabled = true;
    try {
      // Keep this the first await: iPhones only show the prompt straight after a tap.
      var permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications are blocked. Allow them for " + brandName() + " in your phone's settings." : "Notifications weren't allowed.");
      var reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      var sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
      var j = sub.toJSON();
      var r = await sb.rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
      if (r.error) throw r.error;
      toast("Notifications are on for this phone");
    } catch (err) { toast(err.message || String(err), true); }
    S.notify = null; render();
  }
  // Also runs quietly on sign-out, so a shared phone stops getting the last person's alerts.
  async function turnOffNotifications(quiet) {
    try {
      var sub = await currentSubscription();
      if (sub) { if (S.me) await sb.rpc("remove_push_subscription", { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
      if (!quiet) toast("Notifications are off for this phone");
    } catch (err) { if (!quiet) toast(err.message || String(err), true); }
    S.notify = null; if (!quiet) render();
  }
  async function sendTest(btn, discord) {
    btn.disabled = true;
    try {
      var r = await callFunction("send-alerts", { type: "test", discord: !!discord }, true);
      if (discord) toast("Discord: DROPS " + (r.drops ? "sent" : "not set or failed") + " · PICKS " + (r.picks ? "sent" : "not set or failed"), !(r.drops || r.picks));
      else toast(r.sent ? "Test sent. It should arrive in a few seconds." : "Nothing sent: notifications aren't on for this phone.", !r.sent);
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; }
  }

  // ── me ────────────────────────────────────
  // One switch for the company's Discord channel; the links stay saved.
  function discordSwitchHtml() {
    if (!can("settings")) return "";
    if (S.discord === undefined) { S.discord = null; sb.rpc("discord_status").then(function (r) { S.discord = r.error ? false : r.data; if (S.view === "me") render(); }); }
    var D = S.discord;
    if (D === false) return "";
    var head = '<div class="box" style="padding:14px;margin-top:14px"><strong>Discord alerts</strong>';
    if (!D) return head + '<p class="note">Checking…</p></div>';
    if (!D.drops && !D.picks) return head + '<p class="note">Not set up. Add the channel links in Settings.</p></div>';
    var where = [D.drops ? "DROPS" : "", D.picks ? "PICKS" : ""].filter(Boolean).join(" and ");
    return head + '<p class="note">' + (D.paused ? "Off for everyone. The links are kept." : "On. Posting " + where + " alerts to Discord for the whole team.") + "</p>" +
      '<div class="row-actions">' + (D.paused ? '<button type="button" class="btn brand" data-discordpause="0">Turn on Discord alerts</button>'
        : '<button type="button" class="btn ghost" data-discordpause="1">Turn off Discord alerts</button><button type="button" class="btn ghost small" data-discordtest>Send a test</button>') + "</div></div>";
  }
  async function setDiscordPaused(btn, paused) {
    if (paused && !confirm("Turn off Discord alerts for the whole team? Phone notifications carry on.")) return;
    btn.disabled = true;
    var r = await sb.rpc("set_discord_paused", { p_paused: paused });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    S.discord = r.data; toast(paused ? "Discord alerts off" : "Discord alerts on"); render();
  }
  async function changePin() {
    var old = $("pinOld").value, a = $("pinNew").value, b = $("pinNew2").value;
    if (!/^\d{4}$/.test(old)) return toast("Enter your current 4-number PIN.", true);
    if (!/^\d{4}$/.test(a)) return toast("The new PIN must be 4 numbers.", true);
    if (a !== b) return toast("The two new PINs don't match.", true);
    if (a === old) return toast("That's the PIN you have now.", true);
    $("pinGo2").disabled = true;
    var r = await sb.rpc("change_my_pin", { p_current: old, p_new: a });
    $("pinGo2").disabled = false;
    if (r.error) return toast(r.error.message, true);
    var st = r.data && r.data.status;
    if (st === "bad_pin") { $("pinOld").value = ""; return toast("Current PIN is wrong. " + r.data.left + " tries left before a 15-minute lock.", true); }
    if (st === "locked") return toast("Too many wrong PINs. Try again after " + hhmm(r.data.until) + ".", true);
    ["pinOld", "pinNew", "pinNew2"].forEach(function (id) { $(id).value = ""; });
    toast("PIN changed. Use the new one next time you sign in.");
  }
  // Me → Copy my link: this phone's own personal link (the PIN is never kept).
  function myLinkHtml() {
    var t = storedLink(); if (!t) return "";
    var link = location.origin + "/#t=" + t;
    return '<div class="box pinbox mylink"><strong>My link</strong><p class="note">Private: with your PIN it opens the app as you.</p>' +
      '<button type="button" class="btn ghost" data-copy="' + esc(link) + '">Copy my link</button></div>';
  }
  function renderMe() {
    if (opsDesk() && !S.platform) {
      // A wide screen: you and your alerts, your PIN, and the tutorials side by side.
      var tuts = myTutorials();
      return '<h2 class="title">' + esc(S.me.name) + '</h2><p class="note">' + esc(ROLE_LABEL[S.me.role] || S.me.role) + " · " + esc(S.company.name) + "</p>" +
        '<div class="me-desk"><div class="me-col">' + notifyHtml() + discordSwitchHtml() + myLinkHtml() + "</div>" +
        '<div class="me-col">' + pinFormHtml() + "</div>" +
        '<div class="me-col">' + opsPanel("Tutorials", tuts.length + (tuts.length === 1 ? " video" : " videos"), '<div class="me-tuts">' + tuts.map(function (x) {
          return '<button type="button" data-tutorial="' + x[0] + '"><span>' + esc(x[1]) + '<small class="num">' + x[2] + "</small></span><b>Play</b></button>";
        }).join("") + "</div>") + "</div></div>";
    }
    return '<h2 class="title">' + esc(S.me.name) + '</h2><p class="note">' + esc(ROLE_LABEL[S.me.role] || S.me.role) + " · " + esc(S.company.name) + "</p>" +
      (S.platform ? "" : notifyHtml() + discordSwitchHtml()) +
      myLinkHtml() + pinFormHtml();
  }
  function pinFormHtml() {
    return '<form class="box pinbox" id="pinChange" novalidate><strong>Change my PIN</strong><p class="note">Your link stays the same.</p>' +
      '<label>Current PIN<input id="pinOld" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password"></label>' +
      '<label>New PIN<input id="pinNew" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></label>' +
      '<label>New PIN again<input id="pinNew2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></label>' +
      '<button class="btn brand" id="pinGo2">Change PIN</button></form>' +
      '<div class="row-actions"><button type="button" class="btn ghost" data-signout>Sign out</button><button type="button" class="btn ghost" data-forget>Sign out and remove my link</button></div>';
  }

  // Physical yard positions are shared, confirmed online, and independent of a shift.
  // An add-on: only clients given it on the platform page (Clients → Edit, brand.lane_planner).
  function lanePlanner() { return !!(S.company && S.company.brand && S.company.brand.lane_planner); }
  var LP = { data: null, loading: false, error: '', selected: '', query: '', yard: '', busy: false, seq: 0 };
  function laneById(id) { return LP.data && LP.data.lanes.filter(function (x) { return x.id === id; })[0]; }
  function laneCar(id) { return LP.data && LP.data.cars.filter(function (x) { return x.id === id; })[0]; }
  function lanePosition(id) { return LP.data && LP.data.positions.filter(function (x) { return x.booking_id === id; })[0]; }
  function laneOccupants(id) { return LP.data.positions.filter(function (x) { return x.lane_id === id; }).sort(function (a,b) { return a.position-b.position; }); }
  function laneBlockers(p) {
    var l = p && laneById(p.lane_id); if (!l || l.access === 'open') return [];
    var all = laneOccupants(l.id), front = all.filter(function (x) { return x.position < p.position; });
    if (l.access !== 'both') return front;
    var rear = all.filter(function (x) { return x.position > p.position; }).reverse();
    return rear.length < front.length ? rear : front;
  }
  function laneReachable(l, pos) {
    var all = laneOccupants(l.id);
    if (all.some(function (x) { return x.position === pos; })) return false;
    return l.access === 'open' || !all.some(function (x) { return x.position < pos; }) ||
      l.access === 'both' && !all.some(function (x) { return x.position > pos; });
  }
  function laneRisk(p) {
    var c = laneCar(p.booking_id), due = c && Date.parse(c.return_at);
    if (!due) return false;
    return laneBlockers(p).some(function (x) { var b = laneCar(x.booking_id); return !b || !b.return_at || Date.parse(b.return_at) > due; });
  }
  function laneMatch(c) { var q = LP.query.replace(/\s/g,'').toUpperCase(); return !q || ((c.reg || '') + (c.ref || '')).replace(/\s/g,'').toUpperCase().indexOf(q) !== -1; }
  function laneYard(y) { return YARD_LABEL[y] || y; }
  function laneWhen(c) { return c.return_at ? dayShort(c.return_at) + ' ' + hhmm(c.return_at) : 'Return time unknown'; }
  function laneSuggestion(c) {
    // Conservative first version: one-ended lanes only, compatible return order.
    // Load late returns deepest first. Unknown returns never get a parking promise.
    if (!c || !c.return_at) return null;
    var current = lanePosition(c.id), choices = [];
    LP.data.lanes.forEach(function (l) {
      if (l.kind !== 'lane' || l.access !== 'front' || current && current.lane_id === l.id || (c.yard && c.yard !== l.yard)) return;
      var all = laneOccupants(l.id);
      if (all.some(function (p) { var b = laneCar(p.booking_id); return !b || !b.return_at || Date.parse(b.return_at) < Date.parse(c.return_at); })) return;
      for (var i = l.capacity; i >= 1; i--) if (laneReachable(l,i)) {
        var same = all.some(function (p) { var b = laneCar(p.booking_id); return b && b.return_at && londonParts(new Date(b.return_at)).key === londonParts(new Date(c.return_at)).key; });
        choices.push({ lane: l, position: i, rank: (same ? 1000 : 0) + all.length }); break;
      }
    });
    choices.sort(function (a,b) { return b.rank-a.rank || a.lane.name.localeCompare(b.lane.name); }); return choices[0] || null;
  }
  async function loadLanes() {
    if (!S.me || S.platform || !lanePlanner() || LP.loading || LP.busy) return;
    var seq = ++LP.seq, company = S.company.id; LP.loading = true; LP.error = '';
    try {
      var r = await sb.rpc('lane_get');
      if (seq !== LP.seq || !S.company || S.company.id !== company) return;
      if (r.error) LP.error = /lane_get|PGRST202/.test(r.error.message || '') ? 'Lane planner needs database part 104.' : /not switched on/.test(r.error.message || '') ? 'The yard planner is not switched on for your company.' : r.error.message;
      else LP.data = r.data;
    } catch (e) { if (seq === LP.seq) LP.error = 'Could not load the yard. Check your connection.'; }
    finally { if (seq === LP.seq) { LP.loading = false; if (S.view === 'lanes') render(); } }
  }
  function laneChanged() { if (S.view === 'lanes' && !LP.busy && !document.querySelector('.lp-form:focus-within')) loadLanes(); }
  function resetLanes() { LP.seq++; LP.data = null; LP.loading = false; LP.error = ''; LP.selected = ''; LP.query = ''; LP.yard = ''; LP.busy = false; }
  function laneSelectButton(c, extra) { return '<button type="button" class="lp-car' + (LP.selected === c.id ? ' selected' : '') + '" data-lpcar="' + esc(c.id) + '"><b>' + esc(c.reg || 'No registration') + '</b><span>' + esc(laneWhen(c)) + '</span>' + (extra || '') + '</button>'; }
  function renderLanes() {
    if (!LP.data && !LP.loading && !LP.error) loadLanes();
    if (!LP.data) return '<div class="msg">' + esc(LP.error || 'Loading the yard…') + (LP.error ? '<p><button type="button" class="btn" data-lpreload>Try again</button></p>' : '') + '</div>';
    var d = LP.data, selected = laneCar(LP.selected), visible = d.lanes.filter(function (l) { return !LP.yard || l.yard === LP.yard; });
    var active = d.positions.filter(function (p) { var l = laneById(p.lane_id); return l && (!LP.yard || l.yard === LP.yard); });
    var risks = active.filter(laneRisk), unlocated = d.cars.filter(function (c) { return !lanePosition(c.id); });
    var h = '<section class="lp"><div class="lp-toolbar"><div><p>' + active.length + ' positioned · ' + risks.length + ' return conflicts · ' + unlocated.length + ' unrecorded</p></div><button type="button" class="btn ghost" data-lpreload' + (LP.loading || LP.busy ? ' disabled' : '') + '>Refresh</button></div>';
    if (LP.error) h += '<p class="lp-alert" role="alert">' + esc(LP.error) + '</p>';
    h += '<div class="lp-filters"><label>Yard<select id="lpYard"><option value="">All yards</option>' + yardOrder().filter(function (y) { return y !== 'T'; }).map(function (y) { return '<option value="' + esc(y) + '"' + (LP.yard === y ? ' selected' : '') + '>' + esc(YARD_LABEL[y] || y) + '</option>'; }).join('') + '</select></label><label>Find a car<input id="lpQuery" type="search" placeholder="Registration or booking reference" value="' + esc(LP.query) + '"></label></div>';
    if (!d.lanes.length) h += '<div class="lp-empty"><h3>Set up your yard</h3><p>Add lanes, holding areas and temporary moving spaces. Then record actual positions, starting at the back of each lane.</p></div>';
    if (risks.length) h += '<div class="lp-alert"><b>Returns needing a move</b><div class="lp-alert-list">' + risks.map(function (p) { var c = laneCar(p.booking_id); return laneSelectButton(c, '<small>' + laneBlockers(p).length + ' blocking · ' + esc(laneById(p.lane_id).name) + '</small>'); }).join('') + '</div></div>';
    h += '<div class="lp-layout"><div class="lp-lanes">';
    visible.forEach(function (l) {
      var all = laneOccupants(l.id), matches = !LP.query || all.some(function (p) { var c = laneCar(p.booking_id); return c && laneMatch(c); });
      if (!matches) return;
      h += '<article class="lp-lane"><header><h3>' + esc(laneYard(l.yard)) + ' / ' + esc(l.name) + '</h3><span>' + all.length + '/' + l.capacity + ' · ' + (l.access === 'open' ? 'Independent spaces' : l.access === 'both' ? 'Exit at both ends' : 'Front exit only') + '</span></header>' + (l.access !== 'open' ? '<div class="lp-exit">FRONT EXIT · position 1</div>' : '') + '<ol>';
      for (var pos=1; pos<=l.capacity; pos++) {
        var p = all.filter(function (x) { return x.position === pos; })[0], c = p && laneCar(p.booking_id), blockers = p && laneBlockers(p);
        h += '<li' + (c && !laneMatch(c) ? ' class="lp-muted"' : '') + '><span class="lp-pos">' + pos + '</span>';
        if (c) h += laneSelectButton(c,'<small class="' + (laneRisk(p) || c.sent_at || c.cleared_at || c.removed_at ? 'lp-warning' : '') + '">' + (c.sent_at || c.cleared_at || c.removed_at ? 'Verify location · board status changed' : laneRisk(p) ? 'Return conflict · ' + blockers.length + ' blocking' : blockers.length ? 'Behind ' + blockers.length + ' car' + (blockers.length===1?'':'s') : 'Accessible') + '</small>');
        else h += '<span class="lp-vacant">Empty' + (laneReachable(l,pos) ? '' : ' · access blocked') + '</span>';
        h += '</li>';
      }
      h += '</ol>' + (l.access === 'both' ? '<div class="lp-exit">REAR EXIT</div>' : '') + '</article>';
    });
    h += '</div><aside class="lp-detail' + (selected ? '' : ' lp-none') + '" aria-live="polite">' + (selected ? laneDetail(selected) : '<h3>Vehicle details</h3><p>Select a registration to see its position, blockers and available moves.</p>') + '</aside></div>';
    h += '<section class="lp-section"><h3>Position not recorded <span>' + unlocated.length + '</span></h3><div class="lp-unlocated">' + unlocated.filter(function (c) { return (!LP.yard || c.yard === LP.yard) && laneMatch(c); }).sort(function (a,b) { return (Date.parse(b.return_at)||0)-(Date.parse(a.return_at)||0); }).map(function (c) { return laneSelectButton(c,'<small>' + esc(c.yard ? laneYard(c.yard) : 'Yard unknown') + ' · ' + esc(c.ref) + '</small>'); }).join('') + '</div></section>';
    if (d.can_manage) h += '<details class="lp-section"><summary>Add lane or holding area</summary><form id="lpAdd" class="lp-form"><label>Yard<select name="yard" required>' + yardOrder().filter(function (y) { return y !== 'T'; }).map(function (y) { return '<option value="' + esc(y) + '">' + esc(laneYard(y)) + '</option>'; }).join('') + '</select></label><label>Name<input name="name" maxlength="40" required placeholder="Lane A"></label><label>Spaces<input name="capacity" type="number" min="1" max="100" value="5" required></label><label>Type<select name="kind"><option value="lane">Parking lane</option><option value="holding">Holding area</option><option value="temporary">Temporary moving spaces</option></select></label><label>Lane exits<select name="access"><option value="front">Front only</option><option value="both">Both ends</option></select></label><button class="btn" type="submit"' + (LP.busy ? ' disabled' : '') + '>Add area</button></form></details>';
    h += '<details class="lp-section"><summary>Recent confirmed moves</summary>' + (d.moves || []).map(function (m) { return '<div class="lp-history"><b>' + esc(m.reg) + '</b><span>' + esc(m.value) + '</span><small>' + esc(m.staff_name) + ' · ' + esc(dayShort(m.at) + ' ' + hhmm(m.at)) + '</small></div>'; }).join('') + '</details></section>';
    return h;
  }
  function laneDetail(c) {
    var p=lanePosition(c.id), l=p && laneById(p.lane_id), blockers=laneBlockers(p), d=LP.data;
    var h='<h3>' + esc(c.reg) + '</h3><p>' + esc(c.make || '') + ' · ' + esc(c.ref || 'No reference') + '</p><dl><dt>Position</dt><dd>' + (l ? esc(laneYard(l.yard) + ' / ' + l.name + ' / ' + p.position) : 'Not recorded') + '</dd><dt>Expected return</dt><dd>' + esc(laneWhen(c)) + '</dd></dl>';
    if (blockers.length) {
      var spaces=[];
      d.lanes.filter(function (x) { return x.yard===l.yard && x.access==='open'; }).sort(function (a,b) { return (a.kind==='temporary'?0:1)-(b.kind==='temporary'?0:1); }).forEach(function (x) { for(var n=1;n<=x.capacity;n++) if(laneReachable(x,n)) spaces.push(x.name+' / '+n); });
      h+='<h4>Move these cars first</h4><ol class="lp-blockers">'+blockers.map(function (x,i) { var b=laneCar(x.booking_id); return '<li>'+laneSelectButton(b,'<small>'+(spaces[i]?'Suggested: '+esc(spaces[i]):'No free holding space recorded')+'</small>')+'</li>'; }).join('')+'</ol>';
      if(spaces.length<blockers.length) h+='<p class="lp-warning">Supervisor planning required: not enough independent moving spaces.</p>';
    }
    var suggestion=(!l || l.kind!=='lane') && laneSuggestion(c);
    if(suggestion) h+='<p class="lp-suggestion">Suggested parking: <b>'+esc(suggestion.lane.name)+' / '+suggestion.position+'</b>. Later returns sit behind this car.</p>';
    if(!d.can_move) return h+'<p>View only</p>';
    if(blockers.length) return h;
    var destinations=d.lanes.filter(function(x){return !l || x.id!==l.id;});
    h+='<form id="lpMove" class="lp-form"><label>Destination<select id="lpDest" name="lane" required><option value="">Choose an area</option>'+destinations.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(laneYard(x.yard)+' / '+x.name)+'</option>';}).join('')+(l?'<option value="left">Car has left the yard</option>':'')+'</select></label><label>Position<select id="lpSlot" name="position" required><option value="">Choose destination first</option></select></label><p class="note">Confirm only after physically moving the car.</p><button type="submit" class="btn"'+(LP.busy?' disabled':'')+'>'+(l?'Confirm moved':'Confirm actual position')+'</button></form>';
    return h;
  }
  function laneDestinationChanged() {
    var el=$('lpDest'), slots=$('lpSlot'), l=laneById(el.value);
    if(el.value==='left') { slots.innerHTML='<option value="">Not applicable</option>'; slots.required=false; slots.disabled=true; return; }
    slots.disabled=false; slots.required=true;
    var h='<option value="">Choose a reachable space</option>';
    if(l) for(var n=1;n<=l.capacity;n++) if(laneReachable(l,n)) h+='<option value="'+n+'">Position '+n+'</option>';
    slots.innerHTML=h;
  }
  document.addEventListener('submit',async function(e) {
    if(e.target.id!=='lpAdd' && e.target.id!=='lpMove') return;
    e.preventDefault(); if(LP.busy) return;
    if(LP.loading) return toast('Wait for the yard to finish refreshing.',true);
    if(!navigator.onLine) return toast('Reconnect before confirming a yard change.',true);
    var form=e.target, values=new FormData(form), args, method;
    if(form.id==='lpAdd') {
      var kind=values.get('kind'); method='lane_save'; args={p_yard:values.get('yard'),p_name:values.get('name'),p_capacity:+values.get('capacity'),p_kind:kind,p_access:kind==='lane'?values.get('access'):'open'};
    } else {
      var c=laneCar(LP.selected), p=lanePosition(LP.selected), l=laneById(values.get('lane'));
      if(!c || !values.get('lane')) return;
      method='lane_move'; args={p_booking:c.id,p_lane:l?l.id:null,p_position:l?+values.get('position'):null,p_revision:p?p.revision:0,p_lane_revision:l?l.revision:null};
    }
    var requestCompany=S.company.id, requestSeq=LP.seq;
    LP.busy=true; var btn=form.querySelector('button[type="submit"]'); btn.disabled=true;
    try {
      var result=await sb.rpc(method,args);
      if(!S.company || S.company.id!==requestCompany || LP.seq!==requestSeq) return;
      if(result.error) { toast(result.error.message,true); LP.error=result.error.message; }
      else { if(method==='lane_move') LP.data=result.data; toast(method==='lane_save'?'Area added.':'Position confirmed.'); }
    } catch(e) { if(!S.company || S.company.id!==requestCompany || LP.seq!==requestSeq) return; LP.error='Confirmation could not be verified. Refresh the yard before trying again.'; toast(LP.error,true); }
    finally { if(S.company && S.company.id===requestCompany && LP.seq===requestSeq) { LP.busy=false; await loadLanes(); } }
  });
  document.addEventListener('change',function(e) {
    if(e.target.id==='lpYard') { LP.yard=e.target.value; render(); }
    if(e.target.id==='lpDest') laneDestinationChanged();
  });
  document.addEventListener('input',function(e) {
    if(e.target.id!=='lpQuery') return;
    var pos=e.target.selectionStart; LP.query=e.target.value; render(); var q=$('lpQuery'); q.focus(); try { q.setSelectionRange(pos,pos); } catch(e) {}
  });
  setInterval(function(){ if(S.me && S.view==='lanes' && document.visibilityState==='visible') laneChanged(); },15000);
  // ── customer texts (database part 116) ──
  // An add-on (Parking Ops → Clients → Edit, brand.texts): the app texts the
  // customer by itself when their flight lands, when a driver is SENT, and the
  // day before a PICKS drop-off. Owners set it in Settings → Customer texts;
  // the send-texts function sends them (once each) and every text goes on the
  // car's Texts list and the activity log. The office can send one by hand.
  function voiceAddon() { return !!(S.company && S.company.brand && S.company.brand.voice === true); }
  function textsAddon() { return !!(S.company && S.company.brand && S.company.brand.texts === true); }
  var TEXT_RULES = [
    ["landed", "Flight landed", "DROPS: when the flight lands",
      "Welcome back {name}. Once you have your bags, call us on {office} and we'll bring your car {reg} to {meet}. {company}"],
    ["sent", "Car on its way", "DROPS: when a driver is SENT",
      "Hi {name}, your car {reg} is on its way to {meet}. Please wait there for our driver. {company}"],
    ["reminder", "Reminder", "PICKS: the day before drop-off",
      "Hi {name}, a reminder from {company}: we meet you at {meet} on {date} at {time}. Please call {office} 30 min before you arrive."]];
  var TEXT_LABEL = { landed: "Flight landed", sent: "Car on its way", reminder: "Reminder", manual: "Text" };
  function textsCfg() {
    var t = (S.company && S.company.texts) || {}, out = { on: t.on === true, demo: t.on === true && t.demo === true, sender: t.sender || "", office: t.office || "", meet: t.meet || "", at: t.at || "18:00" };
    TEXT_RULES.forEach(function (x) { var r = t[x[0]] || {}; out[x[0]] = { on: r.on !== false, text: r.text || x[3] }; });
    return out;
  }
  function textsOn() { return textsAddon() && textsCfg().on; }
  // The words a customer gets, filled in for this car (or a sample car in Settings).
  function fillText(tpl, r, cfg) {
    var when = r.drop_at ? new Date(r.drop_at) : null;
    var v = { name: customerName(r.name), reg: r.reg || "", office: cfg.office, meet: cfg.meet,
      company: cfg.sender || brandName(), time: when ? hhmm(r.drop_at) : "", date: when ? dayShort(r.drop_at) : "" };
    return String(tpl || "").replace(/\{(\w+)\}/g, function (m, k) { return k in v ? v[k] : m; }).replace(/\s+/g, " ").trim();
  }
  // Bookings come as "KHAIRA MS" or "MR JOHN SMITH": a text says "Ms Khaira" or "Mr Smith", else the name as given.
  var TITLES = /^(MR|MRS|MS|MISS|DR|MX)\.?$/i;
  function customerName(n) {
    var w = String(n || "").trim().split(/\s+/).filter(Boolean), cap = function (x) { return x.charAt(0).toUpperCase() + x.slice(1).toLowerCase(); };
    if (!w.length) return "there";
    if (w.length > 1 && TITLES.test(w[w.length - 1])) return cap(w[w.length - 1].replace(".", "")) + " " + cap(w[0]);
    if (w.length > 1 && TITLES.test(w[0])) return cap(w[0].replace(".", "")) + " " + cap(w[w.length - 1]);
    return w.map(cap).join(" ");
  }
  // A text of 160 letters goes as one; longer ones go in parts of 153 (each part costs one text).
  function textParts(s) { var n = String(s).length; return n <= 160 ? 1 : Math.ceil(n / 153); }
  var TEXT_SAMPLE = { name: "JONES MS", reg: "AB12CDE", drop_at: new Date(Date.now() + 86400000).toISOString().slice(0, 10) + "T04:30:00Z" };
  function textPrev(tpl, cfg) {
    var s = fillText(tpl, TEXT_SAMPLE, cfg), n = textParts(s);
    return '<span class="txprev-t">' + esc(s) + '</span><small class="hint"> · ' + s.length + " characters, " + (n === 1 ? "1 text" : n + " texts each") + "</small>";
  }
  function phoneHealthHtml() {
    setTimeout(loadPhoneHealth, 0);
    return '<div class="section-label">Company phone</div><p id="phoneHealth" class="note" role="status">Checking the company phone…</p><div id="phonePair"></div><button type="button" class="btn" data-phone-health>Refresh phone status</button>' +
      (S.me && S.me.role === 'owner' ? ' <a class="btn" href="/phone/takeoff-phone.apk" download>TakeOff Phone app (Android)</a>' : '');
  }
  async function loadPhoneHealth() {
    if (!$('phoneHealth')) return;
    var companyId = S.company && S.company.id, got = await sb.rpc('phone_bridge_status');
    var el = $('phoneHealth'); if (!el || !S.company || S.company.id !== companyId) return;
    if (got.error) { el.textContent = 'Phone status unavailable. Check that phone setup is complete.'; return; }
    var h = got.data || {}, status = !h.paired ? 'No company phone paired.' : h.online ? 'Company phone online.' : 'Company phone offline — texts are waiting.';
    el.textContent = status + (h.paired && !h.sms_ready ? ' SMS access or default SIM needs attention.' : '') +
      (h.battery !== null && h.battery !== undefined ? ' Battery ' + h.battery + '%.' : '') +
      ' ' + (+h.queued || 0) + ' waiting; ' + (+h.needs_review || 0) + ' to review; ' + (+h.expired || 0) + ' expired in the last day.' +
      (h.last_seen && !h.online ? ' Last seen ' + dayShort(h.last_seen) + ' ' + hhmm(h.last_seen) + '.' : '') +
      (h.paired && h.paired_as ? ' Signed in as ' + h.paired_as + '.' : '');
    // Pairing (part 118): the handset signs in with the office login and asks; an owner approves it here.
    var pair = $('phonePair'), own = !!(S.me && S.me.role === 'owner'), p = h.pending, o = '';
    if (pair) {
      if (own && h.paired && h.paired_as_owner) o += '<p class="note">This phone is signed in with an owner\'s login. Sign it in with the office login and approve it here instead.</p>';
      if (own && p) o += '<p class="note"><b>A phone is asking to be paired</b>, signed in as ' + esc(p.name || '?') + ' (' + dayShort(p.at) + ' ' + hhmm(p.at) + ').' + (h.paired ? ' Approving it replaces the paired phone.' : '') + '</p>' +
        '<button type="button" class="btn" data-phonepair="approve" data-device="' + esc(p.device) + '">Approve this phone</button> <button type="button" class="btn" data-phonepair="refuse">Refuse</button>';
      if (own && h.paired) o += ' <button type="button" class="btn" data-phonepair="unpair">Unpair the phone</button>';
      pair.innerHTML = o;
    }
  }
  async function phonePairing(btn) {
    var a = btn.dataset.phonepair;
    if (a === 'approve' && !confirm('Approve this phone? It sends the customer texts from now on.')) return;
    if (a === 'unpair' && !confirm('Unpair the company phone? It stops sending texts until a phone is approved again.')) return;
    btn.disabled = true;
    var got = await sb.rpc('phone_pairing', { p_action: a, p_device: btn.dataset.device || null });
    btn.disabled = false;
    if (got.error) { toast(got.error.message, true); return; }
    toast(a === 'approve' ? 'Phone approved. Tap Go online on it.' : a === 'unpair' ? 'Phone unpaired.' : 'Refused.');
    loadPhoneHealth();
  }
  setInterval(function () { if (S.view === 'settings' && document.visibilityState !== 'hidden' && $('phoneHealth')) loadPhoneHealth(); }, 30000);
  document.addEventListener('click', async function (e) {
    if (e.target.closest('[data-phone-health]')) loadPhoneHealth();
    var pb = e.target.closest('[data-phonepair]'); if (pb) { phonePairing(pb); return; }
    var review = e.target.closest('[data-reviewtext]');
    if (!review) return;
    if (!confirm('Have you checked the send outcome on the company phone? Marking reviewed does not send another message.')) return;
    review.disabled = true;
    var got = await sb.rpc('phone_text_review', { p_id: +review.dataset.reviewtext });
    if (got.error) { review.disabled = false; toast(got.error.message, true); return; }
    if (panelRow) carTexts(panelRow);
    loadPhoneHealth();
  });
  function textsHtml() {
    if (!textsAddon() || !S.me || S.me.role !== "owner") return "";
    var T = textsCfg(), sample = Object.assign({}, T, { sender: T.sender || brandName() });
    function hours() { var o = ""; for (var h = 8; h <= 21; h++) { var v = pad(h) + ":00"; o += '<option value="' + v + '"' + (T.at === v ? " selected" : "") + ">" + v + "</option>"; } return o; }
    return setBox("texts", "Customer texts", T.demo ? "Demo" : T.on ? TEXT_RULES.filter(function (x) { return T[x[0]].on; }).length + " of 3 on" : "Off", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      phoneHealthHtml() + '<label class="field">Texts to customers<select id="txOn"><option value="true"' + (T.on && !T.demo ? " selected" : "") + '>On</option><option value="demo"' + (T.demo ? " selected" : "") + ">Demo: write them on each car, don't send</option>" +
        '<option value="false"' + (T.on ? "" : " selected") + ">Off</option></select></label>" +
      '<label class="field">Name in the message<input id="txSender" maxlength="40" autocomplete="off" placeholder="e.g. TakeOff Parking" value="' + esc(T.sender) + '"></label>' +
      '<label class="field">Office number for customers to call<input id="txOffice" type="tel" autocomplete="off" placeholder="e.g. 0161 496 0000" value="' + esc(T.office) + '"></label>' +
      '<label class="field">Meeting point<input id="txMeet" autocomplete="off" maxlength="80" placeholder="e.g. Terminal 2 short stay, level 1" value="' + esc(T.meet) + '"></label>' +
      TEXT_RULES.map(function (x) {
        var R = T[x[0]];
        return '<div class="section-label">' + esc(x[1]) + '</div><p class="note">' + esc(x[2]) + "</p>" +
          '<label class="check"><input type="checkbox" data-txon="' + x[0] + '"' + (R.on ? " checked" : "") + "> Send this text</label>" +
          (x[0] === "reminder" ? '<label class="field">Send at<select id="txAt">' + hours() + "</select></label>" : "") +
          '<label class="field">Words<textarea data-txrule="' + x[0] + '" maxlength="459" rows="3">' + esc(R.text) + "</textarea></label>" +
          '<p class="note txprev" style="border-left:3px solid currentColor;padding-left:10px" data-txprev="' + x[0] + '">' + textPrev(R.text, sample) + "</p>";
      }).join("") +
      '<p class="note">{name} the customer (Ms Khaira), {reg}, {office}, {meet}, {date} and {time} of the drop-off, {company}. Customers can\'t reply to these texts.</p>' +
      '<label class="field">Test to your mobile<input id="txTestTo" data-nodirty type="tel" autocomplete="off" placeholder="07…"></label>' +
      '<div class="row-actions"><button type="button" class="btn ghost small" data-txtest>Send me a test</button><button type="button" class="btn brand" data-savetexts>Save texts</button></div>');
  }
  function textsForm() {
    var p = { on: $("txOn").value !== "false", demo: $("txOn").value === "demo", sender: $("txSender").value.trim(), office: $("txOffice").value.trim(), meet: $("txMeet").value.trim(), at: $("txAt").value };
    TEXT_RULES.forEach(function (x) { p[x[0]] = { on: document.querySelector('[data-txon="' + x[0] + '"]').checked, text: document.querySelector('[data-txrule="' + x[0] + '"]').value.trim() }; });
    return p;
  }
  async function saveTexts(btn) {
    var p = textsForm();
    if (p.on && p.sender.length > 40) return toast("The message name is 40 characters at most.", true);
    if (p.on && !p.office) return toast("Add the office number customers call.", true);
    btn.disabled = true;
    var r = await sb.rpc("set_texts", { p: p });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.texts = r.data;
    toast(r.data.demo ? "Saved: customer texts in demo, nothing is sent" : r.data.on ? "Saved: customer texts on" : "Customer texts off"); render();
  }
  async function testText(btn) {
    var to = $("txTestTo").value.trim();
    if (!to) return toast("Type your mobile number for the test.", true);
    btn.disabled = true;
    try { await callFunction("send-texts", { type: "test", to: to, text: fillText(textsForm().landed.text, TEXT_SAMPLE, textsForm()) }, true); toast("Test text queued on the company phone"); }
    catch (e) { toast(e.message, true); }
    btn.disabled = false;
  }
  // The live preview under each text's words.
  document.addEventListener("input", function (e) {
    var k = e.target.dataset && e.target.dataset.txrule, p = k && document.querySelector('[data-txprev="' + k + '"]');
    if (p) p.innerHTML = textPrev(e.target.value, Object.assign(textsForm(), { sender: $("txSender").value.trim() || brandName() }));
  });
  // ── the car's texts ──
  // What was sent to this customer, when and how it went; the office sends one by hand.
  function carTextsHtml(r) { return (textsAddon() && (r.phone || textsOn()) ? '<div id="carTexts"></div>' : "") + (callsAddon() && can("called") ? '<div id="carCalls"></div>' : ""); }
  function carCommsTitle() { return textsAddon() && callsAddon() && can("called") ? "Calls & texts" : callsAddon() && can("called") ? "Calls" : "Texts"; }
  var TEXT_STATE = { queued: "Waiting for company phone", sending: "Sending from company phone", sent: "Sent from company SIM", delivered: "Delivered", failed: "Not sent", uncertain: "Check send outcome", expired: "Expired — not sent", skipped: "Not sent", demo: "Demo, not sent" };
  async function carTexts(r) {
    var el = $("carTexts"); if (!el) return;
    var got = await Promise.all([
      sb.from("customer_texts").select("id, at, rule, to_number, body, status, error, staff_name, reviewed_at, expires_at").eq("booking_id", r.id).order("at", { ascending: false }).limit(20),
      sb.from("customer_sms").select("at, from_number, body").eq("booking_id", r.id).order("at", { ascending: false }).limit(20)
    ]);
    el = $("carTexts"); if (!el || panelRow !== r) return;
    var list = got[0].error || got[1].error ? null : (got[0].data || []).map(function (x) { x.direction = "outbound"; if (x.status === "queued" && x.expires_at && new Date(x.expires_at).getTime() <= Date.now()) x.status = "expired"; return x; }).concat((got[1].data || []).map(function (x) { x.direction = "inbound"; x.rule = "reply"; x.status = "received"; x.to_number = x.from_number; return x; })).sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
    var rules = r.kind === "drops" ? ["landed", "sent"] : ["reminder"];
    var send = can("called") && r.phone && textsOn() && !r.removed_at ? '<div class="pseg txsend">' + rules.map(function (k) { return '<button type="button" data-txpick="' + k + '">' + esc(TEXT_LABEL[k]) + "</button>"; }).join("") + "</div>" +
      '<div id="txConfirm" hidden></div>' : "";
    el.innerHTML = (isOps() ? "" : "<label>TEXTS</label>") + (list === null ? '<p class="hint">Couldn\'t load the messages.</p>' : !list.length ? '<p class="hint">' + (r.phone ? "No messages with this customer yet." : "No phone number on this booking.") + "</p>" :
      '<div class="hist txlist">' + list.map(function (t) {
        var bad = t.status === "failed" || t.status === "skipped" || t.status === "uncertain" || t.status === "expired";
        return '<div><span class="hw num">' + esc(dayShort(t.at) + " " + hhmm(t.at)) + '</span><span class="hb"><b>' + (t.direction === "inbound" ? "Customer reply" : esc(TEXT_LABEL[t.rule] || "Text")) + "</b> · " +
          '<span class="' + (bad ? "bad" : "") + '">' + (t.direction === "inbound" ? "Received from " + esc(phoneLabel(t.from_number)) : esc(TEXT_STATE[t.status] || t.status) + (t.error ? ": " + esc(t.error) : "")) + "</span>" + (t.staff_name ? " · " + esc(t.staff_name) : "") +
          '<span class="hv">' + esc(t.body) + "</span>" + (t.direction === "outbound" && /^(failed|uncertain)$/.test(t.status) && !t.reviewed_at && can("called") ? '<button type="button" class="btn" data-reviewtext="' + esc(t.id) + '">Mark reviewed</button>' : '') + "</span></div>";
      }).join("") + "</div>") + (send ? '<p class="hint">Send a text now:</p>' + send : "");
  }
  // A tap on a text shows its words first; Send now sends it.
  function pickText(k) {
    var r = panelRow, box = $("txConfirm"); if (!r || !box) return;
    document.querySelectorAll("[data-txpick]").forEach(function (b) { b.classList.toggle("on", b.dataset.txpick === k); });
    var words = fillText(textsCfg()[k].text, r, textsCfg());
    box.hidden = false;
    box.innerHTML = (textsCfg().demo ? '<p class="hint">Demo: it goes on the list, not to the customer.</p>' : "") + '<p class="note" style="border-left:3px solid currentColor;padding-left:10px">To ' + esc(phoneLabel(r.phone)) + ': “' + esc(words) + '”</p><div class="row-actions"><button type="button" class="btn ghost small" data-txcancel>Cancel</button><button type="button" class="btn brand small" data-txsend="' + k + '">Send now</button></div>';
  }
  async function sendTextNow(btn) {
    var r = panelRow; if (!r) return;
    btn.disabled = true;
    if (!btn.dataset.txrequest) btn.dataset.txrequest = crypto.randomUUID();
    try { await callFunction("send-texts", { type: "manual", booking: r.id, rule: btn.dataset.txsend, request: btn.dataset.txrequest }, true); toast(textsCfg().demo ? "Demo: written on the car, not sent" : "Text queued on company phone"); }
    catch (e) { btn.disabled = false; return toast(e.message, true); }
    carTexts(r);
  }
  // ── incoming calls (database part 117) ──
  // An add-on (brand.calls): the TakeOff Android companion screens calls on
  // the company SIM, matches them to a booking and records the call. The app
  // never answers or redirects a call; staff use the normal phone controls.
  function callsAddon() { return !!(S.company && S.company.brand && S.company.brand.calls === true); }
  function callsCfg() { var c = (S.company && S.company.calls) || {}; return { on: c.on === true }; }
  function callsOn() { return callsAddon() && callsCfg().on; }
  var CALL_STATE = { ringing: "Ringing", answered: "Answered", missed: "Missed" };
  function callSecs(s) { s = +s || 0; return s ? Math.floor(s / 60) + ":" + pad(s % 60) : ""; }
  function callWhat(k) { return k.status === "answered" ? "Answered" + (k.seconds ? " · " + callSecs(k.seconds) : "") : CALL_STATE[k.status] || k.status; }
  function callMarked(k) { return k.marked === "CALLED" ? (k.kind === "picks" ? "Pressed 2: on the way, marked CALLED" : "Pressed 1: landed, marked CALLED") : ""; }
  // ── the pop-up ──
  var POP = { calls: [], timers: {} };
  function callEvent(k) {
    if (!k || !callsOn() || !can("called") || k.company_id && S.company && k.company_id !== S.company.id) return;
    var i = POP.calls.findIndex(function (x) { return x.id === k.id; });
    if (i >= 0) POP.calls[i] = Object.assign({}, POP.calls[i], k);
    else if (k.status === "ringing") POP.calls.unshift(k); else return;
    POP.calls = POP.calls.slice(0, 3);
    // Answered calls disappear after a short while; missed calls stay until closed.
    if (k.status === "answered") { clearTimeout(POP.timers[k.id]); POP.timers[k.id] = setTimeout(function () { callGone(k.id); }, 15000); }
    if (S.view === "calls") S.callsList = null;
    callPopDraw();
  }
  function callGone(id) { POP.calls = POP.calls.filter(function (x) { return x.id !== id; }); callPopDraw(); }
  window.addEventListener("takeoff:call", function (e) { callEvent(e.detail); });
  function callRow(k) { return k.booking_id ? (S.rows || []).find(function (r) { return r.id === k.booking_id; }) : null; }
  function callPopDraw() {
    var el = $("callPop");
    if (!POP.calls.length) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("div"); el.id = "callPop"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
      el.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:60;max-width:520px;margin:0 auto;display:grid;gap:6px";
      document.body.appendChild(el);
    }
    el.innerHTML = POP.calls.map(function (k) {
      var r = callRow(k), done = r && (r.kind === "drops" ? !!r.called_at : !!r.pick_called), bad = k.status === "missed";
      var who = k.booking_id ? "<b>" + esc(k.reg || "NO REG") + "</b> · " + esc(nice(k.name) || "Customer") + " · " + (k.kind === "picks" ? "PICKS, dropping off" : "DROPS, flying back" + (r && r.flight ? " · " + esc(r.flight) + (r.est_time ? " " + esc(r.est_time) : "") : ""))
        : "<b>Not on today's cars</b>";
      return '<div class="callpop" data-callid="' + k.id + '" style="background:#fff;color:#16181D;border:2px solid ' + (bad ? "#C62828" : "#1B7F3B") + ';border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:15px">' +
        '<div style="display:flex;justify-content:space-between;gap:8px"><span>' + (bad ? "Missed call" : k.status === "ringing" ? "Incoming call" : callWhat(k)) + " · " + esc(phoneLabel(k.from_number) || "Number hidden") + "</span>" +
        '<button type="button" data-callclose="' + k.id + '" aria-label="Close" style="background:none;border:0;font-size:20px;line-height:1;color:inherit">&times;</button></div>' +
        '<div style="margin-top:4px">' + who + "</div>" + (callMarked(k) ? '<div style="margin-top:4px;color:#1B7F3B">' + esc(callMarked(k)) + "</div>" : "") +
        (k.handled_name ? '<div style="margin-top:4px">' + esc(k.handled_name) + " has it</div>" : "") +
        '<div class="row-actions" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' +
          (r && !done && !r.removed_at ? '<button type="button" class="btn brand small" data-callmark="' + k.id + '">CALLED</button>' : done ? '<span class="hint">CALLED ✓</span>' : "") +
          (r ? '<button type="button" class="btn ghost small" data-callopen="' + k.id + '">Open car</button>' : "") +
          (!k.handled_name ? '<button type="button" class="btn ghost small" data-calltake="' + k.id + '">' + (bad ? "I'll call back" : "I've got it") + "</button>" : "") +
          (bad && k.from_number ? '<a class="btn ghost small" href="tel:' + esc(dialable(k.from_number)) + '">Call back</a>' : "") +
        "</div></div>";
    }).join("");
  }
  async function callTake(id, btn) {
    if (btn) btn.disabled = true;
    var r = await sb.rpc("call_take", { p_call: +id });
    if (r.error) { if (btn) btn.disabled = false; return toast(r.error.message, true); }
    callEvent(r.data); if (S.view === "calls") loadCalls();
  }
  function callMark(id) {
    var k = POP.calls.find(function (x) { return String(x.id) === String(id); }), r = k && callRow(k); if (!r) return;
    if (r.kind === "drops") { if (!r.called_at) tapDrop(r, "called"); } else if (!r.pick_called) tapPick(r, "called", "Called");
    callPopDraw();
  }
  // ── on the car: its calls, with the texts ──
  async function carCalls(r) {
    var el = $("carCalls"); if (!el) return;
    var q = await sb.from("customer_calls").select("id, at, from_number, status, seconds, marked, kind, handled_name").eq("booking_id", r.id).order("at", { ascending: false }).limit(20);
    el = $("carCalls"); if (!el || panelRow !== r) return;
    var list = q.error ? null : q.data || [];
    el.innerHTML = (isOps() ? '<div class="hint" style="margin-top:8px">Calls</div>' : "<label>CALLS</label>") + (list === null ? '<p class="hint">Couldn\'t load the calls.</p>' : !list.length ? '<p class="hint">No calls from this customer yet.</p>' :
      '<div class="hist callist">' + list.map(function (k) {
        return '<div><span class="hw num">' + esc(dayShort(k.at) + " " + hhmm(k.at)) + '</span><span class="hb"><b class="' + (k.status === "missed" ? "bad" : "") + '">' + esc(callWhat(k)) + "</b>" +
          (k.handled_name ? " · " + esc(k.handled_name) : "") + (callMarked(k) ? '<span class="hv">' + esc(callMarked(k)) + "</span>" : "") + "</span></div>";
      }).join("") + "</div>");
  }
  // ── Menu → Calls: today's calls, missed first ──
  async function loadCalls() {
    var since = new Date(Date.now() - 24 * 3600000).toISOString();
    var q = await sb.from("customer_calls").select("*").gte("at", since).order("at", { ascending: false }).limit(300);
    S.callsList = q.error ? false : q.data || [];
    if (S.view === "calls") render();
  }
  function renderCalls() {
    if (!callsAddon() || !can("called")) return '<div class="msg">Calls aren\'t switched on.</div>';
    if (S.callsList === undefined || S.callsList === null) { S.callsList = 0; loadCalls(); }
    var head = (isOps() ? '<div class="ops-head"><h1>Calls</h1></div>' : "<h2>Calls</h2>") + (callsOn() ? "" : '<p class="note">Calls are off. An owner switches them on in Settings → Calls.</p>');
    if (!S.callsList) return head + '<p class="hint">' + (S.callsList === false ? "Couldn't load the calls." : "Loading…") + "</p>";
    var f = S.callsFilter || "all", L0 = S.callsList, missed = L0.filter(function (k) { return k.status === "missed" && !k.handled_name; });
    var list = f === "missed" ? missed : f === "unknown" ? L0.filter(function (k) { return !k.booking_id; }) : missed.concat(L0.filter(function (k) { return missed.indexOf(k) < 0; }));
    var tab = function (k, t, n) { return '<button type="button" data-callsf="' + k + '" class="' + (f === k ? "on" : "") + '"' + ' aria-pressed="' + (f === k) + '">' + t + (n !== undefined ? " (" + n + ")" : "") + "</button>"; };
    return head + '<div class="pseg" style="margin:10px 0">' + tab("all", "All", L0.length) + tab("missed", "To call back", missed.length) + tab("unknown", "Not on a booking", L0.filter(function (k) { return !k.booking_id; }).length) + "</div>" +
      (!list.length ? '<p class="hint">No calls in the last 24 hours.</p>' : '<div class="box hist calls" style="max-height:none;overflow:visible">' + list.map(function (k) {
        var bad = k.status === "missed" && !k.handled_name;
        return '<div style="padding:8px 10px;border-bottom:1px solid rgba(0,0,0,.08)"><span class="hw num">' + esc(hhmm(k.at)) + '</span><span class="hb"><b class="' + (bad ? "bad" : "") + '">' + esc(callWhat(k)) + "</b> · " +
          esc(phoneLabel(k.from_number) || "Number hidden") + " · " + (k.booking_id ? "<b>" + esc(k.reg || "NO REG") + "</b> " + esc(nice(k.name)) + " (" + (k.kind === "picks" ? "PICKS" : "DROPS") + ")" : "not on a booking") +
          (callMarked(k) ? '<span class="hv">' + esc(callMarked(k)) + "</span>" : "") + (k.handled_name ? '<span class="hv">' + esc(k.handled_name) + (k.status === "missed" ? " called back" : " took it") + "</span>" : "") +
          '<span class="row-actions" style="display:flex;gap:6px;margin-top:6px">' + (k.from_number ? '<a class="btn ghost small" href="tel:' + esc(dialable(k.from_number)) + '">Call</a>' : "") +
          (bad ? '<button type="button" class="btn small" data-calltake="' + k.id + '">Called back</button>' : "") + "</span></span></div>";
      }).join("") + "</div>");
  }
  // ── Settings → Calls (owners) ──
  function callsHtml() {
    if (!callsAddon() || !S.me || S.me.role !== "owner") return "";
    var C = callsCfg();
    if (voiceAddon()) setTimeout(loadVoiceMenu, 0);
    return setBox("calls", "Calls", C.on ? "On · company Android" : "Off", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      (textsAddon() ? '' : phoneHealthHtml()) + '<label class="field">Calls in the app<select id="clOn"><option value="true"' + (C.on ? " selected" : "") + '>On</option><option value="false"' + (C.on ? "" : " selected") + ">Off</option></select></label>" +
      '<p class="note">Calls use the company Android phone and its SIM. Customers keep calling the usual company number. The TakeOff phone app shows the matching booking and call status. The optional caller menu below can answer calls through an approved voice service.</p>' +
      '<div class="row-actions"><button type="button" class="btn brand" data-savecalls>Save calls</button></div>' +
      (voiceAddon() ? '<div id="voiceMenu" style="margin-top:20px"><h3>Caller keypad menu</h3><p class="note">Checking voice setup…</p></div>' : ""));
  }
  async function saveCalls(btn) {
    var p = { on: $("clOn").value === "true" };
    btn.disabled = true;
    var r = await sb.rpc("set_calls", { p: p });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.calls = r.data;
    toast(r.data.on ? "Saved: calls on for the company Android" : "Calls off"); render();
  }

  async function loadVoiceMenu() {
    var host = $("voiceMenu"), company = S.company && S.company.id;
    if (!host) return;
    var r = await sb.rpc("voice_menu_settings");
    if (host !== $("voiceMenu") || !S.company || S.company.id !== company) return;
    if (r.error || !r.data || !r.data.configured) {
      host.innerHTML = '<h3>Caller keypad menu</h3><p class="note">Not set up. This optional service answers calls, takes 1 for landed or 2 for dropping off, then rings this TakeOff app. A voice service and cost approval are required.</p>';
      return;
    }
    var v = r.data, ready = v.approved && v.app_ready;
    host.innerHTML = '<h3>Caller keypad menu</h3><p class="note">' + (v.approved ? (v.app_ready ? 'Company phone ready for calls in TakeOff.' : 'Open Voice calls on the company phone to register it.') : 'Waiting for service cost approval.') + '</p>' +
      '<label class="field">Caller menu<select id="vmOn"><option value="false"' + (!v.on ? ' selected' : '') + '>Off</option><option value="true"' + (v.on ? ' selected' : '') + (!ready && !v.on ? ' disabled' : '') + '>On</option></select></label>' +
      '<label class="field">Text the caller the instructions<select id="vmText"><option value="demo"' + (v.menu_text === "demo" || !v.menu_text ? ' selected' : '') + '>Demo: write it on the call, don\'t send</option><option value="on"' + (v.menu_text === "on" ? ' selected' : '') + '>On: send from the company phone</option><option value="off"' + (v.menu_text === "off" ? ' selected' : '') + '>Off</option></select></label>' +
      '<label class="field">Greeting<textarea id="vmGreeting" maxlength="400" rows="3">' + esc(v.greeting) + '</textarea></label>' +
      '<p class="note">Leave the greeting blank for the standard welcome. TakeOff then reads: 1 if you have landed, 2 if you are dropping off, or 0 for the office. A single matching booking is marked CALLED. Calls ring inside TakeOff; internet is required.</p>' +
      '<button type="button" class="btn brand" data-savevoice>Save caller menu</button>';
  }
  async function saveVoiceMenu(btn) {
    btn.disabled = true;
    var r = await sb.rpc("set_voice_menu", { p_on: $("vmOn").value === "true", p_greeting: $("vmGreeting").value });
    if (!r.error && $("vmText")) r = await sb.rpc("set_voice_menu_text", { p_mode: $("vmText").value });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); toast("Caller menu saved"); loadVoiceMenu();
  }
  // ── events ────────────────────────────────
  // A personal link opened while this page is already open only changes the hash.
  window.addEventListener("hashchange", function () { if (/^#t=/.test(location.hash) || /^#setup/.test(location.hash)) location.reload(); });

  // ── never a dead screen ──
  // Anything that goes wrong unexpectedly is noted, the person gets a short
  // message (not more than one every few seconds), and the screen is redrawn
  // from what the app knows, so buttons work again. Signal trouble has its own
  // messages and isn't repeated here.
  var lastOops = 0;
  function oopsLog(err) {
    var m = String((err && (err.message || err.reason)) || err || "").slice(0, 300);
    try { console.error(err); } catch (e) {}
    try { var list = JSON.parse(localStorage.getItem("takeoff_errors") || "[]"); list.push({ at: new Date().toISOString(), view: S.view, m: m }); localStorage.setItem("takeoff_errors", JSON.stringify(list.slice(-30))); } catch (e) {}
    queueError(m, err);
    return m;
  }
  // Phone error reports (database part 100): what went wrong also goes to the
  // server, a few seconds later and in one go, for Clients → Health. Signal
  // trouble isn't an error. Sending never shows anything, and a failed send
  // isn't tried again (it could be the thing that's broken).
  var errOut = [], errTimer = 0;
  function queueError(m, err) {
    if (!m || isNetwork({ message: m }) || /ResizeObserver|Script error/i.test(m)) return;
    var at = /app\.js:(\d+):(\d+)/.exec(String((err && err.stack) || ""));
    if (errOut.length < 20) errOut.push({ m: m + (at ? " @" + at[1] + ":" + at[2] : ""), view: String(S.view || "") });
    if (!errTimer) errTimer = setTimeout(sendErrors, 5000);
  }
  function sendErrors() {
    errTimer = 0;
    if (!errOut.length) return;
    if (!S.me) { errOut = []; return; }
    if (!navigator.onLine) { errTimer = setTimeout(sendErrors, 60000); return; }
    var list = errOut.splice(0, 20);
    try { sb.rpc("report_errors", { p_list: list, p_device: deviceName(), p_version: String(appTag || "").replace(/\W/g, "").slice(0, 8) }).then(function () {}, function () {}); } catch (e) {}
  }
  function deviceName() {
    var ua = navigator.userAgent, v;
    var os = IS_IOS ? "iPhone" + ((v = /OS (\d+)_/.exec(ua)) ? " iOS " + v[1] : "") : (v = /Android (\d+)/.exec(ua)) ? "Android " + v[1] : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "other";
    var br = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "";
    var home = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
    return os + (br ? " · " + br : "") + (home ? " · Home Screen app" : "");
  }
  function oops(err) {
    if (!err) return;
    var m = oopsLog(err);
    if (isNetwork({ message: m }) || /ResizeObserver|Script error/i.test(m)) return;
    if (Date.now() - lastOops > 8000) { lastOops = Date.now(); try { toast("That didn't work. Try again.", true); } catch (e) {} }
    try {
      $("panelBody").querySelectorAll("button[disabled]").forEach(function (b) { if (!b.closest("[data-keepoff]")) b.disabled = false; });
      if (S.me && !$("panel").open) render();
    } catch (e) {}
  }
  // Closing or reloading the app with Settings not saved: the browser asks first.
  window.addEventListener("beforeunload", function (e) { if (dirtySecs().length) { e.preventDefault(); e.returnValue = ""; } });
  window.addEventListener("error", function (e) { if (e.error || e.message) oops(e.error || e.message); });
  window.addEventListener("unhandledrejection", function (e) { oops(e.reason); });

  // Those numbers are tiles, not buttons: Enter or Space on one taps it.
  document.addEventListener("keydown", function (e) {
    var tile = (e.key === "Enter" || e.key === " ") && e.target.closest && e.target.closest("[data-tileq],[data-fltile]");
    if (tile) { e.preventDefault(); tile.click(); }
  });
  document.addEventListener("click", async function (e) {
    if (S.me && e.target.closest && e.target.closest("#who.can-switch, [data-switchname]")) return openSwitchName();
    if (e.target.closest("[data-reload]")) return location.reload();
    // The second line of a row opens the car too, not only the reg.
    var opener = e.target.closest("[data-addflight]") ? null : e.target.closest("div[data-open]");
    if (opener && S.me && !$("panel").open) { var or = rowOf(opener); if (or) return openPanel(or); }
    // A number on Summary, Hourly stats or Flights: its cars (tileAttr, flTileAttr).
    var tile = S.me && e.target.closest("[data-tileq],[data-fltile]");
    if (tile && tile.dataset.tileq !== undefined) return openTile(tile.dataset.tileq);
    if (tile) { S.flTile = (S.flTile || "") === tile.dataset.fltile ? "" : tile.dataset.fltile; return render(); }
    var t = e.target.closest("button,a"); if (!t) return;
    if (t.dataset.copy === "stats") return putOnClipboard(copyText("stats"));
    if (t.dataset.copy) { try { await navigator.clipboard.writeText(t.dataset.copy); toast("Copied"); } catch (err) { toast("Couldn't copy: select the link and copy it", true); } return; }
    if (!S.me) return;
    if ((t.dataset.payfold !== undefined || t.dataset.payfilter !== undefined || t.dataset.paydetails || t.dataset.paybooking || t.dataset.payproof) && !boardPaymentsAvailable()) return;
    if (t.dataset.payfold !== undefined) return togglePayFold();
    if (t.dataset.payfilter !== undefined) { S.paymentFilter = t.dataset.payfilter; render(); return; }
    if (t.dataset.paydetails) { var pr = S.rows.find(function (x) { return x.id === t.dataset.paydetails; }); if (pr) openBoardPayment(pr); return; }
    if (t.dataset.paybooking) { var pb = S.rows.find(function (x) { return x.id === t.dataset.paybooking; }); if (pb) { boardPaymentId = ""; $("panel").classList.remove("payment-sheet"); openPanel(pb); } return; }
    if (t.dataset.payproof) { var pp = S.rows.find(function (x) { return x.id === t.dataset.payproof; }); if (pp) fillBoardPaymentProof(pp); return; }
    // The link opens WhatsApp by itself; just remember it was sent.
    // The link opens WhatsApp by itself; PT is done.
    if (t.dataset.ptlink !== undefined) { if (panelRow) ptSent(panelRow); return; }
    // WhatsApp opens on the PT chat with the reg typed; the photos are next.
    if (t.dataset.ptreg !== undefined) { if (pt) { pt.regSent = true; ptStore(); } setTimeout(function () { if (panelRow && pt) openPt(panelRow); }, 400); return; }
    if (t.dataset.savept !== undefined) return savePtNumber(t);
    if (t.dataset.backup !== undefined) return downloadBackup(t);
    if (t.dataset.saverate !== undefined) return saveOverstayRate(t);
    if (t.dataset.saveexit !== undefined) return saveExitFee(t);
    if (t.dataset.savetexts !== undefined) return saveTexts(t);
    if (t.dataset.savevoice !== undefined) return saveVoiceMenu(t);
    if (t.dataset.savecalls !== undefined) return saveCalls(t);
    if (t.dataset.callclose) return callGone(+t.dataset.callclose);
    if (t.dataset.callmark) return callMark(t.dataset.callmark);
    if (t.dataset.calltake) return callTake(t.dataset.calltake, t);
    if (t.dataset.callsf) { S.callsFilter = t.dataset.callsf; return render(); }
    if (t.dataset.callopen) { var ck = POP.calls.find(function (x) { return String(x.id) === t.dataset.callopen; }), cr = ck && callRow(ck); if (cr) openPanel(cr); return; }
    if (t.dataset.txtest !== undefined) return testText(t);
    if (t.dataset.txpick) return pickText(t.dataset.txpick);
    if (t.dataset.txsend) return sendTextNow(t);
    if (t.dataset.txcancel !== undefined) { var txc = $("txConfirm"); if (txc) { txc.hidden = true; txc.innerHTML = ""; } document.querySelectorAll("[data-txpick]").forEach(function (b) { b.classList.remove("on"); }); return; }
    if (t.dataset.saveycol !== undefined) return saveYardColours(t);
    if (t.dataset.ycoff) { var yi = document.querySelector('[data-ycol="' + t.dataset.ycoff + '"]'); if (yi) yardOff(yi); else t.outerHTML = '<span class="note">Not set</span>'; showUnsaved(); return; }
    if (t.dataset.setsec) return toggleSec(t.dataset.setsec);
    if (t.dataset.savedirty !== undefined) { dirtySecs().map(function (d) { return d.querySelector(".row-actions .btn.brand"); }).forEach(function (b) { if (b) b.click(); }); return; }
    if (t.dataset.savecap !== undefined) return saveCapacity(t);
    if (t.dataset.swipestep) { setSwipeChoice(t.dataset.swipestep); render(); return openMenu(); }
    if (t.dataset.swipeleft) { setSwipeLeftChoice(t.dataset.swipeleft); render(); return openMenu(); }
    if (t.closest("[data-swipeonlyme]")) { setSwipeOnlyChoice(!swipeOnlyChoice()); render(); return openMenu(); }
    if (t.dataset.keytick) return tickKey(t.dataset.keytick);
    if (t.dataset.keymissing) return tickKey(t.dataset.keymissing, "missing");
    if (t.dataset.keyfilter) { S.keyFilter = t.dataset.keyfilter; return render(); }
    if (t.dataset.keystart !== undefined) return startKeyCheck(false);
    if (t.dataset.keynew !== undefined) return startKeyCheck(true);
    if (t.dataset.keyfinish !== undefined) return finishKeyCheck();
    if (t.dataset.keyretry !== undefined) return loadKeys(S.sheetId);
    if (t.id === "keyBtn") return toggleKeyMode();
    if (t.dataset.flfilter) { S.flFilter = t.dataset.flfilter; return render(); }
    if (t.dataset.settab) {
      S.setTab = t.dataset.settab;
      document.querySelectorAll(".set-tabs [data-settab]").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.settab === S.setTab); });
      document.querySelectorAll(".set-more [data-settab]").forEach(function (b) { b.hidden = b.dataset.settab === S.setTab; });
      document.querySelectorAll("main .set-group").forEach(function (g) { g.hidden = g.id !== "set-" + S.setTab; });
      if (t.closest(".set-more")) window.scrollTo(0, 0);
      return;
    }
    if (t.dataset.setgo) { var sg = $("set-" + t.dataset.setgo); if (sg) sg.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
    if (t.dataset.lpcar) { LP.selected = t.dataset.lpcar; render(); var detail = document.querySelector(".lp-detail"); if (detail && window.innerWidth < 761) detail.scrollIntoView({block:"start"}); return; }
    if (t.dataset.lpreload !== undefined) return loadLanes();
    if (t.dataset.view) return go(t.dataset.view);
    if (t.id === "menuBtn" || t.closest("#cHead")) return openMenu();
    if (t.id === "shiftBtn" || t.closest("#cShift")) return openShiftPick();
    if (t.dataset.kind) return switchKind(t.dataset.kind);
    if (t.dataset.sheetretry !== undefined) return sheetRetry();
    if (t.dataset.sheetback !== undefined) return sheetBack();
    if (t.dataset.pickshift) return chooseShift(t.dataset.pickshift);
    if (t.dataset.closeshift !== undefined) return $("shiftPick").close();
    if (t.dataset.bn && isOps() && t.dataset.bn === "flBtn") return go("flights");
    if (t.dataset.bn) { if (S.view !== "board" && t.dataset.bn !== "menuBtn" && go("board") === false) return; return $(t.dataset.bn).click(); }
    if (t.dataset.mode) { setMode(t.dataset.mode); return openMenu(); }
    if (t.id === "logBtn") return go("summary");
    if (t.id === "flBtn") return checkFlights(t);
    if (t.id === "rtBtn") return openReturns();
    if (t.id === "psBtn") return isOps() ? go("stats") : (sheet() || {}).kind === "drops" ? openDropsStats() : openPicksStats();
    if (t.id === "refreshBtn") return refreshAll(t);
    if (t.dataset.appupdate !== undefined) { location.reload(); return; }
    if (t.dataset.checkflights !== undefined) return checkFlights(t);
    if (t.dataset.filltimes !== undefined) return fillTimes(t);
    if (t.dataset.savesettings !== undefined) return saveSettings(t);
    if (t.dataset.archopen) return openArchived(t.dataset.archopen, t.dataset.archq);
    if (t.dataset.archivesheet) return archiveSheet(t.dataset.archivesheet, true);
    if (t.dataset.unarchive) return archiveSheet(t.dataset.unarchive, false);
    if (t.dataset.deletesheet) return deleteSheet(t.dataset.deletesheet);
    if (t.dataset.addcar !== undefined) { $("menu").close(); return openAddCar(); }
    if (t.dataset.addperson !== undefined) { S.addPerson = !S.addPerson; render(); if (S.addPerson) $("newName").focus(); return; }
    if (t.closest(".ops-dd")) t.closest(".ops-dd").open = false;
    if (t.dataset.manage) return openStaffPanel(t.dataset.manage);
    if (t.dataset.clientedit && S.platform) return openClient(t.dataset.clientedit);
    if (t.dataset.clientsuspend && S.platform) return suspendClient(t);
    if (t.dataset.clientopen && S.platform) return openClientBoard(t);
    if (t.dataset.usage !== undefined && S.platform) return openUsage();
    if (t.dataset.health !== undefined && S.platform) return openHealth();
    if (t.id === "homeBtn") return backToPlatform();
    if (t.dataset.clientowner && S.platform) return askClientOwner(t.dataset.clientowner);
    if (t.id === "qClear") { S.q = ""; S.other = null; $("q").value = ""; show("qClear", false); setMain(renderBoard(), "board"); $("q").focus(); return; }
    if (t.dataset.othersheet) { var oq = t.dataset.otherreg; S.other = null; await openArchived(t.dataset.othersheet, oq); searchOtherDays(); window.scrollTo(0, 0); return; }
    if (t.dataset.removedlist !== undefined) { $("menu").close(); return openRemoved(); }
    if (t.dataset.tutorials !== undefined) { if ($("menu").open) $("menu").close(); return openTutorials(); }
    if (t.dataset.tutorial) return openTutorials(t.dataset.tutorial);
    if (t.dataset.notifyon !== undefined) return turnOnNotifications(t);
    if (t.dataset.notifyoff !== undefined) return turnOffNotifications(false);
    if (t.dataset.notifytest !== undefined) return sendTest(t, false);
    if (t.dataset.discordtest !== undefined) return sendTest(t, true);
    if (t.dataset.discordpause) return setDiscordPaused(t, t.dataset.discordpause === "1");
    if (t.dataset.bssave !== undefined) return saveBookingSite(t, false);
    if (t.dataset.bsclear !== undefined) { if (confirm("Remove the booking website login?")) saveBookingSite(t, true); return; }
    if (t.dataset.discordsave !== undefined) return saveDiscord(t, false);
    if (t.dataset.discordclear !== undefined) { if (confirm("Stop posting " + brandName() + " alerts to Discord?")) saveDiscord(t, true); return; }
    if (t.dataset.resetsettings !== undefined) { S.settingsDraft = Object.assign({}, TIMING_DEFAULT); render(); return; }
    if (t.dataset.filter) { keyModeSet(false); S.filter = t.dataset.filter; S.boardQueue = ""; render(); return; }
    if (t.closest("#tallyFold")) return toggleTallyFold();
    if (t.dataset.actf) { S.actFilter = t.dataset.actf; return render(); }
    if (t.dataset.cat) { S.catFilter = S.catFilter === t.dataset.cat ? "" : t.dataset.cat; render(); return; }
    if (t.dataset.deskbook !== undefined) return openDeskBooking();
    if (t.dataset.dktoday !== undefined) return deskToday(t.dataset.dktoday);
    if (t.dataset.dkyard) { var on = t.classList.contains("on"); document.querySelectorAll("#dkYard button").forEach(function (b) { b.classList.remove("on"); }); if (!on) t.classList.add("on"); return; }
    if (t.dataset.tally !== undefined) { S.yardFilter = S.yardFilter === t.dataset.tally ? "" : t.dataset.tally; render(); return; }
    var r = rowOf(t);
    if (r && t.dataset.addflight !== undefined) return openQuickFlight(r, S.view === "flights");
    if (t.dataset.fillflights !== undefined) { var m0 = missingFlights()[0]; if (m0) openQuickFlight(m0, true); return; }
    if (r && t.dataset.open !== undefined) return openPanel(r);
    if (r && t.dataset.act) { if (t.closest(".pacts") && $("panel").open) $("panel").close(); return t.dataset.act === "called" ? tapCalled(r) : tapDrop(r, t.dataset.act); }
    if (r && t.dataset.pick) return tapPick(r, "intake", t.dataset.pick);
    if (r && t.dataset.pt !== undefined) {
      if (r.pt_at) return tapPick(r, "pt");
      return ptStart(r);
    }
    if (t.dataset.archretry !== undefined) { S.arch.days = null; render(); return; }
    if (t.dataset.bipreset) { var a1=S.autoImport; if(a1 && !a1.running && !a1.checking){a1.custom=Number(t.dataset.bipreset)!==3;a1.from=biToday();a1.to=addDaysKey(biToday(),Number(t.dataset.bipreset)-1);a1.preview=null;a1.error='';render();}return; }
    if (t.dataset.manualcheck !== undefined) { if(S.imp) S.imp.pending=null; return checkManualImport(); }
    if (t.dataset.manualfilter) { S.imp.filter=t.dataset.manualfilter;render();return; }
    if (t.dataset.manualincoming) return manualIncoming(t.dataset.manualincoming);
    if (t.dataset.manualopen) return manualOpen(t.dataset.manualopen);
    if (t.dataset.manualkeep) { delete S.imp.selected[t.dataset.manualkeep];S.imp.plan.items.forEach(function(i){if(i.key===t.dataset.manualkeep){i.reason='Current details kept for this import. No change will be applied.';}});render();return; }
    if (t.dataset.importreview !== undefined) {S.imp.stage='preview';return checkManualImport();}
    if (t.dataset.importboard) {await switchSheet(t.dataset.importboard,{});S.view='board';render();return;}
    if (t.dataset.importlog !== undefined) {S.view='summary';S.actFilter='IMPORT';render();return;}
    if (t.dataset.impkind) { S.imp = newImport(t.dataset.impkind); render(); return; }
    if (t.dataset.undoimport && !t.closest("#panel")) return undoImport(t.dataset.undoimport, t);
    if (t.dataset.bitab) { S.bi.tab = t.dataset.bitab; render(); return; }
    if (t.dataset.bifilter) { S.bi.f = t.dataset.bifilter; render(); return; }
    if (t.dataset.birow !== undefined) {
      var open = t.getAttribute("aria-expanded") !== "true"; t.setAttribute("aria-expanded", open ? "true" : "false");
      t.closest(".bi-row").classList.toggle("open", open); if (open) S.bi.open[t.dataset.birow] = 1; else delete S.bi.open[t.dataset.birow];
      return;
    }
    if (t.dataset.schedadd !== undefined && S.autoImport) return biSchedChange(S.autoImport, function (d) { d.times.push("12:00"); });
    if (t.dataset.schedrm !== undefined && S.autoImport) { var i2 = Number(t.dataset.schedrm); return biSchedChange(S.autoImport, function (d) { d.times.splice(i2, 1); }); }
    if (t.dataset.schedsave !== undefined && S.autoImport) return biSchedSave(S.autoImport);
    if (t.dataset.birangereset !== undefined) { var bb = S.autoImport; if (bb) { bb.custom = false; bb.preview = null; bb.error = ""; render(); } return; }
    if (t.dataset.autopreview !== undefined) return previewAutoImport();
    if (t.dataset.reviewdone !== undefined) return reviewDone(t.dataset.reviewdone);
    if (t.dataset.rvopen) return revOpen(t.dataset.rvopen);
    if (t.dataset.rvmove) return revMoveGo(t.dataset.rvmove, t);
    if (t.dataset.rvremove) return revRemoveGo(t.dataset.rvremove, t);
    if (t.dataset.autorun !== undefined) return runAutoImport(t);
    if (t.dataset.read !== undefined) return readImport();
    if (t.dataset.restart !== undefined) { S.imp = newImport(S.imp.kind); render(); return; }
    if (t.dataset.create !== undefined) return createSheet();
    if (t.dataset.reloadlog !== undefined) { S.activity = null; render(); return; }
    if (t.dataset.dashjump) {
      var target = document.getElementById('dash-' + t.dataset.dashjump);
      if (target) {
        if (target.tagName === 'DETAILS') target.open = true;
        var focus = (target.tagName === 'DETAILS' && target.querySelector('summary')) || target;
        focus.focus({ preventScroll: true }); target.scrollIntoView({ block: 'start', behavior: 'auto' });
      }
      return;
    }
    if (t.dataset.dashdates !== undefined) {
      S.dashAllDates = !S.dashAllDates; render();
      var datesBtn = document.querySelector('[data-dashdates]');
      if (datesBtn) { datesBtn.focus({ preventScroll: true }); datesBtn.scrollIntoView({ block: 'nearest' }); }
      return;
    }
    if (t.dataset.dashp) { S.dashDays = t.dataset.dashp; S.dash = null; render(); return; }
    if (t.dataset.dashreload !== undefined) { S.dash = null; S.dashLive = undefined; render(); return; }
    if (t.dataset.dashsheet) return switchSheet(t.dataset.dashsheet, { filter: "todo", queue: t.dataset.dashqueue || "", force: true });
    if (t.dataset.savehandover !== undefined) return saveHandover(t);
    if (t.dataset.queueclear !== undefined) { S.boardQueue = ""; render(); return; }
    if (t.dataset.reset) {
      var p = S.staff[t.dataset.reset];
      if (!confirm("Give " + p.name + " a new link and PIN? Their old link stops working.")) return;
      var got = await staffAction({ action: "reset", staff_id: p.id }, t); if (got) { S.issued = got; render(); window.scrollTo(0, 0); } return;
    }
    if (t.dataset.onoff) {
      var q = S.staff[t.dataset.onoff];
      if (q.active && !confirm("Switch off " + q.name + "? They're signed out and can't use the app. Their history stays.")) return;
      if (await staffAction({ action: q.active ? "off" : "on", staff_id: q.id }, t)) { toast(q.name + (q.active ? " switched off" : " switched on")); render(); } return;
    }
    if (t.dataset.signout !== undefined || t.dataset.forget !== undefined) {
      if (S.queue.length && !confirm(S.queue.length + " change(s) haven't saved yet. Sign out anyway?")) return;
      if (t.dataset.forget !== undefined) { try { localStorage.removeItem(LINK_KEY); localStorage.removeItem(BRAND_KEY); } catch (err) {} }
      await turnOffNotifications(true);
      // "Sign out anyway" drops the unsaved changes (notes can hold customer details).
      try { localStorage.removeItem(queueKey()); } catch (err) {}
      S.queue = [];
      S.me = null; teardown(); await sb.auth.signOut(); showSignIn(); return;
    }
  });
  document.addEventListener("submit", async function (e) {
    if (e.target.id === "archSearch") { e.preventDefault(); return searchArchive(); }
    if (e.target.id === "addCarForm") { e.preventDefault(); return addCar(); }
    if (e.target.id === "deskForm") { e.preventDefault(); return saveDeskBooking(); }
    if (e.target.id === "pinChange") { e.preventDefault(); return changePin(); }
    if (e.target.id === "clientForm") { e.preventDefault(); return saveClient(); }
    if (e.target.id === "clientOwnerForm") { e.preventDefault(); return createClientOwner(); }
    if (e.target.id === "quickForm") {
      e.preventDefault();
      if (quick && quick.noFlight) { var ct = readTime("collectTime"); if (!ct) { toast("Type the collection time like 13:20 (or 1320).", true); return; } return saveQuickFlight("NO FLIGHT", ct); }
      var qs = readTime("quickSched"); if (qs === null) { toast("Type the landing time like 13:20 (or 1320).", true); return; }
      return saveQuickFlight($("quickFlight").value, undefined, qs);
    }
    if (e.target.id !== "addStaff") return;
    e.preventDefault();
    var name = $("newName").value.trim(); if (!name) { toast("Enter the person's name.", true); return; }
    var got = await staffAction({ action: "add", name: name, role: $("newRole").value }, $("addGo"));
    if (got) { S.issued = got; S.addPerson = false; render(); window.scrollTo(0, 0); }
  });
  document.addEventListener("input", function (e) {
    if (e.target.id === "biQ" && S.bi) {
      S.bi.q = e.target.value; var bq = S.bi.q.toLowerCase().replace(/\s+/g, ""), shown = 0, rows = document.querySelectorAll(".bi-row");
      Array.prototype.forEach.call(rows, function (r) { var hide = !!bq && r.getAttribute("data-biq").indexOf(bq) < 0; r.hidden = hide; if (!hide) shown++; });
      var bs = document.getElementById("biShown"); if (bs) bs.textContent = bq ? "Showing " + shown + " of " + rows.length + "." : "";
      return;
    }
    if (e.target.id === "q") { S.q = e.target.value; show("qClear", !!S.q); searchOtherDays(); setMain(renderBoard(), "board"); }
    // Yard colours: the tag beside the picker shows the colour as it's chosen.
    var yc = e.target.dataset && e.target.dataset.ycol;
    if (yc) {
      e.target.removeAttribute("data-off");
      var tag = e.target.parentNode.querySelector(".code"), v = e.target.value;
      if (tag) { tag.style.background = v; tag.style.borderColor = hexMix(v, "#000000", 0.15); tag.style.color = lightColour(v) ? "#1F1A00" : "#FFFFFF"; }
      var nt = e.target.parentNode.querySelector(".note"); if (nt) nt.outerHTML = '<button type="button" class="link" data-ycoff="' + esc(yc) + '">No colour</button>';
    }
    if (S.view === "settings" && e.target.closest("[data-sec]")) showUnsaved();
  });
  document.addEventListener('input',function(e){var t=e.target;if(t.id==='miQ'){S.imp.q=t.value;document.querySelectorAll('[data-miq]').forEach(function(r){r.hidden=t.value&&r.dataset.miq.indexOf(t.value.toLowerCase().replace(/\s+/g,''))<0;});}if(t.id==='biHistoryQ'){S.bi.historyQ=t.value;clearTimeout(S.bi.historyTimer);S.bi.historyTimer=setTimeout(function(){render();var el=$('biHistoryQ');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}},250);}});
  document.addEventListener("change", async function (e) {
    if (e.target.id === "keyYard") { S.keyYard = e.target.value; render(); return; }
    if (e.target.id === "earlyDay" && $("earlyTo")) { $("earlyTo").innerHTML = earlyLabel(earlyDay()); return; }
    var t = e.target;
    if ((t.id === "biFrom" || t.id === "biTo") && S.autoImport) {
      var ba = S.autoImport, br = biRange(ba), nf = t.id === "biFrom" ? t.value : br.from, nt = t.id === "biTo" ? t.value : br.to;
      if (!nf || !nt) return;
      if (t.id === "biFrom" && nf > nt) nt = nf;
      if (t.id === "biTo" && nt < nf) nf = nt;
      if (Math.round((Date.parse(nt + "T12:00:00Z") - Date.parse(nf + "T12:00:00Z")) / 86400000) + 1 > 14) { if (t.id === "biFrom") nt = addDaysKey(nf, 13); else nf = addDaysKey(nt, -13); toast("Up to 14 days at a time.", true); }
      ba.custom = true; ba.from = nf; ba.to = nt; ba.preview = null; ba.error = ""; ba.stale = false; render(); return;
    }
    if (t.id === "schedOn" && S.autoImport) { var on1 = t.checked; return biSchedChange(S.autoImport, function (d) { d.on = on1; }); }
    if (t.dataset.schedtime !== undefined && S.autoImport) { var v1 = t.value, i1 = Number(t.dataset.schedtime); return biSchedChange(S.autoImport, function (d) { d.times[i1] = v1; }); }
    if (t.id === "sheetPick") { if (!leaveOk()) { t.value = S.sheetId; return; } switchSheet(t.value, {}); return; }
    if (t.dataset.yard !== undefined) {
      var r = rowOf(t); if (!r) return;
      var y = t.value;
      t.blur();
      run("set_yard", { p_booking: r.id, p_yard: y }, r, function (x) { x.yard = y; x.yard_before_t = ""; });
      return;
    }
    if (t.dataset.ptfile !== undefined) return ptAdd(t);
    if (t.dataset.deskfile !== undefined) {
      deskPhoto = t.files && t.files[0] || null;
      if (deskPhoto) { $("dkShot").classList.add("done"); $("dkShotTxt").textContent = "Docket photo taken ✓ (tap to retake)"; }
      return;
    }
    if (t.dataset.exitfile !== undefined) { var fx = t.files && t.files[0]; if (fx && panelRow && t.dataset.m) markExit(panelRow, t.dataset.m, fx); return; }
    if (t.dataset.docfile !== undefined) { var f0 = t.files && t.files[0]; if (f0 && panelRow) { toast("Saving the docket photo…"); uploadDoc(panelRow, f0); } return; }
    if (t.dataset.ptmethod !== undefined) return savePtMethod(t);
    if (t.dataset.historymethod !== undefined) {S.bi.historyMethod=t.value;render();return;}
    if (t.dataset.historyday !== undefined) {S.bi.historyDay=t.value;render();return;}
    if (t.dataset.biselect !== undefined) {if(S.autoImport.running||S.autoImport.checking)return;S.bi.selected=S.bi.selected||{};S.bi.selected[t.dataset.biselect]=t.checked;render();return;}
    if (t.dataset.biselectall !== undefined) {if(S.autoImport.running||S.autoImport.checking)return;var checked=t.checked;S.bi.selected={};(S.autoImport.preview.items||[]).forEach(function(i){if(i.status==='new'||i.status==='changed')S.bi.selected[i.kind+'|'+i.ref]=checked;});render();return;}
    if (t.dataset.manualselect !== undefined) {if(S.imp.saving)return;S.imp.selected[t.dataset.manualselect]=t.checked;S.imp.pending=null;render();return;}
    if (t.dataset.manualall !== undefined) {if(S.imp.saving)return;var ck=t.checked;S.imp.plan.items.forEach(function(i){if(manualReady(i))S.imp.selected[i.key]=ck;});S.imp.pending=null;render();return;}
    if (t.dataset.file) { if(S.imp.saving||S.imp.checking||S.imp.stage==="reading")return; var f = t.files && t.files[0]; if (!f) return; S.imp[t.dataset.file + "File"] = f; if(t.dataset.file==="excel"){var fs1=Array.from(t.files);if(S.imp.stage==="pick"&&S.imp.bookingFiles)fs1=S.imp.bookingFiles.concat(fs1).filter(function(x,i,a){return a.findIndex(function(y){return y.name===x.name&&y.size===x.size&&y.lastModified===x.lastModified;})===i;});else S.imp.pdfFile=null;S.imp.bookingFiles=fs1;}S.imp.error="";S.imp.stage="pick";S.imp.plan=null;S.imp.fileInfo=null;S.imp.pending=null;render();return; }
    if (t.dataset.alertpref !== undefined) {
      var P = Object.assign({ drops: true, picks: true, flights: true }, S.notify.prefs); P[t.dataset.alertpref] = t.checked;
      var pr = await sb.rpc("set_alert_prefs", { p_drops: P.drops !== false, p_picks: P.picks !== false, p_flights: P.flights !== false });
      if (pr.error) { t.checked = !t.checked; toast(pr.error.message, true); } else S.notify.prefs = pr.data;
      return;
    }
    if (t.dataset.setting !== undefined) { S.settingsDraft[t.dataset.setting] = t.value; render(); return; }
    if (t.dataset.shortuntil !== undefined) {
      var sh0 = sheet(), val = t.value || null; t.blur();
      var rr = await sb.rpc("set_short_until", { p_sheet: sh0.id, p_day: val });
      if (rr.error) { toast(/set_short_until/.test(rr.error.message) ? "Short dates need database part 6 first." : rr.error.message, true); }
      else { Object.assign(sh0, rr.data); if (!val && /^(short|long)/.test(S.catFilter)) S.catFilter = ""; }
      render(); return;
    }
    if (t.dataset.impdate !== undefined) return buildPreview(t.value);
    if (t.dataset.impcut !== undefined) { S.imp.cutoff = t.value; var keep = S.imp.preview.dateKey; groupImport(); buildPreview(keep === "all" || S.imp.real.dates.indexOf(keep) !== -1 ? keep : "all"); return checkManualImport(); }
    if (t.dataset.fix !== undefined) {
      var v = normFlight(t.value);
      S.imp.preview.rows[+t.dataset.fix].flight = v; return checkManualImport();
    }
  });

  // ── menu ──────────────────────────────────
  function openMenu() {
    if (S.platform) {
      $("menuBody").innerHTML = "<h2>Parking Ops</h2><p class=\"sub\">" + esc(S.me.name) + " · product owner</p><div class=\"menu-list\">" +
        [["clients", "Clients"], ["me", "Me · sign out"]].map(function (x) { return '<button type="button" data-view="' + x[0] + '"' + (S.view === x[0] ? ' aria-current="page"' : "") + ">" + x[1] + "</button>"; }).join("") +
        '</div><div class="pbtns"><button type="button" data-closemenu>Close</button></div>';
      return $("menu").showModal();
    }
    var items = [["board", "Board", true], ["flights", "Flights", true], ["lanes", "Yard planner", lanePlanner()], ["calls", "Calls", callsAddon() && can("called")], ["summary", "Summary and activity", can("summary") || can("log")], ["archive", "Archive: older days and search", can("log")], ["dashboard", "Dashboard", can("settings")],
      ["import", "Import bookings", can("import")], ["staff", "Staff", can("staff")], ["settings", "Settings", can("settings")], ["me", "Me · sign out", true]];
    var sh = sheet();
    var sheetTools = sh && can("import") ? '<label>THIS SHEET · ' + esc(sheetLabel(sh)) + '</label><div class="menu-list">' +
      '<button type="button" data-addcar>Add a car</button>' +
      '<button type="button" data-removedlist>Removed cars' + ((S.removed || []).length ? " (" + S.removed.length + ")" : "") + "</button>" +
      (sh.archived_at ? '<button type="button" data-unarchive="' + sh.id + '">Bring back to the list</button>' : '<button type="button" data-archivesheet="' + sh.id + '">Archive this sheet</button>') +
      '<button type="button" class="danger" data-deletesheet="' + sh.id + '">Delete this sheet</button></div>' : "";
    if (hasFeatures()) { $("menuBody").innerHTML = premiumMenuHtml(items, sh); if (!$("menu").open) { opsMenuPlace(); $("menu").showModal(); } markBnav(); menuVersionCheck(); return; }
    $("menuBody").innerHTML = "<h2>" + esc(S.company.name) + "</h2>" + whoSub() +
      '<div class="menu-list">' + items.filter(function (x) { return x[2]; }).map(function (x) {
        return (x[0] === "me" ? '<button type="button" data-tutorials>Tutorials</button>' : "") + '<button type="button" data-view="' + x[0] + '"' + (S.view === x[0] ? ' aria-current="page"' : "") + ">" + x[1] + "</button>";
      }).join("") + "</div>" + sheetTools + modeHtml() + '<div class="pbtns"><button type="button" data-closemenu>Close</button></div>' + appVersionHtml();
    if (!$("menu").open) $("menu").showModal();
    menuVersionCheck();
  }
  // Premium looks: the menu in sections with icons (Today, Office, This sheet,
  // Display, You), and "Delete this sheet" alone at the bottom, in red.
  var MENU_ICON = {
    lanes: '<path d="M5 3v18M12 3v18M19 3v18M3 7h18M3 17h18"/>',
    board: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    calls: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    flights: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    summary: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
    "import": '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
    staff: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3.2-5.5 6.5-5.5s5.9 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.8 2.6 3 5.2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    removed: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    box: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/>',
    bin: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>'
  };
  function menuIcon(k) { return '<svg class="mi" viewBox="0 0 24 24" aria-hidden="true">' + (MENU_ICON[k] || "") + "</svg>"; }
  function premiumMenuHtml(items, sh) {
    var have = {}, o = isOps(); items.forEach(function (x) { if (x[2]) have[x[0]] = x[1]; });
    // Operations: a Menu page of panels, in the words of its other pages.
    if (o) { if (have.summary) have.stats = "Hourly stats"; Object.assign(have, { board: "Operations board", summary: have.summary && "Shift summary", archive: have.archive && "Archive", staff: have.staff && "Staff & access", me: "Me and sign out" }); }
    var btn = function (k) { return '<button type="button" data-view="' + k + '"' + (S.view === k ? ' aria-current="page"' : "") + ">" + menuIcon(k) + "<span>" + esc(have[k]) + "</span></button>"; };
    // A wide screen: each section in its own panel, side by side.
    var W = function (x) { return x && o && opsDesk() ? '<div class="mgrp">' + x + "</div>" : x; };
    var group = function (title, keys) { keys = keys.filter(function (k) { return have[k]; }); return W(keys.length ? "<label>" + title + '</label><div class="menu-list">' + keys.map(btn).join("") + "</div>" : ""); };
    var h = (o ? "<h2>Menu</h2>" : "<h2>" + esc(S.company.name) + "</h2>") + whoSub() +
      group(o ? "Operations" : "TODAY", ["board", "flights", "calls", "lanes", "summary", "stats"]) + group(o ? "Office" : "OFFICE", ["dashboard", "archive", "import", "staff", "settings"]);
    if (sh && can("import")) {
      h += W("<label>" + (o ? "This sheet<small>" + esc(sheetLabel(sh)) + "</small>" : "THIS SHEET · " + esc(sheetLabel(sh))) + '</label><div class="menu-list">' +
        '<button type="button" data-addcar>' + menuIcon("add") + "<span>Add a car</span></button>" +
        '<button type="button" data-removedlist>' + menuIcon("removed") + "<span>Removed cars" + ((S.removed || []).length ? " (" + S.removed.length + ")" : "") + "</span></button>" +
        (sh.archived_at ? '<button type="button" data-unarchive="' + sh.id + '">' + menuIcon("box") + "<span>Bring back to the list</span></button>"
          : '<button type="button" data-archivesheet="' + sh.id + '">' + menuIcon("box") + "<span>Archive this sheet</span></button>") + "</div>");
    }
    h += W(modeHtml() + swipeMenuHtml()) + W('<label>' + (o ? "You" : "YOU") + '</label><div class="menu-list"><button type="button" data-tutorials>' + menuIcon("play") + "<span>Tutorials</span></button>" + btn("me") + "</div>");
    if (sh && can("import")) h += '<div class="menu-danger"><button type="button" class="danger" data-deletesheet="' + sh.id + '">' + menuIcon("bin") + "<span>Delete this sheet</span></button></div>";
    return h + '<div class="pbtns"><button type="button" data-closemenu>Close</button></div>' + appVersionHtml();
  }
  // Refresh: the button, and (Premium looks) pulling the board down from the top.
  async function refreshAll(btn) {
    if (btn) btn.disabled = true;
    try { await loadSheets(); await loadRows(); S.runs = null; S.activity = null; render(); }
    finally { if (btn) btn.disabled = false; flush(); }
  }

  // ── Premium looks: swipe right on a drop, and pull down to refresh ──
  // A swipe right (and, if they pick one, a swipe left) marks the car with the
  // step this person chooses on their own phone (Menu → Swipe right / left on
  // drops): Sent, Called or Clear. Swipe right
  // starting from their role (bongo Sent, office Called, terminal Clear;
  // others Off). It only ever marks: a car already marked is left alone
  // (undo stays a tap on the button). Picks don't swipe.
  var SWIPE_STEPS = { sent: ["sent", "Sent", "sent_at"], called: ["called", "Called", "called_at"], clear: ["clear", "Clear", "cleared_at"] };
  var SWIPE_ROLE = { bongo: "sent", office: "called", terminal: "clear" };
  var SWIPE_KEY = "takeoff_swipe", SWIPE_LEFT_KEY = "takeoff_swipe_left", SWIPE_ONLY_KEY = "takeoff_swipe_only";
  var SWIPE_AT = 90, PULL_AT = 64, sw = null;
  function swipeChoice() {
    var v = null; try { v = localStorage.getItem(SWIPE_KEY); } catch (e) {}
    if (v !== "off" && !SWIPE_STEPS[v]) v = (S.me && SWIPE_ROLE[S.me.role]) || "off";
    return v !== "off" && !can(v) ? "off" : v;
  }
  function setSwipeChoice(v) { try { localStorage.setItem(SWIPE_KEY, v); } catch (e) {} }
  // A second step on swipe left (Off to start for everyone).
  function swipeLeftChoice() {
    var v = null; try { v = localStorage.getItem(SWIPE_LEFT_KEY); } catch (e) {}
    return SWIPE_STEPS[v] && can(v) ? v : "off";
  }
  function setSwipeLeftChoice(v) { try { localStorage.setItem(SWIPE_LEFT_KEY, v); } catch (e) {} }
  function swipeOn() { return swipeChoice() !== "off" || swipeLeftChoice() !== "off"; }
  function swipeOnlyChoice() { try { return localStorage.getItem(SWIPE_ONLY_KEY) === "1"; } catch (e) { return false; } }
  function setSwipeOnlyChoice(on) { try { if (on) localStorage.setItem(SWIPE_ONLY_KEY, "1"); else localStorage.removeItem(SWIPE_ONLY_KEY); } catch (e) {} }
  // "Swipe only" (this person's choice): no SENT / CALLED / CLEAR buttons on
  // drops; the row shows what is done, and the car's panel keeps the buttons.
  function swipeOnly() {
    var sh = sheet();
    return !!(hasFeatures() && S.me && swipeOn() && swipeOnlyChoice() && sh && sh.kind === "drops");
  }
  // Menu → Display (Premium looks): this phone's swipe step and buttons.
  function swipeMenuHtml() {
    if (!hasFeatures() || S.platform) return "";
    var c = swipeChoice(), l = swipeLeftChoice(), shown = !swipeOnlyChoice();
    var opts = [["off", "Off"]].concat(["sent", "called", "clear"].filter(can).map(function (k) { return [k, SWIPE_STEPS[k][1]]; }));
    var seg = function (title, attr, cls, cur) {
      return "<label>" + title + '</label><div class="pseg mode ' + cls + '">' + opts.map(function (x) {
        return '<button type="button" ' + attr + '="' + x[0] + '" class="' + (cur === x[0] ? "on" : "") + '" aria-pressed="' + (cur === x[0]) + '">' + x[1] + "</button>";
      }).join("") + "</div>";
    };
    return seg(isOps() ? "Swipe right on drops" : "SWIPE RIGHT ON DROPS", "data-swipestep", "swipestep", c) + seg(isOps() ? "Swipe left on drops" : "SWIPE LEFT ON DROPS", "data-swipeleft", "swipestep swipeleft", l) +
      (!swipeOn() ? "" :
        '<button type="button" class="swtoggle" data-swipeonlyme role="switch" aria-checked="' + shown + '"><span>Show buttons on drops</span><i aria-hidden="true"></i></button>');
  }
  function stepStatus(r) {
    var parts = [["sent_at", "sent_by", "Sent", "s"], atDesk(r) ? ["desk_at", "desk_by", "At desk", "c dk"] : ["called_at", "called_by", r.called_word === "Overstay" ? "Overstay" : "Called", "c"], ["cleared_at", "cleared_by", r.clear_word === "COMPLAINT" ? "Complaint" : "Clear", "x"]]
      .filter(function (p) { return r[p[0]]; }).map(function (p) {
        var who = nice(byName(r, p[1]).trim().split(/\s+/)[0]);
        return '<span class="st ' + p[3] + '"><b>' + p[2] + '</b><small class="num">' + esc(hhmm(r[p[0]])) + "</small>" + (who ? "<em>" + esc(who) + "</em>" : "") + "</span>";
      });
    return '<div class="acts steps" data-open>' + (parts.join("") || '<span class="st none">Swipe ›</span>') + "</div>";
  }
  function swipeAction(row, dir) {
    var sh = sheet(), c = !S.me ? "off" : dir === "left" ? swipeLeftChoice() : swipeChoice();
    if (!row || c === "off" || !sh || sh.kind !== "drops" || S.view !== "board") return null;
    return SWIPE_STEPS[c];
  }
  function pullBar() {
    var el = $("ptr");
    if (!el) { el = document.createElement("div"); el.id = "ptr"; el.setAttribute("aria-hidden", "true"); document.body.appendChild(el); }
    return el;
  }
  document.addEventListener("touchstart", function (e) {
    sw = null;
    if (S.switching || !hasFeatures() || !S.me || S.view !== "board" || e.touches.length !== 1 || document.querySelector("dialog[open]")) return;
    var t = e.touches[0];
    sw = { x: t.clientX, y: t.clientY, dx: 0, dy: 0, mode: "", row: e.target.closest("#main .row[data-id]"), top: window.scrollY <= 0 };
  }, { passive: true });
  document.addEventListener("touchmove", function (e) {
    if (!sw || e.touches.length !== 1) return;
    var t = e.touches[0]; sw.dx = t.clientX - sw.x; sw.dy = t.clientY - sw.y;
    if (!sw.mode) {
      if (Math.abs(sw.dx) > 12 && Math.abs(sw.dx) > Math.abs(sw.dy) * 1.4) { sw.dir = sw.dx > 0 ? "right" : "left"; sw.mode = (sw.act = swipeAction(sw.row, sw.dir)) ? "swipe" : "none"; }
      else if (sw.dy > 12 && sw.top && sw.dy > Math.abs(sw.dx)) sw.mode = "pull";
      else if (Math.abs(sw.dy) > 12) sw.mode = "none";
    }
    if (sw.mode === "swipe") {
      var x = sw.dir === "left" ? Math.min(0, Math.max(sw.dx, -150)) : Math.max(0, Math.min(sw.dx, 150)), done = !!rowOf(sw.row) && !!rowOf(sw.row)[sw.act[2]];
      sw.row.classList.toggle("swipe-left", sw.dir === "left");
      sw.row.classList.add("swiping"); sw.row.style.transform = "translateX(" + x + "px)";
      sw.row.setAttribute("data-swipe", done ? "Already " + sw.act[1].toLowerCase() : sw.act[1]);
      sw.row.classList.toggle("swipe-" + sw.act[0], true);
      sw.row.classList.toggle("swipe-go", Math.abs(x) >= SWIPE_AT && !done);
    } else if (sw.mode === "pull") {
      var d = Math.min(sw.dy * 0.5, 90), bar = pullBar();
      bar.style.top = ($("boardHead").getBoundingClientRect().bottom) + "px";
      bar.style.transition = "none"; bar.style.height = d + "px"; bar.className = d >= PULL_AT ? "go" : "";
      bar.textContent = d >= PULL_AT ? "Release to refresh" : "Pull to refresh";
      sw.pull = d;
    }
  }, { passive: true });
  document.addEventListener("touchend", function () {
    if (!sw) return;
    var s0 = sw; sw = null;
    if (s0.mode === "swipe") {
      var row = s0.row, r = rowOf(row), go = s0.dir === "left" ? s0.dx <= -SWIPE_AT : s0.dx >= SWIPE_AT;
      row.classList.remove("swiping", "swipe-go"); row.style.transform = "";
      setTimeout(function () { row.removeAttribute("data-swipe"); row.classList.remove("swipe-" + s0.act[0], "swipe-left"); }, 220);
      if (!go || !r) return;
      if (r[s0.act[2]]) { toast((r.reg || "This car") + " is already " + s0.act[1].toLowerCase() + "."); return; }
      if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) {}
      tapDrop(r, s0.act[0]);
    } else if (s0.mode === "pull") {
      var bar = $("ptr"); if (!bar) return;
      bar.style.transition = "";
      if ((s0.pull || 0) >= PULL_AT) {
        bar.className = "go busy"; bar.textContent = "Refreshing…";
        refreshAll($("refreshBtn")).then(function () { bar.style.height = "0px"; bar.className = ""; });
      } else { bar.style.height = "0px"; bar.className = ""; }
    }
  });
  document.addEventListener("touchcancel", function () {
    if (sw && sw.row) { sw.row.classList.remove("swiping", "swipe-go", "swipe-left"); sw.row.style.transform = ""; sw.row.removeAttribute("data-swipe"); }
    if ($("ptr")) $("ptr").style.height = "0px";
    sw = null;
  });
  $("menu").addEventListener("click", function (e) {
    var out = outside("menu", e);
    if (out || e.target.closest("[data-closemenu]")) $("menu").close();
    // Operations: the menu is a page between the top bar and the bottom bar, so a tap on those still works.
    if (out && isOps()) { var el = document.elementFromPoint(e.clientX, e.clientY), b = el && el.closest("#bnav button, .bar button, .bar select"); if (b && b.dataset.bn !== "menuBtn") b.tagName === "SELECT" ? b.focus() : b.click(); }
  });
  $("menu").addEventListener("close", markBnav);
  // Operations: crossing 900 px wide swaps the board and Flights between their phone and wide-screen layouts.
  if (OPS_DESK_MQ) { var onDesk = function () { if (S.me && isOps()) { render(); if ($("menu").open) opsMenuPlace(); } }; if (OPS_DESK_MQ.addEventListener) OPS_DESK_MQ.addEventListener("change", onDesk); else if (OPS_DESK_MQ.addListener) OPS_DESK_MQ.addListener(onDesk); }
  function opsMenuPlace() {
    if (!isOps()) return;
    var top = document.querySelector(".bar").getBoundingClientRect().bottom, nav = $("bnav").classList.contains("hidden") ? 0 : $("bnav").getBoundingClientRect().height;
    // Wide screen: the tabs are under the top bar, so the menu starts below them and runs to the bottom.
    if (opsDesk() && !$("bnav").classList.contains("hidden")) { top = $("bnav").getBoundingClientRect().bottom; nav = 0; }
    document.documentElement.style.setProperty("--ops-menu-top", Math.max(0, Math.round(top)) + "px");
    document.documentElement.style.setProperty("--ops-menu-bottom", Math.round(nav) + "px");
  }
  $("shiftPick").addEventListener("click", function (e) { if (outside("shiftPick", e)) $("shiftPick").close(); });
  // Activity search (Premium looks): only the list redraws, so the keyboard stays up.
  document.addEventListener("input", function (e) {
    // Flights search (Operations, wide screen): only the tables redraw.
    if (e.target.id === "flQ") { S.flQ = e.target.value; if ($("flTables")) $("flTables").innerHTML = flTablesHtml(); return; }
    if (e.target.id !== "actQ" || !S.activity) return;
    S.actQ = e.target.value; if ($("actList")) $("actList").innerHTML = activityListHtml();
  });
  // The clock, and the CALLED colours that change with waiting time.
  setInterval(function () {
    if (!S.me) return;
    $("clock").textContent = londonParts(new Date()).time;
    if (S.view === "board" && !$("panel").open && !yardOpen() && document.activeElement !== $("q")) render();
  }, 60000);

  // ── staying up to date ──
  // A phone or office computer can keep the app open for days, and fixes then
  // never reach it (26 Sept: an office tab from the morning imported with the
  // old file reader in the evening). The app's own file is checked every 10
  // minutes and when it comes back to the front (a HEAD request: no data).
  // A new version is loaded as soon as nothing is in progress, and always
  // before an import.
  var appTag = "", appTagAt = 0;
  async function appVersion() {
    try {
      var r = await fetch("/app.js", { method: "HEAD", cache: "no-store" });
      return r.ok ? (r.headers.get("etag") || r.headers.get("last-modified") || "") : "";
    } catch (e) { return ""; }
  }
  async function checkForUpdate() {
    if (S.updateReady || Date.now() - appTagAt < 5 * 60000) return;
    appTagAt = Date.now();
    var tag = await appVersion(); if (!tag) return;
    if (!appTag) { appTag = tag; return; }
    if (tag !== appTag) { S.updateReady = true; updateIfSafe(); }
  }
  function updateSafeNow() {
    return !$("panel").open && !$("menu").open && !pt && !camStream && !S.queue.length && !BK.some(function (y) { return y.x.bk === "up"; }) &&
      !(S.view === "import" && S.imp && (S.imp.excelFile || S.imp.stage === "preview" || S.imp.saving)) && !(S.imp && S.imp.saving) &&
      !(document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
  }
  function updateIfSafe() { if (S.updateReady && updateSafeNow()) location.reload(); }
  // Bottom of the menu: which version this phone runs, and whether a newer one is out.
  function appVersionHtml() {
    var short = String(appTag || "").replace(/[^0-9a-f]/gi, "").slice(0, 7).toLowerCase();
    return '<p class="appver">' + (S.updateReady ? '<button type="button" class="link" data-appupdate>New version ready · Update now</button>'
      : short ? "App version " + esc(short) + " · up to date" : "App version not checked yet (no signal?)") + "</p>";
  }
  // Opening the menu checks for a newer version straight away.
  function menuVersionCheck() {
    appTagAt = 0;
    checkForUpdate().then(function () { var el = document.querySelector("#menuBody .appver"); if (el) el.outerHTML = appVersionHtml(); });
  }
  appVersion().then(function (t) { appTag = t; appTagAt = Date.now(); });
  setInterval(function () { checkForUpdate(); updateIfSafe(); }, 60000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { appTagAt = 0; checkForUpdate(); } });

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(function () {});
  start().catch(function (err) { oopsLog(err); bootTrouble(); });
})();
