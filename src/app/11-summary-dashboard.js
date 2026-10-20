  // ── summary + activity ────────────────────
  function renderSummary() {
    var sh = sheet(), h = "";
    if (sh && can("summary")) {
      if (sh.kind === "drops") {
        var d = S.rows;
        var due = d.filter(function (r) { return /£/.test(r.note); }), D = dropsStats();
        var back = d.filter(function (r) { return r.cleared_at; }).length;
        if (isOps()) h += opsSub(sh) + '<div class="stats">' + kstat("back", "Cars back", back + " / " + d.length, progressBar(back, d.length), "big") + "</div>" +
          opsStrip([["On the way", d.filter(function (r) { return r.sent_at && !r.cleared_at; }).length], ["Overstays", d.filter(function (r) { return r.overstay; }).length], ["Complaints", d.filter(function (r) { return r.clear_word === "COMPLAINT" || /^!/.test(r.note); }).length]]) +
          opsPanel("Shift progress", "Collected / due", opsTable(null, [["Morning<small>06:00–17:30</small>", D.morning.done + " / " + D.morning.due], ["Night<small>17:31–05:59</small>", D.night.done + " / " + D.night.due]]));
        else h += '<h2 class="title">' + esc(sheetLabel(sh)) + '</h2><div class="stats">' +
          kstat("back", "Cars back", back + " / " + d.length, progressBar(back, d.length), hasFeatures() ? "big" : "") +
          kstat("way", "On the way", d.filter(function (r) { return r.sent_at && !r.cleared_at; }).length) +
          kstat("over", "Overstays", d.filter(function (r) { return r.overstay; }).length) +
          kstat("comp", "Complaints", d.filter(function (r) { return r.clear_word === "COMPLAINT" || /^!/.test(r.note); }).length) +
          kstat("morn", "Morning 06:00–17:30", D.morning.done + " / " + D.morning.due, miniBar(D.morning.done, D.morning.due)) +
          kstat("night", "Night 17:31–05:59", D.night.done + " / " + D.night.due, miniBar(D.night.done, D.night.due)) + "</div>";
        h += (due.length ? '<div class="section-label">Money due</div><div class="box">' + due.map(function (r) { return '<div class="rowline"><div class="grow"><strong>' + esc(r.reg) + "</strong> · " + esc(r.name) + '<div class="note">' + esc(r.note) + "</div></div></div>"; }).join("") + "</div>" : "");
      } else {
        var p = S.rows, hours = {};
        p.filter(function (r) { return r.intake === "Collected"; }).forEach(function (r) { var k = hhmm(r.intake_at).slice(0, 2); hours[k] = (hours[k] || 0) + 1; });
        var cin = p.filter(function (r) { return r.intake === "Collected"; }).length;
        if (isOps()) h += opsSub(sh) + '<div class="stats">' + kstat("back", "Cars in", cin + " / " + p.length, progressBar(cin, p.length), "big") + "</div>" +
          opsStrip([["Still to come", p.filter(function (r) { return !r.intake; }).length], ["No shows", p.filter(function (r) { return r.intake === "No Show"; }).length], ["RTC", p.filter(function (r) { return r.intake === "RTC"; }).length]]) +
          opsPanel("Cars in by collection hour", "", hourBars(hours), "By the time each car was taken in. Hourly stats uses the booked arrival time.");
        else h += '<h2 class="title">' + esc(sheetLabel(sh)) + '</h2><div class="stats">' +
          kstat("back", "Cars in", cin + " / " + p.length, progressBar(cin, p.length), hasFeatures() ? "big" : "") +
          kstat("noshow", "No shows", p.filter(function (r) { return r.intake === "No Show"; }).length) +
          kstat("rtc", "RTC", p.filter(function (r) { return r.intake === "RTC"; }).length) +
          kstat("come", "Still to come", p.filter(function (r) { return !r.intake; }).length) + "</div>" +
          '<div class="section-label">Cars in by hour</div>' + (hasFeatures() ? hourBars(hours) : '<div class="box">' + (Object.keys(hours).sort().map(function (k) { return '<div class="rowline"><span class="num grow">' + k + ':00</span><strong class="num">' + hours[k] + "</strong></div>"; }).join("") || '<div class="empty">None yet.</div>') + "</div>");
      }
    }
    var mid = h.length;
    if (can("log")) {
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
  function kstat(k, label, value, extra, cls) {
    var zero = /^(0|£0|0 \/ 0)$/.test(String(value));
    return '<div class="stat k-' + k + (zero ? " zero" : "") + (cls ? " " + cls : "") + '"><svg class="ki" viewBox="0 0 24 24" aria-hidden="true">' + (KICON[k] || "") + "</svg><span>" + label + '</span><strong class="num">' + value + "</strong>" + (extra || "") + "</div>";
  }
  function miniBar(done, all) { return '<span class="mbar" aria-hidden="true"><i style="width:' + (all ? Math.round(done / all * 100) : 0) + '%"></i></span>'; }
  function progressBar(done, all) {
    if (!hasFeatures() || !all) return "";
    var pc = Math.round(done / all * 100);
    return '<div class="pbar" role="progressbar" aria-valuemin="0" aria-valuemax="' + all + '" aria-valuenow="' + done + '"><i style="width:' + pc + '%"></i></div><small class="pbar-pc">' + pc + '% done</small><div class="pring" aria-hidden="true" style="--pc:' + pc + '" data-pc="' + pc + '%"></div>';
  }
  // Which part of the work an activity line is about, for the filter chips.
  var PICK_ACTIONS = { INTAKE: 1, PT: 1, "PT PHOTOS": 1, "PT COPY": 1, "SHORT DATES": 1, "COLLECTION TIME": 1 };
  function actKind(a) {
    if (a.action === "STAFF") return "staff";
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
    N.removedBy = { "No show": tn("no_show", removed.filter(function (r) { return r.removed_reason === "No show"; }).length), Cancelled: tn("cancelled", removed.filter(function (r) { return r.removed_reason === "Cancelled"; }).length), Duplicate: tn("duplicate", removed.filter(function (r) { return r.removed_reason === "Duplicate"; }).length) };
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
      tile("Removed", N.removed, ["No show", "Cancelled", "Duplicate"].map(function (k) { var n = N.removedBy[k]; return n ? n + " " + k.toLowerCase() : ""; }).filter(Boolean).join(" · ")) +
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

    var h = '<div class="ops-dashboard ops-v2 od"><div class="od-head"><h1>Dashboard</h1><div class="od-tools"><span class="od-updated ops-updated">Updated ' + esc(hhmm(S.dashUpdated)) + '</span><button type="button" class="od-refresh" data-dashreload>Refresh</button><div class="dchips" role="group" aria-label="Period">' + DASH_PERIODS.map(function (p) {
      var on = p[0] === (S.dashDays || "7");
      return '<button type="button" data-dashp="' + p[0] + '" class="' + (on ? "on" : "") + '" aria-pressed="' + on + '">' + p[1] + "</button>";
    }).join("") + "</div></div></div>";

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
        ["removed", "Removed", NN.removed, ["No show", "Cancelled", "Duplicate"].map(function (k) { var n = NN.removedBy[k]; return n ? n + " " + k.toLowerCase() : ""; }).filter(Boolean).join(" · ")],
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

