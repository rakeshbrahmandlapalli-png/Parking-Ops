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

