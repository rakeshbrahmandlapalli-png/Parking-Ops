  // SKIDATA card top-up (part 128): the terminal car park's card, topped up per shift.
  // Every terminal ticket costs the same: one per DROPS car taken over, one per PICKS car
  // brought back, one per bongo round (cars ÷ drivers, rounded up, DROPS and PICKS apart).
  // An add-on: only clients given it on the platform page (Clients → Edit, brand.topup).
  function topupOn() { return !!(can("topup") && S.company && S.company.brand && S.company.brand.topup === true); }
  var TU = { pick: null, counts: null, list: null, loading: false, error: "", seq: 0, card: "", busy: false, form: false, amount: "", file: null };
  var TU_DRIVERS = "takeoff_topup_drivers";
  function topupConf() {
    var t = (S.company && S.company.topup) || {};
    return { ticket: +t.ticket || 3.5, step: +t.step || 10,
      shifts: t.shifts && t.shifts.length ? t.shifts : [{ name: "Morning", start: "04:00", end: "17:00" }, { name: "Night", start: "17:00", end: "04:00" }] };
  }
  // The shift on now (or the next to start), and the one after it, as { day, shift }.
  function topupShifts() {
    var sh = topupConf().shifts, now = londonParts(new Date()), t = minsOf(now.time), all = [];
    [-1, 0, 1].forEach(function (d) {
      var day = addDaysKey(now.key, d);
      sh.forEach(function (x, i) {
        var a = minsOf(x.start) + d * 1440, b = minsOf(x.end) + d * 1440; if (b <= a) b += 1440;
        all.push({ day: day, shift: i, name: x.name, start: x.start, end: x.end, a: a, b: b });
      });
    });
    all.sort(function (p, q) { return p.a - q.a; });
    var on = all.filter(function (x) { return x.a <= t && t < x.b; }).pop(), i = on ? all.indexOf(on) : all.findIndex(function (x) { return x.a > t; });
    var list = [all[i], all[i + 1]].filter(Boolean);
    if (on) list[0].now = true;
    return list;
  }
  function topupKey(x) { return x.day + ":" + x.shift; }
  function topupDrivers() { try { return localStorage.getItem(TU_DRIVERS) || ""; } catch (e) { return ""; } }
  function topupSums() {
    var c = TU.counts, conf = topupConf(), drivers = parseInt(topupDrivers(), 10) || 0;
    if (!c) return null;
    var rounds = drivers > 0 ? Math.ceil(c.drops / drivers) + Math.ceil(c.picks / drivers) : null;
    var tickets = rounds === null ? null : c.drops + c.picks + rounds, need = tickets === null ? null : Math.round(tickets * conf.ticket * 100) / 100;
    var card = TU.card === "" ? null : +TU.card, top = need === null || card === null || isNaN(card) ? null : Math.max(0, Math.ceil(Math.round((need - card) * 100) / 100 / conf.step) * conf.step);
    return { drops: c.drops, picks: c.picks, drivers: drivers, rounds: rounds, tickets: tickets, need: need, card: card, top: top, ticket: conf.ticket, step: conf.step };
  }
  async function loadTopup() {
    if (!topupOn() || TU.loading) return;
    var shifts = topupShifts(); if (!TU.pick || !shifts.some(function (x) { return topupKey(x) === TU.pick; })) TU.pick = shifts[0] && topupKey(shifts[0]);
    var p = shifts.filter(function (x) { return topupKey(x) === TU.pick; })[0]; if (!p) return;
    var seq = ++TU.seq, company = S.company.id; TU.loading = true; TU.error = "";
    try {
      var r = await Promise.all([sb.rpc("topup_counts", { p_day: p.day, p_shift: p.shift }), sb.rpc("topup_list")]);
      if (seq !== TU.seq || !S.company || S.company.id !== company) return;
      var err = r[0].error || r[1].error;
      if (err) TU.error = /topup_counts|PGRST202/.test(err.message || "") ? "The card top-up needs database part 128." : err.message;
      else { TU.counts = r[0].data; TU.list = r[1].data || []; }
    } catch (e) { if (seq === TU.seq) TU.error = "Could not load the top-up. Check your connection."; }
    finally { if (seq === TU.seq) { TU.loading = false; if (S.view === "topup") render(); } }
  }
  function resetTopup() { TU.seq++; TU.pick = null; TU.counts = null; TU.list = null; TU.loading = false; TU.error = ""; TU.card = ""; TU.busy = false; TU.form = false; TU.amount = ""; TU.file = null; }
  function tuLine(label, value, sub, cls) { return '<div class="tu-line' + (cls ? " " + cls : "") + '"><span>' + label + (sub ? "<small>" + sub + "</small>" : "") + '</span><b class="num">' + value + "</b></div>"; }
  function renderTopup() {
    if (!topupOn()) return '<div class="msg">The card top-up is not switched on for your company.</div>';
    if (!TU.counts && !TU.loading && !TU.error) loadTopup();
    var shifts = topupShifts(), x = topupSums(), conf = topupConf();
    var h = '<section class="tu"><div class="tu-head">' + "<span></span>" + '<button type="button" class="btn ghost small" data-tureload' + (TU.loading ? " disabled" : "") + ">Refresh</button></div>" +
      '<div class="tu-shifts" role="group" aria-label="Shift">' + shifts.map(function (s) {
        var on = topupKey(s) === TU.pick;
        return '<button type="button" data-tushift="' + topupKey(s) + '" class="' + (on ? "on" : "") + '" aria-pressed="' + on + '"><b>' + esc(s.name) + " " + esc(dayShortLabel(s.day)) + "</b><small>" + esc(s.start + "–" + s.end) + (s.now ? " · now" : " · next") + "</small></button>";
      }).join("") + "</div>";
    if (TU.error) h += '<p class="tu-err" role="alert">' + esc(TU.error) + "</p>";
    if (!x) return h + (TU.error ? "" : '<p class="note">Counting the cars…</p>') + "</section>";
    h += '<div class="tu-box">' + tuLine("DROPS left", x.drops, "not sent yet") + tuLine("PICKS left", x.picks, "not taken in yet") +
      '<label class="tu-line tu-in"><span>Drivers on shift</span><input id="tuDrivers" type="number" inputmode="numeric" min="1" max="99" value="' + esc(topupDrivers()) + '" placeholder="0"></label>' +
      (x.rounds === null ? '<p class="tu-hint">Type the drivers on shift to work out the bongo rounds.</p>' :
        tuLine("Bongo rounds", x.rounds, x.drops + " ÷ " + x.drivers + " and " + x.picks + " ÷ " + x.drivers + ", rounded up") +
        tuLine("Tickets", x.tickets, x.drops + " + " + x.picks + " + " + x.rounds + " × " + money(x.ticket)) +
        tuLine("Needed", money(x.need), "", "tu-need")) +
      '<label class="tu-line tu-in"><span>On the card now<small>from the machine screen</small></span><span class="tu-money">£<input id="tuCard" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(TU.card) + '" placeholder="0"></span></label>' +
      (x.top === null ? "" : '<div class="tu-top' + (x.top ? "" : " none") + '">' + (x.top ? "Top up <b class=\"num\">" + money(x.top) + "</b><small>in " + money(x.step) + " steps · card then " + money(x.card + x.top) + "</small>" : "No top-up needed") + "</div>") + "</div>";
    h += TU.form ? topupForm(x) : '<div class="row-actions"><button type="button" class="btn" data-tuform>📷 Record top-up</button></div>';
    h += '<h3 class="tu-h">Top-ups, last 14 days</h3>' + (TU.list && TU.list.length ? '<div class="tu-list">' + TU.list.map(function (t) {
      return '<div class="tu-row"><b class="num">' + money(t.amount) + "</b><span>" + esc(t.shift_name + " " + dayShortLabel(t.shift_day)) + (t.card_before !== null ? " · card " + money(t.card_before) + " → " + money(+t.card_before + +t.amount) : "") +
        (t.tickets ? " · " + t.tickets + " tickets" : "") + "</span><small>" + esc(t.staff_name) + " · " + esc(dayShort(t.at) + " " + hhmm(t.at)) + "</small>" +
        (t.photo ? '<button type="button" class="link" data-tuphoto="' + esc(t.photo) + '">Photo</button>' : '<small class="tu-nophoto">No photo</small>') + "</div>";
    }).join("") + "</div>" : '<p class="note">' + (TU.list ? "No top-ups recorded yet." : "Loading…") + "</p>");
    if (S.me.role === "owner") h += '<details class="tu-set"><summary>Ticket price and shifts</summary><form id="tuSet"><label>Ticket £<input name="ticket" type="number" min="0.01" step="0.01" required value="' + conf.ticket + '"></label>' +
      '<label>Top up in steps of £<input name="step" type="number" min="0.01" step="0.01" required value="' + conf.step + '"></label>' +
      conf.shifts.concat([{ name: "", start: "", end: "" }]).map(function (s, i) {
        return '<div class="tu-shiftrow"><input name="n' + i + '" maxlength="20" placeholder="' + (i < conf.shifts.length ? "Shift name" : "Another shift (optional)") + '" value="' + esc(s.name) + '"><input name="s' + i + '" type="time" value="' + esc(s.start) + '" aria-label="Starts"><span>to</span><input name="e' + i + '" type="time" value="' + esc(s.end) + '" aria-label="Ends"></div>';
      }).join("") + '<p class="note">A shift that ends at or before it starts finishes the next day. Clear a name to remove that shift.</p><button type="submit" class="btn">Save</button></form></details>';
    return h + "</section>";
  }
  function topupForm(x) {
    var amt = TU.amount !== "" ? TU.amount : x.top ? String(x.top) : "";
    return '<form id="tuRec" class="tu-form"><label>Amount topped up £<input id="tuAmount" name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" required value="' + esc(amt) + '"></label>' +
      '<label class="tu-file"><input id="tuFile" type="file" accept="image/*" capture="environment"><span>' + (TU.file ? "✓ Photo ready" : "📷 Photo of the machine") + "</span></label>" +
      '<div class="tu-acts"><button type="submit" class="btn"' + (TU.busy ? " disabled" : "") + ">" + (TU.busy ? "Saving…" : "Save top-up") + '</button><button type="button" class="btn ghost" data-tucancel>Cancel</button></div></form>';
  }
  async function saveTopup() {
    var x = topupSums(), p = topupShifts().filter(function (s) { return topupKey(s) === TU.pick; })[0], amount = +(($("tuAmount") || {}).value || 0);
    if (!p || !(amount > 0)) return toast("Type the amount topped up.", true);
    if (!navigator.onLine) return toast("Reconnect before saving the top-up.", true);
    if (!TU.file && !confirm("Save without a photo of the machine?")) return;
    TU.busy = true; render();
    var company = S.company.id, path = "";
    try {
      if (TU.file) {
        var small = await bkSmall(TU.file, true);
        path = company + "/docs/topup/t" + Date.now() + ".jpg";
        var up = await sb.storage.from("pt-photos").upload(path, small.blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
      }
      var r = await sb.rpc("record_topup", { p: { day: p.day, shift: p.shift, amount: amount, card: x && x.card, drivers: x && x.drivers || null, drops: x && x.drops, picks: x && x.picks, rounds: x && x.rounds, tickets: x && x.tickets, need: x && x.need, photo: path } });
      if (r.error) throw r.error;
      if (!S.company || S.company.id !== company) return;
      toast("Top-up " + money(amount) + " saved");
      TU.form = false; TU.amount = ""; TU.file = null; TU.card = "";
    } catch (e) { toast("The top-up didn't save: " + ((e && e.message) || e), true); }
    finally { TU.busy = false; TU.counts = null; loadTopup(); render(); }
  }
  async function saveTopupSettings(f) {
    var v = new FormData(f), shifts = [];
    for (var i = 0; v.has("n" + i); i++) if ((v.get("n" + i) || "").trim()) shifts.push({ name: v.get("n" + i).trim(), start: v.get("s" + i), end: v.get("e" + i) });
    var r = await sb.rpc("set_topup_settings", { p: { ticket: v.get("ticket"), step: v.get("step"), shifts: shifts } });
    if (r.error) return toast(r.error.message, true);
    S.company.topup = r.data; TU.pick = null; TU.counts = null; toast("Saved"); loadTopup(); render();
  }
  document.addEventListener("click", async function (e) {
    var t = e.target.closest("[data-tushift],[data-tureload],[data-tuform],[data-tucancel],[data-tuphoto]"); if (!t || S.view !== "topup") return;
    if (t.hasAttribute("data-tushift")) { TU.pick = t.getAttribute("data-tushift"); TU.counts = null; loadTopup(); render(); }
    else if (t.hasAttribute("data-tureload")) { TU.counts = null; loadTopup(); render(); }
    else if (t.hasAttribute("data-tuform")) { TU.form = true; render(); }
    else if (t.hasAttribute("data-tucancel")) { TU.form = false; TU.amount = ""; TU.file = null; render(); }
    else if (t.hasAttribute("data-tuphoto")) {
      var u = await sb.storage.from("pt-photos").createSignedUrl(t.getAttribute("data-tuphoto"), 3600);
      if (u.error || !u.data) return toast("Photo not found.", true);
      window.open(u.data.signedUrl, "_blank", "noopener");
    }
  });
  document.addEventListener("input", function (e) {
    if (S.view !== "topup") return;
    if (e.target.id === "tuDrivers") { try { localStorage.setItem(TU_DRIVERS, e.target.value); } catch (x) {} topupRedraw("tuDrivers"); }
    else if (e.target.id === "tuCard") { TU.card = e.target.value; topupRedraw("tuCard"); }
    else if (e.target.id === "tuAmount") TU.amount = e.target.value;
  });
  // Redraw the sums but keep the box being typed in focused.
  function topupRedraw(id) { var el = $(id), pos = el && el.selectionStart; render(); el = $(id); if (el) { el.focus(); try { if (pos !== null && pos !== undefined) el.setSelectionRange(pos, pos); } catch (x) {} } }
  document.addEventListener("change", function (e) { if (e.target.id === "tuFile" && S.view === "topup") { TU.file = e.target.files && e.target.files[0] || null; render(); } });
  document.addEventListener("submit", function (e) {
    if (e.target.id === "tuRec") { e.preventDefault(); if (!TU.busy) saveTopup(); }
    else if (e.target.id === "tuSet") { e.preventDefault(); saveTopupSettings(e.target); }
  });
