  // ── staff ─────────────────────────────────
  var ROLE_LABEL = { owner: "Owner", office: "Office", manager: "Manager", bongo: "Bongo driver", terminal: "Terminal", view: "View only" };
  function issuedHtml(x, appName) {
    var msg = "Your " + (appName || brandName()) + " app: " + x.link + " (open it on your phone) Your PIN: " + x.pin;
    return '<div class="issued"><strong>' + esc(x.name) + " · " + esc(ROLE_LABEL[x.role] || x.role) + '</strong><span class="note">Send them this link and PIN. It is shown only once.</span><code>' + esc(x.link) + '</code><div>PIN <span class="pin num">' + esc(x.pin) + "</span></div>" +
      '<div class="row-actions" style="margin:0"><button type="button" class="btn small" data-copy="' + esc(msg) + '">Copy message</button>' +
      '<a class="btn ghost small" href="https://wa.me/?text=' + encodeURIComponent(msg) + '" target="_blank" rel="noopener">WhatsApp</a></div></div>';
  }
  // ── Clients (product owner only, database part 19) ──
  // Counts only: this page never sees a client's customers.
  // The looks a client's app can wear (brand.theme): "pro" is pro.css, "cards" is cards.css, "premium" is premium.css, "board" is premium.css + board.css.
  var LOOKS = [["", "Standard"], ["pro", "Airport Parking Bay UI"], ["cards", "Cards (light and dark)"], ["premium", "Premium UI"], ["board", "Premium Board"], ["stdplus", "Standard with features"], ["ops", "Operations"], ["ops-refined", "Operations Refined"]];
  function lookName(b) { var l = LOOKS.filter(function (x) { return x[0] === ((b && b.theme) || ""); })[0]; return l ? l[1] : "Standard"; }
  function renderClients() {
    if (S.clients === undefined) { S.clients = null; loadClients(); }
    var list = S.clients;
    var hw = (S.health && S.health.warnings) || [];
    var h = '<div class="clienthead"><h2 class="title">Clients</h2><button type="button" class="btn ghost" data-health>Health</button><button type="button" class="btn ghost" data-usage>Usage</button><button type="button" class="btn brand" data-clientedit="new">Add a client</button></div>' +
      (hw.length ? '<button type="button" class="hwarnline" data-health>' + hw.length + (hw.length === 1 ? " thing needs" : " things need") + " a look · Health</button>" : "");
    if (list === null) return h + '<p class="note">Loading…</p>';
    if (list === false) return h + '<div class="msg">Couldn\'t load the clients. Refresh to try again.</div>';
    if (!list.length) return h + '<p class="note">No clients yet.</p>';
    return h + '<div class="clients">' + list.map(function (c) {
      var b = c.brand || {}, host = b.host || "parking-ops.vercel.app";
      var status = c.suspended_at ? '<span class="cstat off">Suspended</span>' : !c.has_owner ? '<span class="cstat wait">Waiting for owner</span>' : '<span class="cstat on">Active</span>';
      var last = c.last_activity ? dayShort(c.last_activity) + " " + hhmm(c.last_activity) : "never";
      return '<div class="client' + (c.suspended_at ? " off" : "") + '"><div class="cl1"><span class="swatch" style="background:' + esc(b.colour || "#334155") + '"></span><strong>' + esc(c.name) + "</strong>" + status + "</div>" +
        '<div class="cmeta">' + esc(c.slug) + " · " + esc(host) + " · yards " + esc((c.yards || []).join(", ")) + " · " + esc(lookName(b)) + "</div>" +
        '<div class="cnums"><div><b class="num">' + c.staff + "</b><span>staff</span></div><div><b class=\"num\">" + c.cars_7d + "</b><span>cars, last 7 days</span></div><div><b class=\"num\">" + c.sheets_7d + "</b><span>sheets, last 7 days</span></div><div><b>" + esc(last) + "</b><span>last activity</span></div></div>" +
        '<div class="row-actions">' + (c.suspended_at ? "" : '<button type="button" class="btn brand small" data-clientopen="' + c.id + '">Open board</button>') +
        '<button type="button" class="btn ghost small" data-clientedit="' + c.id + '">Edit</button>' +
        (!c.has_owner && !c.suspended_at ? '<button type="button" class="btn brand small" data-clientowner="' + c.id + '">Create first owner</button>' : "") +
        '<button type="button" class="btn ghost small' + (c.suspended_at ? "" : " warn") + '" data-clientsuspend="' + c.id + '">' + (c.suspended_at ? "Resume" : "Suspend") + "</button></div></div>";
    }).join("") + "</div>";
  }
  async function loadClients() {
    var both = await Promise.all([sb.rpc("admin_clients"), sb.rpc("admin_health")]);
    S.clients = both[0].error ? false : both[0].data || [];
    S.health = both[1].error ? null : both[1].data;
    if (S.view === "clients") render();
  }
  function hexMix(hex, withHex, amt) {
    var a = parseInt(hex.slice(1), 16), b = parseInt(withHex.slice(1), 16);
    var ch = function (x, y) { return Math.round(x + (y - x) * amt); };
    var r = ch(a >> 16 & 255, b >> 16 & 255), g = ch(a >> 8 & 255, b >> 8 & 255), bl = ch(a & 255, b & 255);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1).toUpperCase();
  }
  // Yard colours (Settings, owners only, database part 77): each yard's tag,
  // PICKS location button and car-panel yard button filled with its colour.
  // A yard with no colour keeps the look's own.
  function yardColour(y) { var c = ((S.company && S.company.yard_colours) || {})[y]; return /^#[0-9A-Fa-f]{6}$/.test(c || "") ? c.toUpperCase() : ""; }
  function applyYardColours(co) {
    var yc = (co && co.yard_colours) || {}, css = "";
    Object.keys(yc).forEach(function (y) {
      var c = yc[y];
      if (!/^[A-Za-z0-9_-]+$/.test(y) || !/^#[0-9A-Fa-f]{6}$/.test(c || "")) return;
      var ink = lightColour(c) ? "#1F1A00" : "#FFFFFF", line = hexMix(c, "#000000", 0.15);
      css += "html body .code." + y + ",html body select.code.pick." + y + ",html body .acts .pyard.on.y-" + y + ",html body .pseg.yard button.on.y-" + y +
        "{background:" + c + ";border-color:" + line + ";color:" + ink + ";}";
      // Operations (and Operations Refined) on a wide screen: a dot of the yard's colour by its count.
      css += "html.ops body.ops-desk #tally button[data-tally=\"" + y + "\"] span::before,html.ops-refined body.ops-desk #tally button[data-tally=\"" + y + "\"] span::before{display:inline-block;background:" + c + ";}";
    });
    var el = document.getElementById("yardColours");
    if (!el) { el = document.createElement("style"); el.id = "yardColours"; document.head.appendChild(el); }
    el.textContent = css;
  }
  function lightColour(hex) { var n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) > 160; }
  function openClient(id) {
    var c = id === "new" ? null : (S.clients || []).filter(function (x) { return x.id === id; })[0];
    var b = (c && c.brand) || {};
    var f = function (key, label, val, attrs, hint) { return '<label for="' + key + '">' + label + '</label><input id="' + key + '" value="' + esc(val || "") + '" autocomplete="off" ' + (attrs || "") + ">" + (hint ? '<p class="hint">' + hint + "</p>" : ""); };
    $("panelBody").innerHTML = '<h2 id="panelTitle">' + (c ? "Edit " + esc(c.name) : "Add a client") + '</h2><form id="clientForm" novalidate data-id="' + (c ? c.id : "") + '">' +
      f("clName", "COMPANY NAME", c && c.name, 'maxlength="80"') +
      f("clShort", "SHORT NAME FOR THE TOP BAR", b.short, 'maxlength="24"', "Leave empty to use the company name.") +
      (c ? '<label>SHORT CODE</label><p class="sub">' + esc(c.slug) + " (fixed: their links are built from it)</p>"
         : f("clSlug", "SHORT CODE", "", 'maxlength="40" autocapitalize="off" placeholder="e.g. airport-parking-bay"', "Lower-case letters, numbers and dashes. Can't be changed later.")) +
      f("clYards", "YARDS", c ? (c.yards || []).join(", ") : "", 'autocapitalize="characters" placeholder="e.g. GS, MY, T"', "Codes separated by commas, 1 to 4 letters each. Add T for the terminal.") +
      f("clEnd", "DROPS DAY ENDS AT", c ? String(c.drops_day_end || "06:00").slice(0, 5) : "06:00", 'type="time"') +
      '<label for="clColour">COLOUR</label><div class="when2"><input id="clColour" type="color" value="' + esc(b.colour || "#334155") + '"><select id="clInk"><option value="#FFFFFF"' + (b.ink !== "#16181D" ? " selected" : "") + '>White text on it</option><option value="#16181D"' + (b.ink === "#16181D" ? " selected" : "") + ">Dark text on it</option></select></div>" +
      '<label for="clLook">LOOK</label><select id="clLook">' + LOOKS.map(function (l) { return '<option value="' + l[0] + '"' + ((b.theme || "") === l[0] ? " selected" : "") + ">" + l[1] + "</option>"; }).join("") + "</select>" +
      '<p class="hint">How their app looks to their team. Their phones change the next time the app refreshes.</p>' +
      '<label class="check"><input type="checkbox" id="clPicksYard"' + (b.picks_yard ? " checked" : "") + "> Location on PICKS (instead of NO SHOW)</label>" +
      '<label class="check"><input type="checkbox" id="clLanes"' + (b.lane_planner ? " checked" : "") + "> Yard planner (add-on)</label>" +
      '<label class="check"><input type="checkbox" id="clCollections"' + (b.collections ? " checked" : "") + "> Collections on DROPS (add-on)</label>" +
      f("clHost", "WEB ADDRESS", b.host, 'autocapitalize="off" placeholder="e.g. clientname-ops.vercel.app"', "Add the same address in Vercel (Settings, Domains) or it won't open.") +
      '<div class="pbtns"><button type="button" data-close>Cancel</button><button class="save" id="clGo">' + (c ? "Save" : "Add client") + "</button></div></form>";
    if (!$("panel").open) $("panel").showModal();
    if (!c) {
      $("clColour").addEventListener("input", function () { $("clInk").value = lightColour(this.value) ? "#16181D" : "#FFFFFF"; });
      $("clName").addEventListener("input", function () { if (!$("clSlug").dataset.touched) $("clSlug").value = this.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40); });
      $("clSlug").addEventListener("input", function () { this.dataset.touched = "1"; });
      setTimeout(function () { $("clName").focus(); }, 50);
    }
  }
  async function saveClient() {
    var id = $("clientForm").dataset.id, colour = $("clColour").value.toUpperCase();
    var was = id ? ((S.clients || []).filter(function (x) { return x.id === id; })[0] || {}).brand || {} : {};
    var p = { id: id, name: $("clName").value, slug: $("clSlug") ? $("clSlug").value.trim() : "", drops_day_end: $("clEnd").value,
      yards: $("clYards").value.split(/[\s,]+/).filter(Boolean),
      brand: { short: $("clShort").value, colour: colour, ink: $("clInk").value, soft: hexMix(colour, "#FFFFFF", 0.88), text: hexMix(colour, "#000000", 0.35), host: $("clHost").value.trim().toLowerCase(), theme: $("clLook").value, picks_yard: $("clPicksYard").checked, lane_planner: $("clLanes").checked, collections: $("clCollections").checked } };
    // Same colour as before: keep their hand-picked tints rather than recalculating.
    if (was.colour && was.colour.toUpperCase() === colour) { p.brand.soft = was.soft || p.brand.soft; p.brand.text = was.text || p.brand.text; }
    $("clGo").disabled = true;
    var r = await sb.rpc("admin_save_client", { p: p });
    $("clGo").disabled = false;
    if (r.error) return toast(r.error.message, true);
    await loadClients();
    if (id) { toast("Saved"); return $("panel").close(); }
    var host = (r.data.brand && r.data.brand.host) || "parking-ops.vercel.app";
    $("panelBody").innerHTML = '<h2 id="panelTitle">' + esc(r.data.name) + " added</h2>" +
      '<p class="sub">Next steps:</p><ol class="steps"><li>' + (r.data.brand && r.data.brand.host ? "In Vercel, add <b>" + esc(host) + "</b> under Settings, Domains." : "No web address set: they'll use parking-ops.vercel.app.") + "</li>" +
      "<li>On the Clients page, tap <b>Create first owner</b> on " + esc(r.data.name) + ", enter their boss's name, and send the boss the link and PIN it shows.</li></ol>" +
      '<div class="pbtns"><button type="button" data-close>Done</button></div>';
  }
  function askClientOwner(id) {
    var c = (S.clients || []).filter(function (x) { return x.id === id; })[0]; if (!c) return;
    $("panelBody").innerHTML = '<h2 id="panelTitle">First owner for ' + esc(c.name) + '</h2>' +
      '<p class="sub">Their boss. They get a personal link and PIN, and add the rest of their team themselves.</p>' +
      '<form id="clientOwnerForm" data-id="' + c.id + '" novalidate><label for="coName">NAME</label><input id="coName" maxlength="60" autocomplete="off">' +
      '<div class="pbtns"><button type="button" data-close>Cancel</button><button class="save" id="coGo">Create owner</button></div></form><div id="coDone"></div>';
    if (!$("panel").open) $("panel").showModal();
    setTimeout(function () { $("coName").focus(); }, 50);
  }
  async function createClientOwner() {
    var form = $("clientOwnerForm"), name = $("coName").value.trim();
    if (!name) return toast("Enter their boss's name.", true);
    $("coGo").disabled = true;
    try {
      var r = await callFunction("manage-staff", { action: "client_owner", company_id: form.dataset.id, name: name, app_url: location.origin + "/" }, true);
      form.remove();
      var cl = (S.clients || []).filter(function (x) { return x.id === form.dataset.id; })[0] || {};
      $("coDone").innerHTML = issuedHtml(r, (cl.brand && cl.brand.short) || cl.name) + '<div class="pbtns"><button type="button" data-close>Done</button></div>';
      loadClients();
    } catch (err) { $("coGo").disabled = false; toast(err.message, true); }
  }
  async function suspendClient(btn) {
    var c = (S.clients || []).filter(function (x) { return x.id === btn.dataset.clientsuspend; })[0]; if (!c) return;
    var on = !c.suspended_at;
    if (!confirm(on ? "Suspend " + c.name + "? Everyone at " + c.name + " is locked out straight away. Nothing is deleted, and Resume lets them back in." : "Resume " + c.name + "? Their team can sign in again.")) return;
    btn.disabled = true;
    var r = await sb.rpc("admin_suspend_client", { p_id: c.id, p_suspend: on });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    toast(c.name + (on ? " suspended" : " resumed"));
    loadClients();
  }

  // ── Open a client's app (database part 56) ──
  // The product owner signs in as their own "(Parking Ops)" owner inside the
  // client: the client's board, Settings and Staff, exactly as their owner has
  // them. The Parking Ops sign-in is kept on this phone for the way back.
  var HOME_KEY = "po_home";
  function homeSaved() { try { return JSON.parse(localStorage.getItem(HOME_KEY) || "null"); } catch (e) { return null; } }
  async function openClientBoard(btn) {
    var c = (S.clients || []).filter(function (x) { return x.id === btn.dataset.clientopen; })[0]; if (!c) return;
    if (!confirm("Open " + c.name + "'s app? You'll be their owner, shown as \"" + S.me.name + " (Parking Ops)\" in their Staff list and activity. Tap ‹ PARKING OPS at the top to come back.")) return;
    btn.disabled = true;
    try {
      var s = (await sb.auth.getSession()).data.session;
      if (!s) throw new Error("Sign in again.");
      var r = await callFunction("manage-staff", { action: "client_open", company_id: c.id, app_url: location.origin + "/" }, true);
      try { localStorage.setItem(HOME_KEY, JSON.stringify({ a: s.access_token, r: s.refresh_token })); } catch (e) {}
      var v = await sb.auth.verifyOtp({ type: "magiclink", token_hash: r.token_hash });
      if (v.error) { try { localStorage.removeItem(HOME_KEY); } catch (e) {} await sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token }); throw v.error; }
      location.reload();
    } catch (err) { btn.disabled = false; toast(err.message || String(err), true); }
  }
  async function backToPlatform() {
    var h = homeSaved(); if (!h) return;
    $("homeBtn").disabled = true;
    try { await sb.auth.signOut({ scope: "local" }); } catch (e) {}
    var r = await sb.auth.setSession({ access_token: h.a, refresh_token: h.r });
    try { localStorage.removeItem(HOME_KEY); } catch (e) {}
    if (r.error) { toast("Sign in to Parking Ops again with your link and PIN.", true); return showSignIn(); }
    location.reload();
  }
  // ── Usage (database part 56): what each client uses, last 30 days ──
  var FR24_CREDITS = 39;   // about this many credits per live check, from the FR24 account
  function mb(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(2) + " GB" : (n / 1048576).toFixed(1) + " MB"; }
  async function openUsage() {
    $("panelBody").innerHTML = '<h2 id="panelTitle">Usage</h2><p class="note">Loading…</p>';
    if (!$("panel").open) $("panel").showModal();
    var r = await sb.rpc("admin_usage");
    if (r.error) { $("panelBody").innerHTML = '<h2 id="panelTitle">Usage</h2><div class="msg">' + esc(r.error.message) + '</div><div class="pbtns"><button type="button" data-close>Close</button></div>'; return; }
    var u = r.data || {}, rows = function (list) { return list.map(function (x) { return "<tr><th>" + x[0] + "</th><td class=\"num\">" + x[1] + "</td></tr>"; }).join(""); };
    $("panelBody").innerHTML = '<h2 id="panelTitle">Usage</h2>' +
      '<h3 class="usehead">Everyone</h3><table class="usage">' + rows([
        ["Database", esc(mb(u.db_bytes || 0)) + " of 8 GB"],
        ["Supabase file store", esc(mb(u.store_bytes || 0)) + " of 100 GB · " + (u.store_files || 0) + " files"]]) + "</table>" +
      '<p class="hint">Download traffic (egress, 250 GB a month on Pro) is only on the <a href="https://supabase.com/dashboard/project/_/settings/billing/usage" target="_blank" rel="noopener">Supabase usage page</a>. PT copies are in Cloudflare R2, counted below.</p>' +
      (u.clients || []).map(function (c) {
        var tt = c.timetable_last_error ? '<span class="warnt">' + esc(c.timetable_last_error.slice(0, 90)) + "</span>" : c.timetable_last_ok ? "working · last " + esc(dayShort(c.timetable_last_ok) + " " + hhmm(c.timetable_last_ok)) : "not used";
        return '<h3 class="usehead">' + esc(c.name) + '</h3><table class="usage">' + rows([
          ["Cars (30 days)", c.cars_30d], ["Sheets (30 days)", c.sheets_30d],
          ["PT sets / photos (30 days)", c.pt_sets_30d + " / " + c.pt_photos_30d],
          ["FR24 checks today", c.fr24_calls_today + " · about " + (c.fr24_calls_today * FR24_CREDITS).toLocaleString("en-GB") + " credits"],
          ["FR24 checks (30 days)", c.fr24_calls_30d + " · about " + (c.fr24_calls_30d * FR24_CREDITS).toLocaleString("en-GB") + " credits"],
          ["AeroDataBox (30 days)", c.timetable_runs_30d + " checks"], ["AeroDataBox now", tt],
          ["Taps and changes (30 days)", c.activity_30d]]) + "</table>";
      }).join("") + '<div class="pbtns"><button type="button" data-close>Close</button></div>';
  }

  // ── Health (database part 100): what runs on its own, and errors on phones ──
  function agoText(iso) {
    if (!iso) return "never";
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : dayShort(iso) + " " + hhmm(iso);
  }
  async function openHealth() {
    $("panelBody").innerHTML = '<h2 id="panelTitle">Health</h2><p class="note">Loading…</p>';
    if (!$("panel").open) $("panel").showModal();
    var r = await sb.rpc("admin_health");
    if (r.error) { $("panelBody").innerHTML = '<h2 id="panelTitle">Health</h2><div class="msg">' + esc(r.error.message) + '</div><div class="pbtns"><button type="button" data-close>Close</button></div>'; return; }
    S.health = r.data || {};
    if (S.view === "clients") render();
    var h = S.health, w = h.warnings || [], ad = h.aerodata || {}, calls = h.calls || {}, bk = h.backup || {};
    var bad = function (t) { return '<span class="warnt">' + t + "</span>"; };
    var n = function (x) { return Number(x || 0).toLocaleString("en-GB"); };
    var rows = function (list) { return list.map(function (x) { return "<tr><th>" + x[0] + "</th><td>" + x[1] + "</td></tr>"; }).join(""); };
    var oldBackup = !bk.last || Date.now() - new Date(bk.last).getTime() > 30 * 3600000;
    $("panelBody").innerHTML = '<h2 id="panelTitle">Health</h2>' +
      (w.length ? '<div class="hwarn"><strong>Needs a look</strong><ul>' + w.map(function (x) { return "<li>" + esc(x.text) + "</li>"; }).join("") + "</ul></div>"
        : '<p class="hok">Nothing needs a look.</p>') +
      '<h3 class="usehead">Everyone</h3><table class="usage health">' + rows([
        ["Last backup", oldBackup ? bad(esc(agoText(bk.last))) : esc(agoText(bk.last))],
        ["Server calls, last hour", n(calls.ok) + " worked" + (calls.failed ? " · " + bad(n(calls.failed) + " failed") : "")],
        ["AeroDataBox units this month", "about " + n(ad.units) + " of " + n(ad.cap) + " (" + n(ad.pct) + "%)"],
        ["AeroDataBox calls this month", n(ad.calls) + (ad.counted_from ? " since " + esc(dayShort(ad.counted_from)) : "")],
        ["Notifications that failed, 24 h", h.push_failed_24h ? bad(n(h.push_failed_24h)) : "0"]]) + "</table>" +
      '<h3 class="usehead">Timers</h3><table class="usage health">' + rows((h.timers || []).map(function (t) {
        return [esc(t.name), (t.failed_24h ? bad(n(t.failed_24h) + " failed in 24 h") + " · " : "") + (t.active ? "last ran " + esc(agoText(t.last_ok)) : "switched off")];
      })) + "</table>" +
      (h.clients || []).map(function (c) {
        var ai = c.auto_import, aiBad = ai && ai.last_error && (!ai.last_ok || ai.last_ok < ai.last_run);
        return '<h3 class="usehead">' + esc(c.name) + '</h3><table class="usage health">' + rows([
          ["Live flight times (FR24)", c.live_error ? bad(esc(c.live_error.slice(0, 90))) : "last " + esc(agoText(c.live_last))],
          ["Timetable (AeroDataBox)", c.timetable_error ? bad(esc(c.timetable_error.slice(0, 90))) : "last " + esc(agoText(c.timetable_last))],
          ["AeroDataBox calls this month", n(c.aerodata_calls_month)],
          ["Booking import", "last " + esc(agoText(c.import_last)) + (ai ? " · scheduled " + (ai.enabled ? "on" : "off") + (aiBad ? " · " + bad(esc(ai.last_error)) : "") : "")],
          ["Phones online now", n(c.online)], ["Phones with notifications", n(c.phones_push)],
          ["Last tap or change", esc(agoText(c.last_activity))],
          ["App errors, 24 h", c.errors_24h ? bad(n(c.errors_24h)) : "0"]]) + "</table>" +
          ((c.errors || []).length ? '<details class="herr"><summary>Latest app errors (' + c.errors.length + ")</summary><ul>" + c.errors.map(function (e) {
            return "<li><b>" + esc(dayShort(e.at) + " " + hhmm(e.at)) + (e.n > 1 ? " ×" + e.n : "") + "</b> " + esc(e.m) +
              '<span class="note">' + esc([e.who, e.view, e.device, e.version ? "app " + e.version : ""].filter(Boolean).join(" · ")) + "</span></li>";
          }).join("") + "</ul></details>" : "");
      }).join("") + '<div class="pbtns"><button type="button" data-health>Refresh</button><button type="button" data-close>Close</button></div>';
  }

  // Mirrors can() in database parts 3 and 105: defaults before per-person changes.
  var ROLE_CAN = { sent: ["office", "manager", "bongo"], called: ["office", "manager"], desk: ["office", "manager", "terminal"], clear: ["office", "manager", "terminal"], yard: ["office", "manager"],
    summary: ["office", "manager"], log: ["office", "manager"], flights: ["office"], rtc: ["office", "manager", "bongo"], picksinfo: ["office", "manager", "terminal"],
    import: ["office", "manager"], staff: ["office", "manager"], settings: ["manager"], collections: ["office", "manager"] };
  var PERMS = [["sent", "DROPS: press SENT"], ["called", "DROPS: press CALLED and OVERSTAY"], ["desk", "DROPS: press AT DESK"], ["clear", "DROPS: press CLEAR and COMPLAINT"], ["yard", "Set yards"],
    ["note", "Write notes"], ["flights", "Enter and check flight numbers"], ["intake", "PICKS: Collected, No show, PT"], ["rtc", "PICKS: RTC"],
    ["picksinfo", "Hourly stats, and PICKS returns"], ["summary", "Summary"], ["log", "Activity log and archive"], ["import", "Import, add and remove cars"],
    ["collections", "View board collections"], ["staff", "Staff: add people, new links, switch off"], ["settings", "Settings"]];
  // "View board collections" only where the client has the Collections add-on.
  function permShown(x) { return x[0] !== "collections" || !!(S.company && S.company.brand && S.company.brand.collections === true); }
  function roleCan(role, a) { if (role === "owner") return true; var l = ROLE_CAN[a]; return l ? l.indexOf(role) !== -1 : role !== "view"; }
  function personCan(p, a) { var x = p.extra || []; if (x.indexOf("-" + a) !== -1) return false; if (x.indexOf(a) !== -1) return true; return roleCan(p.role, a) || (a === "desk" && p.role !== "view" && personCan(p, "called")); }
  // New link / switch off: the same rule as manage-staff (owners by an owner, managers by a manager or owner).
  function canChange(p) { return p.id !== S.me.id && (p.role !== "owner" || S.me.role === "owner") && (p.role !== "manager" || S.me.role === "owner" || S.me.role === "manager"); }
  function canManage(p) { return (S.me.role === "manager" || S.me.role === "owner") && p.id !== S.me.id && (p.role !== "owner" || S.me.role === "owner"); }
  async function reloadStaff() {
    var list = await sb.from("staff").select("*").order("name");
    if (!list.error) { S.staff = {}; list.data.forEach(function (p) { S.staff[p.id] = p; }); }
  }
  var staffEdit = null;
  function openStaffPanel(id) {
    var p = S.staff[id]; if (!p) return;
    staffEdit = id;
    $("panelBody").innerHTML = '<h2 id="panelTitle">' + esc(p.name) + " <small>" + esc(ROLE_LABEL[p.role] || p.role) + "</small></h2>" +
      '<label>WHAT ' + esc(p.name.toUpperCase()) + ' CAN DO</label><div class="acc">' + PERMS.filter(permShown).map(function (x) {
        var d = roleCan(p.role, x[0]);
        return '<label class="chk"><input type="checkbox" data-perm="' + x[0] + '"' + (personCan(p, x[0]) ? " checked" : "") + "><span>" + esc(x[1]) +
          "<small>" + esc(ROLE_LABEL[p.role] || p.role) + " default: " + (d ? "yes" : "no") + "</small></span></label>";
      }).join("") + '</div><div class="pseg" style="margin-top:8px"><button type="button" data-saveaccess>SAVE ACCESS</button><button type="button" data-roledefault>ROLE DEFAULTS</button></div>' +
      '<label for="spPin">SET A NEW PIN</label><div class="when2"><input id="spPin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="4 numbers"><button type="button" class="btn ghost" data-savepin>Set PIN</button></div>' +
      '<p class="hint">Their link stays the same. Tell them the new PIN.</p>' +
      '<label for="spNames">NAMES ON THIS LOGIN</label><textarea id="spNames" rows="3" placeholder="One per line, e.g. RAKESH.O">' + esc((p.desk_names || []).join("\n")) + "</textarea>" +
      '<div class="pseg" style="margin-top:8px"><button type="button" data-savenames>SAVE NAMES</button></div>' +
      '<p class="hint">For a shared login: whoever is working picks their name with Switch name.</p>' +
      '<button type="button" class="link rmcar" data-removestaff>Remove ' + esc(p.name) + '</button>' +
      '<div class="pbtns"><button type="button" data-close>Close</button></div>';
    if (!$("panel").open) $("panel").showModal();
  }
  async function staffPanelAction(t) {
    var p = S.staff[staffEdit]; if (!p) return;
    if (t.dataset.roledefault !== undefined) {
      Array.prototype.forEach.call($("panelBody").querySelectorAll("[data-perm]"), function (c) { c.checked = roleCan(p.role, c.dataset.perm); });
      return;
    }
    var r;
    t.disabled = true;
    if (t.dataset.saveaccess !== undefined) {
      var extra = [];
      Array.prototype.forEach.call($("panelBody").querySelectorAll("[data-perm]"), function (c) {
        var a = c.dataset.perm, d = roleCan(p.role, a);
        if (c.checked && !d) extra.push(a); else if (!c.checked && d) extra.push("-" + a);
      });
      // A hidden switch keeps what was saved for it, ready for when the add-on comes back.
      (p.extra || []).forEach(function (x) { if (!permShown([x.replace(/^-/, "")])) extra.push(x); });
      r = await sb.rpc("set_staff_access", { p_staff: p.id, p_extra: extra });
      if (!r.error) toast("Access saved for " + p.name + ". It applies next time they open the app.");
    } else if (t.dataset.savepin !== undefined) {
      var pin = $("spPin").value;
      if (!/^\d{4}$/.test(pin)) { t.disabled = false; return toast("The PIN must be 4 numbers.", true); }
      r = await sb.rpc("set_staff_pin", { p_staff: p.id, p_pin: pin });
      if (!r.error) { $("spPin").value = ""; toast("New PIN set for " + p.name + "."); }
    } else if (t.dataset.savenames !== undefined) {
      var names = $("spNames").value.split(/[\n,]/).map(function (x) { return x.trim(); }).filter(Boolean);
      r = await sb.rpc("set_desk_names", { p_staff: p.id, p_names: names });
      if (!r.error) toast(names.length ? "Names saved for " + p.name + "." : "Names cleared for " + p.name + ".");
    } else if (t.dataset.removestaff !== undefined) {
      if (!confirm("Remove " + p.name + "? Their link and PIN stop working for good. Their name stays on everything they did.")) { t.disabled = false; return; }
      r = await sb.rpc("remove_staff", { p_staff: p.id });
      if (!r.error) { toast(p.name + " removed"); await reloadStaff(); $("panel").close(); render(); return; }
    }
    t.disabled = false;
    if (r && r.error) return toast(r.error.message, true);
    await reloadStaff();
  }
  // Online / Offline (setup 99): the app checks in every minute while it is on
  // screen; anyone seen or who changed something in the last 5 minutes is Online.
  var SEEN_ONLINE = 5 * 60000;
  async function loadSeen() {
    S.seenAt = Date.now();
    var r = await sb.rpc("staff_seen");
    if (r.error || !Array.isArray(r.data)) return;
    S.seen = {}; r.data.forEach(function (x) { S.seen[x.id] = x; });
    if (S.view === "staff" && !$("panel").open && !document.querySelector(".ops-dd[open]") && document.activeElement !== $("newName")) render();
  }
  function seenHtml(p) {
    var x = (S.seen || {})[p.id] || {}, t = Math.max(x.seen_at ? Date.parse(x.seen_at) : 0, x.acted_at ? Date.parse(x.acted_at) : 0);
    if (p.id === S.me.id || (t && Date.now() - t < SEEN_ONLINE)) return '<b class="seen on">Online</b>';
    if (!t) return '<b class="seen">Offline</b>';
    var d = new Date(t), today = londonParts(d).key === londonParts(new Date()).key;
    return '<b class="seen">Offline · ' + esc(today ? hhmm(d) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: TZ })) + "</b>";
  }
  setInterval(function () {
    if (!S.me || document.visibilityState !== "visible") return;
    sb.rpc("i_am_here").then(function () {}, function () {});
    if (S.view === "staff" && isOps()) loadSeen();
  }, 60000);
  document.addEventListener("visibilitychange", function () { if (S.me && document.visibilityState === "visible") sb.rpc("i_am_here").then(function () {}, function () {}); });
  function renderStaff() {
    var people = Object.keys(S.staff).map(function (k) { return S.staff[k]; }).filter(function (p) { return !p.removed_at; }).sort(function (a, b) { return (b.active - a.active) || a.name.localeCompare(b.name); });
    if (isOps()) return opsStaff(people);
    return '<h2 class="title">Staff</h2>' + (S.issued ? issuedHtml(S.issued) + "<br>" : "") +
      '<form class="box" id="addStaff" style="padding:12px;margin-bottom:14px" novalidate><strong>Add a person</strong>' +
      '<label class="field">Name<input id="newName" maxlength="60" autocomplete="off"></label>' +
      '<label class="field">Role<select id="newRole">' + ["bongo", "terminal", "office", "view"].concat(S.me.role === "owner" || S.me.role === "manager" ? ["manager"] : [], S.me.role === "owner" ? ["owner"] : []).map(function (r) { return '<option value="' + r + '">' + ROLE_LABEL[r] + "</option>"; }).join("") + "</select></label>" +
      '<button class="btn brand" id="addGo">Add and get link</button></form>' +
      '<div class="box staffbox">' + people.map(function (p) {
        return '<div class="rowline' + (p.active ? "" : " off") + '" data-initial="' + esc((p.name || "?").trim().charAt(0).toUpperCase()) + '"><div class="grow"><strong>' + esc(p.name) + '</strong><div class="note">' + esc(ROLE_LABEL[p.role] || p.role) + (p.active ? "" : " · switched off") + "</div></div>" +
          (p.id === S.me.id ? '<span class="note">You</span>' : '<div class="sbtns">' + (canManage(p) ? '<button type="button" class="btn ghost small" data-manage="' + p.id + '">PIN and access</button>' : "") +
            (canChange(p) ? '<button type="button" class="btn ghost small" data-reset="' + p.id + '">New link</button><button type="button" class="btn ghost small" data-onoff="' + p.id + '">' + (p.active ? "Switch off" : "Switch on") + "</button>" : "") + "</div>") + "</div>";
      }).join("") + "</div>";
  }
  // Operations: Staff & access. "Add person" opens the form; each person's
  // PIN and access, New link and Switch off sit in one Actions menu.
  function opsStaff(people) {
    if (!S.seenAt || Date.now() - S.seenAt > 30000) loadSeen();
    var roles = ["bongo", "terminal", "office", "view"].concat(S.me.role === "owner" || S.me.role === "manager" ? ["manager"] : [], S.me.role === "owner" ? ["owner"] : []);
    return '<p class="ops-sub">Manage your team and their permissions</p>' + (S.issued ? issuedHtml(S.issued) + "<br>" : "") +
      (S.addPerson ? '<form class="ops-card ops-add" id="addStaff" novalidate><header><strong>Add a person</strong><button type="button" class="ops-x" data-addperson aria-label="Close">&times;</button></header>' +
        '<div class="ops-fields"><label class="field">Name<input id="newName" maxlength="60" autocomplete="off"></label>' +
        '<label class="field">Role<select id="newRole">' + roles.map(function (r) { return '<option value="' + r + '">' + ROLE_LABEL[r] + "</option>"; }).join("") + "</select></label></div>" +
        '<div class="ops-btns"><button class="btn" id="addGo">Add and get link</button></div></form>'
        : '<div class="ops-acts"><button type="button" class="btn" data-addperson>Add person</button></div>') +
      opsPanel("Team members", people.length + (people.length === 1 ? " person" : " people"), '<div class="staffbox ops-team">' + (opsDesk() ? '<div class="ops-person ops-th" aria-hidden="true"><i></i><div class="grow"><strong>Person</strong><small>Account</small><span>Role</span></div><div class="ops-side"><em>Status</em><b class="seen">Online</b><b>Actions</b></div></div>' : "") + people.map(function (p) {
        var acts = p.id === S.me.id ? "" : (canManage(p) ? '<button type="button" data-manage="' + p.id + '">PIN and access</button>' : "") +
          (canChange(p) ? '<button type="button" data-reset="' + p.id + '">New link</button><button type="button" data-onoff="' + p.id + '">' + (p.active ? "Switch off" : "Switch on") + "</button>" : "");
        return '<div class="ops-person' + (p.active ? "" : " off") + '"><i>' + esc((p.name || "?").trim().charAt(0).toUpperCase()) + "</i>" +
          '<div class="grow"><strong>' + esc(p.name) + "</strong><small>" + (p.id === S.me.id ? "Your account" : "Staff member") + "</small><span>" + esc(ROLE_LABEL[p.role] || p.role) + "</span></div>" +
          '<div class="ops-side"><em class="' + (p.active ? "on" : "") + '">' + (p.active ? "Active" : "Inactive") + "</em>" + (p.active ? seenHtml(p) : "") +
          (acts ? '<details class="ops-dd"><summary>Actions</summary><div>' + acts + "</div></details>" : "") + "</div></div>";
      }).join("") + "</div>");
  }
  // An Actions menu that would open under the bottom bar (the last people on a phone) opens upward,
  // so Switch on / Switch off stays in view.
  document.addEventListener("toggle", function (e) {
    var d = e.target; if (!d || !d.classList || !d.classList.contains("ops-dd")) return;
    d.classList.remove("up"); if (!d.open) return;
    var m = d.querySelector(":scope > div"), bn = $("bnav"), low = innerHeight, b = bn && bn.getBoundingClientRect();
    if (b && b.height && b.top > innerHeight / 2) low = Math.min(low, b.top);
    var r = m.getBoundingClientRect();
    if (r.bottom > low - 8 && d.getBoundingClientRect().top - r.height - 4 > 0) d.classList.add("up");
  }, true);
  async function staffAction(body, busyEl) {
    if (busyEl) busyEl.disabled = true;
    try {
      body.app_url = location.origin + "/";
      var r = await callFunction("manage-staff", body, true);
      var list = await sb.from("staff").select("*").order("name");
      if (!list.error) { S.staff = {}; list.data.forEach(function (p) { S.staff[p.id] = p; }); }
      return r;
    } catch (err) { toast(err.message, true); return null; }
    finally { if (busyEl) busyEl.disabled = false; }
  }

