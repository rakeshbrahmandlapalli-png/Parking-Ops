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
    var parts = [["sent_at", "sent_by", "Sent", "s"], ["called_at", "called_by", r.called_word === "Overstay" ? "Overstay" : "Called", "c"], ["cleared_at", "cleared_by", r.clear_word === "COMPLAINT" ? "Complaint" : "Clear", "x"]]
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
