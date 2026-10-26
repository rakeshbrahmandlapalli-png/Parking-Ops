  // ── customer texts (database part 116) ──
  // An add-on (Parking Ops → Clients → Edit, brand.texts): the app texts the
  // customer by itself when their flight lands, when a driver is SENT, and the
  // day before a PICKS drop-off. Owners set it in Settings → Customer texts;
  // the send-texts function sends them (once each) and every text goes on the
  // car's Texts list and the activity log. The office can send one by hand.
  function voiceAddon() { return !!(S.company && S.company.brand && S.company.brand.voice === true); }
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
    var t = (S.company && S.company.texts) || {}, out = { on: t.on === true, demo: t.on === true && t.demo === true, sender: t.sender || "", office: t.office || "", meet: t.meet || "", at: t.at || "18:00" };
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
  function phoneHealthHtml() {
    setTimeout(loadPhoneHealth, 0);
    return '<div class="section-label">Company phone</div><p id="phoneHealth" class="note" role="status">Checking the company phone…</p><div id="phonePair"></div><button type="button" class="btn" data-phone-health>Refresh phone status</button>' +
      (S.me && S.me.role === 'owner' ? ' <a class="btn" href="/phone/takeoff-phone.apk" download>TakeOff Phone app (Android)</a>' : '');
  }
  async function loadPhoneHealth() {
    if (!$('phoneHealth')) return;
    var companyId = S.company && S.company.id, got = await sb.rpc('phone_bridge_status');
    var el = $('phoneHealth'); if (!el || !S.company || S.company.id !== companyId) return;
    if (got.error) { el.textContent = 'Phone status unavailable. Check that phone setup is complete.'; return; }
    var h = got.data || {}, status = !h.paired ? 'No company phone paired.' : h.online ? 'Company phone online.' : 'Company phone offline — texts are waiting.';
    el.textContent = status + (h.paired && !h.sms_ready ? ' SMS access or default SIM needs attention.' : '') +
      (h.battery !== null && h.battery !== undefined ? ' Battery ' + h.battery + '%.' : '') +
      ' ' + (+h.queued || 0) + ' waiting; ' + (+h.needs_review || 0) + ' to review; ' + (+h.expired || 0) + ' expired in the last day.' +
      (h.last_seen && !h.online ? ' Last seen ' + dayShort(h.last_seen) + ' ' + hhmm(h.last_seen) + '.' : '') +
      (h.paired && h.paired_as ? ' Signed in as ' + h.paired_as + '.' : '');
    // Pairing (part 118): the handset signs in with the office login and asks; an owner approves it here.
    var pair = $('phonePair'), own = !!(S.me && S.me.role === 'owner'), p = h.pending, o = '';
    if (pair) {
      if (own && h.paired && h.paired_as_owner) o += '<p class="note">This phone is signed in with an owner\'s login. Sign it in with the office login and approve it here instead.</p>';
      if (own && p) o += '<p class="note"><b>A phone is asking to be paired</b>, signed in as ' + esc(p.name || '?') + ' (' + dayShort(p.at) + ' ' + hhmm(p.at) + ').' + (h.paired ? ' Approving it replaces the paired phone.' : '') + '</p>' +
        '<button type="button" class="btn" data-phonepair="approve" data-device="' + esc(p.device) + '">Approve this phone</button> <button type="button" class="btn" data-phonepair="refuse">Refuse</button>';
      if (own && h.paired) o += ' <button type="button" class="btn" data-phonepair="unpair">Unpair the phone</button>';
      pair.innerHTML = o;
    }
  }
  async function phonePairing(btn) {
    var a = btn.dataset.phonepair;
    if (a === 'approve' && !confirm('Approve this phone? It sends the customer texts from now on.')) return;
    if (a === 'unpair' && !confirm('Unpair the company phone? It stops sending texts until a phone is approved again.')) return;
    btn.disabled = true;
    var got = await sb.rpc('phone_pairing', { p_action: a, p_device: btn.dataset.device || null });
    btn.disabled = false;
    if (got.error) { toast(got.error.message, true); return; }
    toast(a === 'approve' ? 'Phone approved. Tap Go online on it.' : a === 'unpair' ? 'Phone unpaired.' : 'Refused.');
    loadPhoneHealth();
  }
  setInterval(function () { if (S.view === 'settings' && document.visibilityState !== 'hidden' && $('phoneHealth')) loadPhoneHealth(); }, 30000);
  document.addEventListener('click', async function (e) {
    if (e.target.closest('[data-phone-health]')) loadPhoneHealth();
    var pb = e.target.closest('[data-phonepair]'); if (pb) { phonePairing(pb); return; }
    var review = e.target.closest('[data-reviewtext]');
    if (!review) return;
    if (!confirm('Have you checked the send outcome on the company phone? Marking reviewed does not send another message.')) return;
    review.disabled = true;
    var got = await sb.rpc('phone_text_review', { p_id: +review.dataset.reviewtext });
    if (got.error) { review.disabled = false; toast(got.error.message, true); return; }
    if (panelRow) carTexts(panelRow);
    loadPhoneHealth();
  });
  function textsHtml() {
    if (!textsAddon() || !S.me || S.me.role !== "owner") return "";
    var T = textsCfg(), sample = Object.assign({}, T, { sender: T.sender || brandName() });
    function hours() { var o = ""; for (var h = 8; h <= 21; h++) { var v = pad(h) + ":00"; o += '<option value="' + v + '"' + (T.at === v ? " selected" : "") + ">" + v + "</option>"; } return o; }
    return setBox("texts", "Customer texts", T.demo ? "Demo" : T.on ? TEXT_RULES.filter(function (x) { return T[x[0]].on; }).length + " of 3 on" : "Off", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      phoneHealthHtml() + '<label class="field">Texts to customers<select id="txOn"><option value="true"' + (T.on && !T.demo ? " selected" : "") + '>On</option><option value="demo"' + (T.demo ? " selected" : "") + ">Demo: write them on each car, don't send</option>" +
        '<option value="false"' + (T.on ? "" : " selected") + ">Off</option></select></label>" +
      '<label class="field">Name in the message<input id="txSender" maxlength="40" autocomplete="off" placeholder="e.g. TakeOff Parking" value="' + esc(T.sender) + '"></label>' +
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
      '<p class="note">{name} the customer (Ms Khaira), {reg}, {office}, {meet}, {date} and {time} of the drop-off, {company}. Customers can\'t reply to these texts.</p>' +
      '<label class="field">Test to your mobile<input id="txTestTo" data-nodirty type="tel" autocomplete="off" placeholder="07…"></label>' +
      '<div class="row-actions"><button type="button" class="btn ghost small" data-txtest>Send me a test</button><button type="button" class="btn brand" data-savetexts>Save texts</button></div>');
  }
  function textsForm() {
    var p = { on: $("txOn").value !== "false", demo: $("txOn").value === "demo", sender: $("txSender").value.trim(), office: $("txOffice").value.trim(), meet: $("txMeet").value.trim(), at: $("txAt").value };
    TEXT_RULES.forEach(function (x) { p[x[0]] = { on: document.querySelector('[data-txon="' + x[0] + '"]').checked, text: document.querySelector('[data-txrule="' + x[0] + '"]').value.trim() }; });
    return p;
  }
  async function saveTexts(btn) {
    var p = textsForm();
    if (p.on && p.sender.length > 40) return toast("The message name is 40 characters at most.", true);
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
    try { await callFunction("send-texts", { type: "test", to: to, text: fillText(textsForm().landed.text, TEXT_SAMPLE, textsForm()) }, true); toast("Test text queued on the company phone"); }
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
  var TEXT_STATE = { queued: "Waiting for company phone", sending: "Sending from company phone", sent: "Sent from company SIM", delivered: "Delivered", failed: "Not sent", uncertain: "Check send outcome", expired: "Expired — not sent", skipped: "Not sent", demo: "Demo, not sent" };
  async function carTexts(r) {
    var el = $("carTexts"); if (!el) return;
    var got = await Promise.all([
      sb.from("customer_texts").select("id, at, rule, to_number, body, status, error, staff_name, reviewed_at, expires_at").eq("booking_id", r.id).order("at", { ascending: false }).limit(20),
      sb.from("customer_sms").select("at, from_number, body").eq("booking_id", r.id).order("at", { ascending: false }).limit(20)
    ]);
    el = $("carTexts"); if (!el || panelRow !== r) return;
    var list = got[0].error || got[1].error ? null : (got[0].data || []).map(function (x) { x.direction = "outbound"; if (x.status === "queued" && x.expires_at && new Date(x.expires_at).getTime() <= Date.now()) x.status = "expired"; return x; }).concat((got[1].data || []).map(function (x) { x.direction = "inbound"; x.rule = "reply"; x.status = "received"; x.to_number = x.from_number; return x; })).sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
    var rules = r.kind === "drops" ? ["landed", "sent"] : ["reminder"];
    var send = can("called") && r.phone && textsOn() && !r.removed_at ? '<div class="pseg txsend">' + rules.map(function (k) { return '<button type="button" data-txpick="' + k + '">' + esc(TEXT_LABEL[k]) + "</button>"; }).join("") + "</div>" +
      '<div id="txConfirm" hidden></div>' : "";
    el.innerHTML = (isOps() ? "" : "<label>TEXTS</label>") + (list === null ? '<p class="hint">Couldn\'t load the messages.</p>' : !list.length ? '<p class="hint">' + (r.phone ? "No messages with this customer yet." : "No phone number on this booking.") + "</p>" :
      '<div class="hist txlist">' + list.map(function (t) {
        var bad = t.status === "failed" || t.status === "skipped" || t.status === "uncertain" || t.status === "expired";
        return '<div><span class="hw num">' + esc(dayShort(t.at) + " " + hhmm(t.at)) + '</span><span class="hb"><b>' + (t.direction === "inbound" ? "Customer reply" : esc(TEXT_LABEL[t.rule] || "Text")) + "</b> · " +
          '<span class="' + (bad ? "bad" : "") + '">' + (t.direction === "inbound" ? "Received from " + esc(phoneLabel(t.from_number)) : esc(TEXT_STATE[t.status] || t.status) + (t.error ? ": " + esc(t.error) : "")) + "</span>" + (t.staff_name ? " · " + esc(t.staff_name) : "") +
          '<span class="hv">' + esc(t.body) + "</span>" + (t.direction === "outbound" && /^(failed|uncertain)$/.test(t.status) && !t.reviewed_at && can("called") ? '<button type="button" class="btn" data-reviewtext="' + esc(t.id) + '">Mark reviewed</button>' : '') + "</span></div>";
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
    if (!btn.dataset.txrequest) btn.dataset.txrequest = crypto.randomUUID();
    try { await callFunction("send-texts", { type: "manual", booking: r.id, rule: btn.dataset.txsend, request: btn.dataset.txrequest }, true); toast(textsCfg().demo ? "Demo: written on the car, not sent" : "Text queued on company phone"); }
    catch (e) { btn.disabled = false; return toast(e.message, true); }
    carTexts(r);
  }
  // ── incoming calls (database part 117) ──
  // An add-on (brand.calls): the TakeOff Android companion screens calls on
  // the company SIM, matches them to a booking and records the call. The app
  // never answers or redirects a call; staff use the normal phone controls.
  function callsAddon() { return !!(S.company && S.company.brand && S.company.brand.calls === true); }
  function callsCfg() { var c = (S.company && S.company.calls) || {}; return { on: c.on === true }; }
  function callsOn() { return callsAddon() && callsCfg().on; }
  var CALL_STATE = { ringing: "Ringing", answered: "Answered", missed: "Missed" };
  function callSecs(s) { s = +s || 0; return s ? Math.floor(s / 60) + ":" + pad(s % 60) : ""; }
  function callWhat(k) { return k.status === "answered" ? "Answered" + (k.seconds ? " · " + callSecs(k.seconds) : "") : CALL_STATE[k.status] || k.status; }
  function callMarked(k) { return k.marked === "CALLED" ? (k.kind === "picks" ? "Pressed 2: on the way, marked CALLED" : "Pressed 1: landed, marked CALLED") : ""; }
  // ── the pop-up ──
  var POP = { calls: [], timers: {} };
  function callEvent(k) {
    if (!k || !callsOn() || !can("callpop") || k.company_id && S.company && k.company_id !== S.company.id) return;
    var i = POP.calls.findIndex(function (x) { return x.id === k.id; });
    if (i >= 0) POP.calls[i] = Object.assign({}, POP.calls[i], k);
    else if (k.status === "ringing") POP.calls.unshift(k); else return;
    POP.calls = POP.calls.slice(0, 3);
    // Answered calls disappear after a short while; missed calls stay until closed.
    if (k.status === "answered") { clearTimeout(POP.timers[k.id]); POP.timers[k.id] = setTimeout(function () { callGone(k.id); }, 15000); }
    if (S.view === "calls") S.callsList = null;
    callPopDraw();
    callLoadCar(POP.calls.find(function (x) { return x.id === k.id; }) || k);
  }
  function callGone(id) { POP.calls = POP.calls.filter(function (x) { return x.id !== id; }); callPopDraw(); }
  window.addEventListener("takeoff:call", function (e) { callEvent(e.detail); });
  function callRow(k) { return k.booking_id ? (S.rows || []).find(function (r) { return r.id === k.booking_id; }) : null; }
  // The car's details when it is on another sheet than the one on screen: read once, shown, never edited from here.
  POP.cars = {};
  function callCar(k) { return callRow(k) || (k.booking_id && POP.cars[k.booking_id]) || null; }
  async function callLoadCar(k) {
    if (!k.booking_id || callRow(k) || POP.cars[k.booking_id] !== undefined) return;
    POP.cars[k.booking_id] = null;
    var q = await sb.from("bookings").select("*").eq("id", k.booking_id).maybeSingle();
    if (q.data) { POP.cars[k.booking_id] = q.data; callPopDraw(); }
  }
  async function callOpenCar(k) {
    var r = callRow(k); if (r) return openPanel(r);
    var b = callCar(k); if (!b) return;
    await openArchived(b.sheet_id, b.reg);
    var row = (S.rows || []).filter(function (x) { return x.id === b.id; })[0];
    if (row) openPanel(row);
  }
  // 26 Oct redesign (the user's mock-up): status chip, reg and customer, number masked, return / status /
  // location / key tag from the car, cars due out before it, Claim call and Open booking. Only what the
  // car really holds is shown; no lane or position (that needs the Yard planner) and no invented queue.
  function callMask(p) {
    var d = String(dialable(p) || "").replace(/\D/g, "");
    return d.length >= 8 ? (d.slice(0, 2) === "44" ? "+44 " : d.slice(0, 2)) + "••• •••" + d.slice(-3) : "";
  }
  function callStatus(r) {
    if (r.kind === "picks") return r.intake === "Collected" ? "Parked in yard" : "Not taken in yet";
    return r.cleared_at ? "Handed back" : r.sent_at ? "On its way" : r.called_at ? "Called" : r.flight_status === "landed" ? "Landed" : r.flight ? "Flight " + r.flight : "Waiting";
  }
  // The car's own mark: a PICKS car marked NEW BOOKING says so, it was never called (26 Oct, LN13ELV showed CALLED ✓).
  function callMarkOn(r) {
    if (!r) return "";
    if (r.kind === "drops") return r.called_at ? "CALLED" : "";
    return r.pick_called === "New Booking" ? "NEW BOOKING" : r.pick_called ? "CALLED" : "";
  }
  function callAhead(r) {
    if (!r || r.kind !== "drops" || r.sent_at || r.cleared_at || r.removed_at || !r.return_at) return 0;
    return (S.rows || []).filter(function (x) { return x !== r && x.kind === "drops" && waiting(x) && !x.removed_at && x.return_at && x.return_at < r.return_at; }).length;
  }
  function callPopCss() {
    if ($("callPopCss")) return;
    var st = document.createElement("style"); st.id = "callPopCss";
    st.textContent = ".callpop{background:#fff;color:#16181D;border:1px solid #D9DDE3;border-top:4px solid var(--brand,#F9A01B);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.28);font-size:15px;overflow:hidden}" +
      ".callpop.bad{border-top-color:#C62828}.callpop .cp-h,.callpop .cp-b,.callpop .cp-f{padding:10px 14px}.callpop .cp-h{display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid #E6E9EE;font-weight:600}" +
      ".callpop .cp-chip{font-size:13px;font-weight:700;color:#B26A00}.callpop .cp-chip.ok{color:#1B7F3B}" +
      ".callpop .cp-reg{font-size:22px;font-weight:800;letter-spacing:.5px}.callpop .cp-kind{font-size:13px;font-weight:700;color:#1B7F3B;background:#E7F5EC;border-radius:6px;padding:4px 8px;white-space:nowrap}" +
      ".callpop .cp-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.callpop .cp-sub{color:#5B6370;font-size:14px;margin-top:2px}" +
      ".callpop .cp-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;margin-top:10px;padding-top:10px;border-top:1px solid #E6E9EE}.callpop .cp-grid span{display:block;color:#5B6370;font-size:12px}.callpop .cp-grid b{font-size:15px}" +
      ".callpop .cp-warn{margin-top:10px;background:#FFF3DC;color:#7A4A00;border-radius:8px;padding:8px 10px;font-size:14px}.callpop .cp-act{display:grid;gap:6px;margin-top:10px}.callpop .cp-act .btn{width:100%;justify-content:center;text-align:center}" +
      ".callpop .cp-f{color:#5B6370;font-size:13px;background:#F5F6F8;border-top:1px solid #E6E9EE}";
    document.head.appendChild(st);
  }
  function callPopDraw() {
    var el = $("callPop");
    if (!POP.calls.length) { if (el) el.remove(); return; }
    callPopCss();
    if (!el) {
      el = document.createElement("div"); el.id = "callPop"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
      el.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:60;max-width:430px;margin:0 auto;display:grid;gap:8px;max-height:calc(100vh - 16px);overflow:auto";
      document.body.appendChild(el);
    }
    el.innerHTML = POP.calls.map(function (k) {
      var live = callRow(k), r = live || callCar(k), mark = callMarkOn(r), bad = k.status === "missed", hit = !!k.booking_id;
      var head = bad ? "Missed call" : k.status === "ringing" ? "Incoming call" : callWhat(k);
      var chip = k.handled_name ? '<span class="cp-chip ok">Claimed by ' + esc(k.handled_name) + "</span>" : '<span class="cp-chip">Unclaimed</span>';
      var mask = callMask(k.from_number) || "Number hidden";
      var body = hit
        ? '<div class="cp-top"><div><div class="cp-reg">' + esc(k.reg || "NO REG") + '</div><div style="font-weight:600;margin-top:2px">' + esc(nice(k.name) || "Customer") + '</div></div><span class="cp-kind">' + (k.kind === "picks" ? "PICKS" : "DROPS") + "</span></div>" +
          '<div class="cp-sub">' + esc(mask) + " · Number matched</div>"
        : '<div class="cp-reg" style="font-size:18px">Not on today\'s cars</div><div class="cp-sub">' + esc(mask) + " · Number not matched</div>";
      var grid = hit && r ? '<div class="cp-grid"><div><span>Return due</span><b>' + esc(dayShort(r.return_at) + " · " + hhmm(r.return_at)) + "</b></div><div><span>Vehicle status</span><b>" + esc(callStatus(r)) + "</b></div>" +
          "<div><span>Vehicle location</span><b>" + esc(r.yard ? YARD_LABEL[r.yard] || r.yard : "Not set") + "</b></div><div><span>Key tag</span><b>" + (r.num ? esc(r.num) : "—") + "</b></div></div>" : "";
      var ahead = live ? callAhead(live) : 0, warn = ahead ? '<div class="cp-warn"><b>' + ahead + (ahead === 1 ? " car" : " cars") + " due out before this one</b> · Check retrieval before confirming a time.</div>" : "";
      var acts = '<div class="cp-act">' +
        (!k.handled_name ? '<button type="button" class="btn brand" data-calltake="' + k.id + '">' + (bad ? "I\'ll call back" : "Claim call") + "</button>" : "") +
        (r ? '<button type="button" class="btn ghost" data-callopen="' + k.id + '">Open booking</button>' : "") +
        (live && can("called") && !mark && !r.removed_at ? '<button type="button" class="btn ghost" data-callmark="' + k.id + '">CALLED</button>' : mark ? '<span class="hint" style="text-align:center">' + mark + " ✓</span>" : "") +
        (bad && k.from_number ? '<a class="btn ghost" href="tel:' + esc(dialable(k.from_number)) + '">Call back</a>' : "") + "</div>";
      return '<div class="callpop' + (bad ? " bad" : "") + '" data-callid="' + k.id + '"><div class="cp-h"><span>' + head + "</span>" + chip +
        '<button type="button" data-callclose="' + k.id + '" aria-label="Close" style="background:none;border:0;font-size:22px;line-height:1;color:inherit;margin-left:4px">&times;</button></div>' +
        '<div class="cp-b">' + body + grid + warn + (callMarked(k) ? '<div style="margin-top:8px;color:#1B7F3B">' + esc(callMarked(k)) + "</div>" : "") + acts + "</div>" +
        '<div class="cp-f">' + (k.handled_name ? esc(k.handled_name) + " has it" : "No staff member assigned") + " · from the company phone " + esc(hhmm(k.at)) + "</div></div>";
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
    var C = callsCfg();
    if (voiceAddon()) setTimeout(loadVoiceMenu, 0);
    return setBox("calls", "Calls", C.on ? "On · company Android" : "Off", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      (textsAddon() ? '' : phoneHealthHtml()) + '<label class="field">Calls in the app<select id="clOn"><option value="true"' + (C.on ? " selected" : "") + '>On</option><option value="false"' + (C.on ? "" : " selected") + ">Off</option></select></label>" +
      '<p class="note">Calls use the company Android phone and its SIM. Customers keep calling the usual company number. The TakeOff phone app shows the matching booking and call status. The optional caller menu below can answer calls through an approved voice service.</p>' +
      '<div class="row-actions"><button type="button" class="btn brand" data-savecalls>Save calls</button></div>' +
      (voiceAddon() ? '<div id="voiceMenu" style="margin-top:20px"><h3>Caller keypad menu</h3><p class="note">Checking voice setup…</p></div>' : ""));
  }
  async function saveCalls(btn) {
    var p = { on: $("clOn").value === "true" };
    btn.disabled = true;
    var r = await sb.rpc("set_calls", { p: p });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.calls = r.data;
    toast(r.data.on ? "Saved: calls on for the company Android" : "Calls off"); render();
  }

  async function loadVoiceMenu() {
    var host = $("voiceMenu"), company = S.company && S.company.id;
    if (!host) return;
    var r = await sb.rpc("voice_menu_settings");
    if (host !== $("voiceMenu") || !S.company || S.company.id !== company) return;
    if (r.error || !r.data || !r.data.configured) {
      host.innerHTML = '<h3>Caller keypad menu</h3><p class="note">Not set up. This optional service answers calls, takes 1 for landed or 2 for dropping off, then rings this TakeOff app. A voice service and cost approval are required.</p>';
      return;
    }
    var v = r.data, ready = v.approved && v.app_ready;
    host.innerHTML = '<h3>Caller keypad menu</h3><p class="note">' + (v.approved ? (v.app_ready ? 'Company phone ready for calls in TakeOff.' : 'Open Voice calls on the company phone to register it.') : 'Waiting for service cost approval.') + '</p>' +
      '<label class="field">Caller menu<select id="vmOn"><option value="false"' + (!v.on ? ' selected' : '') + '>Off</option><option value="true"' + (v.on ? ' selected' : '') + (!ready && !v.on ? ' disabled' : '') + '>On</option></select></label>' +
      '<label class="field">Text the caller the instructions<select id="vmText"><option value="demo"' + (v.menu_text === "demo" || !v.menu_text ? ' selected' : '') + '>Demo: write it on the call, don\'t send</option><option value="on"' + (v.menu_text === "on" ? ' selected' : '') + '>On: send from the company phone</option><option value="off"' + (v.menu_text === "off" ? ' selected' : '') + '>Off</option></select></label>' +
      '<label class="field">Greeting<textarea id="vmGreeting" maxlength="400" rows="3">' + esc(v.greeting) + '</textarea></label>' +
      '<p class="note">Leave the greeting blank for the standard welcome. TakeOff then reads: 1 if you have landed, 2 if you are dropping off, or 0 for the office. A single matching booking is marked CALLED. Calls ring inside TakeOff; internet is required.</p>' +
      '<button type="button" class="btn brand" data-savevoice>Save caller menu</button>';
  }
  async function saveVoiceMenu(btn) {
    btn.disabled = true;
    var r = await sb.rpc("set_voice_menu", { p_on: $("vmOn").value === "true", p_greeting: $("vmGreeting").value });
    if (!r.error && $("vmText")) r = await sb.rpc("set_voice_menu_text", { p_mode: $("vmText").value });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); toast("Caller menu saved"); loadVoiceMenu();
  }
