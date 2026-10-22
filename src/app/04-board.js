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
    soon: ["Due in the next 2 hours, not sent", function (r) { return r.kind === "drops" && waiting(r) && orderAt(r) <= new Date(Date.now() + 2 * 3600000).toISOString(); }]
  };
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
  var deskPhoto = null;
  function openDeskBooking() {
    var sh = sheet(); if (!sh) return;
    deskPhoto = null;
    var now = londonParts(new Date());
    function f(id, label, attrs) { return '<label for="' + id + '">' + label + '</label><input id="' + id + '" ' + (attrs || "") + ">"; }
    $("panelBody").innerHTML = '<h2 id="panelTitle">New booking <small>' + esc(sheetLabel(sh)) + "</small></h2>" +
      '<form id="deskForm" novalidate>' +
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
    var sh = sheet(), reg = $("dkReg").value.trim();
    if (!reg) return toast("Enter the registration.", true);
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
    toast(x.data.reg + " added" + (photo ? " · saving the docket photo…" : ""));
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
      wait.sort(function (a, b) { return a.called_at < b.called_at ? -1 : 1; });   // longest wait first
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
  var RF_WORDS = { COLL: "Coll", "NO SHOW": "No show", SENT: "Sent", CALLED: "Called", CLEAR: "Clear", OVERSTAY: "Overstay", COMPLAINT: "Complaint" };
  var PRO_WORDS = { COLL: "Collected", "NO SHOW": "No show", SENT: "Sent", CALLED: "Called", CLEAR: "Clear", OVERSTAY: "Overstay", COMPLAINT: "Complaint" };
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
