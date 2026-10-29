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
    show("clockBtn", !!a); if (!a) return;
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
