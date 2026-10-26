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
    if (!S.me || S.me.id !== me.data.id || S.me.company_id !== me.data.company_id) resetNotificationCentre();
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
    startNotificationCentre(); startCallQueue();
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
        if (S.live) loadCallQueue();
        if (S.live && liveLost) {
          if (keyAllowed()) loadKeys(S.sheetId);
          var gone = liveLostAt; liveLost = false;
          (Date.now() - gone < QUICK_BACK ? catchUp(gone - 10000) : loadRows()).then(function () { if (!$("panel").open && !yardOpen()) render(); });
        }
        if (was && !S.live) { liveLost = true; liveLostAt = Date.now(); }
      });
  }
  var liveLost = false, liveLostAt = 0;
  function teardown() { resetCallQueue(); resetNotificationCentre(); resetLanes(); if (channel) sb.removeChannel(channel); channel = null; liveLost = false; S.rows = []; S.keys = null; keyLoadSeq++; clearTimeout(keyLiveTimer); snapForget(); }

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

