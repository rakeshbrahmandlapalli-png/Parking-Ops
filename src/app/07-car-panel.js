  // ── car panel ─────────────────────────────
  var panelRow = null;
  // Booking files give UK mobiles as 447…, 7… or 07…; without the + or the 0
  // the phone can't dial them. Anything else is dialled as written.
  // Some bookings carry the number twice ("7868615571 7868615571") or two
  // numbers: take the first whole number (UK numbers are written in pieces,
  // "07868 615571", so pieces are joined until there are 10 digits).
  function firstPhone(p) {
    var acc = "";
    String(p || "").split(/[^\d+]+/).filter(Boolean).some(function (g) { acc += g; return acc.replace(/\D/g, "").length >= 10; });
    return acc;
  }
  function dialable(p) {
    var d = firstPhone(p).replace(/[^\d+]/g, "");
    if (/^44\d{10}$/.test(d)) return "+" + d;
    if (/^7\d{9}$/.test(d)) return "0" + d;
    return d;
  }
  function phoneLabel(p) {
    var d = dialable(p);
    if (/^\+447\d{9}$/.test(d)) return "+44 " + d.slice(3, 7) + " " + d.slice(7);
    if (/^07\d{9}$/.test(d)) return d.slice(0, 5) + " " + d.slice(5);
    return firstPhone(p) || String(p);
  }
  // ── early returns (database part 29) ──
  // Booked back on a later day but coming back early: the car moves onto the
  // DROPS sheet for the night picked (tonight unless changed; part 75), marked
  // EARLY. Undo puts it back.
  // The day of the sheet the car is on ("" when that sheet isn't loaded).
  function carSheetDay(r) { var s = S.sheets.concat(S.archiveSheet ? [S.archiveSheet] : []).filter(function (x) { return x.id === r.sheet_id; })[0]; return (s && s.day) || ""; }
  function canEarly(r) {
    if (r.kind !== "drops" || r.early || r.cleared_at || !can("called")) return false;
    var here = S.sheets.filter(function (x) { return x.id === r.sheet_id; })[0];
    return !!here && here.day > currentShiftKey();
  }
  // The night they're coming: tonight up to the night before the booked day.
  function earlyPickHtml(before, attr) {
    var today = currentShiftKey(), last = addDaysKey(before, -1);
    return fld('<label for="earlyDay">' + L("COMING BACK") + '</label><input id="earlyDay" type="date" value="' + today + '" min="' + today + '" max="' + last + '">', true) +
      '<button type="button" id="earlyTo" class="btn ghost ptgo" ' + attr + ">" + earlyLabel(today) + "</button>";
  }
  function earlyLabel(day) { return "EARLY RETURN · add to " + esc(sheetLabel({ kind: "drops", day: day })); }
  function earlyDay() {
    var el = $("earlyDay"), today = currentShiftKey();
    return el && /^\d{4}-\d{2}-\d{2}$/.test(el.value) && el.value > today ? el.value : today;
  }
  function earlyWhen(day) { return day === currentShiftKey() ? "tonight's sheet" : sheetLabel({ kind: "drops", day: day }); }
  function earlyHtml(r) {
    if (!can("called") || r.cleared_at) return "";
    if (r.early) {
      var from = S.sheets.filter(function (x) { return x.id === r.moved_from; })[0];
      return '<button type="button" class="link" data-undoearly>Undo early return' + (from ? " (back to " + esc(sheetLabel(from)) + ")" : "") + "</button>";
    }
    if (!canEarly(r)) return "";
    var here = S.sheets.filter(function (x) { return x.id === r.sheet_id; })[0];
    return earlyPickHtml(here.day, "data-early");
  }
  async function earlyMove(r, btn, undo, asked) {
    var day = asked ? currentShiftKey() : earlyDay();
    if (!undo && !asked && !confirm("Move " + (r.reg || "this car") + " to " + earlyWhen(day) + " as an early return?")) return;
    btn.disabled = true;
    var x = await sb.rpc(undo ? "undo_early_return" : "early_return", undo || asked ? { p_booking: r.id } : { p_booking: r.id, p_day: day });
    btn.disabled = false;
    if (x.error) return toast(x.error.message, true);
    $("panel").close();
    // Follow the car to the sheet it's on now.
    S.sheetId = x.data.sheet_id; S.q = ""; S.yardFilter = "";
    await loadSheets(); await loadRows(); flashId = x.data.id; render();
    toast((r.reg || "Car") + (undo ? " is back on its booked day." : " moved to " + earlyWhen(day) + " as an early return."));
  }
  // From the PICKS car (parts 74, 75): its booked day's DROPS sheet may not be
  // imported yet, so this makes its DROPS car on the night picked, marked EARLY.
  function pickEarlyHtml(r) {
    if (r.kind !== "picks" || r.intake !== "Collected" || !can("called") || !(returnDay(r) > currentShiftKey())) return "";
    return earlyPickHtml(returnDay(r), "data-pearly");
  }
  async function earlyFromPicks(r, btn) {
    var day = earlyDay();
    if (!confirm((r.reg || "This car") + " is booked back " + dayShort(r.return_at) + " " + hhmm(r.return_at) + ". Coming back early?\n\nOK adds it to " + earlyWhen(day) + " as an early return.")) return;
    btn.disabled = true;
    var x = await sb.rpc("early_return_from_picks", { p_picks: r.id, p_day: day });
    btn.disabled = false;
    if (x.error) return toast(x.error.message, true);
    $("panel").close();
    S.sheetId = x.data.sheet_id; S.q = ""; S.yardFilter = "";
    await loadSheets(); await loadRows(); flashId = x.data.id; render();
    toast((r.reg || "Car") + " added to " + earlyWhen(day) + " as an early return.");
  }
  // The office changes the return (the customer rang): DROPS cars, and PICKS cars, whose DROPS car follows (database part 78).
  function canReturn(r) { return can("import") && (r.kind === "picks" || (r.kind === "drops" && !r.early && !r.cleared_at)); }
  function openPanel(r) {
    if (S.switching || (r && r.sheet_id && S.sheetId && r.sheet_id !== S.sheetId)) return;
    // Operations Refined: drawn again after a tap that saves at once (yard, charge), it keeps what was typed.
    var draft = isRefined() && $("panel").open && panelRow && panelRow.id === r.id && $("carState") ? carDraft() : null;
    panelRow = r;
    var drops = r.kind === "drops";
    function by(at, who) { return at ? esc(hhmm(at)) + (who ? " · " + esc(who) : "") : "—"; }
    var det = [["NAME", esc(r.name) || "—"], ["CAR", /^[-\s.]*$/.test(r.make || "") ? "—" : esc(r.make)], ["REF", esc(r.ref) || "—"]];
    if (exitFee() > 0) det.push(["EXIT FEE", exitFree(r) ? "None for this booking" : r.exit_method ? money(r.exit_amount) + " paid, " + esc(r.exit_method) : money(exitFee())]);
    if (drops) {
      det.push(["MEET", r.drop_at ? esc(dayShort(r.drop_at) + " " + hhmm(r.drop_at)) : "—"]);
      det.push(["BACK", esc(dayShort(r.return_at) + " " + hhmm(r.return_at)) + (r.orig_return_at ? ' <span class="hint">· was ' + esc(dayShort(r.orig_return_at) + " " + hhmm(r.orig_return_at)) + "</span>" : "")]);
      det.push(["FLIGHT", esc(r.flight || "—") + (r.sched_time ? " · sched " + esc(r.sched_time) : "")]);
      if (r.est_time || r.flight_note) det.push(["ARRIVAL", (r.est_time ? "<b>" + esc(r.est_time) + "</b> " : "") + '<span class="hint">' + esc(r.flight_note) + "</span>"]);
      det.push(["SENT", by(r.sent_at, byName(r, "sent_by"))], [r.called_word === "Overstay" ? "OVERSTAY" : "CALLED", by(r.called_at, byName(r, "called_by"))]);
      if (atDesk(r)) det.push(["AT DESK", by(r.desk_at, byName(r, "desk_by"))]);
      det.push([r.clear_word === "COMPLAINT" ? "COMPLAINT" : "CLEAR", by(r.cleared_at, byName(r, "cleared_by"))]);
    } else {
      det.push(["DROP-OFF", esc(dayShort(r.drop_at) + " " + hhmm(r.drop_at))], ["BACK", esc(dayShort(r.return_at) + " " + hhmm(r.return_at))]);
      if (r.intake) det.push([esc(r.intake.toUpperCase()), by(r.intake_at, byName(r, "intake_by"))]);
    }
    // Operations: "Booking details" with the reg under it, the details in two
    // columns, and the boxes in sections, each with a plain name.
    var o = isOps(), desk = o && opsDesk(), R = "", rf = isRefined();
    var h = o ? '<button type="button" class="ops-x" data-close aria-label="Close">&times;</button><h2 id="panelTitle">Booking details</h2>' +
        (rf ? '<p class="sub"><b class="rf-reg">' + esc(r.reg || "NO REG") + "</b>" + (r.num ? ' <span class="rf-num">#' + r.num + "</span>" : "") + " · " + esc(refinedSheetLabel(sheet() || { day: "", kind: r.kind })) + "</p>"
          : '<p class="sub">' + esc(r.reg || "NO REG") + (r.num ? " #" + r.num : "") + " · " + esc(sheetLabel(sheet() || { day: "", kind: r.kind })) + "</p>")
      : '<h2 id="panelTitle">' + esc(r.reg || "NO REG") + (r.num ? " <small>#" + r.num + "</small>" : "") + "</h2>" +
      '<p class="sub">' + esc(sheetLabel(sheet() || { day: "", kind: r.kind })) + "</p>";
    var headEnd = h.length;
    var tel = r.phone ? '<a class="tel" href="tel:' + esc(dialable(r.phone)) + '">Call ' + esc(phoneLabel(r.phone)) + "</a>" : "";
    function detList(list) { return '<div class="det">' + list.map(function (x) { return "<div><b>" + L(x[0]) + "</b><span>" + x[1] + "</span></div>"; }).join("") + "</div>"; }
    // Operations Refined: a tap here saves at once, unlike the boxes saved by Save changes.
    var NOW = rf ? '<small class="rf-now">Saves when tapped</small>' : "";
    // A booking can come with no reg: the office can type or correct it, a
    // driver can fill in a missing one when the car comes in.
    var canReg = can("import") || (can("intake") && !r.reg);
    // Swipe instead of buttons: the buttons live here, to undo or fix a swipe.
    var steps = drops && swipeOnly() ? '<label>' + L("STEPS") + NOW + '</label>' + dropButtons(r, r.called_word === "Overstay", r.clear_word === "COMPLAINT", " pacts") : "";
    var parking = canReg || canReturn(r) || (drops ? can("yard") : picksYard() && can("intake")) || (drops ? can("flights") : canPickFlight());
    var regF = canReg ? fld('<label for="regText">' + L("REG") + '</label><input id="regText" value="' + esc(r.reg) + '" autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="Type the reg">', true) : "";
    // A customer rang to come back another day: the office changes it here too.
    // The first booked return is kept (WAS tag, charge), and the new day's file
    // finds this car rather than adding it again (database part 48).
    // The booking site moved the drop-off: the office moves the car to that day (part 102).
    var dropF = "", retF = "", yardF = "", flightF = "", pickFlightF = "";
    // Operations Refined: the date and the time as two boxes side by side, each named.
    function when(d, t, word, p) {
      return rf ? fld('<label for="' + d + '">' + word + ' date</label><input id="' + d + '" type="date" value="' + esc(p.key) + '">') + fld('<label for="' + t + '">' + word + " time</label>" + timeBox(t, p.time))
        : fld('<label for="' + d + '">' + L(word === "Drop-off" ? "DROP-OFF DATE AND TIME" : "BACK DATE AND TIME") + '</label><div class="when2"><input id="' + d + '" type="date" value="' + esc(p.key) + '">' + timeBox(t, p.time) + "</div>", true);
    }
    if (!drops && can("import") && !r.removed_at) {
      var dp = r.drop_at ? londonParts(new Date(r.drop_at)) : { key: "", time: "" }, onDay = carSheetDay(r);
      dropF = when("dropD", "dropT", "Drop-off", dp);
      // Added to another day's sheet (a desk booking with tomorrow's board open): Save moves it (part 114).
      if (dp.key && onDay && dp.key !== onDay) dropF += '<p class="dropday" id="dropDay">On the ' + esc(dayShort(onDay + "T12:00:00Z")) + " sheet. Save moves it to " + esc(dayShort(dp.key + "T12:00:00Z")) + ".</p>";
    }
    if (canReturn(r)) retF = when("retD", "retT", "Return", r.return_at ? londonParts(new Date(r.return_at)) : { key: "", time: "" });
    if (drops ? can("yard") : picksYard() && can("intake")) {
      yardF = fld('<label>' + L(drops ? "YARD" : "LOCATION") + NOW + '</label><div class="pseg yard">' + (S.company.yards || []).map(function (y) {
        return '<button type="button" data-setyard="' + esc(y) + '" class="' + (r.yard === y ? "on y-" + esc(y) : "") + '"' + (rf ? ' aria-pressed="' + (r.yard === y) + '"' : "") + ">" + esc(YARD_LABEL[y] || y) + "</button>";
      }).join("") + "</div>", true);
    }
    var flightNo = "", flightTime = "";
    if (drops && can("flights")) {
      flightNo = fld('<label for="flightText">' + L("FLIGHT NUMBER") + '</label><input id="flightText" value="' + esc(r.flight) + '" autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="or NO FLIGHT">');
      if (r.flight === "NO FLIGHT") flightTime = fld('<label for="collectText">' + L("COLLECTION TIME") + '</label>' + timeBox("collectText", /^\d{2}:\d{2}$/.test(r.est_time) ? r.est_time : ""));
      else flightTime = fld('<label for="schedText">' + L("SCHEDULED LANDING") + '</label>' + timeBox("schedText", /^\d{2}:\d{2}$/.test(r.sched_time) ? r.sched_time : ""));
      flightF = flightNo + flightTime;
    }
    // The return flight, when the booking came without one: it goes on to the DROPS car (database part 78).
    if (!drops && canPickFlight()) pickFlightF = fld('<label for="pickFlightText">' + L("RETURN FLIGHT") + '</label><input id="pickFlightText" value="' + esc(r.flight) + '" autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="e.g. W43451">');
    var docs = docBlockHtml(r);
    var noteF = can("note") ? fld('<label for="noteText">' + L("NOTE") + '</label><textarea id="noteText" maxlength="500">' + esc(r.note) + '</textarea>', true) : "";
    var extra = "", W = function (t) { return rf ? sentence(t) : t; }, AP = function (on) { return rf ? ' aria-pressed="' + on + '"' : ""; };
    if (drops) {
      // CALLED and AT DESK here too: the row's button goes CALLED ↔ AT DESK, so CALLED comes off here (part 112).
      if (can("called")) extra += '<button type="button" data-word="called:Called" class="' + (r.called_word === "Called" && r.called_at ? "on" : "") + '"' + AP(r.called_word === "Called" && !!r.called_at) + ">" + W("CALLED") + "</button>";
      // AT DESK needs its own permission only (part 115); on a car not called yet it is for those who can call.
      if (can("desk") && r.called_word !== "Overstay" && (can("called") || r.called_at)) extra +=
        ('<button type="button" data-word="desk:" class="' + (atDesk(r) ? "on dk" : "") + '"' + AP(atDesk(r)) + ">" + W("AT DESK") + "</button>");
      if (can("called")) extra += '<button type="button" data-word="called:Overstay" class="' + (r.called_word === "Overstay" ? "on nb" : "") + '"' + AP(r.called_word === "Overstay") + ">" + W("OVERSTAY") + "</button>";
      if (can("clear")) extra += '<button type="button" data-word="clear:COMPLAINT" class="' + (r.clear_word === "COMPLAINT" ? "on cm" : "") + '"' + AP(r.clear_word === "COMPLAINT") + ">" + W("COMPLAINT") + "</button>";
    } else if (can("intake")) {
      extra += '<button type="button" data-pcall="Called" class="' + (r.pick_called === "Called" ? "on" : "") + '"' + AP(r.pick_called === "Called") + ">" + W("CALLED") + "</button>";
      extra += '<button type="button" data-pcall="New Booking" class="' + (r.pick_called === "New Booking" ? "on nb" : "") + '"' + AP(r.pick_called === "New Booking") + ">" + W("NEW BOOKING") + "</button>";
      if (picksYard()) extra += '<button type="button" data-pnoshow class="' + (r.intake === "No Show" ? "on n" : "") + '"' + AP(r.intake === "No Show") + ">" + W("NO SHOW") + "</button>";
    }
    var markF = extra ? fld('<label>' + L("MARK AS") + NOW + '</label><div class="pseg">' + extra + "</div>", true) : "";
    var exitP = drops ? exitPanelHtml(r) : "", pay = (drops ? chargePanelHtml(r) : "") + exitP;
    var early = drops ? earlyHtml(r) : pickEarlyHtml(r);
    // PT photos from when the car came in (PICKS), also on its DROPS row: same booking ref.
    var photos = '<div id="ptPhotos"></div>';
    var rm = can("import") ? '<button type="button" class="link rmcar" data-removecar>Remove this car (no show, cancelled)</button>' : "";
    var saves = can("note") || can("flights") || (!drops && canPickFlight()) || canReg || canReturn(r);
    var hist = can("log") ? '<div id="carHist"></div>' : "";
    if (rf) h = refinedCar(r, h.slice(0, headEnd), { det: det, tel: tel, steps: steps, regF: regF, dropF: dropF, retF: retF, yardF: yardF, flightF: flightF, flightNo: flightNo, flightTime: flightTime, pickFlightF: pickFlightF,
      docs: docs, noteF: noteF, markF: markF, pay: pay, exitP: exitP, early: early, photos: photos, rm: rm, saves: saves, hist: hist, desk: desk, detList: detList });
    else {
      h += tel + opsSec("Customer & vehicle") + detList(det);
      if (steps) { if (desk) R += opsSec("Status") + steps; else h += steps; }
      if (parking) h += opsSec(drops ? "Return & parking" : "Parking");
      h += regF + dropF + retF + yardF + flightF + pickFlightF;
      if (!desk) h += docs;
      if (can("note")) h += opsSec("Notes & status") + noteF;
      // A wide screen: the booking, its return and notes on the left; status, payments, photos and the rest on the right.
      var side = "";
      if (extra) side += (desk || can("note") ? "" : opsSec("Status")) + markF;
      side += pay + early + photos + rm;
      if (desk) R = (R || opsSec("Status")) + side + (docs ? '<div class="ops-docs">' + opsSec("Documents") + docs + "</div>" : ""); else h += side;
      var foot = '<div class="pbtns' + (o ? " ops-foot2" : "") + '">' + (o && saves ? "<small>Changes saved only when confirmed</small>" : "") + '<button type="button" data-close>' + (o && saves ? "Cancel" : "Close") + "</button>" + (saves ? '<button type="button" class="save" data-savepanel>' + (o ? "Save changes" : "Save") + "</button>" : "") + "</div>";
      // Operations: the boxes in one white panel, the history under it, Cancel and Save always in view.
      h = desk ? h.slice(0, headEnd) + '<div class="ops-2col"><div class="ops-sheet">' + h.slice(headEnd) + '</div><div class="ops-sheet ops-carside">' + R + "</div></div>" + hist + foot
        : o ? h.slice(0, headEnd) + '<div class="ops-sheet">' + h.slice(headEnd) + "</div>" + hist + foot : h + foot + hist;
    }
    $("panelBody").innerHTML = h;
    $("panel").classList.toggle("ops-car", o);
    if (rf) { carInit = carFieldVals(); if (draft) Object.keys(draft).forEach(function (k) { if ($(k)) $(k).value = draft[k]; }); carState(); }
    if (o) opsMenuPlace();
    if (!$("panel").open) $("panel").showModal();
    ptPhotosList(r);
    carHistory(r);
    if ($("docBox")) fillDoc(r);
    if ($("exitImg")) fillExit(r);
  }
  // ── Operations Refined: Booking details in sections ──
  // Customer & vehicle, Return & parking, Notes & status, then payments,
  // documents and photos; the read-only details as text, the boxes Save changes
  // saves as fields, and what saves on a tap marked "Saves when tapped". The same
  // fields, buttons and saves as Operations; only where they sit changes.
  var CAR_PARK = { MEET: 1, BACK: 1, FLIGHT: 1, ARRIVAL: 1, "DROP-OFF": 1 }, CAR_STAMP = { SENT: 1, CALLED: 1, "AT DESK": 1, OVERSTAY: 1, CLEAR: 1, COMPLAINT: 1 };
  function refinedCar(r, head, P) {
    // A detail that has its own box below shows once, in the box.
    var skip = { NAME: 1, CAR: 1, REF: 1 }; if (P.retF) skip.BACK = 1; if (P.dropF) skip["DROP-OFF"] = 1; if (P.flightF) skip.FLIGHT = 1; if (P.exitP) skip["EXIT FEE"] = 1;
    var park = [], stat = [], fee = [];
    P.det.forEach(function (x) { if (skip[x[0]]) return; (CAR_PARK[x[0]] ? park : x[0] === "EXIT FEE" ? fee : stat).push(x); });
    // Read-only details: the name on the left, the value on the right, a line each.
    function lab(t) { var l = L(t); return l === t ? sentence(t) : l; }
    function kv(list) { list = list.filter(function (x) { return x[1] !== "—"; }); return list.length ? '<div class="rf-kv">' + list.map(function (x) { return "<div><span>" + lab(x[0]) + "</span><b>" + x[1] + "</b></div>"; }).join("") + "</div>" : ""; }
    // Sent / Called / Clear (or how the car came in): when and who, side by side.
    function stamps(list) { return list.length ? '<div class="rf-stamps">' + list.map(function (x) { var v = x[1].split(" · "); return '<div class="' + (x[1] === "—" ? "" : "on") + '"><span>' + lab(x[0]) + "</span><b>" + v[0] + "</b>" + (v[1] ? "<small>" + nice(v.slice(1).join(" · ")) + "</small>" : "") + "</div>"; }).join("") + "</div>" : ""; }
    var was = P.retF && r.orig_return_at ? '<p class="rf-hint">First booked back ' + esc(dayShort(r.orig_return_at) + " " + hhmm(r.orig_return_at)) + "</p>" : "";
    function sec(cls, title, body, aside) { return body ? '<section class="rf-sec ' + cls + '"><h3 class="rf-h">' + esc(title) + (aside ? "<small>" + esc(aside) + "</small>" : "") + '</h3><div class="ops-sheet rf-grid">' + body + "</div></section>" : ""; }
    var car = /^[-\s.]*$/.test(r.make || "") ? "" : niceMake(String(r.make).trim());
    var cv = '<div class="rf-cv"><div><small>Customer</small><b>' + (esc(nice(r.name)) || "—") + "</b>" + (P.tel ? '<span class="rf-tel">' + P.tel + "</span>" : "") + "</div>" +
      "<div><small>Vehicle</small><b>" + (esc(car) || "—") + '</b><span class="num">' + (esc(r.ref) || "No reference") + "</span></div></div>";
    // A wide screen: the booking and its return on the left; status, notes, payments and photos on the right.
    var A = sec("rf-cust", "Customer & vehicle", cv) +
      sec("rf-park", r.kind === "drops" ? "Return & parking" : "Drop-off & parking", P.regF.replace('class="ops-f wide"', 'class="ops-f"') + P.flightNo + P.pickFlightF + P.dropF + P.retF + was + P.flightTime + kv(park) + P.yardF + (P.early ? '<div class="rf-early">' + P.early + "</div>" : ""));
    var stampList = stat.filter(function (x) { return CAR_STAMP[x[0]] || r.kind !== "drops"; });
    var B = sec("rf-notes", "Notes & status", stamps(stampList) + P.steps + P.noteF + P.markF) +
      sec("rf-pay", "Payments", kv(fee) + P.pay, P.pay ? "Saves when tapped" : "") +
      sec("rf-docs", P.docs ? "Documents & photos" : "Photos", P.docs + P.photos) +
      (P.rm ? '<div class="rf-rm">' + P.rm + "</div>" : "");
    var foot = '<div class="pbtns ops-foot2 rf-foot">' + (P.saves ? '<small id="carState" class="rf-state" role="status" aria-live="polite">No unsaved changes</small><button type="button" data-close>Cancel</button><button type="button" class="save" data-savepanel>Save changes</button>'
      : '<button type="button" data-close>Close</button>') + "</div>";
    return head + (P.desk ? '<div class="ops-2col rf-2col"><div class="rf-col">' + A + '</div><div class="rf-col">' + B + "</div></div>" : A + B) +
      (P.hist ? '<section class="rf-sec rf-hist">' + P.hist + "</section>" : "") + foot;
  }
  // What's typed in the car's boxes and not saved yet (Operations Refined).
  var CAR_FIELDS = ["regText", "dropD", "dropT", "retD", "retT", "flightText", "collectText", "schedText", "pickFlightText", "noteText"], carInit = {};
  function carFieldVals() { var v = {}; CAR_FIELDS.forEach(function (id) { var el = $(id); if (el) v[id] = el.value; }); return v; }
  function carDraft() { var v = carFieldVals(), d = {}; Object.keys(v).forEach(function (k) { if (v[k] !== carInit[k]) d[k] = v[k]; }); return d; }
  function carState(msg) {
    var el = $("carState"); if (!el) return;
    var n = Object.keys(carDraft()).length;
    el.textContent = msg || (n ? "Unsaved changes" : "No unsaved changes");
    el.className = "rf-state" + (msg ? " bad" : n ? " dirty" : "");
  }
  // A box Save changes can't take: said in the footer too (Operations Refined), always as a message.
  function saveErr(m) { if (isRefined()) carState(m); return toast(m, true); }
  ["input", "change"].forEach(function (ev) { $("panelBody").addEventListener(ev, function (e) { if (isRefined() && $("carState") && e.target.id && CAR_FIELDS.indexOf(e.target.id) >= 0) carState(); }); });
  // A phone keyboard: the box being typed in stays above Cancel / Save changes.
  $("panelBody").addEventListener("focusin", function (e) {
    var t = e.target; if (!isRefined() || !$("carState") || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    setTimeout(function () { if (document.activeElement === t) t.scrollIntoView({ block: "nearest" }); }, 350);
  });
  // Operations' words, sections and two-column boxes for the car panel; the
  // other looks get exactly what they had.
  var OPS_LABEL = { NAME: "Customer name", CAR: "Car", REF: "Booking reference", "EXIT FEE": "Exit fee", MEET: "Meet", BACK: "Back", FLIGHT: "Flight", ARRIVAL: "Arrival", SENT: "Sent", CALLED: "Called", "AT DESK": "At desk", OVERSTAY: "Overstay", CLEAR: "Clear", COMPLAINT: "Complaint",
    "DROP-OFF": "Drop-off", REG: "Registration", "BACK DATE AND TIME": "Return date and time", "DROP-OFF DATE AND TIME": "Drop-off date and time", YARD: "Yard", LOCATION: "Location", "FLIGHT NUMBER": "Flight number", "RETURN FLIGHT": "Return flight", "COLLECTION TIME": "Collection time",
    "SCHEDULED LANDING": "Scheduled landing", "COMING BACK": "Coming back", NOTE: "Note", "MARK AS": "Mark as", STEPS: "Steps" };
  function L(t) { return isOps() && OPS_LABEL[t] || t; }
  function opsSec(t) { return isOps() ? '<div class="ops-psec">' + esc(t) + "</div>" : ""; }
  function fld(html, wide) { return isOps() ? '<div class="ops-f' + (wide ? " wide" : "") + '">' + html + "</div>" : html; }
  // Everything done to this car, who and when: this row and its other half
  // (the PICKS and DROPS rows of one booking share the ref). Office only,
  // like the activity log. "OFFICE" is the shared office login.
  async function carHistory(r) {
    var el = $("carHist"); if (!el) return;
    var ids = [r.id], kinds = {}; kinds[r.id] = r.kind;
    if (r.ref) {
      var tw = await sb.from("bookings").select("id, kind").eq("ref", r.ref).neq("id", r.id);
      (tw.data || []).forEach(function (x) { ids.push(x.id); kinds[x.id] = x.kind; });
    }
    var q = await sb.from("activity").select("at, action, value, staff_name, booking_id").in("booking_id", ids).order("at", { ascending: false }).limit(100);
    el = $("carHist"); if (!el || panelRow !== r) return;
    if (q.error) { el.innerHTML = '<label>HISTORY</label><p class="hint">Couldn\'t load the history.</p>'; return; }
    var list = q.data || [], both = ids.length > 1;
    el.innerHTML = '<label>HISTORY</label>' + (!list.length ? '<p class="hint">Nothing done to this car in the app yet.</p>' :
      '<div class="hist">' + list.map(function (a) {
        return '<div><span class="hw num">' + esc(dayShort(a.at) + " " + hhmm(a.at)) + '</span><span class="hb"><b>' + esc(a.staff_name || "System") + "</b> · " +
          esc(a.action) + (both ? ' <small class="hk">' + esc(String(kinds[a.booking_id] || "").toUpperCase()) + "</small>" : "") +
          (a.value ? '<span class="hv">' + esc(a.value) + "</span>" : "") + "</span></div>";
      }).join("") + "</div>");
  }
  // The car's PT photos (kept 30 days, in Supabase or Cloudflare). View opens the same page PT gets.
  async function ptPhotosList(r) {
    var res = await sb.rpc("pt_photos_for", { p_booking: r.id });
    var el = $("ptPhotos"); if (!el || panelRow !== r || res.error) return;
    var sets = res.data || [];
    if (!sets.length) { if (r.pt_at && r.kind === "picks") el.innerHTML = '<label>PT PHOTOS</label><p class="hint">No copy of the photos in the app for this car.</p>'; return; }
    el.innerHTML = "<label>PT PHOTOS</label>" + sets.map(function (x) {
      return '<a class="ptset" href="/p/' + esc(x.token) + '" target="_blank" rel="noopener"><span><b>' + x.n + " photo" + (x.n === 1 ? "" : "s") + "</b> · " + esc(dayShort(x.at) + " " + hhmm(x.at)) + (x.by ? " · " + esc(x.by) : "") + "</span><i>View ›</i></a>";
    }).join("");
  }
  $("panel").addEventListener("close", function () { $("panel").classList.remove("ops-car", "payment-sheet"); boardPaymentId = ""; var tv = document.querySelector("#panelBody video"); if (tv) tv.pause(); camStop(); panelRow = null; quick = null; staffEdit = null; render(); setTimeout(bkPump, 500); });
  // Closes on a tap outside only when the press started outside too: selecting
  // text in a box and letting go past the edge must not close it.
  var downOn = {};
  ["panel", "menu"].forEach(function (id) { $(id).addEventListener("pointerdown", function (e) { downOn[id] = e.target; }); });
  function outside(id, e) { var hit = e.target === $(id) && downOn[id] === $(id); downOn[id] = null; return hit; }
  $("panel").addEventListener("click", function (e) {
    if (outside("panel", e)) return $("panel").close();          // tap outside the sheet
    if (e.target === $("panel")) return;
    var t = e.target.closest("button"); if (!t) return;
    if (t.dataset.close !== undefined) return $("panel").close();
    if (t.dataset.pickflight && quick) return saveQuickFlight(t.dataset.pickflight, undefined, t.dataset.picksched);
    if (t.dataset.noflight !== undefined && quick) { quick.noFlight = true; drawQuickFlight(); setTimeout(function () { var i = $("collectTime"); if (i) i.focus(); }, 50); return; }
    if (t.dataset.flightback !== undefined && quick) { quick.noFlight = false; drawQuickFlight(); return; }
    if (t.dataset.copy === "returns" || t.dataset.copy === "stats") { e.stopPropagation(); return putOnClipboard(copyText(t.dataset.copy)); }
    if (t.dataset.restore) return restoreCar(t);
    if (t.dataset.gone) return removeGone([t.dataset.gone], t);
    if (t.dataset.undoimport) return undoImport(t.dataset.undoimport, t);
    if (t.dataset.goneall !== undefined) return removeGone(Array.prototype.map.call($("panelBody").querySelectorAll("[data-gone]"), function (b) { return b.dataset.gone; }), t);
    if (t.dataset.acting !== undefined) return setActing(t.dataset.acting, t);
    if (staffEdit && (t.dataset.saveaccess !== undefined || t.dataset.roledefault !== undefined || t.dataset.savepin !== undefined || t.dataset.removestaff !== undefined || t.dataset.savenames !== undefined)) return staffPanelAction(t);
    if (!panelRow) return;
    var r = S.rows.filter(function (x) { return x.id === panelRow.id; })[0] || panelRow;
    if (t.dataset.savepanel !== undefined) {
      var saved = false;
      // Check everything first: nothing is queued while any field is invalid.
      var pf = $("pickFlightText") ? normFlight($("pickFlightText").value).replace(/^NO FLIGHT$/, "") : null;
      if (pf && pf.length > 10) return saveErr("That does not look like a flight number.");
      var g = null;
      if ($("regText")) {
        g = $("regText").value.trim().toUpperCase().replace(/\s+/g, " ");
        if (g !== r.reg && !/^[A-Z0-9 ]{0,12}$/.test(g)) return saveErr("Check the reg: letters and numbers only.");
      }
      var rl = null;
      if ($("retD")) {
        var rt = readTime("retT"), old = r.return_at ? londonParts(new Date(r.return_at)) : { key: "", time: "" };
        if (rt === null) return saveErr("Type the time like 13:20 (or 1320).");
        if ($("retD").value !== old.key || (rt || "") !== old.time) {
          if (!$("retD").value || !rt) return saveErr("Enter when the car is back: the date and the time.");
          rl = $("retD").value + " " + rt;
        }
      }
      var dl = null;
      if ($("dropD")) {
        var dt = readTime("dropT"), od = r.drop_at ? londonParts(new Date(r.drop_at)) : { key: "", time: "" };
        if (dt === null) return saveErr("Type the time like 13:20 (or 1320).");
        if ($("dropD").value !== od.key || (dt || "") !== od.time || ($("dropD").value && carSheetDay(r) && $("dropD").value !== carSheetDay(r))) {
          if (!$("dropD").value || !dt) return saveErr("Enter the drop-off: the date and the time.");
          dl = $("dropD").value + " " + dt;
          if ((dl.slice(0, 10) !== od.key || dl.slice(0, 10) !== carSheetDay(r)) && !confirm("Move " + (r.reg || "this car") + " to PICKS " + biWhen(dl) + "?")) return;
        }
      }
      var f = null, ct, st;
      if ($("flightText")) {
        f = normFlight($("flightText").value); ct = readTime("collectText"); st = readTime("schedText");
        if (ct === null || st === null) return saveErr("Type the time like 13:20 (or 1320).");
      }
      if (pf !== null && pf !== r.flight) { run("set_pick_flight", { p_booking: r.id, p_flight: pf }, r, function (x) { x.flight = pf; }); saved = true; }
      if (g !== null && g !== r.reg) { run("set_reg", { p_booking: r.id, p_reg: g }, r, function (x) { x.reg = g; }); saved = true; }
      if (dl) {
        run("move_pick", { p_booking: r.id, p_drop_local: dl }, r, function (x) { x.drop_at = londonIso(dl); });
        saved = true;
      }
      if (rl) {
        if (r.kind === "picks") run("set_pick_return", { p_booking: r.id, p_return_local: rl }, r, function (x) { x.return_at = londonIso(rl); });
        else run("set_return", { p_booking: r.id, p_return_local: rl }, r);
        saved = true;
      }
      // The note first: turning a car into NO FLIGHT moves on to the
      // collection-time screen, and a note typed alongside must not be lost.
      if ($("noteText")) {
        var text = $("noteText").value.trim();
        if (text !== r.note) { run("set_note", { p_booking: r.id, p_note: text }, r, function (x) { x.note = text; }); saved = true; }
      }
      if (f !== null) {
        if (f === "NO FLIGHT" && r.flight !== "NO FLIGHT") { panelRow = null; quick = { id: r.id, chain: false, suggest: [], noFlight: true }; drawQuickFlight(); return; }
        // The old flight's time left in the box doesn't carry over to a new flight number.
        if (f !== r.flight && st === (r.sched_time || "")) st = undefined;
        if (f !== r.flight || (f === "NO FLIGHT" && ct !== undefined && ct !== (r.est_time || "")) || (st !== undefined && st !== (r.sched_time || ""))) { setFlight(r, f, ct, st); saved = true; }
      }
      if (saved) toast("Saved");
      return $("panel").close();
    }
    if (t.dataset.setyard) {
      var y = r.yard === t.dataset.setyard ? "" : t.dataset.setyard;
      run("set_yard", { p_booking: r.id, p_yard: y }, r, function (x) { x.yard = y; x.yard_before_t = ""; });
      return openPanel(r);
    }
    if (t.dataset.word) { var p = t.dataset.word.split(":"); tapDrop(r, p[0], p[1]); return $("panel").close(); }
    if (t.dataset.pcall) { tapPick(r, "called", t.dataset.pcall); return $("panel").close(); }
    if (t.dataset.pnoshow !== undefined) { tapPick(r, "intake", "No Show"); return $("panel").close(); }
    if (t.dataset.ptcam !== undefined) return ptCamera(r);
    if (t.dataset.shutter !== undefined) return ptShoot(r);
    if (t.dataset.camtorch !== undefined) return camToggleTorch();
    if (t.dataset.camlens !== undefined) return camLensNext();
    if (t.dataset.camtips) return camTipsSet(t.dataset.camtips === "on");
    if (t.dataset.camdone !== undefined) { t.disabled = true; t.textContent = "Saving…"; return camShots.then(function () { camStop(); openPt(r); ptStore(); ptPump(r); }); }
    if (t.dataset.ptretry !== undefined) return ptRetry(r);
    if (t.dataset.ptlinkshare !== undefined) {
      // No PT number in Settings: share the message and pick the chat.
      if (!navigator.share) return toast("Set the PT WhatsApp number in Settings.", true);
      navigator.share({ text: ptMessage(r) }).then(function () { ptSent(r); }).catch(function () {});
      return;
    }
    if (t.dataset.ptclear !== undefined) {
      if (pt) { var tk = pt.token; BK = BK.filter(function (y) { return y.token !== tk; }); ptForget(pt.id); }
      ptClear(); return openPt(r);
    }
    if (t.dataset.ptshare !== undefined) return ptShare(r, t);
    if (t.dataset.ptpdf !== undefined) return ptSharePdf(r, t);
    if (t.dataset.ptregshare !== undefined) {
      // No PT number in Settings: share the reg and pick the chat.
      if (!navigator.share) return toast("Set the PT WhatsApp number in Settings.", true);
      navigator.share({ text: ptCaption(r) }).then(function () { if (pt) { pt.regSent = true; ptStore(); } openPt(r); }).catch(function () {});
      return;
    }
    if (t.dataset.ptmark !== undefined) {
      if (r.pt_at) { ptClear(); return $("panel").close(); }
      if (pt && pt.id === r.id && pt.items.length) return ptTickKeep(r);
      return ptNoPhotos(r);
    }
    if (t.dataset.ptcamgo !== undefined) { if (pt && pt.id === r.id) { openPt(r); return ptCamera(r); } return ptStart(r); }
    if (t.dataset.ptback !== undefined) return pt && pt.id === r.id ? openPt(r) : $("panel").close();
    if (t.dataset.ptwhy) return ptTickWhy(r, t.dataset.ptwhy);
    if (t.dataset.charge) { recordCharge(r, t.dataset.charge); return openPanel(r); }
    if (t.dataset.chargeundo !== undefined) { recordCharge(r, ""); return openPanel(r); }
    if (t.dataset.exitshot) { $("exitFile").dataset.m = t.dataset.exitshot; $("exitFile").value = ""; return $("exitFile").click(); }
    if (t.dataset.exitundo !== undefined) return markExit(r, "");
    if (t.dataset.exitnophoto) return markExit(r, t.dataset.exitnophoto);
    if (t.dataset.chargeadd !== undefined) { S.chargeAdd = r.id; openPanel(r); var a = $("chgAmount"); if (a) a.focus(); return; }
    if (t.dataset.chargeagreed !== undefined) { setAgreed(r, t.dataset.chargeagreed); return openPanel(r); }
    if (t.dataset.removecar !== undefined) return askRemove(r);
    if (t.dataset.early !== undefined) return earlyMove(r, t, false);
    if (t.dataset.undoearly !== undefined) return earlyMove(r, t, true);
    if (t.dataset.pearly !== undefined) return earlyFromPicks(r, t);
    if (t.dataset.backcar !== undefined) return openPanel(r);
    if (t.dataset.removewhy) return removeCar(r, t.dataset.removewhy, t);
  });

  // ── add a car by hand, remove a no-show (office) ──
  // The reasons remove_booking accepts (setup 15, RTC and Early return from 110).
  var REMOVE_WHY = ["No show", "Cancelled", "Duplicate", "RTC", "Early return"];
  function removeWhyLine(by) {
    return REMOVE_WHY.map(function (k) { var n = by[k]; return n ? n + " " + (k === "RTC" ? k : k.toLowerCase()) : ""; }).filter(Boolean).join(" · ");
  }
  function askRemove(r) {
    // Two rows of buttons, so five reasons fit a phone in every look.
    var seg = function (ws, st) {
      return '<div class="pseg rmwhy"' + (st || "") + ">" + ws.map(function (w) {
        return '<button type="button" data-removewhy="' + w + '">' + w.toUpperCase() + "</button>";
      }).join("") + "</div>";
    };
    $("panelBody").innerHTML = '<h2 id="panelTitle">Remove ' + esc(r.reg || "this car") + "?</h2>" +
      '<p class="sub">It leaves the board and the counts, and is never carried over as an overstay. You can put it back from Menu, Removed cars.</p>' +
      "<label>WHY</label>" + seg(REMOVE_WHY.slice(0, 3)) + seg(REMOVE_WHY.slice(3), ' style="margin-top:6px"') + '<div class="pbtns"><button type="button" data-backcar>Back</button></div>';
  }
  async function removeCar(r, why, btn) {
    btn.disabled = true;
    var x = await sb.rpc("remove_booking", { p_booking: r.id, p_reason: why });
    if (x.error) { btn.disabled = false; return toast(x.error.message, true); }
    S.rows = S.rows.filter(function (y) { return y.id !== r.id; });
    dropRemoved(r.id); S.removed.push(x.data);
    toast(r.reg + " removed: " + why);
    $("panel").close();
  }
  function openRemoved() {
    var list = (S.removed || []).slice().sort(function (a, b) { return a.removed_at < b.removed_at ? 1 : -1; });
    $("panelBody").innerHTML = '<h2 id="panelTitle">Removed cars <small>' + esc(sheetName()) + "</small></h2>" +
      (list.length ? '<div class="rmlist">' + list.map(function (r) {
        return '<div><span><b>' + esc(r.reg || "NO REG") + "</b> " + esc(r.name) + '<small>' + esc(r.removed_reason) + " · " + esc(byName(r, "removed_by") || "") + " · " + esc(dayShort(r.removed_at) + " " + hhmm(r.removed_at)) +
          '</small></span><button type="button" data-restore="' + r.id + '">Put back</button></div>';
      }).join("") + "</div>" : '<p class="sub">Nothing removed from this sheet.</p>') +
      '<div class="pbtns"><button type="button" data-close>Close</button></div>';
    if (!$("panel").open) $("panel").showModal();
  }
  // Tutorials (Menu → Tutorials): short videos in public/tutorials, played
  // here. Terminal and bongo staff see their own; everyone else sees all.
  var TUTORIALS = [
    ["1-owner-every-option", "Every option in the app", "3:19", ""],
    ["2-terminal-setup", "Terminal: getting set up", "0:58", "terminal"],
    ["3-terminal-picks-and-pt", "Terminal: picks and PT", "1:39", "terminal"],
    ["4-terminal-drops", "Terminal: drops", "1:38", "terminal"],
    ["5-bongo-setup", "Bongo: getting set up", "0:58", "bongo"],
    ["6-bongo-picks-and-pt", "Bongo: picks and PT", "1:31", "bongo"],
    ["7-bongo-drops", "Bongo: drops", "1:38", "bongo"]
  ];
  function myTutorials() {
    var role = S.me && S.me.role;
    var own = TUTORIALS.filter(function (t) { return t[3] === role; });
    return own.length ? own : TUTORIALS;
  }
  function openTutorials(key) {
    var t = key && TUTORIALS.find(function (x) { return x[0] === key; });
    $("panelBody").innerHTML = t
      ? '<h2 id="panelTitle">' + esc(t[1]) + "</h2>" +
        '<video class="tutvid" src="/tutorials/' + t[0] + '.mp4" poster="/tutorials/' + t[0] + '.jpg" controls autoplay playsinline preload="metadata" style="display:block;height:68vh;max-width:100%;aspect-ratio:390/844;margin:0 auto;border-radius:10px;background:#000;object-fit:contain"></video>' +
        '<div class="pbtns"><button type="button" data-tutorials>All videos</button><button type="button" data-close>Close</button></div>'
      : '<h2 id="panelTitle">Tutorials</h2><div class="menu-list">' + myTutorials().map(function (x) {
          return '<button type="button" data-tutorial="' + x[0] + '">' + (hasFeatures() ? menuIcon("play") : "") + "<span>" + esc(x[1]) + " <small>" + x[2] + "</small></span></button>";
        }).join("") + '</div><div class="pbtns"><button type="button" data-close>Close</button></div>';
    if (!$("panel").open) $("panel").showModal();
  }
  async function restoreCar(btn) {
    btn.disabled = true;
    var x = await sb.rpc("restore_booking", { p_booking: btn.dataset.restore });
    if (x.error) { btn.disabled = false; return toast(x.error.message, true); }
    // The live update may have put it back already: replace, never add twice.
    dropRemoved(x.data.id);
    var at = S.rows.findIndex(function (y) { return y.id === x.data.id; });
    if (at >= 0) S.rows[at] = x.data; else S.rows.push(x.data);
    toast(x.data.reg + " is back on the board");
    openRemoved();
  }
  function openAddCar() {
    var sh = sheet(); if (!sh) return;
    var drops = sh.kind === "drops";
    function f(id, label, attrs) { return '<label for="' + id + '">' + label + '</label><input id="' + id + '" ' + (attrs || "") + ">"; }
    function when(id, label, day) { return '<label>' + label + '</label><div class="when2"><input id="' + id + 'D" type="date" value="' + esc(day || "") + '">' + timeBox(id + "T", "") + "</div>"; }
    $("panelBody").innerHTML = '<h2 id="panelTitle">Add a car <small>' + esc(sheetLabel(sh)) + "</small></h2>" +
      '<form id="addCarForm" novalidate>' +
      f("acReg", "REG", 'autocomplete="off" autocapitalize="characters" maxlength="12" required') +
      f("acName", "NAME", 'autocomplete="off" maxlength="80"') +
      f("acPhone", "PHONE", 'type="tel" autocomplete="off" maxlength="30"') +
      f("acMake", "CAR", 'autocomplete="off" maxlength="60" placeholder="Make and colour"') +
      f("acRef", "REF", 'autocomplete="off" maxlength="40" placeholder="Booking reference, if there is one"') +
      (drops ? when("acRet", "BACK", sh.day) + f("acFlight", "FLIGHT", 'autocomplete="off" autocapitalize="characters" maxlength="12"') +
        '<label for="acYard">YARD</label><select id="acYard"><option value="">None yet</option>' + (S.company.yards || []).map(function (y) { return '<option value="' + esc(y) + '">' + esc(YARD_LABEL[y] || y) + "</option>"; }).join("") + "</select>"
        : when("acDrop", "DROP-OFF", sh.day) + when("acRet", "BACK", "")) +
      '<label for="acNote">NOTE</label><textarea id="acNote" maxlength="500"></textarea>' +
      '<div class="pbtns"><button type="button" data-close>Cancel</button><button class="save" id="acGo">Add car</button></div></form>';
    if (!$("panel").open) $("panel").showModal();
    setTimeout(function () { $("acReg").focus(); }, 50);
  }
  // "" when no date; null when the typed time isn't one.
  function localWhen(id) {
    var d = $(id + "D"), t = readTime(id + "T");
    if (!d || !d.value) return "";
    if (t === null) return null;
    return d.value + " " + (t || "00:00");
  }
  async function addCar() {
    var sh = sheet(), reg = $("acReg").value.trim();
    if (!reg) return toast("Enter the registration.", true);
    var ret = localWhen("acRet"), drop = sh.kind === "picks" ? localWhen("acDrop") : "";
    if (ret === null || drop === null) return toast("Type the time like 13:20 (or 1320).", true);
    if (sh.kind === "drops") {
      if (!ret || !readTime("acRetT")) return toast("Enter when the car is back: the date and the time.", true);
      // The DROPS day runs to 06:00 next morning: 01:30 typed on the sheet's own
      // date means the early hours after it, not the morning before.
      var end = ((S.company && S.company.drops_day_end) || "06:00").slice(0, 5);
      if (ret.slice(0, 10) === sh.day && ret.slice(11) <= end) ret = addDaysKey(sh.day, 1) + ret.slice(10);
    }
    var p = { reg: reg, name: $("acName").value, phone: $("acPhone").value, make: $("acMake").value, ref: $("acRef").value, note: $("acNote").value,
      return_local: ret, drop_local: drop,
      flight: $("acFlight") ? normFlight($("acFlight").value) || "" : "", yard: $("acYard") ? $("acYard").value : "" };
    $("acGo").disabled = true;
    var x = await sb.rpc("add_booking", { p_sheet: sh.id, p: p });
    if (x.error) { $("acGo").disabled = false; return toast(x.error.message, true); }
    await loadRows();
    toast(x.data.reg + " added");
    $("panel").close();
    if (sh.kind === "picks") await askDrops([x.data.id]);
  }
  // A new PICKS car (added by hand, or new in a re-imported file) booked back
  // on a day whose DROPS sheet is already in isn't on that DROPS sheet: ask,
  // and put it there (database part 50).
  async function askDrops(ids) {
    if (!ids || !ids.length || !can("import")) return;
    var m = await sb.rpc("drops_missing", { p_ids: ids });
    var list = (m && m.data) || []; if (!list.length) return;
    function line(x) { return (x.reg || "NO REG") + (x.name ? " (" + x.name + ")" : "") + ", back " + dayShort(x.return_at) + " " + hhmm(x.return_at); }
    var q = list.length === 1
      ? line(list[0]) + ".\n\nThe DROPS sheet for " + sheetLabel({ day: list[0].day, kind: "drops" }).replace(/^DROPS /, "") + " is already in. Add this car to it too?"
      : list.length + " new cars are booked back on a day whose DROPS sheet is already in:\n\n" + list.map(line).join("\n") + "\n\nAdd them to DROPS too?";
    if (!confirm(q)) return;
    var done = [];
    for (var i = 0; i < list.length; i++) {
      var a = await sb.rpc("add_pick_to_drops", { p_booking: list[i].id });
      if (a.error) toast(a.error.message, true); else done.push(list[i].reg);
    }
    if (done.length) toast("Added to DROPS: " + done.join(", ") + ". Add the flight there.");
  }

