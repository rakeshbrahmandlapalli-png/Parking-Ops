  // ── customer texts (database part 114) ──
  // An add-on (Parking Ops → Clients → Edit, brand.texts): the app texts the
  // customer by itself when their flight lands, when a driver is SENT, and the
  // day before a PICKS drop-off. Owners set it in Settings → Customer texts;
  // the send-texts function sends them (once each) and every text goes on the
  // car's Texts list and the activity log. The office can send one by hand.
  function textsAddon() { return !!(S.company && S.company.brand && S.company.brand.texts === true); }
  var TEXT_RULES = [
    ["landed", "Flight landed", "DROPS: when the flight lands",
      "Welcome back {name}. Once you have your bags, call us on {office} and we'll bring your car {reg} to {meet}. {company}"],
    ["sent", "Car on its way", "DROPS: when a driver is SENT",
      "Hi {name}, your car {reg} is on its way to {meet}. Please wait there for our driver. {company}"],
    ["reminder", "Reminder", "PICKS: the day before drop-off",
      "Hi {name}, a reminder from {company}: we meet you at {meet} on {date} at {time}. Please call {office} 30 min before you arrive."]];
  var TEXT_LABEL = { landed: "Flight landed", sent: "Car on its way", reminder: "Reminder", manual: "Text" };
  function textsCfg() {
    var t = (S.company && S.company.texts) || {}, out = { on: t.on === true, demo: t.on === true && t.demo === true, via: t.via === "twilio" ? "twilio" : "phone", sender: t.sender || "", office: t.office || "", meet: t.meet || "", at: t.at || "18:00" };
    TEXT_RULES.forEach(function (x) { var r = t[x[0]] || {}; out[x[0]] = { on: r.on !== false, text: r.text || x[3] }; });
    return out;
  }
  function textsOn() { return textsAddon() && textsCfg().on; }
  // The words a customer gets, filled in for this car (or a sample car in Settings).
  function fillText(tpl, r, cfg) {
    var when = r.drop_at ? new Date(r.drop_at) : null;
    var v = { name: customerName(r.name), reg: r.reg || "", office: cfg.office, meet: cfg.meet,
      company: cfg.sender || brandName(), time: when ? hhmm(r.drop_at) : "", date: when ? dayShort(r.drop_at) : "" };
    return String(tpl || "").replace(/\{(\w+)\}/g, function (m, k) { return k in v ? v[k] : m; }).replace(/\s+/g, " ").trim();
  }
  // Bookings come as "KHAIRA MS" or "MR JOHN SMITH": a text says "Ms Khaira" or "Mr Smith", else the name as given.
  var TITLES = /^(MR|MRS|MS|MISS|DR|MX)\.?$/i;
  function customerName(n) {
    var w = String(n || "").trim().split(/\s+/).filter(Boolean), cap = function (x) { return x.charAt(0).toUpperCase() + x.slice(1).toLowerCase(); };
    if (!w.length) return "there";
    if (w.length > 1 && TITLES.test(w[w.length - 1])) return cap(w[w.length - 1].replace(".", "")) + " " + cap(w[0]);
    if (w.length > 1 && TITLES.test(w[0])) return cap(w[0].replace(".", "")) + " " + cap(w[w.length - 1]);
    return w.map(cap).join(" ");
  }
  // A text of 160 letters goes as one; longer ones go in parts of 153 (each part costs one text).
  function textParts(s) { var n = String(s).length; return n <= 160 ? 1 : Math.ceil(n / 153); }
  var TEXT_SAMPLE = { name: "JONES MS", reg: "AB12CDE", drop_at: new Date(Date.now() + 86400000).toISOString().slice(0, 10) + "T04:30:00Z" };
  function textPrev(tpl, cfg) {
    var s = fillText(tpl, TEXT_SAMPLE, cfg), n = textParts(s);
    return '<span class="txprev-t">' + esc(s) + '</span><small class="hint"> · ' + s.length + " characters, " + (n === 1 ? "1 text" : n + " texts each") + "</small>";
  }
  function textsHtml() {
    if (!textsAddon() || !S.me || S.me.role !== "owner") return "";
    var T = textsCfg(), sample = Object.assign({}, T, { sender: T.sender || brandName() });
    function hours() { var o = ""; for (var h = 8; h <= 21; h++) { var v = pad(h) + ":00"; o += '<option value="' + v + '"' + (T.at === v ? " selected" : "") + ">" + v + "</option>"; } return o; }
    return setBox("texts", "Customer texts", T.demo ? "Demo" : T.on ? TEXT_RULES.filter(function (x) { return T[x[0]].on; }).length + " of 3 on" : "Off", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<label class="field">Texts to customers<select id="txOn"><option value="true"' + (T.on && !T.demo ? " selected" : "") + '>On</option><option value="demo"' + (T.demo ? " selected" : "") + ">Demo: write them on each car, don't send</option>" +
        '<option value="false"' + (T.on ? "" : " selected") + ">Off</option></select></label>" +
      '<label class="field">Send texts from<select id="txVia"><option value="phone"' + (T.via === "phone" ? " selected" : "") + '>The company mobile (free, Settings → Office phone)</option><option value="twilio"' + (T.via === "twilio" ? " selected" : "") + ">Twilio (about 4p a text)</option></select></label>" +
      '<label class="field">Company name in texts (up to 11 letters)<input id="txSender" maxlength="11" autocomplete="off" autocapitalize="characters" placeholder="e.g. TAKEOFF" value="' + esc(T.sender) + '"></label>' +
      '<label class="field">Office number for customers to call<input id="txOffice" type="tel" autocomplete="off" placeholder="e.g. 0161 496 0000" value="' + esc(T.office) + '"></label>' +
      '<label class="field">Meeting point<input id="txMeet" autocomplete="off" maxlength="80" placeholder="e.g. Terminal 2 short stay, level 1" value="' + esc(T.meet) + '"></label>' +
      TEXT_RULES.map(function (x) {
        var R = T[x[0]];
        return '<div class="section-label">' + esc(x[1]) + '</div><p class="note">' + esc(x[2]) + "</p>" +
          '<label class="check"><input type="checkbox" data-txon="' + x[0] + '"' + (R.on ? " checked" : "") + "> Send this text</label>" +
          (x[0] === "reminder" ? '<label class="field">Send at<select id="txAt">' + hours() + "</select></label>" : "") +
          '<label class="field">Words<textarea data-txrule="' + x[0] + '" maxlength="459" rows="3">' + esc(R.text) + "</textarea></label>" +
          '<p class="note txprev" style="border-left:3px solid currentColor;padding-left:10px" data-txprev="' + x[0] + '">' + textPrev(R.text, sample) + "</p>";
      }).join("") +
      '<p class="note">{name} the customer (Ms Khaira), {reg}, {office}, {meet}, {date} and {time} of the drop-off, {company}.' + (T.via === "twilio" ? " Customers can\'t reply to Twilio texts." : " Replies come to the company mobile.") + "</p>" +
      '<label class="field">Test to your mobile<input id="txTestTo" data-nodirty type="tel" autocomplete="off" placeholder="07…"></label>' +
      '<div class="row-actions"><button type="button" class="btn ghost small" data-txtest>Send me a test</button><button type="button" class="btn brand" data-savetexts>Save texts</button></div>');
  }
  function textsForm() {
    var p = { on: $("txOn").value !== "false", demo: $("txOn").value === "demo", via: $("txVia").value, sender: $("txSender").value.trim(), office: $("txOffice").value.trim(), meet: $("txMeet").value.trim(), at: $("txAt").value };
    TEXT_RULES.forEach(function (x) { p[x[0]] = { on: document.querySelector('[data-txon="' + x[0] + '"]').checked, text: document.querySelector('[data-txrule="' + x[0] + '"]').value.trim() }; });
    return p;
  }
  async function saveTexts(btn) {
    var p = textsForm();
    if (p.sender ? !/^[A-Za-z0-9 ]{1,11}$/.test(p.sender) : p.on && p.via === "twilio") return toast("Company name: up to 11 letters or numbers.", true);
    if (p.on && !p.office) return toast("Add the office number customers call.", true);
    btn.disabled = true;
    var r = await sb.rpc("set_texts", { p: p });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.texts = r.data;
    toast(r.data.demo ? "Saved: customer texts in demo, nothing is sent" : r.data.on ? "Saved: customer texts on" : "Customer texts off"); render();
  }
  async function testText(btn) {
    var to = $("txTestTo").value.trim();
    if (!to) return toast("Type your mobile number for the test.", true);
    btn.disabled = true;
    try { await callFunction("send-texts", { type: "test", to: to, text: fillText(textsForm().landed.text, TEXT_SAMPLE, textsForm()) }, true); toast("Test text sent"); }
    catch (e) { toast(e.message, true); }
    btn.disabled = false;
  }
  // The live preview under each text's words.
  document.addEventListener("input", function (e) {
    var k = e.target.dataset && e.target.dataset.txrule, p = k && document.querySelector('[data-txprev="' + k + '"]');
    if (p) p.innerHTML = textPrev(e.target.value, Object.assign(textsForm(), { sender: $("txSender").value.trim() || brandName() }));
  });
  // ── the car's texts ──
  // What was sent to this customer, when and how it went; the office sends one by hand.
  function carTextsHtml(r) { return (textsAddon() && (r.phone || textsOn()) ? '<div id="carTexts"></div>' : "") + (callsAddon() && can("called") ? '<div id="carCalls"></div>' : ""); }
  function carCommsTitle() { return textsAddon() && callsAddon() && can("called") ? "Calls & texts" : callsAddon() && can("called") ? "Calls" : "Texts"; }
  var TEXT_STATE = { queued: "Sending", sent: "Sent", delivered: "Delivered", failed: "Not delivered", skipped: "Not sent", demo: "Demo, not sent" };
  async function carTexts(r) {
    var el = $("carTexts"); if (!el) return;
    var q = await sb.from("customer_texts").select("at, rule, to_number, body, status, error, staff_name").eq("booking_id", r.id).order("at", { ascending: false }).limit(20);
    el = $("carTexts"); if (!el || panelRow !== r) return;
    var list = q.error ? null : q.data || [];
    var rules = r.kind === "drops" ? ["landed", "sent"] : ["reminder"];
    var send = can("called") && r.phone && textsOn() && !r.removed_at ? '<div class="pseg txsend">' + rules.map(function (k) { return '<button type="button" data-txpick="' + k + '">' + esc(TEXT_LABEL[k]) + "</button>"; }).join("") + "</div>" +
      '<div id="txConfirm" hidden></div>' : "";
    el.innerHTML = (isOps() ? "" : "<label>TEXTS</label>") + (list === null ? '<p class="hint">Couldn\'t load the texts.</p>' : !list.length ? '<p class="hint">' + (r.phone ? "No texts sent to this customer yet." : "No phone number on this booking.") + "</p>" :
      '<div class="hist txlist">' + list.map(function (t) {
        var bad = t.status === "failed" || t.status === "skipped";
        return '<div><span class="hw num">' + esc(dayShort(t.at) + " " + hhmm(t.at)) + '</span><span class="hb"><b>' + esc(TEXT_LABEL[t.rule] || "Text") + "</b> · " +
          '<span class="' + (bad ? "bad" : "") + '">' + esc(TEXT_STATE[t.status] || t.status) + (t.error ? ": " + esc(t.error) : "") + "</span>" + (t.staff_name ? " · " + esc(t.staff_name) : "") +
          '<span class="hv">' + esc(t.body) + "</span></span></div>";
      }).join("") + "</div>") + (send ? '<p class="hint">Send a text now:</p>' + send : "");
  }
  // A tap on a text shows its words first; Send now sends it.
  function pickText(k) {
    var r = panelRow, box = $("txConfirm"); if (!r || !box) return;
    document.querySelectorAll("[data-txpick]").forEach(function (b) { b.classList.toggle("on", b.dataset.txpick === k); });
    var words = fillText(textsCfg()[k].text, r, textsCfg());
    box.hidden = false;
    box.innerHTML = (textsCfg().demo ? '<p class="hint">Demo: it goes on the list, not to the customer.</p>' : "") + '<p class="note" style="border-left:3px solid currentColor;padding-left:10px">To ' + esc(phoneLabel(r.phone)) + ': “' + esc(words) + '”</p><div class="row-actions"><button type="button" class="btn ghost small" data-txcancel>Cancel</button><button type="button" class="btn brand small" data-txsend="' + k + '">Send now</button></div>';
  }
  async function sendTextNow(btn) {
    var r = panelRow; if (!r) return;
    btn.disabled = true;
    try { await callFunction("send-texts", { type: "manual", booking: r.id, rule: btn.dataset.txsend }, true); toast(textsCfg().demo ? "Demo: written on the car, not sent" : "Text sent to " + phoneLabel(r.phone)); }
    catch (e) { btn.disabled = false; return toast(e.message, true); }
    carTexts(r);
  }
  // ── incoming calls (database part 115) ──
  // An add-on (brand.calls): the office number is forwarded to a Twilio number.
  // Each call is written to customer_calls with the caller's car (tonight's
  // DROPS or today's PICKS), and every office phone pops it up with a CALLED
  // button. At busy times auto-answer asks the customer to press 1 (landed) or 2
  // (on the way to drop off) and marks the car itself. The car lists its calls;
  // Menu → Calls lists today's, missed first, to ring back.
  function callsAddon() { return !!(S.company && S.company.brand && S.company.brand.calls === true); }
  function callsCfg() { var c = (S.company && S.company.calls) || {}; return { on: c.on === true, via: c.via === "twilio" ? "twilio" : "phone", number: c.number || "", ring: c.ring || [], auto: c.auto || "off", from: c.from || "20:00", to: c.to || "02:00", words: c.words || "" }; }
  function callsOn() { return callsAddon() && callsCfg().on; }
  var CALL_STATE = { ringing: "Ringing", answered: "Answered", missed: "Missed", auto: "Auto-answered" };
  function callSecs(s) { s = +s || 0; return s ? Math.floor(s / 60) + ":" + pad(s % 60) : ""; }
  function callWhat(k) { return k.status === "answered" ? "Answered" + (k.seconds ? " · " + callSecs(k.seconds) : "") : CALL_STATE[k.status] || k.status; }
  function callMarked(k) { return k.marked === "CALLED" ? (k.kind === "picks" ? "Pressed 2: on the way, marked CALLED" : "Pressed 1: landed, marked CALLED") : ""; }
  // ── the pop-up ──
  var POP = { calls: [], timers: {} };
  function callEvent(k) {
    if (!k || !callsOn() || !can("called") || k.company_id && S.company && k.company_id !== S.company.id) return;
    var i = POP.calls.findIndex(function (x) { return x.id === k.id; });
    if (i >= 0) POP.calls[i] = Object.assign({}, POP.calls[i], k);
    else if (k.status === "ringing" || k.status === "auto") POP.calls.unshift(k); else return;
    POP.calls = POP.calls.slice(0, 3);
    // Answered or auto-answered: it goes by itself after a little while; missed stays until closed.
    if (k.status === "answered" || k.status === "auto") { clearTimeout(POP.timers[k.id]); POP.timers[k.id] = setTimeout(function () { callGone(k.id); }, 15000); }
    if (S.view === "calls") S.callsList = null;
    callPopDraw();
  }
  function callGone(id) { POP.calls = POP.calls.filter(function (x) { return x.id !== id; }); callPopDraw(); }
  window.addEventListener("takeoff:call", function (e) { callEvent(e.detail); });
  function callRow(k) { return k.booking_id ? (S.rows || []).find(function (r) { return r.id === k.booking_id; }) : null; }
  function callPopDraw() {
    var el = $("callPop");
    if (!POP.calls.length) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("div"); el.id = "callPop"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
      el.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:60;max-width:520px;margin:0 auto;display:grid;gap:6px";
      document.body.appendChild(el);
    }
    el.innerHTML = POP.calls.map(function (k) {
      var r = callRow(k), done = r && (r.kind === "drops" ? !!r.called_at : !!r.pick_called), bad = k.status === "missed";
      var who = k.booking_id ? "<b>" + esc(k.reg || "NO REG") + "</b> · " + esc(nice(k.name) || "Customer") + " · " + (k.kind === "picks" ? "PICKS, dropping off" : "DROPS, flying back" + (r && r.flight ? " · " + esc(r.flight) + (r.est_time ? " " + esc(r.est_time) : "") : ""))
        : "<b>Not on today's cars</b>";
      return '<div class="callpop" data-callid="' + k.id + '" style="background:#fff;color:#16181D;border:2px solid ' + (bad ? "#C62828" : "#1B7F3B") + ';border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:15px">' +
        '<div style="display:flex;justify-content:space-between;gap:8px"><span>' + (bad ? "Missed call" : k.status === "ringing" ? "Incoming call" : callWhat(k)) + " · " + esc(phoneLabel(k.from_number) || "Number hidden") + "</span>" +
        '<button type="button" data-callclose="' + k.id + '" aria-label="Close" style="background:none;border:0;font-size:20px;line-height:1;color:inherit">&times;</button></div>' +
        '<div style="margin-top:4px">' + who + "</div>" + (callMarked(k) ? '<div style="margin-top:4px;color:#1B7F3B">' + esc(callMarked(k)) + "</div>" : "") +
        (k.handled_name ? '<div style="margin-top:4px">' + esc(k.handled_name) + " has it</div>" : "") +
        '<div class="row-actions" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' +
          (r && !done && !r.removed_at ? '<button type="button" class="btn brand small" data-callmark="' + k.id + '">CALLED</button>' : done ? '<span class="hint">CALLED ✓</span>' : "") +
          (r ? '<button type="button" class="btn ghost small" data-callopen="' + k.id + '">Open car</button>' : "") +
          (!k.handled_name ? '<button type="button" class="btn ghost small" data-calltake="' + k.id + '">' + (bad ? "I'll call back" : "I've got it") + "</button>" : "") +
          (bad && k.from_number ? '<a class="btn ghost small" href="tel:' + esc(dialable(k.from_number)) + '">Call back</a>' : "") +
        "</div></div>";
    }).join("");
  }
  async function callTake(id, btn) {
    if (btn) btn.disabled = true;
    var r = await sb.rpc("call_take", { p_call: +id });
    if (r.error) { if (btn) btn.disabled = false; return toast(r.error.message, true); }
    callEvent(r.data); if (S.view === "calls") loadCalls();
  }
  function callMark(id) {
    var k = POP.calls.find(function (x) { return String(x.id) === String(id); }), r = k && callRow(k); if (!r) return;
    if (r.kind === "drops") { if (!r.called_at) tapDrop(r, "called"); } else if (!r.pick_called) tapPick(r, "called", "Called");
    callPopDraw();
  }
  // ── on the car: its calls, with the texts ──
  async function carCalls(r) {
    var el = $("carCalls"); if (!el) return;
    var q = await sb.from("customer_calls").select("id, at, from_number, status, seconds, marked, kind, handled_name").eq("booking_id", r.id).order("at", { ascending: false }).limit(20);
    el = $("carCalls"); if (!el || panelRow !== r) return;
    var list = q.error ? null : q.data || [];
    el.innerHTML = (isOps() ? '<div class="hint" style="margin-top:8px">Calls</div>' : "<label>CALLS</label>") + (list === null ? '<p class="hint">Couldn\'t load the calls.</p>' : !list.length ? '<p class="hint">No calls from this customer yet.</p>' :
      '<div class="hist callist">' + list.map(function (k) {
        return '<div><span class="hw num">' + esc(dayShort(k.at) + " " + hhmm(k.at)) + '</span><span class="hb"><b class="' + (k.status === "missed" ? "bad" : "") + '">' + esc(callWhat(k)) + "</b>" +
          (k.handled_name ? " · " + esc(k.handled_name) : "") + (callMarked(k) ? '<span class="hv">' + esc(callMarked(k)) + "</span>" : "") + "</span></div>";
      }).join("") + "</div>");
  }
  // ── Menu → Calls: today's calls, missed first ──
  async function loadCalls() {
    var since = new Date(Date.now() - 24 * 3600000).toISOString();
    var q = await sb.from("customer_calls").select("*").gte("at", since).order("at", { ascending: false }).limit(300);
    S.callsList = q.error ? false : q.data || [];
    if (S.view === "calls") render();
  }
  function renderCalls() {
    if (!callsAddon() || !can("called")) return '<div class="msg">Calls aren\'t switched on.</div>';
    if (S.callsList === undefined || S.callsList === null) { S.callsList = 0; loadCalls(); }
    var head = (isOps() ? '<div class="ops-head"><h1>Calls</h1></div>' : "<h2>Calls</h2>") + (callsOn() ? "" : '<p class="note">Calls are off. An owner switches them on in Settings → Calls.</p>');
    if (!S.callsList) return head + '<p class="hint">' + (S.callsList === false ? "Couldn't load the calls." : "Loading…") + "</p>";
    var f = S.callsFilter || "all", L0 = S.callsList, missed = L0.filter(function (k) { return k.status === "missed" && !k.handled_name; });
    var list = f === "missed" ? missed : f === "unknown" ? L0.filter(function (k) { return !k.booking_id; }) : missed.concat(L0.filter(function (k) { return missed.indexOf(k) < 0; }));
    var tab = function (k, t, n) { return '<button type="button" data-callsf="' + k + '" class="' + (f === k ? "on" : "") + '"' + ' aria-pressed="' + (f === k) + '">' + t + (n !== undefined ? " (" + n + ")" : "") + "</button>"; };
    return head + '<div class="pseg" style="margin:10px 0">' + tab("all", "All", L0.length) + tab("missed", "To call back", missed.length) + tab("unknown", "Not on a booking", L0.filter(function (k) { return !k.booking_id; }).length) + "</div>" +
      (!list.length ? '<p class="hint">No calls in the last 24 hours.</p>' : '<div class="box hist calls" style="max-height:none;overflow:visible">' + list.map(function (k) {
        var bad = k.status === "missed" && !k.handled_name;
        return '<div style="padding:8px 10px;border-bottom:1px solid rgba(0,0,0,.08)"><span class="hw num">' + esc(hhmm(k.at)) + '</span><span class="hb"><b class="' + (bad ? "bad" : "") + '">' + esc(callWhat(k)) + "</b> · " +
          esc(phoneLabel(k.from_number) || "Number hidden") + " · " + (k.booking_id ? "<b>" + esc(k.reg || "NO REG") + "</b> " + esc(nice(k.name)) + " (" + (k.kind === "picks" ? "PICKS" : "DROPS") + ")" : "not on a booking") +
          (callMarked(k) ? '<span class="hv">' + esc(callMarked(k)) + "</span>" : "") + (k.handled_name ? '<span class="hv">' + esc(k.handled_name) + (k.status === "missed" ? " called back" : " took it") + "</span>" : "") +
          '<span class="row-actions" style="display:flex;gap:6px;margin-top:6px">' + (k.from_number ? '<a class="btn ghost small" href="tel:' + esc(dialable(k.from_number)) + '">Call</a>' : "") +
          (bad ? '<button type="button" class="btn small" data-calltake="' + k.id + '">Called back</button>' : "") + "</span></span></div>";
      }).join("") + "</div>");
  }
  // ── Settings → Calls (owners) ──
  function callsHtml() {
    if (!callsAddon() || !S.me || S.me.role !== "owner") return "";
    var C = callsCfg(), ring = C.ring.concat(["", "", ""]).slice(0, 3);
    function hrs(id, v) { var o = ""; for (var h = 0; h < 24; h++) for (var m = 0; m < 60; m += 30) { var t = pad(h) + ":" + pad(m); o += '<option value="' + t + '"' + (v === t ? " selected" : "") + ">" + t + "</option>"; } return '<select id="' + id + '">' + o + "</select>"; }
    return setBox("calls", "Calls", !C.on ? "Off" : C.via === "phone" ? "On · company mobile" : C.auto === "on" ? "On · auto-answer" : C.auto === "times" ? "On · auto-answer " + C.from + "–" + C.to : "On · Twilio", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<label class="field">Calls in the app<select id="clOn"><option value="true"' + (C.on ? " selected" : "") + '>On</option><option value="false"' + (C.on ? "" : " selected") + ">Off</option></select></label>" +
      '<label class="field">Calls come in on<select id="clVia"><option value="phone"' + (C.via === "phone" ? " selected" : "") + '>The company mobile (free, Settings → Office phone)</option><option value="twilio"' + (C.via === "twilio" ? " selected" : "") + ">A Twilio number (about £1 a month, adds auto-answer)</option></select></label>" +
      '<div id="clTwilio"' + (C.via === "twilio" ? "" : " hidden") + ">" +
      '<label class="field">Twilio number (forward the office number to it)<input id="clNumber" type="tel" autocomplete="off" placeholder="e.g. 0161 850 0000" value="' + esc(C.number) + '"></label>' +
      '<div class="section-label">Ring these phones</div>' + ring.map(function (n, i) { return '<label class="field">Phone ' + (i + 1) + '<input data-clring type="tel" autocomplete="off" placeholder="' + (i ? "optional" : "e.g. 07700 900123") + '" value="' + esc(n) + '"></label>'; }).join("") +
      '<div class="section-label">Auto-answer</div><p class="note">Press 1 if you\'ve landed, 2 if you\'re on your way to drop off: the car is marked CALLED, then the call is put through.</p>' +
      '<label class="field">Auto-answer<select id="clAuto"><option value="off"' + (C.auto === "off" ? " selected" : "") + '>Off</option><option value="times"' + (C.auto === "times" ? " selected" : "") + '>Between two times</option><option value="on"' + (C.auto === "on" ? " selected" : "") + ">Always</option></select></label>" +
      '<div class="pair"><label class="field">From' + hrs("clFrom", C.from) + '</label><label class="field">Until' + hrs("clTo", C.to) + "</label></div>" +
      '<label class="field">Words (empty: the standard ones)<textarea id="clWords" maxlength="400" rows="3" placeholder="Thank you for calling ' + esc(brandName()) + '. If you have landed, press 1. If you are on your way to drop off your car, press 2. To speak to someone, stay on the line.">' + esc(C.words) + "</textarea></label></div>" +
      '<div class="row-actions"><button type="button" class="btn brand" data-savecalls>Save calls</button></div>');
  }
  async function saveCalls(btn) {
    var p = { on: $("clOn").value === "true", via: $("clVia").value, number: $("clNumber").value.trim(), ring: Array.prototype.map.call(document.querySelectorAll("[data-clring]"), function (x) { return x.value.trim(); }).filter(Boolean),
      auto: $("clAuto").value, from: $("clFrom").value, to: $("clTo").value, words: $("clWords").value.trim() };
    if (p.on && p.via === "twilio" && (!p.number || !p.ring.length)) return toast("Add the Twilio number and a phone to ring.", true);
    btn.disabled = true;
    var r = await sb.rpc("set_calls", { p: p });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.calls = r.data;
    toast(r.data.on ? "Saved: calls on" : "Calls off"); render();
  }
  // ── Settings → Office phone (owners): the Android phone with the company SIM ──
  // MacroDroid on it tells the app about each call (its link holds a key, shown
  // once); the SMS Gateway app on it sends the texts (its login, password in Vault).
  document.addEventListener("change", function (e) { if (e.target.id === "clVia" && $("clTwilio")) $("clTwilio").hidden = e.target.value !== "twilio"; });
  function phoneLink(k) { return CFG.url + "/functions/v1/calls?step=phone&key=" + k; }
  function officePhoneHtml() {
    if (!(textsAddon() || callsAddon()) || !S.me || S.me.role !== "owner") return "";
    if (S.ophone === undefined) { S.ophone = null; sb.rpc("office_phone_status").then(function (r) { S.ophone = r.error ? false : r.data; if (S.view === "settings") render(); }); }
    if (S.ophone === false) return "";
    var O = S.ophone || {}, seen = O.last_seen ? dayShort(O.last_seen) + " " + hhmm(O.last_seen) : "";
    var link = S.ophoneKey ? phoneLink(S.ophoneKey) : "";
    var calls = callsAddon() ? '<div class="section-label">Calls: MacroDroid (free)</div>' +
      '<p class="note">' + (O.linked ? "Linked" + (seen ? ". Last heard from the phone " + esc(seen) + "." : ", not heard from yet.") : "Not linked yet.") + "</p>" +
      (link ? '<p class="note">The phone\'s link, shown once. Copy it into MacroDroid now:</p><p class="note" style="word-break:break-all;border-left:3px solid currentColor;padding-left:10px">' + esc(link) + "</p>" +
        '<div class="row-actions"><button type="button" class="btn ghost small" data-copy="' + esc(link) + '">Copy link</button></div>' +
        '<ol class="note" style="padding-left:20px">' +
          "<li>On the office Android phone, install MacroDroid.</li>" +
          "<li>Macro 1: trigger <b>Call Incoming</b>, action <b>HTTP Request</b> (POST) to the link with <b>&amp;event=ringing&amp;number=</b> and the caller's number (Magic text: Call number).</li>" +
          "<li>Macro 2: trigger <b>Call Active</b> (incoming), the same with <b>event=answered</b>.</li>" +
          "<li>Macro 3: trigger <b>Call Missed</b>, the same with <b>event=missed</b>.</li>" +
          "<li>Test: send the link with <b>&amp;event=test</b>; this box then says when it last heard from the phone.</li></ol>" : "") +
      '<div class="row-actions"><button type="button" class="btn ' + (O.linked ? "ghost small" : "brand") + '" data-ophonekey>' + (O.linked ? "New link (the old one stops)" : "Link the phone") + "</button>" +
        (O.linked ? '<button type="button" class="btn ghost small" data-ophonecheck>Check again</button>' : "") + "</div>" : "";
    var texts = textsAddon() ? '<div class="section-label">Texts: SMS Gateway for Android (free)</div>' +
      '<p class="note">Install SMS Gateway on the same phone, switch on its Cloud server, and type the username and password it shows.</p>' +
      '<label class="field">Username<input id="opLogin" autocomplete="off" autocapitalize="none" spellcheck="false" value="' + esc(O.gw_login || "") + '"></label>' +
      '<label class="field">Password <span class="note">' + (S.ophone ? (O.has_pass ? "✓ saved" : "not set") : "…") + '</span><input id="opPass" type="password" autocomplete="new-password" placeholder="' + (O.has_pass ? "Type a new one to replace it" : "") + '"></label>' +
      '<div class="row-actions"><button type="button" class="btn brand" data-ophonesave>Save texting login</button></div>' : "";
    return setBox("ophone", "Office phone", !S.ophone ? "" : O.linked || O.has_pass ? "Set up" + (seen ? " · heard " + hhmm(O.last_seen) : "") : "Not set up", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<p class="note">An Android phone with the company SIM, kept on and charging in the office.</p>' + calls + texts);
  }
  async function officePhoneKey(btn) {
    if (S.ophone && S.ophone.linked && !confirm("Make a new link? The phone's old link stops working until MacroDroid has the new one.")) return;
    btn.disabled = true;
    var r = await sb.rpc("office_phone_new_key");
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    S.ophoneKey = r.data; S.ophone = Object.assign({}, S.ophone, { linked: true, last_seen: null }); render();
  }
  async function officePhoneCheck() { var r = await sb.rpc("office_phone_status"); if (!r.error) { S.ophone = r.data; render(); } }
  async function officePhoneSave(btn) {
    btn.disabled = true;
    var r = await sb.rpc("office_phone_gateway_set", { p_login: $("opLogin").value.trim(), p_password: $("opPass").value || null });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.ophone = r.data; toast(r.data.gw_login ? "Saved: texting login" : "Texting login removed"); render();
  }
