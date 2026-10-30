  // ── clock in and out inside Parking Ops ──
  // For people with Attendance: one slide, no trip to Attendance and no map.
  // The site check runs in aero_clock_in() in the database, as in Attendance;
  // the phone is only asked where it is on this screen and when sliding.
  var CLK = { sites: null, pos: null, busy: false };
  function clockSlideHtml(kind) {
    var word = kind === "in" ? "Clock in" : "Clock out";
    return '<div class="clk-slide clk-' + kind + '" data-clk="' + kind + '"><span class="clk-fill" aria-hidden="true"></span>' +
      '<span class="clk-label" aria-hidden="true">Slide to ' + word.toLowerCase() + '</span>' +
      '<button type="button" class="clk-knob" aria-label="' + word + '"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 17 5-5-5-5M13 17l5-5-5-5"/></svg></button></div>' +
      '<p class="clk-zone" data-clkzone aria-live="polite"></p>';
  }
  // The shift box on Menu and Me: on shift with a slide to clock out, or a slide to clock in.
  function clockBoxHtml(access) {
    var shift = access.shift;
    if (!shift) return '<div class="clk-box"><p class="clk-state">Not clocked in</p>' + clockSlideHtml("in") + "</div>";
    var mins = Math.max(0, Math.round((Date.now() - new Date(shift.clock_in_at)) / 60000));
    return '<div class="clk-box"><p class="clk-state"><span class="att-dot" aria-hidden="true"></span>On shift since ' + esc(hhmm(shift.clock_in_at)) +
      ' <span class="num">· ' + Math.floor(mins / 60) + "h " + String(mins % 60).padStart(2, "0") + "m</span></p>" + clockSlideHtml("out") + "</div>";
  }
  function clkZone(text, state) {
    document.querySelectorAll("[data-clkzone]").forEach(function (el) { el.textContent = text; el.className = "clk-zone" + (state ? " " + state : ""); });
  }
  function clkSlide(kind, state, label) {
    document.querySelectorAll('.clk-slide[data-clk="' + kind + '"]').forEach(function (el) {
      el.className = "clk-slide clk-" + kind + (state ? " " + state : "");
      el.querySelector(".clk-label").textContent = label || "Slide to clock " + kind;
      if (state !== "done" && state !== "busy") el.style.removeProperty("--x");
      el.querySelector(".clk-knob").disabled = state === "busy" || state === "done";
    });
  }
  function clkHere(fresh) {
    return new Promise(function (ok) {
      if (!fresh && CLK.pos && Date.now() - CLK.pos.at < 60000) return ok(CLK.pos);
      if (!navigator.geolocation) return ok(null);
      navigator.geolocation.getCurrentPosition(function (p) {
        CLK.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() }; ok(CLK.pos);
      }, function () { ok(null); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }
  async function clkSites() {
    if (CLK.sites) return CLK.sites;
    var r = await sb.from("aero_worksites").select("id,name,lat,lng,radius_m");
    if (!r.error && r.data) CLK.sites = r.data;
    return CLK.sites || [];
  }
  function clkMetres(a, b) {
    var p = Math.PI / 180, x = Math.sin((b.lat - a.lat) * p / 2), y = Math.sin((b.lng - a.lng) * p / 2);
    return Math.round(2 * 6371000 * Math.asin(Math.sqrt(x * x + Math.cos(a.lat * p) * Math.cos(b.lat * p) * y * y)));
  }
  // The site you're inside, else the nearest.
  function clkNearest(sites, pos) {
    var best = null;
    sites.forEach(function (w) { var m = clkMetres(pos, w); if (!best || m - w.radius_m < best.m - best.w.radius_m) best = { w: w, m: m }; });
    if (best) best.inside = best.m <= best.w.radius_m + Math.min(pos.acc || 0, 50);
    return best;
  }
  function clkSay(near) {
    if (!near) return clkZone("Turn on location to clock in.", "warn");
    if (near.inside) return clkZone("At " + near.w.name, "ok");
    clkZone((near.m < 1000 ? near.m + " m" : (near.m / 1000).toFixed(1) + " km") + " from " + near.w.name + ". Move closer to clock in.", "warn");
  }
  async function clockLocate() {
    clkZone("Finding your location…");
    var sites = await clkSites(), pos = await clkHere(true);
    if (!sites.length) return clkZone("No sites set up. Speak to the office.", "warn");
    clkSay(pos ? clkNearest(sites, pos) : null);
  }
  async function clockDo(kind) {
    if (CLK.busy) return;
    CLK.busy = true;
    clkSlide(kind, "busy", kind === "in" ? "Locating…" : "Clocking out…");
    try {
      var pos = await clkHere(false), r;
      if (kind === "in") {
        var sites = await clkSites(), near = pos && clkNearest(sites, pos);
        if (!near) { clkSay(null); clkSlide(kind); return; }
        clkSay(near);
        r = await sb.rpc("aero_clock_in", { p_worksite_id: near.w.id, p_lat: pos.lat, p_lng: pos.lng, p_accuracy: pos.acc ? Math.round(pos.acc) : null });
      } else {
        // Clock-out is never blocked: no location just means it's marked unverified.
        r = await sb.rpc("aero_clock_out", { p_lat: pos && pos.lat, p_lng: pos && pos.lng, p_note: "" });
      }
      if (r.error) {
        // A dropped signal can follow a write that went through: ask before saying it failed.
        var check = await sb.rpc("aero_open_shift");
        if (check.error || !!(check.data && check.data.clock_in_at) !== (kind === "in")) { clkZone(r.error.message, "warn"); clkSlide(kind); return; }
      }
      clkSlide(kind, "done", kind === "in" ? "Clocked in" : "Clocked out");
      attendanceAccess = {};
      setTimeout(function () {
        if (S.gateOn || S.gated) gateCheck(false);
        if (S.me && !S.gateOn) { if ($("panel").open && $("panelTitle") && /^Clock/.test($("panelTitle").textContent)) $("panel").close(); if ($("menu").open) openMenu(); else render(); clockBtnPlace(); }
      }, 900);
    } catch (e) { clkZone(e.message || String(e), "warn"); clkSlide(kind); }
    finally { CLK.busy = false; }
  }
  // Slide to confirm: a tap only nudges the handle; dragging to the end clocks.
  // Keyboard users press the handle (a click with detail 0).
  var clkDrag = null;
  document.addEventListener("pointerdown", function (e) {
    var knob = e.target.closest && e.target.closest(".clk-knob"); if (!knob || knob.disabled) return;
    var track = knob.parentNode; clkDrag = { track: track, knob: knob, start: e.clientX, x: 0, max: Math.max(0, track.clientWidth - 8 - knob.offsetWidth) };
    track.classList.remove("snap"); knob.setPointerCapture(e.pointerId);
  });
  document.addEventListener("pointermove", function (e) {
    if (!clkDrag) return;
    clkDrag.x = Math.max(0, Math.min(clkDrag.max, e.clientX - clkDrag.start));
    clkDrag.track.style.setProperty("--x", clkDrag.x + "px");
  });
  document.addEventListener("pointerup", function () {
    if (!clkDrag) return;
    var d = clkDrag; clkDrag = null;
    if (d.x >= d.max - 4) return clockDo(d.track.dataset.clk);
    d.track.classList.add("snap"); d.track.style.setProperty("--x", (d.x < 4 ? 24 : 0) + "px");
    setTimeout(function () { d.track.style.setProperty("--x", "0px"); }, d.x < 4 ? 160 : 0);
  });
  document.addEventListener("click", function (e) {
    var knob = e.target.closest && e.target.closest(".clk-knob");
    if (knob && e.detail === 0 && !knob.disabled) clockDo(knob.parentNode.dataset.clk);
  });
  // The top bar button: "On shift 3h 12m" (green dot) or "Clock in"; opens a sheet with the slide.
  function clockBtnPlace() {
    var b = $("clockBtn"); if (!b) return;
    var a = S.platform || !S.me ? false : attendanceState();
    show("clockBtn", !!a); document.body.classList.toggle("has-clk", !!a); if (!a) return;
    var m = a.shift ? Math.max(0, Math.round((Date.now() - new Date(a.shift.clock_in_at)) / 60000)) : 0;
    b.className = "clkbtn" + (a.shift ? " on" : "");
    b.innerHTML = a.shift ? '<span class="att-dot" aria-hidden="true"></span><span class="num">' + Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m</span>" : "Clock in";
    b.setAttribute("aria-label", a.shift ? "On shift " + Math.floor(m / 60) + " hours " + (m % 60) + " minutes. Clock out" : "Clock in");
  }
  function clockSheet() {
    var a = attendanceState(); if (!a) return;
    $("panelBody").innerHTML = '<h2 id="panelTitle">' + (a.shift ? "Clock out" : "Clock in") + "</h2>" + clockBoxHtml(a) +
      '<div class="pbtns"><button type="button" data-close>Close</button></div>';
    if (!$("panel").open) $("panel").showModal();
    if (!a.shift) clockLocate();
  }
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("#clockBtn")) clockSheet(); });
  setInterval(function () { if (document.visibilityState === "visible" && S.me) clockBtnPlace(); }, 60000);
  // ── Settings → Attendance (part 141): an owner pauses the clock-in lock for the whole company ──
  // Nobody's own lock switch changes, so Resume puts everyone back as they were.
  var LP = { st: null, missing: false, ask: false, busy: false, loading: false };
  function lockPauseHtml() {
    if (!S.me || S.platform || S.me.role !== "owner" || !(S.company && S.company.brand && S.company.brand.attendance === true)) return "";
    if (!LP.st && !LP.missing && !LP.loading) loadLockPause();
    return setBox("attendance", "Attendance", LP.st ? (LP.st.paused ? "Lock paused" : LP.st.locked + " locked") : "", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">', '<div id="lpBox">' + lockPauseInner() + "</div>" + stHtml());
  }
  function lockPauseInner() {
    if (LP.missing) return '<p class="note">Not available yet.</p>';
    if (!LP.st) return '<p class="note">Loading…</p>';
    var st = LP.st, n = +st.locked || 0;
    if (st.paused) {
      return '<p class="note"><b>The lock is paused.</b> Everyone can use Parking Ops without clocking in' + (st.by ? ". Paused by " + esc(st.by) : "") + '. Each person\'s own lock setting is kept.</p>' +
        '<div class="row-actions"><button type="button" class="btn brand" data-lockpause="resume"' + (LP.busy ? " disabled" : "") + ">Resume the lock</button></div>";
    }
    if (LP.ask) {
      return '<p class="note">Let all ' + n + " locked " + (n === 1 ? "person" : "people") + ' in without clocking in? Nobody\'s own setting changes, and you can resume at any time.</p>' +
        '<div class="row-actions"><button type="button" class="btn ghost" data-lockpause="cancel">Cancel</button><button type="button" class="btn brand" data-lockpause="yes"' + (LP.busy ? " disabled" : "") + ">Yes, pause the lock</button></div>";
    }
    return '<p class="note">' + (n ? n + " " + (n === 1 ? "person has" : "people have") + " the lock on: clocked out, they see nothing." : "Nobody has the lock on.") + ' If clocking in stops working for someone, pause it here. Switch one person on or off in Staff &amp; access.</p>' +
      '<div class="row-actions"><button type="button" class="btn ghost" data-lockpause="pause">Pause the lock for everyone</button></div>';
  }
  function lockPauseDraw() { var b = $("lpBox"); if (b) b.innerHTML = lockPauseInner(); }
  async function loadLockPause() {
    LP.loading = true;
    var r = await sb.rpc("clock_gate_pause_status");
    LP.loading = false;
    if (r.error || !r.data) LP.missing = true; else { LP.missing = false; LP.st = r.data; }
    lockPauseDraw();
  }
  async function lockPauseClick(what) {
    if (what === "pause") { LP.ask = true; return lockPauseDraw(); }
    if (what === "cancel") { LP.ask = false; return lockPauseDraw(); }
    if (LP.busy) return;
    LP.busy = true; lockPauseDraw();
    var r = await sb.rpc("clock_gate_pause_set", { p_on: what === "yes" });
    LP.busy = false; LP.ask = false;
    if (r.error) { lockPauseDraw(); return toast(r.error.message, true); }
    toast(what === "yes" ? "Lock paused for everyone" : "Lock resumed");
    LP.st = null; LP.missing = false; await loadLockPause(); render();
  }
  // ── Settings → Attendance → Clock-in sites: add, change or remove where people may clock in ──
  // Managers already may change their own company's sites (row-level security); the clock-in check itself stays in the database.
  var ST = { rows: null, missing: false, loading: false, edit: null, ask: null, busy: false, pos: null, err: "" };
  function stHtml() {
    if (!ST.rows && !ST.missing && !ST.loading) stLoad();
    return '<hr class="lp-hr"><div id="stBox">' + stInner() + "</div>";
  }
  function stInner() {
    if (ST.missing) return "";
    if (!ST.rows) return '<p class="note">Loading sites…</p>';
    var head = "<strong>Clock-in sites</strong><p class=\"note\">People can clock in within the radius of a site.</p>";
    var rows = ST.rows.map(function (w) {
      if (ST.edit === w.id) {
        return '<div class="st-row st-edit"><label>Name<input id="stN" value="' + esc(w.name) + '" maxlength="60"></label><label>Radius (m)<input id="stR" type="number" inputmode="numeric" value="' + w.radius_m + '"></label>' +
          '<div class="row-actions"><button type="button" class="btn ghost" data-site="cancel">Cancel</button><button type="button" class="btn brand" data-site="save" data-sid="' + esc(w.id) + '"' + (ST.busy ? " disabled" : "") + ">Save</button></div></div>";
      }
      if (ST.ask === w.id) {
        return '<div class="st-row"><span>Remove <b>' + esc(w.name) + "</b>? Old shifts are kept.</span>" +
          '<div class="row-actions"><button type="button" class="btn ghost" data-site="cancel">Cancel</button><button type="button" class="btn brand" data-site="remove" data-sid="' + esc(w.id) + '"' + (ST.busy ? " disabled" : "") + ">Yes, remove</button></div></div>";
      }
      return '<div class="st-row"><span><b>' + esc(w.name) + "</b> · " + w.radius_m + ' m</span><span><button type="button" class="btn ghost small" data-site="edit" data-sid="' + esc(w.id) + '">Edit</button> <button type="button" class="btn ghost small" data-site="ask" data-sid="' + esc(w.id) + '">Remove</button></span></div>';
    }).join("");
    var add = '<div class="st-row st-edit"><b>Add a site</b><label>Name<input id="stAN" maxlength="60" placeholder="e.g. Yard 3"></label><label>Radius (m)<input id="stAR" type="number" inputmode="numeric" value="200"></label>' +
      '<div class="note" id="stPos">' + (ST.pos ? "Using your location (" + ST.pos.lat.toFixed(5) + ", " + ST.pos.lng.toFixed(5) + ", about " + Math.round(ST.pos.acc || 0) + " m)." : "Stand at the site and tap Use my location.") + "</div>" +
      '<div class="row-actions"><button type="button" class="btn ghost" data-site="here">Use my location now</button><button type="button" class="btn brand" data-site="add"' + (ST.busy ? " disabled" : "") + ">Add site</button></div></div>";
    return head + (rows || '<p class="note">No sites yet.</p>') + add + (ST.err ? '<p class="note" role="alert" style="color:#B42318">' + esc(ST.err) + "</p>" : "");
  }
  function stDraw() {
    var b = $("stBox"); if (!b) return;
    var keep = { n: $("stAN") && $("stAN").value, r: $("stAR") && $("stAR").value };
    b.innerHTML = stInner();
    if ($("stAN") && keep.n != null) { $("stAN").value = keep.n; $("stAR").value = keep.r; }
  }
  async function stLoad() {
    ST.loading = true;
    var r = await sb.from("aero_worksites").select("id,name,lat,lng,radius_m").order("name");
    ST.loading = false;
    if (r.error || !Array.isArray(r.data)) ST.missing = true; else { ST.missing = false; ST.rows = r.data; }
    stDraw();
  }
  async function siteClick(what, id) {
    ST.err = "";
    if (what === "edit") { ST.edit = id; ST.ask = null; return stDraw(); }
    if (what === "ask") { ST.ask = id; ST.edit = null; return stDraw(); }
    if (what === "cancel") { ST.edit = ST.ask = null; return stDraw(); }
    if (what === "here") {
      var b = $("stPos"); if (b) b.textContent = "Finding you…";
      var p = await clkHere(true);
      if (!p) { ST.err = "Could not get your location. Turn location on and try again."; return stDraw(); }
      ST.pos = p; return stDraw();
    }
    if (ST.busy) return;
    var err = "", row;
    if (what === "save") {
      var nm = ($("stN").value || "").trim(), rd = parseInt($("stR").value, 10);
      if (!nm) err = "Give the site a name."; else if (!(rd >= 50 && rd <= 1000)) err = "The radius must be between 50 and 1000 metres.";
      if (err) { ST.err = err; return stDraw(); }
      ST.busy = true; stDraw();
      var r = await sb.from("aero_worksites").update({ name: nm, radius_m: rd }).eq("id", id);
      ST.busy = false; if (r.error) { ST.err = r.error.message; return stDraw(); }
      ST.edit = null;
    } else if (what === "remove") {
      ST.busy = true; stDraw();
      var d = await sb.from("aero_worksites").delete().eq("id", id);
      ST.busy = false; if (d.error) { ST.err = d.error.message; return stDraw(); }
      ST.ask = null;
    } else if (what === "add") {
      var an = ($("stAN").value || "").trim(), ar = parseInt($("stAR").value, 10);
      if (!an) err = "Give the site a name."; else if (!(ar >= 50 && ar <= 1000)) err = "The radius must be between 50 and 1000 metres."; else if (!ST.pos) err = "Tap Use my location while you are at the site.";
      if (err) { ST.err = err; return stDraw(); }
      ST.busy = true; stDraw();
      var c = await sb.rpc("aero_current_company_id");
      if (c.error || !c.data) { ST.busy = false; ST.err = c.error ? c.error.message : "Attendance is not set up for this company."; return stDraw(); }
      var ins = await sb.from("aero_worksites").insert({ company_id: c.data, name: an, lat: ST.pos.lat, lng: ST.pos.lng, radius_m: ar });
      ST.busy = false; if (ins.error) { ST.err = ins.error.message; return stDraw(); }
      ST.pos = null; if ($("stAN")) { $("stAN").value = ""; }
    } else return;
    CLK.sites = null; ST.rows = null; toast(what === "remove" ? "Site removed" : what === "add" ? "Site added" : "Site saved");
    await stLoad();
  }
  // ── who is on shift now (owners and managers of a client with Attendance) ──
  // Read from Attendance's own shift list; a failed read just shows nothing.
  var SHIFTS = { at: 0, by: null, people: null, sites: {}, busy: false };
  var FORGOT_HOURS = 13;
  function shiftsOn() { return !!(S.me && !S.platform && S.company && S.company.brand && S.company.brand.attendance === true && (S.me.role === "owner" || S.me.role === "manager")); }
  async function loadShifts(force) {
    if (!shiftsOn() || SHIFTS.busy || (!force && SHIFTS.by && Date.now() - SHIFTS.at < 30000)) return;
    SHIFTS.busy = true;
    try {
      var r = await Promise.all([
        sb.from("aero_shifts").select("id,user_id,clock_in_at,worksite_id").is("clock_out_at", null),
        sb.from("aero_worksites").select("id,name"),
        S.me.role === "owner" ? sb.rpc("attendance_people") : Promise.resolve({ data: null })
      ]);
      if (r[0].error || !Array.isArray(r[0].data)) { SHIFTS.by = null; return; }
      SHIFTS.sites = {}; (r[1].data || []).forEach(function (w) { SHIFTS.sites[w.id] = w.name; });
      SHIFTS.by = {}; r[0].data.forEach(function (x) { SHIFTS.by[x.user_id] = x; });
      SHIFTS.people = null;
      if (Array.isArray(r[2].data)) { SHIFTS.people = {}; r[2].data.forEach(function (x) { SHIFTS.people[x.staff_id] = x; }); }
      SHIFTS.at = Date.now();
      if (S.view === "staff" && !$("panel").open && !document.querySelector(".ops-dd[open]") && document.activeElement !== $("newName")) render();
      else if (S.view === "dashboard" && !$("panel").open) render();
    } catch (e) { SHIFTS.by = null; }
    finally { SHIFTS.busy = false; }
  }
  function shiftLen(x) {
    var m = Math.max(0, Math.round((Date.now() - new Date(x.clock_in_at)) / 60000));
    return { m: m, text: Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m", forgot: m >= FORGOT_HOURS * 60 };
  }
  function shiftChip(p) {
    if (!shiftsOn()) return "";
    loadShifts();
    if (!SHIFTS.by) return "";
    var x = p.user_id && SHIFTS.by[p.user_id], pp = SHIFTS.people && SHIFTS.people[p.id];
    var h = "";
    if (x) {
      var s = shiftLen(x), site = SHIFTS.sites[x.worksite_id];
      h += s.forgot ? '<span class="shiftchip bad">Still clocked in since ' + esc(hhmm(x.clock_in_at)) + " · " + s.text + "</span>"
        : '<span class="shiftchip on"><i aria-hidden="true"></i>On shift ' + s.text + (site ? " · " + esc(site) : "") + "</span>";
    } else if (pp && pp.attendance) h += '<span class="shiftchip"><i class="off" aria-hidden="true"></i>Clocked out</span>';
    if (pp && pp.locked) h += '<span class="shiftchip lock">Lock on</span>';
    return h ? '<span class="shiftchips">' + h + "</span>" : "";
  }
  // A manager closing a forgotten shift (Attendance's own aero_clock_out_for: it closes an open break and
  // records who did it). Asks first; the shift ends at the moment of the tap.
  var FIX = { id: "", busy: false };
  async function fixShift(what, id) {
    if (what === "ask") { FIX.id = id; return render(); }
    if (what === "cancel") { FIX.id = ""; return render(); }
    if (FIX.busy) return;
    FIX.busy = true; render();
    var r = await sb.rpc("aero_clock_out_for", { p_shift_id: id, p_reason: "Forgotten clock-out, closed from Parking Ops" });
    FIX.busy = false;
    if (r.error) { render(); return toast(r.error.message, true); }
    FIX.id = ""; toast("Shift closed");
    SHIFTS.at = 0; await loadShifts(true); render();
  }
  function fixButtons(x, name) {
    if (FIX.id === x.id) {
      return '<div class="od-fix"><span>Clock out ' + esc(name) + ' now?</span><button type="button" class="btn ghost small" data-fixshift="cancel">Cancel</button><button type="button" class="btn brand small" data-fixshift="yes" data-sid="' + esc(x.id) + '"' + (FIX.busy ? " disabled" : "") + ">Yes, clock out</button></div>";
    }
    return '<button type="button" class="btn ghost small" data-fixshift="ask" data-sid="' + esc(x.id) + '">Clock out</button>';
  }
  // Dashboard, beside Site status.
  function onShiftHtml() {
    if (!shiftsOn()) return "";
    loadShifts();
    if (!SHIFTS.by) return "";
    var people = Object.keys(S.staff).map(function (k) { return S.staff[k]; }).filter(function (p) { return p.active && !p.removed_at; });
    var on = people.filter(function (p) { return p.user_id && SHIFTS.by[p.user_id]; }).sort(function (a, b) { return new Date(SHIFTS.by[a.user_id].clock_in_at) - new Date(SHIFTS.by[b.user_id].clock_in_at); });
    var h = '<section class="od-onshift" aria-label="On shift now"><h2>On shift now <small class="num">' + on.length + " clocked in</small></h2>";
    if (!on.length) return h + '<p class="od-hnote none">Nobody is clocked in.</p></section>';
    return h + on.map(function (p) {
      var x = SHIFTS.by[p.user_id], s = shiftLen(x), site = SHIFTS.sites[x.worksite_id];
      return '<div class="od-shiftrow' + (s.forgot ? " bad" : "") + '"><i aria-hidden="true"></i><div><strong>' + esc(p.name) + "</strong><small>" +
        (s.forgot ? "Still clocked in since " + esc(hhmm(x.clock_in_at)) : esc(site || "Clocked in")) + '</small></div><span class="num">' + s.text + "</span>" + (s.forgot ? fixButtons(x, p.name) : "") + "</div>";
    }).join("") + "</section>";
  }
