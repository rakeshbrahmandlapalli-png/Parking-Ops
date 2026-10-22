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
      h += opsStrip([["Due back", D.total.due], ["Sent", D.total.sent], ["Collected", D.total.done], ["Still to collect", D.total.due - D.total.done]]) + statsCols(
        opsPanel("Returns by booked hour", desk ? "Due and collected" : "", (desk ? statBars(D.hours.map(function (x) { return [x.label, x.due, x.done]; })) : "") + opsTable(["Hour", "Due", "Sent", "Collected"],
          D.hours.map(function (x) { return [esc(x.label), x.due, x.sent, x.done]; }).concat(D.over.due ? [["Overstays", D.over.due, D.over.sent, D.over.done]] : []),
          ["Total", D.total.due, D.total.sent, D.total.done]), D.over.due ? "Overstays are separate from the morning and night shifts." : ""),
        opsPanel("Shift breakdown", "Collected / due", opsTable(null, [["Morning<small>06:00–17:30</small>", D.morning.done + " / " + D.morning.due], ["Night<small>17:31–05:59</small>", D.night.done + " / " + D.night.due]])) +
        opsPanel("Collected lately", "", opsTable(null, [["Last 30 minutes", D.last30], ["Last 60 minutes", D.last60]])) +
        (owed.length ? opsPanel("Overstay money", "", opsTable(null, owed.map(function (x) { return [esc(x[0]), x[1]]; }))) : ""));
    } else {
      var P = picksStats(), cats = catLines();
      h += opsStrip([["Scheduled", P.totalSched], ["Completed", P.totalDone], ["Last 30 min", P.last30], ["Last 60 min", P.last60]]) + statsCols(
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

