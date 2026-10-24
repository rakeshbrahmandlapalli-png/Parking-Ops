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
  function textsHtml() {
    if (!textsAddon() || !S.me || S.me.role !== "owner") return "";
    var T = textsCfg(), sample = Object.assign({}, T, { sender: T.sender || brandName() });
    function hours() { var o = ""; for (var h = 8; h <= 21; h++) { var v = pad(h) + ":00"; o += '<option value="' + v + '"' + (T.at === v ? " selected" : "") + ">" + v + "</option>"; } return o; }
    return setBox("texts", "Customer texts", T.demo ? "Demo" : T.on ? TEXT_RULES.filter(function (x) { return T[x[0]].on; }).length + " of 3 on" : "Off", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<label class="field">Texts to customers<select id="txOn"><option value="true"' + (T.on && !T.demo ? " selected" : "") + '>On</option><option value="demo"' + (T.demo ? " selected" : "") + ">Demo: write them on each car, don't send</option>" +
        '<option value="false"' + (T.on ? "" : " selected") + ">Off</option></select></label>" +
      '<label class="field">Sent from (up to 11 letters)<input id="txSender" maxlength="11" autocomplete="off" autocapitalize="characters" placeholder="e.g. TAKEOFF" value="' + esc(T.sender) + '"></label>' +
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
    if (p.on && !/^[A-Za-z0-9 ]{1,11}$/.test(p.sender)) return toast("Sent from: up to 11 letters or numbers.", true);
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
  function carTextsHtml(r) { return textsAddon() && (r.phone || textsOn()) ? '<div id="carTexts"></div>' : ""; }
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
