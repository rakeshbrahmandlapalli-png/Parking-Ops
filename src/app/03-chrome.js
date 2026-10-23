  // ── chrome ────────────────────────────────
  // The header is the one the team already knows from the Sheet app: sheet
  // picker, who is signed in, and a row of icon buttons. The yard tally, TO DO /
  // ALL, search and column captions belong to the board only.
  var OPS_TITLE = { summary: "Shift summary", stats: "Hourly stats", staff: "Staff & access" }, BN_VIEW = { logBtn: "summary", psBtn: "stats", flBtn: "flights" };
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
    var fn = { lanes: renderLanes, stats: renderStats, clients: renderClients, board: renderBoard, flights: renderFlights, summary: renderSummary, dashboard: renderDashboard, import: renderImport, staff: renderStaff, settings: renderSettings, archive: renderArchive, me: renderMe }[S.view] || renderBoard;
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
  function go(view) { if (S.view === "settings" && view !== "settings" && !leaveOk()) { if ($("menu").open) $("menu").close(); return false; } if (S.platform && view !== "me") view = "clients"; if (view === "import" && S.updateReady && !S.queue.length && !pt && !camStream && !BK.length) { location.reload(); return; } if (view === "import") S.recentImports = null; if (view === "lanes" && !lanePlanner()) view = "board"; if (view === "lanes") { LP.error = ""; loadLanes(); } S.view = view; S.settingsDraft = null; if (view === "summary") S.activity = null; if (view === "dashboard") { S.dash = null; S.dashLive = undefined; } if ($("menu").open) $("menu").close(); render(); window.scrollTo(0, 0); }

