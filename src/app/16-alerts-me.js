  // ── phone notifications ───────────────────
  // Web push: Android in Chrome, iPhone only when the app is opened from the
  // Home Screen (iOS 16.4+). This public key pairs with VAPID_PRIVATE_KEY, a
  // secret held only by the send-alerts Edge Function.
  var VAPID_PUBLIC_KEY = "BIUvnDQXjj4nWd2EIx7kLAGTTWamJ0oM1V806Ubh7HeiUJfaZWRxwvlUrP7pZTVULpFOYBbWrKtmSC1AmdNtnWw";
  var ALERT_KINDS = [["drops", "DROPS: CALLED, AT DESK, OVERSTAY, 20 min waits and COMPLAINT"], ["picks", "PICKS: RTC"], ["flights", "Flight cancelled"]];
  function pushSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  function iosOutsideHomeScreen() { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator.standalone === true || matchMedia("(display-mode: standalone)").matches); }
  function keyBytes(k) { var raw = atob((k + "=".repeat((4 - k.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, function (c) { return c.charCodeAt(0); }); }
  async function currentSubscription() {
    if (!pushSupported()) return null;
    var reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? reg.pushManager.getSubscription() : null;
  }
  // S.notify: null until loaded; {ready:false} when part 4 hasn't been run yet.
  async function loadNotify() {
    var prefs = await sb.from("alert_prefs").select("*").maybeSingle();
    var sub = null; try { sub = await currentSubscription(); } catch (e) {}
    S.notify = { ready: !prefs.error, prefs: prefs.data || {}, on: !!sub && pushSupported() && Notification.permission === "granted" };
    if (S.view === "me") render();
  }
  function notifyHtml() {
    var N = S.notify;
    if (!N) { loadNotify(); return '<div class="box" style="padding:14px;margin-top:14px"><strong>Phone notifications</strong><p class="note">Checking…</p></div>'; }
    if (!N.ready) return "";
    var text, canOn = false;
    if (iosOutsideHomeScreen()) text = "On iPhone, add " + brandName() + " to your Home Screen (Share, then Add to Home Screen) and open it from there to get notifications.";
    else if (!pushSupported()) text = "This browser can't show notifications. On Android use Chrome; on iPhone open " + brandName() + " from your Home Screen.";
    else if (Notification.permission === "denied") text = "Notifications are blocked for " + brandName() + ". Allow them in your phone's settings, then come back here.";
    else if (N.on) text = "On for this phone.";
    else { text = "Off for this phone."; canOn = true; }
    return '<div class="box" style="padding:14px;margin-top:14px;max-width:560px"><strong>Phone notifications</strong><p class="note" style="margin:4px 0 10px">' + esc(text) + "</p>" +
      (N.on ? ALERT_KINDS.map(function (k) {
        return '<label class="check"><input type="checkbox" data-alertpref="' + k[0] + '"' + (N.prefs[k[0]] === false ? "" : " checked") + "> " + esc(k[1]) + "</label>";
      }).join("") : "") +
      '<div class="row-actions">' + (canOn ? '<button type="button" class="btn brand" data-notifyon>Turn on notifications</button>' : "") +
      (N.on ? '<button type="button" class="btn ghost small" data-notifytest>Send me a test</button><button type="button" class="btn ghost small" data-notifyoff>Turn off</button>' : "") + "</div></div>";
  }
  async function turnOnNotifications(btn) {
    btn.disabled = true;
    try {
      // Keep this the first await: iPhones only show the prompt straight after a tap.
      var permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications are blocked. Allow them for " + brandName() + " in your phone's settings." : "Notifications weren't allowed.");
      var reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      var sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
      var j = sub.toJSON();
      var r = await sb.rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
      if (r.error) throw r.error;
      toast("Notifications are on for this phone");
    } catch (err) { toast(err.message || String(err), true); }
    S.notify = null; render();
  }
  // Also runs quietly on sign-out, so a shared phone stops getting the last person's alerts.
  async function turnOffNotifications(quiet) {
    try {
      var sub = await currentSubscription();
      if (sub) { if (S.me) await sb.rpc("remove_push_subscription", { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
      if (!quiet) toast("Notifications are off for this phone");
    } catch (err) { if (!quiet) toast(err.message || String(err), true); }
    S.notify = null; if (!quiet) render();
  }
  async function sendTest(btn, discord) {
    btn.disabled = true;
    try {
      var r = await callFunction("send-alerts", { type: "test", discord: !!discord }, true);
      if (discord) toast("Discord: DROPS " + (r.drops ? "sent" : "not set or failed") + " · PICKS " + (r.picks ? "sent" : "not set or failed"), !(r.drops || r.picks));
      else toast(r.sent ? "Test sent. It should arrive in a few seconds." : "Nothing sent: notifications aren't on for this phone.", !r.sent);
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; }
  }

  // ── me ────────────────────────────────────
  // One switch for the company's Discord channel; the links stay saved.
  function discordSwitchHtml() {
    if (!can("settings")) return "";
    if (S.discord === undefined) { S.discord = null; sb.rpc("discord_status").then(function (r) { S.discord = r.error ? false : r.data; if (S.view === "me") render(); }); }
    var D = S.discord;
    if (D === false) return "";
    var head = '<div class="box" style="padding:14px;margin-top:14px"><strong>Discord alerts</strong>';
    if (!D) return head + '<p class="note">Checking…</p></div>';
    if (!D.drops && !D.picks) return head + '<p class="note">Not set up. Add the channel links in Settings.</p></div>';
    var where = [D.drops ? "DROPS" : "", D.picks ? "PICKS" : ""].filter(Boolean).join(" and ");
    return head + '<p class="note">' + (D.paused ? "Off for everyone. The links are kept." : "On. Posting " + where + " alerts to Discord for the whole team.") + "</p>" +
      '<div class="row-actions">' + (D.paused ? '<button type="button" class="btn brand" data-discordpause="0">Turn on Discord alerts</button>'
        : '<button type="button" class="btn ghost" data-discordpause="1">Turn off Discord alerts</button><button type="button" class="btn ghost small" data-discordtest>Send a test</button>') + "</div></div>";
  }
  async function setDiscordPaused(btn, paused) {
    if (paused && !confirm("Turn off Discord alerts for the whole team? Phone notifications carry on.")) return;
    btn.disabled = true;
    var r = await sb.rpc("set_discord_paused", { p_paused: paused });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    S.discord = r.data; toast(paused ? "Discord alerts off" : "Discord alerts on"); render();
  }
  async function changePin() {
    var old = $("pinOld").value, a = $("pinNew").value, b = $("pinNew2").value;
    if (!/^\d{4}$/.test(old)) return toast("Enter your current 4-number PIN.", true);
    if (!/^\d{4}$/.test(a)) return toast("The new PIN must be 4 numbers.", true);
    if (a !== b) return toast("The two new PINs don't match.", true);
    if (a === old) return toast("That's the PIN you have now.", true);
    $("pinGo2").disabled = true;
    var r = await sb.rpc("change_my_pin", { p_current: old, p_new: a });
    $("pinGo2").disabled = false;
    if (r.error) return toast(r.error.message, true);
    var st = r.data && r.data.status;
    if (st === "bad_pin") { $("pinOld").value = ""; return toast("Current PIN is wrong. " + r.data.left + " tries left before a 15-minute lock.", true); }
    if (st === "locked") return toast("Too many wrong PINs. Try again after " + hhmm(r.data.until) + ".", true);
    ["pinOld", "pinNew", "pinNew2"].forEach(function (id) { $(id).value = ""; });
    toast("PIN changed. Use the new one next time you sign in.");
  }
  // Me → Copy my link: this phone's own personal link (the PIN is never kept).
  function myLinkHtml() {
    var t = storedLink(); if (!t) return "";
    var link = location.origin + "/#t=" + t;
    return '<div class="box pinbox mylink"><strong>My link</strong><p class="note">Private: with your PIN it opens the app as you.</p>' +
      '<button type="button" class="btn ghost" data-copy="' + esc(link) + '">Copy my link</button></div>';
  }
  function renderMe() {
    if (opsDesk() && !S.platform) {
      // A wide screen: you and your alerts, your PIN, and the tutorials side by side.
      var tuts = myTutorials();
      return '<h2 class="title">' + esc(S.me.name) + '</h2><p class="note">' + esc(ROLE_LABEL[S.me.role] || S.me.role) + " · " + esc(S.company.name) + "</p>" +
        '<div class="me-desk"><div class="me-col">' + notifyHtml() + discordSwitchHtml() + myLinkHtml() + "</div>" +
        '<div class="me-col">' + pinFormHtml() + "</div>" +
        '<div class="me-col">' + opsPanel("Tutorials", tuts.length + (tuts.length === 1 ? " video" : " videos"), '<div class="me-tuts">' + tuts.map(function (x) {
          return '<button type="button" data-tutorial="' + x[0] + '"><span>' + esc(x[1]) + '<small class="num">' + x[2] + "</small></span><b>Play</b></button>";
        }).join("") + "</div>") + "</div></div>";
    }
    return '<h2 class="title">' + esc(S.me.name) + '</h2><p class="note">' + esc(ROLE_LABEL[S.me.role] || S.me.role) + " · " + esc(S.company.name) + "</p>" +
      (S.platform ? "" : notifyHtml() + discordSwitchHtml()) +
      myLinkHtml() + pinFormHtml();
  }
  function pinFormHtml() {
    return '<form class="box pinbox" id="pinChange" novalidate><strong>Change my PIN</strong><p class="note">Your link stays the same.</p>' +
      '<label>Current PIN<input id="pinOld" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password"></label>' +
      '<label>New PIN<input id="pinNew" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></label>' +
      '<label>New PIN again<input id="pinNew2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></label>' +
      '<button class="btn brand" id="pinGo2">Change PIN</button></form>' +
      '<div class="row-actions"><button type="button" class="btn ghost" data-signout>Sign out</button><button type="button" class="btn ghost" data-forget>Sign out and remove my link</button></div>';
  }

