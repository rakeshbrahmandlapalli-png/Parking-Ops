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
    var items = [["board", "Board", true], ["flights", "Flights", true], ["lanes", "Yard planner", lanePlanner()], ["summary", "Summary and activity", can("summary") || can("log")], ["archive", "Archive: older days and search", can("log")], ["dashboard", "Dashboard", can("settings")],
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
      group(o ? "Operations" : "TODAY", ["board", "flights", "lanes", "summary", "stats"]) + group(o ? "Office" : "OFFICE", ["dashboard", "archive", "import", "staff", "settings"]);
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

