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
