  // ── overstay charges (database part 23) ──
  // Booked back before the DROPS day end (06:00): free until 12:00 that day,
  // then one day's rate at once and one more at every midnight.
  // Booked back at 06:00 or later: free until 06:00 the next morning, then one
  // day's rate at once and one more at every 06:00. Counted to CLEAR, or to now.
  function overstayDue(r) {
    var rate = +(S.company && S.company.overstay_rate) || 0;
    if (!rate || r.kind !== "drops" || !r.return_at) return null;
    // A stay made longer in the booking system is charged from the first booked return.
    var ret = londonParts(new Date(r.orig_return_at || r.return_at)), end = londonParts(r.cleared_at ? new Date(r.cleared_at) : new Date());
    var dayEnd = ((S.company.drops_day_end) || "06:00").slice(0, 5);
    var dates = function (a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }, days;
    if (ret.time < dayEnd) {
      var later = dates(ret.key, end.key);
      days = later < 0 ? 0 : later === 0 ? (end.time > "12:00" ? 1 : 0) : 1 + later;
    } else {
      // Up to and including 06:00 still belongs to the day before.
      days = dates(ret.key, end.key) - (end.time <= dayEnd ? 1 : 0);
    }
    return days > 0 ? { days: days, amount: days * rate } : null;
  }
  // What's owed now: the office's agreed amount (a discount) when one is set,
  // else the daily-rate sum. An agreed amount stays put; it doesn't go up.
  function chargeDue(r) {
    var d = overstayDue(r);
    if (r.charge_agreed == null || r.charge_agreed === "") return d;
    return { days: d ? d.days : 0, amount: +r.charge_agreed, agreed: true, calc: d ? d.amount : 0 };
  }
  function money(n) { n = +n || 0; return "£" + (n % 1 ? n.toFixed(2) : n); }
  function chargeTag(r) {
    if (r.charge_method) return ' · <span class="tag pd">' + (r.charge_method === "waived" ? "WAIVED" : money(r.charge_amount) + " " + r.charge_method.toUpperCase()) + "</span>";
    var d = chargeDue(r);
    return d && d.amount > 0 ? ' · <span class="tag due">' + money(d.amount) + " DUE</span>" : "";
  }
  function chargePanelHtml(r) {
    var d = chargeDue(r);
    // No charge yet: the office can add one for any reason (database part 52).
    if (!d && !r.charge_method) {
      if (!can("clear") || r.cleared_at) return "";
      if (S.chargeAdd !== r.id) return '<button type="button" class="link" data-chargeadd>+ ADD CHARGE</button>';
      return "<label>ADD A CHARGE</label>" +
        '<div class="when2 chgpay"><input id="chgAmount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="£" aria-label="Amount">' +
        '<input id="chgReason" maxlength="80" placeholder="Reason, e.g. return date changed" aria-label="Reason" style="flex:3!important"></div>' +
        '<div class="when2 chgpay"><button type="button" data-chargeagreed="set">SET AS DUE</button></div>';
    }
    var h = "<label>" + (d && d.calc ? "OVERSTAY CHARGE" : "CHARGE") + "</label>";
    if (r.charge_method) {
      h += '<div class="chgbox pd"><b>' + (r.charge_method === "waived" ? "Waived " + money(r.charge_amount) : money(r.charge_amount) + " paid by " + r.charge_method) + "</b><span>" +
        esc(byName(r, "charge_by")) + (r.charge_at ? " · " + esc(dayShort(r.charge_at) + " " + hhmm(r.charge_at)) : "") + "</span>" +
        (can("clear") ? '<button type="button" class="link" data-chargeundo>Undo</button>' : "") + "</div>";
      return h;
    }
    if (d.agreed) h += '<div class="chgbox"><b>' + money(d.amount) + " due</b><span>" + esc(r.charge_reason || "agreed") + (d.calc ? " · was " + money(d.calc) + " (" + d.days + (d.days === 1 ? " day" : " days") + ")" : "") + "</span>" +
      (can("clear") ? '<button type="button" class="link" data-chargeagreed="">Undo</button>' : "") + "</div>";
    else h += '<div class="chgbox"><b>' + money(d.amount) + " due</b><span>" + d.days + (d.days === 1 ? " day" : " days") + " × " + money(S.company.overstay_rate) + (r.cleared_at ? "" : " · so far, still going up") + "</span></div>";
    if (can("clear")) h += '<div class="when2 chgpay"><input id="chgAmount" type="number" inputmode="decimal" min="0" step="0.01" value="' + d.amount + '" aria-label="Amount">' +
      '<button type="button" data-chargeagreed="set">SET AS DUE</button></div>' +
      '<div class="when2 chgpay"><button type="button" data-charge="cash">CASH</button><button type="button" data-charge="card">CARD</button><button type="button" data-charge="waived">WAIVE</button></div>' +
      '<div class="hint">Change the amount for a discount: SET AS DUE saves it for everyone, or CASH / CARD takes it now.</div>';
    return h;
  }
  function recordCharge(r, method) {
    var amt = method === "" ? null : parseFloat(($("chgAmount") || {}).value);
    if (method && (isNaN(amt) || amt < 0)) return toast("Check the amount.", true);
    if (method === "waived") { var d = chargeDue(r); amt = d ? d.amount : amt; }
    run("set_overstay_paid", { p_booking: r.id, p_amount: amt, p_method: method }, r, function (x) {
      x.charge_amount = method ? amt : null; x.charge_method = method; x.charge_at = method ? nowIso() : null; x.charge_by = method ? S.me.id : null; markBy(x, "charge_by");
    });
    toast(method === "" ? "Charge cleared" : method === "waived" ? "Waived" : money(amt) + " " + method + " recorded");
  }
  // An agreed amount (a discount) before it's paid; "" puts back the daily-rate sum.
  function setAgreed(r, how) {
    var amt = how ? parseFloat(($("chgAmount") || {}).value) : null;
    if (how && (isNaN(amt) || amt < 0 || (amt === 0 && !overstayDue(r)))) return toast("Check the amount.", true);
    // A new charge keeps its reason; changing an existing one keeps the reason it had.
    var why = how ? ($("chgReason") ? $("chgReason").value.trim() : (r.charge_reason || "")) : "";
    run("set_overstay_agreed", { p_booking: r.id, p_amount: amt, p_reason: why }, r, function (x) { x.charge_agreed = amt; x.charge_reason = amt == null ? "" : why; });
    S.chargeAdd = null;
    toast(how ? money(amt) + " due, saved" : overstayDue(r) ? "Back to the daily rate" : "Charge removed");
  }
  // The flights check couldn't find this number among the day's arrivals, or
  // it isn't a flight number at all (TBC, …): the office needs to look.
  function flightToCheck(r) {
    if (!r.flight || r.flight === "NO FLIGHT" || r.cleared_at) return false;
    // Flight found but landing far from when they booked to be back: it has
    // the flight's time (for the order) and still needs a look.
    if (/over 6 h from the booked time/.test(r.flight_note)) return true;
    if (r.sched_time) return false;
    return /check the flight number$/.test(r.flight_note) || !/^([A-Z0-9]{2}\d{1,5}|[A-Z]{3}\d{1,4})$/.test(r.flight);
  }
  // The car's tags on a line of their own under the flight and times, and only
  // when there are any, so the times stay on one line and no tag (e.g. £30
  // DUE) is ever hidden under the buttons.
  function rowTags(r, tags) {
    tags = tags.filter(Boolean);
    return tags.length ? '<div class="l2 l2t" data-open>' + tags.join(" ") + "</div>" : "";
  }
  // The DROPS card for the Cards look: the reg is the hero, the make/flight and
  // booked → landing time read on one line, the flight status on its own, then
  // the three full-width buttons. Same data and taps as the standard row.
  function flightLine(r) {
    if (r.flight_status === "landed") return '<div class="fst land">Landed</div>';
    if (r.flight_status === "cancelled") return '<div class="fst stop">Flight cancelled</div>';
    if (r.est_time === "DELAY") return '<div class="fst stop">Delayed</div>';
    if (r.flight_status === "expected" && r.est_time) return '<div class="fst due">Expected ' + esc(r.est_time) + "</div>";
    return "";
  }
  // Premium Board's drop row: the flight's state as a word beside the times.
  function flightWord(r) {
    if (r.flight_status === "landed") return ' <i class="fst land">Landed</i>';
    if (r.flight_status === "cancelled") return ' <i class="fst stop">Cancelled</i>';
    if (r.est_time === "DELAY") return ' <i class="fst stop">Delayed</i>';
    return "";
  }
  function dropCard(r, cls, overWord, cmpl, canc, over) {
    var booked = r.early ? r.sched_time : (r.sched_time || hhmm(r.return_at) || "—");
    var eta = canc ? "" : r.est_time;
    var mk = makeOnly(r.make) ? esc(niceMake(makeOnly(r.make))) : "";
    var flt = r.flight ? esc(r.flight) : can("flights") ? '<button type="button" class="addflight" data-addflight>+ FLIGHT</button>' : "";
    var mid = [mk, flt].filter(Boolean).join(" · ");
    var times = booked ? '<span class="bk">booked ' + esc(booked) + (eta && eta !== "DELAY" && eta !== booked ? ' &rarr; <b>' + esc(eta) + "</b>" : "") + "</span>" : "";
    return '<div class="row' + cls + (S.pending[r.id] ? " busy" : "") + '" data-id="' + r.id + '">' +
      '<div class="left"><div class="l1"><button type="button" class="reg" data-open>' + esc(r.reg || "NO REG") + "</button>" + yardChip(r) +
      catTag(r) + wasTag(r) + (r.num && isBoard() ? '<span class="dn num">#' + r.num + "</span>" : "") + '<span class="pin">' + (r.num && !isBoard() ? "#" + r.num + " · " : "") + esc(nice(r.name)) + "</span></div>" +
      // Premium Board: two lines like the old rows, the times on the right of line 2.
      (isBoard()
        ? '<div class="l2 cl2" data-open><span class="l2a">' + (mid || "&nbsp;") + '</span><span class="l2b">' + esc(booked || "") +
          (eta && eta !== "DELAY" && eta !== booked ? ' &rarr; <b>' + esc(eta) + "</b>" : "") + flightWord(r) + "</span></div>"
        : '<div class="l2" data-open>' + mid + (mid && times ? " · " : "") + times + "</div>" + flightLine(r)) +
      rowTags(r, [flightToCheck(r) ? '<span class="tag ck">' + (/^Not in the timetable/.test(r.flight_note) ? "CHECK MANUALLY"
        : /over 6 h from the booked time/.test(r.flight_note) && r.return_at ? "CHECK FLIGHT · BOOKED " + esc(hhmm(r.return_at)) : "CHECK FLIGHT NO.") + "</span>" : "",
        over ? '<span class="tag ov">OVERSTAY</span>' : "", cmpl ? '<span class="tag cm">COMPLAINT</span>' : "", chargeTag(r).replace(/^ · /, ""), exitTag(r)]) +
      earlyLine(r) + noteLine(r) + "</div>" + (swipeOnly() ? stepStatus(r) + "</div>" : dropButtons(r, overWord, cmpl) + "</div>");
  }
  function dropButtons(r, overWord, cmpl, extra) {
    return '<div class="acts' + (extra || "") + '"' + (extra ? ' data-id="' + r.id + '"' : "") + ">" +
      actBtn(r, 'data-act="sent"', "s", "SENT", !!r.sent_at, r.sent_at, can("sent"), byName(r, "sent_by")) +
      actBtn(r, 'data-act="called"', "c" + (overWord ? " ov" : ""), overWord ? "OVERSTAY" : "CALLED", !!r.called_at, r.called_at, can("called"), byName(r, "called_by")) +
      actBtn(r, 'data-act="clear"', "x" + (cmpl ? " cm" : ""), cmpl ? "COMPLAINT" : "CLEAR", !!r.cleared_at, r.cleared_at, can("clear"), byName(r, "cleared_by")) +
      "</div>";
  }
  function dropRow(r) {
    var cmpl = r.clear_word === "COMPLAINT", bang = /^!/.test(r.note), overWord = r.called_word === "Overstay";
    var canc = r.flight_status === "cancelled", over = r.overstay || overWord;
    var cls = "";
    if (cmpl || (bang && !r.cleared_at)) cls = " cmpl";
    else if (r.cleared_at) cls = " done";
    else if (over) cls = " ovst";
    else if (r.called_at) { var w = minsSince(r.called_at); cls = w > LATE_MINS ? " late" : w > WARN_MINS ? " warn" : " called"; }
    if (isCards()) return dropCard(r, cls, overWord, cmpl, canc, over);
    if (opsDesk()) return opsDeskRow(r, cls, overWord, cmpl, canc, over);
    // An early return shows no booked time here (it was for another day): the EARLY tag says when.
    var booked = r.early ? r.sched_time : (r.sched_time || hhmm(r.return_at) || "—");
    var eta = canc ? "" : r.est_time;
    // The card's time block (Cards look only; hidden in the others).
    var big = eta && eta !== "DELAY" ? eta : booked;
    var rt = '<div class="rt" data-open><b class="num' + (eta === "DELAY" ? " dly" : eta && r.flight_status === "expected" ? " exp" : "") + '">' + esc(big || "—") + "</b><small>" + esc(r.flight || "No flight") + "</small>" +
      (eta && booked && eta !== booked ? '<i class="num">booked ' + esc(booked) + "</i>" : "") + (r.flight_status === "landed" ? '<i class="ld">Landed</i>' : "") + "</div>";
    return '<div class="row' + cls + (S.pending[r.id] ? " busy" : "") + '" data-id="' + r.id + '">' + rt +
      '<div class="left"><div class="l1"><button type="button" class="reg" data-open>' + esc(r.reg || "NO REG") + "</button>" + yardChip(r) +
      (r.num ? '<span class="dn num">#' + r.num + "</span>" : "") + keyBox(r) + catTag(r) + wasTag(r) + '<span class="pin">' + esc(nice(r.name)) + "</span></div>" +
      '<div class="l2 num" data-open><span class="l2a">' + (makeOnly(r.make) ? '<span class="mk">' + esc(niceMake(makeOnly(r.make))) + "</span>" : "") +
      '<span class="flp' + (r.flight ? " has" : "") + '">' + (makeOnly(r.make) ? " · " : "") + (r.flight ? esc(r.flight) : can("flights") ? '<button type="button" class="addflight" data-addflight>+ FLIGHT</button>' : "—") + "</span></span>" +
      '<span class="l2b">' + (booked ? " · " + esc(booked) : "") +
      (eta ? ' &rarr; <span class="eta' + (eta === "DELAY" ? " dly" : "") + (r.flight_status === "expected" ? " exp" : "") + '">' + esc(eta) + "</span>" : "") +
      (r.flight_status === "landed" ? ' <span class="tag ld">LANDED</span>' : "") + "</span></div>" +
      // Not in the day's timetable: the flight may still be on, so the office checks by hand.
      rowTags(r, [flightToCheck(r) ? '<span class="tag ck">' + (/^Not in the timetable/.test(r.flight_note) ? "CHECK MANUALLY"
        : /over 6 h from the booked time/.test(r.flight_note) && r.return_at ? "CHECK FLIGHT · BOOKED " + esc(hhmm(r.return_at)) : "CHECK FLIGHT NO.") + "</span>" : "", canc ? '<span class="tag cx">CANCELLED</span>' : "",
        over ? '<span class="tag ov">OVERSTAY</span>' : "", cmpl ? '<span class="tag cm">COMPLAINT</span>' : "", chargeTag(r).replace(/^ · /, ""), exitTag(r)]) +
      earlyLine(r) + noteLine(r) + "</div>" +
      // "Show buttons on drops" off (Standard with features): what's done instead of buttons.
      (swipeOnly() ? stepStatus(r) : dropButtons(r, overWord, cmpl)) + "</div>";
  }

  // Short words on the row, so the customer's name still fits on a phone.
  // DROPS: SAME DAY when the car was met on the sheet's day, NEXT DAY when it
  // was met the day before (one night away).
  function dropCat(r) {
    var sh = sheet();
    if (!sh || sh.kind !== "drops" || !r.drop_at || r.early) return "";
    var d = londonParts(new Date(r.drop_at)).key;
    return d === sh.day ? "same" : d === addDaysKey(sh.day, -1) ? "next" : "";
  }
  // Return moved to a later day in the booking system: the day it was first due back.
  function wasTag(r) {
    if (r.kind !== "drops" || !r.orig_return_at) return "";
    var d = returnDay({ return_at: r.orig_return_at });
    return d ? '<span class="cat was">WAS ' + dayWord(d) + "</span>" : "";
  }
  function catTag(r) { var c = r.kind === "drops" ? dropCat(r) : catOf(r); return c ? '<span class="cat ' + c + '">' + c.toUpperCase() + "</span>" : ""; }
  // Location on PICKS (Clients → Edit, brand.picks_yard): the row's NO SHOW
  // button becomes the car's location (the company's yards); NO SHOW is in
  // the car's panel. Anyone who takes cars in can set it (database part 67).
  function picksYard() { return !!(S.company && S.company.brand && S.company.brand.picks_yard); }
  // Exit fee (Settings, owners only, database part 76): the bookings whose
  // reference starts with a listed start don't pay it. Compared by letters
  // and numbers only, so "Cpd 19660209" starts with CPD.
  function refKey(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function exitFee() { return +(S.company && S.company.exit_fee) || 0; }
  function exitFree(r) {
    var k = refKey(r.ref), list = S.company.exit_free || [];
    return exitFee() > 0 && !!k && list.some(function (x) { return x && k.indexOf(x) === 0; });
  }
  function exitTag(r) {
    if (exitFree(r)) return '<span class="tag pd">NO EXIT FEE</span>';
    return r.exit_method && exitFee() > 0 ? '<span class="tag pd">EXIT ' + money(r.exit_amount) + " " + r.exit_method.toUpperCase() + "</span>" : "";
  }
  // The car's EXIT FEE box (DROPS): paid by cash or card, with a photo of the
  // payment; or what's due, CASH / CARD opening the camera first.
  function exitPanelHtml(r) {
    if (r.kind !== "drops" || !(exitFee() > 0) || exitFree(r)) return "";
    var h = "<label>" + L("EXIT FEE") + "</label>";
    if (r.exit_method) return h + '<div class="chgbox pd exitbox"><b>' + money(r.exit_amount) + " paid by " + esc(r.exit_method) + "</b><span>" +
      esc(byName(r, "exit_by")) + (r.exit_at ? " · " + esc(dayShort(r.exit_at) + " " + hhmm(r.exit_at)) : "") + "</span>" +
      (can("clear") ? '<button type="button" class="link" data-exitundo>Undo</button>' : "") + "</div>" +
      (r.exit_photo ? '<div class="docbox"><a class="docimg" id="exitImg" target="_blank" rel="noopener"><span class="note">Loading photo…</span></a></div>' : '<p class="hint">No photo of the payment.</p>');
    h += '<div class="chgbox exitbox"><b>' + money(exitFee()) + " due</b><span>Take a photo of the payment, then it's marked paid.</span></div>";
    if (!can("clear")) return h;
    return h + '<div class="when2 chgpay exitpay"><button type="button" data-exitshot="cash">📷 CASH</button><button type="button" data-exitshot="card">📷 CARD</button>' +
      '<input type="file" id="exitFile" accept="image/*" capture="environment" data-exitfile hidden></div>' +
      '<button type="button" class="link" data-exitnophoto="cash">Cash, no photo</button> <button type="button" class="link" data-exitnophoto="card">Card, no photo</button>';
  }
  async function markExit(r, method, file) {
    r = S.rows.filter(function (x) { return x.id === r.id; })[0] || r;
    var path = "";
    if (file) {
      toast("Saving the photo…");
      try {
        var small = await bkSmall(file, true);
        path = S.company.id + "/docs/" + r.id + "/x" + Date.now() + ".jpg";
        var up = await sb.storage.from("pt-photos").upload(path, small.blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
      } catch (e) { return toast("The photo didn't save: " + ((e && e.message) || e), true); }
    }
    run("set_exit_paid", { p_booking: r.id, p_method: method, p_photo: path }, r, function (x) {
      x.exit_method = method; x.exit_amount = method ? exitFee() : null; x.exit_at = method ? nowIso() : null; x.exit_by = method ? S.me.id : null; markBy(x, "exit_by"); x.exit_photo = path;
    });
    toast(method ? "Exit fee " + money(exitFee()) + " " + method + " recorded" : "Exit fee cleared");
    if (panelRow && panelRow.id === r.id && $("panel").open) openPanel(r);
  }
  async function fillExit(r) {
    var u = await sb.storage.from("pt-photos").createSignedUrl(r.exit_photo, 3600);
    var a = $("exitImg"); if (!a || !panelRow || panelRow.id !== r.id) return;
    if (u.error || !u.data) { a.innerHTML = '<span class="note">Photo not found.</span>'; return; }
    a.href = u.data.signedUrl; a.innerHTML = '<img alt="Photo of the payment" src="' + esc(u.data.signedUrl) + '">';
  }
  function pickYardBtn(r) {
    var on = !!r.yard, lab = on ? esc(YARD_LABEL[r.yard] || r.yard) : "YARD";
    if (!can("intake")) return '<button type="button" class="pyard' + (on ? " on y-" + esc(r.yard) : "") + '" disabled>' + lab + "</button>";
    return '<label class="pyard' + (on ? " on y-" + esc(r.yard) : "") + '"><span>' + lab + '</span><select data-yard aria-label="Location of ' + esc(r.reg) + '"><option value="">' + (on ? "— none" : "Choose") + "</option>" +
      (S.company.yards || []).map(function (y) { return "<option" + (y === r.yard ? " selected" : "") + ' value="' + esc(y) + '">' + esc(YARD_LABEL[y] || y) + "</option>"; }).join("") + "</select></label>";
  }
  function pickRow(r) {
    var bang = /^!/.test(r.note);
    var cls = r.intake === "Collected" ? " coll" : r.intake === "No Show" ? " nosh" : r.intake === "RTC" ? " rtc" : bang ? " cmpl" : "";
    if (opsDesk()) return opsDeskPickRow(r, cls);
    return '<div class="row' + cls + (S.pending[r.id] ? " busy" : "") + '" data-id="' + r.id + '">' +
      '<div class="rt" data-open><b class="num">' + esc(hhmm(r.drop_at) || "—") + "</b><small>Drop-off</small></div>" +
      (isBoard() ? pickLinesBoard(r) :
      '<div class="left"><div class="l1"><button type="button" class="reg" data-open>' + esc(r.reg || "NO REG") + "</button>" +
      (r.num ? '<span class="dn num">#' + r.num + "</span>" : "") + catTag(r) + '<span class="pin">' + esc(nice(r.name)) + "</span></div>" +
      // Just the make on the row; the full car and booking ref are in the car's panel.
      '<div class="l2 num" data-open><span class="l2a">' + (makeOnly(r.make) ? '<span class="mk">' + esc(niceMake(makeOnly(r.make))) + "</span>" : "") + '<span class="dp">' + (makeOnly(r.make) ? " · " : "") + "drop " + esc(hhmm(r.drop_at) || "—") + "</span>" + pickFlight(r) + (S.ptUnsaved[r.id] && r.pt_at ? ' · <span class="tag due">PT NOT SAVED</span>' : "") + (r.pick_called ? ' · <span class="tag' + (r.pick_called === "New Booking" ? ' nb">NEW BOOKING' : '">' + esc(r.pick_called)) + "</span> " + esc(hhmm(r.pick_called_at)) : "") + "</span></div>" +
      noteLine(r) + "</div>") +
      pickActs(r) + "</div>";
  }
  // COLL, NO SHOW (or the car's location), RTC and PT: the same buttons on every layout.
  function pickActs(r) {
    function b(v, c, label, perm) { return actBtn(r, 'data-pick="' + v + '"', c, label, r.intake === v, r.intake_at, can("intake") && (!perm || can(perm)), byName(r, "intake_by")); }
    return '<div class="acts">' + b("Collected", "k", "COLL") + (picksYard() ? pickYardBtn(r) : b("No Show", "n", "NO SHOW")) + b("RTC", "r", "RTC", "rtc") +
      actBtn(r, "data-pt", "p", "PT", !!r.pt_at, r.pt_at, can("intake"), byName(r, "pt_by")) + "</div>";
  }

  // The return flight the customer gave at drop-off (typed in the car), after the drop time.
  function pickFlight(r) { return r.flight ? ' · <span class="pfl">' + esc(r.flight) + "</span>" : ""; }
  function canPickFlight() { return can("intake") || can("flights"); }

  // Premium Board's two-line pick row, like the old board: plate, number, tag and name, then car and drop time.
  function pickLinesBoard(r) {
    var mk = makeOnly(r.make) ? '<span class="mk">' + esc(niceMake(makeOnly(r.make))) + "</span>" : "";
    var extra = (S.ptUnsaved[r.id] && r.pt_at ? ' <span class="tag due">PT NOT SAVED</span>' : "") +
      (r.pick_called ? ' · <span class="tag' + (r.pick_called === "New Booking" ? ' nb">NEW BOOKING' : '">' + esc(r.pick_called)) + "</span> " + esc(hhmm(r.pick_called_at)) : "");
    return '<div class="left"><div class="l1"><button type="button" class="reg" data-open>' + esc(r.reg || "NO REG") + "</button>" +
      (r.num ? '<span class="dn num">#' + r.num + "</span>" : "") + catTag(r) + '<span class="pin">' + esc(nice(r.name)) + "</span></div>" +
      '<div class="l2 cl2 num" data-open><span class="l2a">' + (mk ? mk + " · " : "") + "drop " + esc(hhmm(r.drop_at) || "—") + pickFlight(r) + extra + "</span></div>" + noteLine(r) + "</div>";
  }

  function sheetDayOf(r) { var sh = S.sheets.filter(function (x) { return x.id === r.sheet_id; })[0]; return sh ? sh.day : ""; }
  function rowOf(el) { var c = el.closest("[data-id]"); return c ? S.rows.filter(function (r) { return r.id === c.dataset.id; })[0] : null; }
  function nowIso() { return new Date().toISOString(); }

  function tapDrop(r, action, word) {
    var field = { sent: "sent_at", called: "called_at", clear: "cleared_at" }[action];
    var on = word ? !(r[field] && (action === "called" ? r.called_word : r.clear_word) === word) : !r[field];
    run("tap_drop", { p_booking: r.id, p_action: action, p_on: on, p_word: word || "" }, r, function (x) {
      if (action === "sent") {
        if (on) { x.yard_before_t = x.yard; x.yard = "T"; x.sent_at = nowIso(); x.sent_by = S.me.id; }
        else { if (x.yard === "T" && x.yard_before_t) x.yard = x.yard_before_t; x.yard_before_t = ""; x.sent_at = null; x.sent_by = null; }
        markBy(x, "sent_by");
      } else if (action === "called") {
        // OVERSTAY taken off a car due back on this sheet was a mis-tap (part 95).
        if (!on && x.called_word === "Overstay" && !x.early && returnDay(x) && returnDay(x) >= sheetDayOf(x)) x.overstay = false;
        x.called_word = on ? (word || "Called") : ""; x.called_at = on ? nowIso() : null; x.called_by = on ? S.me.id : null; markBy(x, "called_by");
        if (on && word === "Overstay") x.overstay = true;
      } else {
        x.clear_word = on ? (word || "Collected") : ""; x.cleared_at = on ? nowIso() : null; x.cleared_by = on ? S.me.id : null; markBy(x, "cleared_by");
      }
    });
    // CALLED on a car booked back on a later day: they're coming back early,
    // so offer to move it onto tonight's sheet there and then.
    if (action === "called" && on && !word && canEarly(r)) {
      var sh = S.sheets.filter(function (x) { return x.id === r.sheet_id; })[0];
      setTimeout(function () {
        if (confirm((r.reg || "This car") + " is booked back " + sheetLabel(sh) + ". Coming back early?\n\nOK moves it to tonight's sheet (" + sheetLabel({ kind: "drops", day: currentShiftKey() }) + ")."))
          earlyMove(r, { disabled: false }, false, true);
      }, 50);
    }
  }
