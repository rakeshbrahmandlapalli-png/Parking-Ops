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
  function renderFlights() {
    var sh = sheet();
    if (!sh || sh.kind !== "drops") return '<div class="msg">Choose a DROPS sheet at the top to see its flights.</div>';
    if (!S.runs) loadRuns();
    var all = S.rows.filter(function (r) { return r.flight; }).sort(function (a, b) { return orderAt(a) < orderAt(b) ? -1 : 1; });
    var manual = all.filter(flightToCheck), rows = all.filter(function (r) { return !flightToCheck(r); });
    function n(st) { return rows.filter(function (r) { return r.flight_status === st; }).length; }
    function last(src) {
      var run0 = (S.runs || []).filter(function (x) { return x.source === src; })[0];
      if (!run0) return "never";
      var res = run0.result || {};
      return esc(dayShort(run0.at) + " " + hhmm(run0.at)) + (res.error ? ' · <span class="bad">' + esc(res.error) + "</span>" : "");
    }
    if (opsDesk()) return opsFlightsDesk(sh);
    if (isOps()) return opsFlights(sh, all, rows, manual, n);
    var h = '<div class="pad"><h2 class="title">' + esc(sheetLabel(sh)) + "</h2>" +
      '<div class="stats"><div class="stat"><span>Flights</span><strong class="num">' + all.length + '</strong></div><div class="stat"><span>Landed</span><strong class="num">' + n("landed") +
      '</strong></div><div class="stat"><span>Delayed or late</span><strong class="num">' + (n("delayed") + n("expected")) + '</strong></div><div class="stat"><span>Cancelled</span><strong class="num">' + n("cancelled") +
      '</strong></div></div><p class="note">Timetable last checked: ' + last("schedule") + "<br>Live positions last checked: " + last("live") + "</p>" +
      (canCheckFlights() ? '<div class="row-actions">' + checksLeftHtml() + '<button type="button" class="btn small" data-filltimes>Fill times · AeroData</button><button type="button" class="btn small" data-checkflights>Check flights now</button></div>' : "") +
      "</div>" + missingHtml() + manualHtml(manual) + (missingFlights().length || manual.length ? '<div class="sec">WITH FLIGHT NUMBERS</div>' : "");
    return h + (rows.length ? rows.map(function (r) {
      return '<div class="row frow' + (r.flight_status === "cancelled" || r.flight_status === "delayed" ? " late" : r.flight_status === "landed" ? " done" : "") + (r.flight_status ? " fs-" + esc(r.flight_status) : "") + '" data-id="' + r.id + '"><div class="left" data-open><div class="l1"><span class="reg">' + esc(r.flight) + '</span><span class="dn">' + esc(r.reg) + '</span><span class="pin">' + esc(nice(r.name)) + "</span></div>" +
        '<div class="l2 num"><span class="l2a">' + esc(FLIGHT_WORD[r.flight_status] || r.flight_status) + (r.flight_note ? " · " + esc(r.flight_note) : "") + '</span><span class="l2b">' + (isPremium() ? "" : " · ") + esc(r.sched_time || hhmm(r.return_at)) +
        (r.est_time ? ' &rarr; <span class="eta' + (r.est_time === "DELAY" ? " dly" : "") + '">' + esc(r.est_time) + "</span>" : "") + "</span></div></div></div>";
    }).join("") : '<div class="msg">No flight numbers on this sheet.</div>');
  }
  // Operations: the numbers in a strip, then each flight with its times and a status badge.
  function opsFlights(sh, all, rows, manual, n) {
    function run(src) { return (S.runs || []).filter(function (x) { return !src || x.source === src; })[0]; }
    var lastRun = run(), tt = run("schedule");
    var h = opsSub(sh) + '<div class="ops-acts ops-check"><span class="ops-dot' + (lastRun ? "" : " never") + '">' + (lastRun ? "Checked at " + esc(hhmm(lastRun.at)) : "Not checked yet") + "</span>" +
      (canCheckFlights() ? checksLeftHtml() + '<button type="button" class="btn ghost small" data-filltimes>Fill times · AeroData</button><button type="button" class="btn small" data-checkflights>Check flights</button>' : "") + "</div>" +
      opsStrip([["Flights", all.length], ["Landed", n("landed")], ["Delayed", n("delayed") + n("expected")], ["Cancelled", n("cancelled")]]) +
      missingHtml() + manualHtml(manual);
    function mins(t) { return /^\d{2}:\d{2}$/.test(t || "") ? +t.slice(0, 2) * 60 + +t.slice(3) : null; }
    var list = rows.map(function (r) {
      var st = r.flight_status || "", sched = r.sched_time || hhmm(r.return_at), est = r.est_time || "";
      var late = mins(est) !== null && mins(sched) !== null ? (mins(est) - mins(sched) + 1440 + 720) % 1440 - 720 : 0;
      var word = st === "landed" ? "Landed" : st === "cancelled" ? "Cancelled" : (st === "delayed" || st === "expected") && late > 0 ? "Delayed +" + late + " min" : st === "delayed" ? "Delayed" : FLIGHT_WORD[st] || st;
      var tone = st === "landed" ? "ok" : st === "cancelled" ? "bad" : st === "delayed" || st === "expected" ? "warn" : "";
      return '<div class="ops-fl fs-' + esc(st || "none") + '" data-id="' + r.id + '"><div class="ops-flin" data-open>' +
        '<b class="num">' + esc(r.flight) + '</b><span class="ops-flcar"><span class="num">' + esc(r.reg) + "</span><small>" + esc(nice(r.name)) + "</small></span>" +
        '<span class="ops-flt"><small>Scheduled</small><span class="num">' + esc(sched || "—") + "</span></span>" +
        (est ? '<span class="ops-flt"><small>' + (st === "landed" ? "Landed" : "Expected") + '</small><span class="num">' + esc(est === "DELAY" ? "Delayed" : est) + "</span></span>" : "<span></span>") +
        '<em class="ops-badge ' + tone + '">' + esc(word) + (r.flight_note && st !== "landed" ? " · " + esc(r.flight_note) : "") + "</em></div></div>";
    }).join("");
    return h + opsPanel("Flight status", tt ? "Timetable updated at " + hhmm(tt.at) : "", list || '<p class="ops-foot">No flight numbers on this sheet.</p>');
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

