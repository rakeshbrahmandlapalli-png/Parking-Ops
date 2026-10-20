  // PT: photos taken in the app's camera (quickest) or picked from the gallery.
  // Ways to get them to PT, chosen in Settings: companies.pt_method on Android
  // phones and computers, pt_method_ios on iPhones (part 49); ptMethod():
  //   photos  the reg goes to the PT WhatsApp chat, then the photos in albums
  //           (10 at a time on Android). Kept on the phone until all are sent,
  //           so a reload while WhatsApp is open carries on where it left off.
  //   link    they upload in the background as they come in, then WhatsApp
  //           opens once with the reg and a link to every photo (part 25).
  // 2400 px at 85% is about a third of a full camera photo to upload, and
  // still sharper than WhatsApp's own HD.
  var pt = null, PT_MAX = 2400, PT_Q = 0.85, PT_AT_ONCE = 4;
  function ptMethod() { var c = S.company || {}; return (IS_IOS && c.pt_method_ios) || c.pt_method || "photos"; }
  function ptCaption(r) { return r.reg || "NO REG"; }
  function ptToken() {
    var b = new Uint8Array(18); crypto.getRandomValues(b);
    return btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function ptLink() { return location.origin + "/p/" + pt.token; }
  function ptMessage(r) { var n = ptCount("done"); return ptCaption(r) + " – " + n + " PT photo" + (n === 1 ? "" : "s") + ": " + ptLink(); }
  function ptCount(state) { return pt ? pt.items.filter(function (x) { return !state || x.state === state; }).length : 0; }
  function openPt(r) {
    if (!pt || pt.id !== r.id) { ptClear(); pt = { id: r.id, reg: ptCaption(r), mode: ptMethod() === "link" ? "link" : "photos", token: ptToken(), items: [], saved: 0, sent: 0 }; }
    panelRow = r;
    if (pt.mode === "photos") return openPtPhotos(r);
    var num = (S.company && S.company.pt_whatsapp) || "", n = pt.items.length, ready = ptReady();
    var pick = '<input type="file" accept="image/*" multiple data-ptfile hidden>';
    $("panelBody").innerHTML = '<h2 id="panelTitle">PT · ' + esc(r.reg || "NO REG") + (r.num ? " <small>#" + r.num + "</small>" : "") + "</h2>" +
      '<button type="button" class="btn ' + (n ? "ghost" : "brand") + ' ptgo" data-ptcam>' + (n ? "+ TAKE MORE" : "TAKE PHOTOS") + "</button>" +
      '<label class="btn ghost ptpick">' + pick + (n ? "+ Add from gallery" : "Choose from gallery") + "</label>" +
      (n ? '<div class="ptthumbs" id="ptThumbs">' + pt.items.map(function (x, i) { return ptImg(x, ' data-pti="' + i + '" class="' + x.state + '"'); }).join("") + "</div>" : "") +
      '<p class="hint" id="ptStatus">' + ptStatusText() + "</p>" +
      (ready ? (num
          ? '<a class="btn brand ptgo" href="https://wa.me/' + esc(num) + "?text=" + encodeURIComponent(ptMessage(r)) + '" target="_blank" rel="noopener" data-ptlink>SEND TO PT ON WHATSAPP</a>'
          : '<button type="button" class="btn brand ptgo" data-ptlinkshare>SEND TO PT ON WHATSAPP</button>')
        : n ? '<button type="button" class="btn brand ptgo" disabled data-keepoff>' + (ptCount("fail") ? "Some photos didn't upload" : pt.saveFail ? "Link not saved yet" : "Uploading…") + "</button>" : "") +
      ((ptCount("fail") || pt.saveFail) && !ptCount("wait") && !ptCount("up") ? '<button type="button" class="btn ghost ptgo" data-ptretry>Try again' + (ptCount("fail") ? " (" + ptCount("fail") + ")" : "") + "</button>" : "") +
      '<div class="pbtns"><button type="button" data-close>Close</button>' + (n ? '<button type="button" data-ptclear>Start again</button>' : "") + "</div>" +
      '<button type="button" class="link" data-ptmark>Tick PT without sending photos</button>';
    if (!$("panel").open) $("panel").showModal();
  }
  function ptReady() { return !!pt && pt.items.length > 0 && ptCount("done") === pt.items.length && pt.saved === pt.items.length; }
  function ptStatusText() {
    if (!pt || !pt.items.length) return "";
    var n = pt.items.length, d = ptCount("done"), f = ptCount("fail");
    if (ptReady()) return "✓ " + n + " photo" + (n === 1 ? "" : "s") + " uploaded. Tap Send, then Send again in WhatsApp.";
    if (f && d + f === n) return d + " of " + n + " uploaded. " + f + " didn't upload: check the signal and try again.";
    if (pt.saveFail && d === n) return "✓ All " + n + " photos are up, but the link didn't save. Trying again… or tap Try again.";
    return "Uploading " + (d + 1 > n ? n : d + 1) + " of " + n + "… keep this screen open.";
  }
  // Update the thumbnails and the button in place while uploading, or redraw
  // the panel once everything's in.
  function ptRefresh() {
    var cc = $("camCount"); if (cc) { cc.textContent = camCountText(); return; }
    if (pt && pt.mode === "photos") { if ($("panel").open && panelRow && panelRow.id === pt.id) openPt(panelRow); return; }
    if (!pt || !$("panel").open || !panelRow || panelRow.id !== pt.id) return;
    if (ptReady() || (!ptCount("wait") && !ptCount("up"))) return openPt(panelRow);
    pt.items.forEach(function (x, i) { var im = $("panelBody").querySelector('[data-pti="' + i + '"]'); if (im) im.className = x.state; });
    var s = $("ptStatus"); if (s) s.textContent = ptStatusText();
  }
  function ptAdd(input) {
    var r = panelRow; if (!pt || !r) return;
    Array.prototype.forEach.call(input.files || [], function (f) {
      pt.items.push({ file: f, url: "", state: pt.mode === "photos" ? "prep" : "wait", n: pt.items.length + 1 });
    });
    input.value = "";
    openPt(r); ptPump(r);
  }
  // A canvas as a JPEG. On some Android phones toBlob's answer never comes
  // after the camera's been open (PT stuck on "Making the PDF…" or "Saving…"
  // until the app is switched away and back, 10 Oct). So it gets a few
  // seconds, then the picture is copied the plain way (toDataURL), which
  // always finishes; and for the next minute the plain way is used at once.
  var BLOB_WAIT = 4000, blobStuckAt = 0;
  function jpegOf(c, q) {
    if (Date.now() - blobStuckAt < 60000) return Promise.resolve(jpegPlain(c, q));
    return new Promise(function (ok) {
      var done = false, t = setTimeout(function () {
        if (done) return; done = true; blobStuckAt = Date.now(); ok(jpegPlain(c, q));
      }, BLOB_WAIT);
      try { c.toBlob(function (b) { if (done) return; done = true; clearTimeout(t); ok(b || jpegPlain(c, q)); }, "image/jpeg", q); }
      catch (e) { done = true; clearTimeout(t); ok(jpegPlain(c, q)); }
    });
  }
  function jpegPlain(c, q) {
    try {
      var s = atob(c.toDataURL("image/jpeg", q).split(",")[1]), a = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
      return a.length ? new Blob([a], { type: "image/jpeg" }) : null;
    } catch (e) { return null; }
  }
  // A promise that gives up after ms (the same Android stall can catch
  // createImageBitmap), so the caller's own fallback takes over.
  function inTime(p, ms) {
    var late = false;
    p.then(function (x) { if (late && x && x.close) x.close(); }, function () {});   // a picture that turns up too late is let go
    return Promise.race([p, new Promise(function (ok, no) { setTimeout(function () { late = true; no(new Error("took too long")); }, ms); })]);
  }
  // Full camera photos are 4-8 MB; 3000 px is sharper than anyone zooms into
  // and a lot quicker to upload on mobile data.
  // Gallery photos: made upload size and stamped with when they were taken.
  async function ptShrink(b, reg) {
    try {
      var when = await ptTakenAt(b);
      var im = await inTime(createImageBitmap(b), 8000), k = Math.min(1, PT_MAX / Math.max(im.width, im.height));
      var c = ptCanvas(im, Math.round(im.width * k), Math.round(im.height * k), when, reg); if (im.close) im.close();
      return (await jpegOf(c, PT_Q)) || b;
    } catch (e) { return b; }
  }
  // Date, time and reg burnt into the bottom corner of the photo, so it stays
  // with the photo in WhatsApp, downloads and the app's copy.
  function ptStampText(when, reg) {
    var t = new Date(when).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");
    return t + (reg ? " · " + reg : "");
  }
  // The photo on a canvas with a black bar UNDER it holding the date, time
  // and reg, so the stamp never covers any of the car.
  function ptBar(w) { return Math.max(28, Math.round(w * 0.032)); }
  function ptCanvas(src, w, h, when, reg) {
    var bar = ptBar(w), c = document.createElement("canvas"); c.width = w; c.height = h + bar;
    var g = c.getContext("2d"); g.drawImage(src, 0, 0, w, h);
    try {
      g.fillStyle = "#000"; g.fillRect(0, h, w, bar);
      var size = Math.round(bar * 0.6);
      g.font = "700 " + size + "px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
      g.fillStyle = "#fff"; g.textBaseline = "middle"; g.fillText(ptStampText(when, reg), Math.round(bar * 0.4), h + bar / 2);
    } catch (e) {}
    return c;
  }
  // When a gallery photo was taken: the camera's own date in the photo (EXIF
  // DateTimeOriginal, UK local time); failing that, the file's date.
  async function ptTakenAt(f) {
    var fallback = f.lastModified || Date.now();
    try {
      if (!/jpe?g/i.test(f.type || f.name || "")) return fallback;
      var v = new DataView(await f.slice(0, 131072).arrayBuffer());
      if (v.getUint16(0) !== 0xFFD8) return fallback;
      for (var o = 2; o + 4 < v.byteLength;) {
        var mk = v.getUint16(o), len = v.getUint16(o + 2);
        if (mk === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return ptExifDate(v, o + 10) || fallback;
        if ((mk & 0xFF00) !== 0xFF00) break;
        o += 2 + len;
      }
    } catch (e) {}
    return fallback;
  }
  function ptExifDate(v, t) {
    var le = v.getUint16(t) === 0x4949, u16 = function (p) { return v.getUint16(p, le); }, u32 = function (p) { return v.getUint32(p, le); };
    function find(ifd, tag) { var n = u16(ifd); for (var i = 0; i < n; i++) { var e = ifd + 2 + i * 12; if (u16(e) === tag) return e; } return 0; }
    var ifd0 = t + u32(t + 4), ex = find(ifd0, 0x8769), e = ex ? find(t + u32(ex + 8), 0x9003) : 0;
    if (!e) e = find(ifd0, 0x0132);
    if (!e) return 0;
    var at = t + u32(e + 8), str = "";
    for (var i = 0; i < 19; i++) str += String.fromCharCode(v.getUint8(at + i));
    var m = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/); if (!m) return 0;
    // The camera's clock is UK local time: find the moment that shows that in London.
    var guess = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    var shown = new Date(guess).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false });
    var off = (+shown % 24 - +m[4] + 24) % 24; if (off > 12) off -= 24;
    return guess - off * 3600000;
  }
  function ptPump(r) {
    var cur = pt; if (!cur) return;
    if (cur.mode === "photos") return ptPrep(r, cur);
    while (ptCount("up") < PT_AT_ONCE) {
      var x = cur.items.filter(function (y) { return y.state === "wait"; })[0]; if (!x) break;
      x.state = "up"; ptUpload(r, cur, x);
    }
    // The link is saved once shooting's finished (Done), not after every photo.
    if (!camStream && !ptCount("wait") && !ptCount("up") && ptCount("done") > cur.saved) ptSave(r, cur);
  }
  async function ptUpload(r, cur, x) {
    try {
      var b = x.ready ? x.file : await ptShrink(x.file, cur.reg);
      if (!x.url) { x.url = await ptThumbOf(b); var im0 = $("panelBody").querySelector('[data-pti="' + (x.n - 1) + '"]'); if (im0 && x.url) im0.src = x.url; }
      var ext = b.type === "image/png" ? "png" : b.type === "image/jpeg" ? "jpg" : (x.file.name.split(".").pop() || "jpg").toLowerCase();
      x.path = S.me.company_id + "/" + r.id + "/" + cur.token + "/" + String(x.n).padStart(2, "0") + "." + ext;
      var up = await sb.storage.from("pt-photos").upload(x.path, b, { contentType: b.type || "image/jpeg" });
      // "Already exists" on a retry means the first try got there after all.
      x.state = !up.error || /exist|duplicate/i.test(up.error.message || "") ? "done" : "fail";
      if (x.state === "fail") x.err = up.error.message;
    } catch (e) { x.state = "fail"; x.err = e.message; }
    if (pt !== cur) return;
    ptRefresh(); ptPump(r);
  }
  async function ptSave(r, cur) {
    if (cur.saving) return;
    cur.saving = true;
    var paths = cur.items.filter(function (x) { return x.state === "done"; }).map(function (x) { return x.path; });
    var res; try { res = await sb.rpc("pt_link_save", { p_token: cur.token, p_booking: r.id, p_paths: paths }); } catch (e) { res = { error: e }; }
    cur.saving = false;
    if (pt !== cur) return;
    if (res.error) {
      cur.saveFail = true;
      toast("Couldn't save the link yet: " + (isDown(res) ? "no signal or the server is busy." : res.error.message), true);
      setTimeout(function () { if (pt === cur && cur.saveFail) { cur.saveFail = false; ptSave(r, cur); } }, 8000);
      return ptRefresh();   // redraws only if this car's PT screen is open
    }
    cur.saveFail = false;
    cur.saved = paths.length;
    if (ptCount("fail")) { var f = cur.items.filter(function (x) { return x.state === "fail"; })[0]; if (f && f.err) toast("Upload failed: " + f.err, true); }
    ptRefresh();
  }
  // In-app camera for speed: one tap per photo, as fast as you like, and each
  // photo starts uploading straight away while you take the next.
  // If the phone refuses (no permission, old browser) the PT screen is there
  // to choose photos from the gallery instead.
  var camStream = null, camTorch = false;
  function camLight(on) {
    var track = camStream && camStream.getVideoTracks()[0]; if (!track) return Promise.resolve();
    return track.applyConstraints({ advanced: [{ torch: on }] });
  }
  async function camToggleTorch() {
    var want = !camTorch;
    try { await camLight(want); camTorch = want; }
    catch (e) { return toast("This phone won't let the app use its light.", true); }
    var b = $("camTorch"); if (b) { b.textContent = "⚡ FLASH " + (camTorch ? "ON" : "OFF"); b.classList.toggle("on", camTorch); b.setAttribute("aria-pressed", camTorch); }
  }
  // iPhones ask for camera permission every time the camera is started again,
  // so there the camera is parked (kept running, off screen) for a few minutes
  // after Done and picked up again by the next PT: one question, not one per car.
  var IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var camParked = null, camParkTimer = null, CAM_PARK_MS = 5 * 60000;
  function camLive(st) { return !!st && st.getVideoTracks().some(function (t) { return t.readyState === "live"; }); }
  function camUnpark() {
    clearTimeout(camParkTimer);
    if (camParked) camParked.getTracks().forEach(function (t) { t.stop(); });
    camParked = null;
  }
  async function ptCamera(r) {
    try {
      if (camLive(camParked)) { clearTimeout(camParkTimer); camStream = camParked; camParked = null; }
      else {
        camUnpark();
        camStream = await camOpen(camLensPick());
      }
    } catch (e) {
      toast(e && e.name === "NotAllowedError"
        ? (IS_IOS ? "Camera not allowed. Tap Allow when asked, or in Safari tap aA › Website Settings › Camera › Allow." : "Camera not allowed. Allow it in the browser's site settings, or choose photos from the gallery.")
        : "The camera wouldn't start. Choose photos from the gallery instead.", true);
      return;
    }
    $("panel").classList.add("cam");
    $("panelBody").innerHTML = '<div class="camview"><video id="camVideo" autoplay playsinline muted></video><div class="camflash" id="camFlash"></div><div class="camring" id="camRing"></div><button type="button" class="camtorch hidden" id="camTorch" data-camtorch aria-pressed="false">⚡ FLASH OFF</button><button type="button" class="camtorch camlens hidden" id="camLens" data-camlens>LENS</button>' + camTipsHtml() + "</div>" +
      '<div class="cambar"><span class="camcount" id="camCount">' + camCountText() + '</span><button type="button" class="shutter" data-shutter aria-label="Take photo"></button><button type="button" class="camdone" data-camdone>Done</button></div>';
    $("camVideo").srcObject = camStream;
    // Keep the picture sharp as the phone moves round the car.
    var track = camStream.getVideoTracks()[0], caps = track && track.getCapabilities ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.indexOf("continuous") !== -1) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(function () {});
    // Some phones open the back camera zoomed out (0.5x, the ultra-wide):
    // start at 1x, like the phone's own camera.
    if (caps.zoom && caps.zoom.min < 1 && caps.zoom.max >= 1) track.applyConstraints({ advanced: [{ zoom: 1 }] }).catch(function () {});
    // The phone's light, for dark corners of the terminal. Stays on while shooting.
    camTorch = false;
    if (caps.torch) show("camTorch", true);
    camLensButton(track);
  }
  // ── PT checklist on the camera screen ──
  // A reminder of how to photograph so small marks show (a chip low on a
  // door was lost in reflections, 28 Sept). ✕ folds it to a small button;
  // the phone remembers.
  var CAM_TIPS_KEY = "takeoff-cam-tips";
  var CAM_TIPS = [
    "Every side, front and back, and all 4 corners",
    "Crouch to door height for each side",
    "Step to one side so lights don't shine off the paint",
    "Close-up of every mark, however small",
    "Wheels, bumpers and mirrors",
  ];
  function camTipsOpen() { try { return localStorage.getItem(CAM_TIPS_KEY) !== "off"; } catch (e) { return true; } }
  function camTipsHtml() {
    if (!camTipsOpen()) return '<button type="button" class="camtipsbtn" data-camtips="on">✓ CHECKLIST</button>';
    return '<div class="camtips" id="camTips"><button type="button" class="camtipsx" data-camtips="off" aria-label="Hide the checklist">✕</button>' +
      "<b>PT checklist</b><ol>" + CAM_TIPS.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ol></div>";
  }
  function camTipsSet(on) {
    try { localStorage.setItem(CAM_TIPS_KEY, on ? "on" : "off"); } catch (e) {}
    var old = document.querySelector(".camtips, .camtipsbtn"); if (!old) return;
    var d = document.createElement("div"); d.innerHTML = camTipsHtml(); old.replaceWith(d.firstChild);
  }
  // ── Which back lens ──
  // A browser asking for "the back camera" can be given any of a phone's back
  // lenses, often the ultra-wide (a wide, bent picture). The main lens is
  // picked by name where the phone gives one, and LENS switches between the
  // back lenses; the choice is remembered on the phone.
  var CAM_LENS_KEY = "takeoff-cam-lens", camLenses = [];
  function camOpen(deviceId) {
    var v = { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } };
    if (deviceId) v.deviceId = { exact: deviceId }; else v.facingMode = { ideal: "environment" };
    return navigator.mediaDevices.getUserMedia({ audio: false, video: v }).catch(function (e) {
      if (!deviceId || e.name === "NotAllowedError") throw e;
      try { localStorage.removeItem(CAM_LENS_KEY); } catch (x) {}
      return camOpen("");
    });
  }
  function camLensPick() { try { return localStorage.getItem(CAM_LENS_KEY) || ""; } catch (e) { return ""; } }
  // Main lens first: not ultra-wide / tele / macro / depth; then the lowest
  // Android number ("camera2 0, facing back" is the main one on most phones).
  function camLensRank(d) {
    var l = d.label || "", n = +((l.match(/camera2?\s*(\d+)/i) || [])[1] || 50);
    return (/ultra|tele|macro|depth|dual|triple/i.test(l) ? 100 : 0) + n;
  }
  async function camLensButton(track) {
    try {
      var all = await navigator.mediaDevices.enumerateDevices();
      camLenses = all.filter(function (d) { return d.kind === "videoinput" && /back|rear|environment/i.test(d.label || ""); })
        .sort(function (a, b) { return camLensRank(a) - camLensRank(b); });
      if (camLenses.length < 2 || !camStream) return;
      var now = (track.getSettings ? track.getSettings().deviceId : "") || "";
      // First time on this phone: if the browser gave a lens other than the
      // main one, switch to the main one.
      if (!camLensPick() && now && camLenses[0].deviceId && now !== camLenses[0].deviceId) return camLensSet(camLenses[0].deviceId);
      var b = $("camLens"); if (!b) return;
      var i = camLenses.findIndex(function (d) { return d.deviceId === now; });
      b.textContent = "LENS " + (i + 1 > 0 ? i + 1 : 1) + "/" + camLenses.length;
      b.classList.remove("hidden");
    } catch (e) {}
  }
  async function camLensNext() {
    if (camLenses.length < 2 || !camStream) return;
    var track = camStream.getVideoTracks()[0], now = track && track.getSettings ? track.getSettings().deviceId : "";
    var i = camLenses.findIndex(function (d) { return d.deviceId === now; });
    camLensSet(camLenses[(i + 1) % camLenses.length].deviceId);
  }
  async function camLensSet(id) {
    try { localStorage.setItem(CAM_LENS_KEY, id); } catch (e) {}
    var r = panelRow; if (!r || !camStream) return;
    if (camTorch) await camLight(false).catch(function () {});
    camStream.getTracks().forEach(function (t) { t.stop(); });
    camStream = null;
    ptCamera(r);
  }
  // Tap the picture to focus on that spot (where the phone allows it).
  function camFocus(e) {
    var v = $("camVideo"), track = camStream && camStream.getVideoTracks()[0]; if (!v || !track) return;
    var caps = track.getCapabilities ? track.getCapabilities() : {}; if (!caps.pointsOfInterest && !caps.focusMode) return;
    var b = v.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    var c = { pointsOfInterest: [{ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }] };
    if (caps.focusMode && caps.focusMode.indexOf("continuous") !== -1) c.focusMode = "continuous";
    track.applyConstraints({ advanced: [c] }).catch(function () {});
    var ring = $("camRing"); if (ring) { ring.style.left = (e.clientX - b.left) + "px"; ring.style.top = (e.clientY - b.top) + "px"; ring.classList.remove("go"); void ring.offsetWidth; ring.classList.add("go"); }
  }
  $("panel").addEventListener("pointerdown", function (e) { if (e.target && e.target.id === "camVideo") camFocus(e); });
  function camCountText() {
    var n = pt ? pt.items.length : 0, d = ptCount("done");
    return n + " photo" + (n === 1 ? "" : "s") + (n && pt.mode === "link" ? " · " + d + " uploaded" : "");
  }
  function camStop() {
    var cur = camStream ? pt : null;
    // However the camera was closed (Done, Back, a tap outside), what was shot
    // carries on: the link (or the app's copy) is saved once shooting stops.
    if (cur) setTimeout(function () {
      if (pt !== cur) return;
      var row = S.rows.filter(function (x) { return x.id === cur.id; })[0] || { id: cur.id, reg: cur.reg };
      if (cur.mode === "photos") ptStore();
      ptPump(row);
    }, 0);
    if (camStream) {
      if (camTorch) camLight(false).catch(function () {});
      if (IS_IOS && camLive(camStream)) { camParked = camStream; clearTimeout(camParkTimer); camParkTimer = setTimeout(camUnpark, CAM_PARK_MS); }
      else camStream.getTracks().forEach(function (t) { t.stop(); });
    }
    camStream = null; camTorch = false; $("panel").classList.remove("cam");
  }
  // The picture on screen, saved at upload size in one go (no second squeeze).
  // Tapping the button shakes the phone, and a single frame of video caught
  // mid-shake is blurred. So each tap takes a few frames over about a quarter
  // of a second and keeps the sharpest. Taps queue up, one photo each, and
  // Done waits for the last one.
  var camShots = Promise.resolve(), CAM_BURST = 4, CAM_GAP = 50;
  function ptShoot(r) {
    var v = $("camVideo"); if (!v || !v.videoWidth || !pt) return;
    var f = $("camFlash"); if (f) { f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); }
    var cur = pt, when = Date.now();
    camShots = camShots.then(function () { return ptGrab(r, cur, when); }).catch(function (e) { oopsLog(e); });
  }
  async function ptGrab(r, cur, when) {
    var v = $("camVideo"); if (!v || !v.videoWidth || pt !== cur) return;
    var best = await camStill(v), bestScore = best ? Infinity : -1;
    for (var i = 0; i < CAM_BURST && bestScore !== Infinity; i++) {
      if (i) await new Promise(function (ok) { setTimeout(ok, CAM_GAP); });
      if (!v.videoWidth) break;
      var fr = null;
      // Copied at upload size: a full 4K frame is 33 MB of memory, a 2400 px one 13 MB.
      try { fr = await inTime(createImageBitmap(v, v.videoWidth >= v.videoHeight ? { resizeWidth: Math.min(PT_MAX, v.videoWidth), resizeQuality: "high" } : { resizeHeight: Math.min(PT_MAX, v.videoHeight), resizeQuality: "high" }), 3000); }
      catch (e) { try { fr = /too long/.test(e.message) ? null : await inTime(createImageBitmap(v), 3000); } catch (e2) { fr = null; } }
      if (!fr) { if (!best) best = v; break; }   // can't copy frames: the picture as it is now
      var sc = camSharpness(fr);
      if (sc > bestScore) { if (best && best.close) best.close(); best = fr; bestScore = sc; } else if (fr.close) fr.close();
    }
    if (!best || pt !== cur) { if (best && best.close) best.close(); return; }
    var w = best.videoWidth || best.width, h = best.videoHeight || best.height, k = Math.min(1, PT_MAX / Math.max(w, h));
    var c = ptCanvas(best, Math.round(w * k), Math.round(h * k), when, cur.reg);
    if (best.close) best.close();
    var thumb = ptThumb(c, c.width, c.height);
    var b = await jpegOf(c, PT_Q);
    c.width = c.height = 0;
    if (!b || pt !== cur) return;
    cur.items.push({ file: b, url: thumb, state: cur.mode === "photos" ? "local" : "wait", n: cur.items.length + 1, ready: true });
    var el = $("camCount"); if (el) el.textContent = camCountText();
    ptPump(r); ptPdfWarm(cur);
  }
  // ── Android: a real photo ──
  // Chrome on Android can ask the camera for a proper still photo (full size,
  // the phone's own sharpening and noise clean-up) instead of a frame of
  // video. It takes about half a second. If it fails or hangs twice, this
  // phone goes back to the sharpest-frame way for the rest of the session.
  // OFF (28 Sept): on some phones the camera hands back a 50+ MP photo and
  // opening it ran the phone out of memory, crashing the app during PT.
  var CAM_STILL_ON = false;
  var IS_ANDROID = /Android/i.test(navigator.userAgent), camIC = null, camStillFails = 0, CAM_STILL_WAIT = 5000;
  async function camStill(v) {
    if (!CAM_STILL_ON || !IS_ANDROID || camStillFails >= 2 || typeof ImageCapture === "undefined" || !camStream) return null;
    var track = camStream.getVideoTracks()[0]; if (!track || track.readyState !== "live") return null;
    try {
      if (!camIC || camIC.track !== track) {
        camIC = new ImageCapture(track); camIC.opts = {};
        // No flash going off for each photo (the FLASH button is the torch).
        var pc = await camIC.getPhotoCapabilities().catch(function () { return null; });
        if (pc && (pc.fillLightMode || []).indexOf("off") !== -1) camIC.opts.fillLightMode = "off";
      }
      var blob = await Promise.race([camIC.takePhoto(camTorch ? {} : camIC.opts),
        new Promise(function (ok, no) { setTimeout(function () { no(new Error("photo took too long")); }, CAM_STILL_WAIT); })]);
      var im = await createImageBitmap(blob, { resizeWidth: PT_MAX, resizeQuality: "high" });
      camStillFails = 0;
      return camUpright(im, v);
    } catch (e) {
      camStillFails++; camIC = null;
      // Logged (PT COPY line) so the office can see which phones can't.
      if (camStillFails === 2 && pt) bkReport(pt.id, "real photos off on this phone, using video frames: " + String(e && e.message || e).slice(0, 80));
      return null;
    }
  }
  // Some phones hand the photo back on its side. It's turned to match the
  // picture on screen: whichever quarter turn looks most like the video.
  function camUpright(im, v) {
    var vPortrait = v.videoHeight > v.videoWidth, pPortrait = im.height > im.width;
    if (vPortrait === pPortrait) return im;
    function grey(src, turn) {
      var N = 48, c = document.createElement("canvas"); c.width = c.height = N;
      var g = c.getContext("2d", { willReadFrequently: true });
      if (turn) { g.translate(N / 2, N / 2); g.rotate(turn * Math.PI / 2); g.translate(-N / 2, -N / 2); }
      g.drawImage(src, 0, 0, N, N);
      var d = g.getImageData(0, 0, N, N).data, out = new Float32Array(N * N);
      for (var i = 0; i < N * N; i++) out[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2];
      return out;
    }
    function diff(a, b) { var t = 0; for (var i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]); return t; }
    var ref = grey(v, 0), turn = diff(grey(im, 1), ref) <= diff(grey(im, 3), ref) ? 1 : 3;
    var c = document.createElement("canvas"); c.width = im.height; c.height = im.width;
    var g = c.getContext("2d"); g.translate(c.width / 2, c.height / 2); g.rotate(turn * Math.PI / 2); g.drawImage(im, -im.width / 2, -im.height / 2);
    if (im.close) im.close();
    return c;
  }
  // How sharp a frame is: the middle of the picture made small and grey, then
  // how much each pixel differs from its neighbours (a blurred frame is smooth).
  var camSharpCv = null;
  function camSharpness(fr) {
    try {
      var W = 160, H = 120, c = camSharpCv || (camSharpCv = document.createElement("canvas")); c.width = W; c.height = H;
      var g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(fr, fr.width * 0.2, fr.height * 0.2, fr.width * 0.6, fr.height * 0.6, 0, 0, W, H);
      var d = g.getImageData(0, 0, W, H).data, y = new Float32Array(W * H), sum = 0;
      for (var p = 0; p < W * H; p++) y[p] = d[p * 4] * 0.3 + d[p * 4 + 1] * 0.59 + d[p * 4 + 2] * 0.11;
      for (var row = 1; row < H - 1; row++) for (var col = 1; col < W - 1; col++) {
        var q = row * W + col, l = 4 * y[q] - y[q - 1] - y[q + 1] - y[q - W] - y[q + W];
        sum += l * l;
      }
      return sum;
    } catch (e) { return 0; }
  }
  function ptRetry(r) { pt.saveFail = false; pt.items.forEach(function (x) { if (x.state === "fail") x.state = "wait"; }); openPt(r); ptPump(r); }
  // WhatsApp is open with the message: PT is done.
  function ptSent(r) {
    r = S.rows.filter(function (x) { return x.id === r.id; })[0] || r;
    if (!r.pt_at) tapPick(r, "pt");
    toast(ptCaption(r) + ": PT link sent, PT ticked");
    setTimeout(function () { ptClear(); if ($("panel").open) $("panel").close(); }, 300);
  }
  function ptClear() { pt = null; }
  // PT ticked without sending: photos taken in the app are still saved as the
  // car's copy (kept on the phone until they are).
  function ptTickKeep(r) {
    tapPick(r, "pt");
    var cur = pt;
    cur.sent = cur.items.length; cur.regSent = true;
    if (cur.mode === "photos") {
      bkQueueSet(cur.id, cur.token, cur.items.filter(function (x) { return x.state === "local"; }));
      if (bkPending(cur)) { ptStore(); bkWatch(cur.id, cur.token, cur); } else ptForget(cur.id);
    }
    ptClear(); $("panel").close();
    toast(ptCaption(r) + ": PT ticked, photos kept in the app");
  }
  // No photos in the app: take them, or say why not (logged for the office).
  var PT_WHY = ["Camera not working", "Photos taken on the phone's own camera", "No signal / app not loading", "Other"];
  function ptNoPhotos(r) {
    panelRow = r;
    $("panelBody").innerHTML = '<h2 id="panelTitle">No photos in the app for ' + esc(r.reg || "this car") + "</h2>" +
      '<p class="sub">The app keeps a copy of PT photos in case of a complaint. Take them with the app\'s camera if you can.</p>' +
      '<button type="button" class="btn brand ptgo" data-ptcamgo>OPEN CAMERA</button>' +
      '<label>OR TICK PT ANYWAY, BECAUSE</label><div class="ptwhy">' +
      PT_WHY.map(function (w) { return '<button type="button" data-ptwhy="' + esc(w) + '">' + esc(w) + "</button>"; }).join("") + "</div>" +
      '<div class="pbtns"><button type="button" data-ptback>Back</button></div>';
    if (!$("panel").open) $("panel").showModal();
  }
  function ptTickWhy(r, why) {
    if (why === "Other") {
      why = (prompt("Why is PT being ticked without photos in the app?") || "").trim().slice(0, 120);
      if (!why) return toast("Say why, or take the photos.", true);
    }
    if (!r.pt_at) tapPick(r, "pt");
    bkReport(r.id, "PT ticked without photos in the app: " + why);
    if (pt && pt.id === r.id) { ptForget(pt.id); ptClear(); }
    $("panel").close();
    toast(ptCaption(r) + ": PT ticked (" + why + ")");
  }
  // Small previews (240 px) for the tiles: fifty full-size photos on screen
  // would need close to a gigabyte and cheaper phones would close the app.
  var PT_THUMB = 240;
  function ptThumb(src, w, h) {
    try {
      var k = PT_THUMB / Math.max(w, h), c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.7);
    } catch (e) { return ""; }
  }
  async function ptThumbOf(blob) {
    try { var im = await inTime(createImageBitmap(blob), 8000), t = ptThumb(im, im.width, im.height); if (im.close) im.close(); return t; } catch (e) { return ""; }
  }
  function ptImg(x, attrs) { return "<img" + (x.url ? ' src="' + x.url + '"' : "") + ' alt="" decoding="async"' + (attrs || "") + ">"; }

  // ── PT the WhatsApp-photos way ──
  var PT_BATCH = 10;
  var BIG_SHARE = IS_IOS;
  function openPtPhotos(r) {
    var num = (S.company && S.company.pt_whatsapp) || "", reg = ptCaption(r), n = pt.items.length, prep = ptCount("prep"), sent = pt.sent || 0;
    var b = ptBatch(), pick = '<input type="file" accept="image/*" multiple data-ptfile hidden>';
    // The way chosen in Settings: every photo in one PDF (one tap), or the
    // photos themselves (reg first, then 10 at a time on Android). If the PDF
    // can't be made on this phone, the photos way is there instead.
    var pdfWay = ptWantsPdf() && n && !prep && !sent && !pt.regSent, pdf = pdfWay ? ptPdfState() : null;
    if (pdf && pdf.failed) pdfWay = false;
    var regBtn = num ? '<a class="btn brand ptgo" href="https://wa.me/' + esc(num) + "?text=" + encodeURIComponent(reg) + '" target="_blank" rel="noopener" data-ptreg>1 · SEND ' + esc(reg) + " TO PT</a>"
      : '<button type="button" class="btn brand ptgo" data-ptregshare>1 · SEND ' + esc(reg) + " TO PT</button>";
    var step1 = !n || prep ? ""
      : pdfWay ? '<button type="button" class="btn brand ptgo" data-ptpdf' + (pdf.ready ? "" : " disabled data-keepoff") + ">" + esc(pdf.label) + "</button>" +
          '<p class="hint">Every photo in one file, with ' + esc(reg) + " as the message. Pick the PT chat and Send; PT ticks itself.</p>"
      : !pt.regSent ? regBtn
      : b ? '<button type="button" class="btn brand ptgo" data-ptshare>2 · ' + esc(ptShareLabel()) + "</button>" : "";
    // The send buttons come first, so they're never below a screenful of photos.
    var hint = '<p class="hint">' + (!n ? "" : prep ? "Getting " + prep + " photo" + (prep === 1 ? "" : "s") + " ready…"
        : pdfWay ? ""
        : !pt.regSent ? (ptWantsPdf() ? "The PDF couldn't be made, so send them as photos: " : "") + "opens the PT chat with " + esc(reg) + " typed; Send, come back, then the photos."
        : sent ? "Keep going: tap the button, pick the PT chat (top of the list), Send."
        : "Tap the button, pick the PT chat (top of the list), then Send. PT ticks itself.") + "</p>";
    $("panelBody").innerHTML = '<h2 id="panelTitle">PT · ' + esc(reg) + (r.num ? " <small>#" + r.num + "</small>" : "") + "</h2>" +
      (n && (pt.regSent || sent) ? '<div class="ptsteps"><span class="' + (pt.regSent ? "ok" : "") + '">' + (pt.regSent ? "✓" : "1") + " Reg</span><span class=\"" + (sent && sent >= n ? "ok" : "") + '">' + (sent >= n && n ? "✓" : "2") + " Photos " + sent + "/" + n + "</span></div>" : "") +
      step1 + hint +
      (sent || pt.pdfSent ? "" : '<button type="button" class="btn ' + (n ? "ghost" : "brand") + ' ptgo" data-ptcam>' + (n ? "+ TAKE MORE" : "TAKE PHOTOS") + "</button>" +
        '<label class="btn ghost ptpick">' + pick + (n ? "+ Add from gallery" : "Choose from gallery") + "</label>") +
      (n ? '<div class="ptthumbs">' + pt.items.map(function (x, i) { return ptImg(x, i < sent ? ' class="sent"' : x.state === "prep" ? ' class="wait"' : ""); }).join("") + "</div>" : "") +
      '<div class="pbtns"><button type="button" data-close>Close</button>' + (n ? '<button type="button" data-ptclear>Start again</button>' : "") + "</div>" +
      '<button type="button" class="link" data-ptmark>Tick PT without sending photos</button>';
    if (!$("panel").open) $("panel").showModal();
  }
  // Gallery photos are 4-8 MB each: made the same size as camera shots first,
  // so WhatsApp takes them quickly and the phone doesn't run out of memory.
  async function ptPrep(r, cur) {
    if (cur.prepping) return;
    cur.prepping = true;
    var x;
    while ((x = cur.items.filter(function (y) { return y.state === "prep"; })[0])) {
      x.file = await ptShrink(x.file, cur.reg); x.url = x.url || await ptThumbOf(x.file); x.state = "local";
      if (pt !== cur) return;
    }
    cur.prepping = false;
    // The copy starts once shooting's finished, so it's saved as one set.
    if (!camStream) bkQueueSet(cur.id, cur.token, cur.items.filter(function (y) { return y.state === "local"; }));
    ptStore(); ptRefresh();
  }

  // ── The copy kept for the app ──
  // In the WhatsApp-chat way a copy of the photos uploads quietly in the
  // background, so the car's panel can show them. PT still gets every full
  // photo on WhatsApp. Where the copy goes is companies.pt_copy_store:
  //   "r2"        Cloudflare R2: every photo, "good" quality (1280 px, about
  //               120 KB), kept 30 days: ~14 GB, a few pence a month over
  //               the free 10 GB. The pt-r2 function hands out upload
  //               addresses; paths start "r2:".
  //   otherwise   Supabase's store (100 GB on Pro), kept 30 days: 10 photos spread
  //               evenly round the car, small (800 px, about 35 KB).
  // It waits while the camera is open or PT's photos are still being sent:
  // making copies alongside the share sheet stopped PT on an iPhone.
  // A failed photo is tried again after 5 s, 15 s, 30 s, 1, 2, 5 and then every
  // 10 minutes, about 4 hours in all (PT is often done where the signal is
  // weak); straight away when the phone's connection comes back or the app
  // is opened again. After a dropped connection, one photo at a time.
  var BK_DELAYS = [5, 15, 30, 60, 120, 300, 600], BK_WARN_AT = 3, BK_WARNED = {}, bkSlow = false, bkOkRun = 0;
  var BK = [], bkActive = 0, BK_TRIES = 30, BK_MAX = 800, BK_Q = 0.5, BK_KEEP = 10, R2_MAX = 1280, R2_Q = 0.6;
  // Returns { blob, how }: "bitmap" or "img" (made small), "orig" (couldn't be).
  async function bkSmall(f, good) {
    var max = good ? R2_MAX : BK_MAX, q = good ? R2_Q : BK_Q;
    async function draw(src, w, h) {
      var k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
      var b = await jpegOf(c, q);
      c.width = c.height = 0;   // free the canvas memory at once (iPhones are strict about it)
      return b && b.size < f.size ? b : null;
    }
    try {
      var im = await inTime(createImageBitmap(f), 8000), b1 = await draw(im, im.width, im.height); if (im.close) im.close();
      if (b1) return { blob: b1, how: "bitmap" };
    } catch (e) {}
    var url = "";
    try {
      url = URL.createObjectURL(f);
      var img = new Image(); img.src = url;
      await (img.decode ? img.decode() : new Promise(function (ok, no) { img.onload = ok; img.onerror = no; }));
      var b2 = await draw(img, img.naturalWidth, img.naturalHeight);
      if (b2) return { blob: b2, how: "img" };
    } catch (e) {} finally { if (url) URL.revokeObjectURL(url); }
    return { blob: f, how: "orig" };
  }
  // In the store's cache setting, so a phone's copies can be checked: small or not.
  var BK_MARK = { bitmap: "3600", img: "3601", orig: "3602" };
  // The photos of a set kept as the copy: BK_KEEP of them, first to last.
  function bkR2() { return !!(S.company && S.company.pt_copy_store === "r2"); }
  function bkPath(rowId, token, n) { return (bkR2() ? "r2:" : "") + S.me.company_id + "/" + rowId + "/" + token + "/" + String(n).padStart(2, "0") + ".jpg"; }
  function bkPick(items) {
    var ns = items.map(function (x) { return x.n; }).sort(function (a, b) { return a - b; }), keep = {};
    if (bkR2() || ns.length <= BK_KEEP) { ns.forEach(function (n) { keep[n] = true; }); return keep; }
    for (var k = 0; k < BK_KEEP; k++) keep[ns[Math.round(k * (ns.length - 1) / (BK_KEEP - 1))]] = true;
    return keep;
  }
  function bkQueueSet(rowId, token, items) {
    var keep = bkPick(items);
    items.forEach(function (x) { if (keep[x.n]) bkQueue(rowId, token, x); else if (x.bk !== "done") { x.bk = "skip"; x.queued = true; } });
    // Every kept photo already up (from before a reload): save the set now.
    var mine = items.filter(function (x) { return keep[x.n]; });
    if (mine.length && mine.every(function (x) { return x.bk === "done"; })) {
      BK = BK.filter(function (y) { return y.token !== token; });
      bkSave(rowId, token, mine.map(function (x) { return x.path || bkPath(rowId, token, x.n); }), true, 0);
    }
  }
  // Tells the office why a car's copy didn't make it (database part 45): a
  // PT COPY line in the activity log. Never gets in the way if it fails.
  function bkReport(rowId, detail) {
    var dev = IS_IOS ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android" : "computer";
    try { sb.rpc("pt_copy_report", { p_booking: rowId, p_detail: detail + " · " + dev + " · app " + (appTag || "?").replace(/\W/g, "").slice(0, 8) }).then(function () {}, function () {}); } catch (e) {}
  }
  // Every photo sent to PT: in 3 minutes the car's copy must be saved or on its way.
  function bkWatch(rowId, token, cur) {
    setTimeout(function () {
      if (BK_SAVED[token] || BK.some(function (y) { return y.token === token; })) return;
      var items = (cur && cur.items) || [];
      bkReport(rowId, "copy never started: " + items.length + " photos, " +
        items.filter(function (x) { return x.state === "local"; }).length + " ready, " +
        items.filter(function (x) { return x.queued; }).length + " queued" +
        (camStream ? ", camera still open" : "") + (bkHold() ? ", waiting (PT screen open)" : "") + (cur && cur.prepping ? ", still preparing" : "") +
        ", store " + (bkR2() ? "Cloudflare" : "Supabase"));
    }, 180000);
  }
  // Connection back, or the app opened again: every photo waiting to retry goes now.
  function bkRetryNow() {
    var any = false;
    BK.forEach(function (y) { if (y.x.bk === "fail" && (y.x.tries || 0) < BK_TRIES) { y.x.bk = "wait"; any = true; } });
    if (any) bkPump();
  }
  window.addEventListener("online", function () { setTimeout(bkRetryNow, 2000); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") setTimeout(bkRetryNow, 2000); });
  function bkHold() { return !!camStream || !!(pt && pt.mode === "photos" && $("panel").open && (pt.sent || 0) < pt.items.length); }
  // Photos already up (before a reload) join the set too, so it's saved whole.
  function bkQueue(rowId, token, x) {
    if (x.queued) return;
    x.queued = true;
    x.path = bkPath(rowId, token, x.n);
    if (x.bk !== "done") x.bk = "wait";
    BK.push({ row: rowId, token: token, x: x }); bkPump();
  }
  function bkPump() {
    if (bkHold()) return;
    while (bkActive < (IS_IOS || bkSlow ? 1 : 2)) {
      var j = BK.filter(function (y) { return y.x.bk === "wait"; })[0]; if (!j) break;
      j.x.bk = "up"; bkActive++; bkUpload(j);
    }
  }
  async function bkUpload(j) {
    var x = j.x;
    try {
      var small = await bkSmall(x.file, /^r2:/.test(x.path));
      if (/^r2:/.test(x.path)) {
        var put = await timedFetch(await bkR2Url(j), { method: "PUT", body: small.blob, headers: { "Content-Type": "image/jpeg" } });
        x.bk = put.ok ? "done" : "fail";
        if (!put.ok) x.err = "Cloudflare refused (" + put.status + ")";
        if (put.status === 403) delete R2URLS[j.token];   // address too old: ask again
      } else {
        var up = await sb.storage.from("pt-photos").upload(x.path, small.blob, { contentType: "image/jpeg", cacheControl: BK_MARK[small.how] });
        x.bk = !up.error || /exist|duplicate/i.test(up.error.message || "") ? "done" : "fail";
        if (x.bk === "fail") x.err = "Supabase refused: " + (up.error.message || "");
      }
    } catch (e) { x.bk = "fail"; x.err = (e && e.message) || String(e); }
    bkActive--;
    if (x.bk === "done") { if (++bkOkRun >= 5) bkSlow = false; }
    if (x.bk === "fail") {
      x.tries = (x.tries || 0) + 1; bkOkRun = 0;
      if (isNetwork({ message: x.err })) bkSlow = true;
      if (x.tries < BK_TRIES) setTimeout(function () { if (x.bk === "fail") { x.bk = "wait"; bkPump(); } }, 1000 * BK_DELAYS[Math.min(x.tries - 1, BK_DELAYS.length - 1)]);
      // Told once per car: still trying, so the office knows why it's late.
      if (x.tries === BK_WARN_AT && !BK_WARNED[j.token]) { BK_WARNED[j.token] = true; bkReport(j.row, "copy delayed, still trying: " + x.err); }
    }
    var mine = BK.filter(function (y) { return y.token === j.token; });
    if (mine.length && mine.every(function (y) { return y.x.bk === "done" || (y.x.bk === "fail" && y.x.tries >= BK_TRIES); })) {
      BK = BK.filter(function (y) { return y.token !== j.token; });
      var paths = mine.filter(function (y) { return y.x.bk === "done"; }).map(function (y) { return y.x.path; });
      if (paths.length < mine.length) {
        var bad = mine.filter(function (y) { return y.x.bk !== "done"; })[0];
        bkReport(j.row, "copy failed: " + paths.length + " of " + mine.length + " photos saved; " + ((bad && bad.x.err) || "no reason given"));
      }
      bkSave(j.row, j.token, paths, paths.length === mine.length, 0);
    }
    bkPump();
  }
  // R2 upload addresses, asked for once per car (they last 15 minutes; asked
  // again after 10, or when one is missing or refused).
  var R2URLS = {};
  async function bkR2Url(j) {
    var name = j.x.path.split("/").pop(), c = R2URLS[j.token];
    if (!c || Date.now() - c.at > 10 * 60000) {
      var names = [name].concat(BK.filter(function (y) { return y.token === j.token && y.x.bk !== "done"; }).map(function (y) { return y.x.path.split("/").pop(); }).filter(function (n) { return n !== name; })).slice(0, 60);
      c = R2URLS[j.token] = { at: Date.now(), p: callFunction("pt-r2", { action: "upload", booking: j.row, token: j.token, names: names }, true).then(function (d) { return d.urls || {}; }) };
    }
    var urls;
    try { urls = await c.p; } catch (e) { if (R2URLS[j.token] === c) delete R2URLS[j.token]; throw e; }
    if (!urls[name]) { if (R2URLS[j.token] === c) delete R2URLS[j.token]; throw new Error("No upload address."); }
    return urls[name];
  }
  // The set is saved as one link; until that has worked the phone keeps its copy
  // (tried again a few times, then again next time the app opens).
  var BK_SAVED = {};
  async function bkSave(rowId, token, paths, allUp, tries) {
    if (paths.length) {
      var res; try { res = await sb.rpc("pt_link_save", { p_token: token, p_booking: rowId, p_paths: paths }); } catch (e) { res = { error: e }; }
      if (res.error) {
        if (tries < 5) setTimeout(function () { bkSave(rowId, token, paths, allUp, tries + 1); }, 5000 * Math.pow(2, tries));
        else bkReport(rowId, "copy uploaded but not saved: " + (res.error.message || res.error));
        return;
      }
    }
    if (allUp) BK_SAVED[token] = true;
    bkFinished(rowId, allUp);
  }
  // Everything for that car is up and saved: forget the phone's copy once all are sent too.
  async function bkFinished(rowId, allUp) {
    if (pt && pt.id === rowId) return ptStore();
    var rec = (await ptSaved()).filter(function (x) { return x.id === rowId; })[0];
    if (allUp && rec && rec.sent >= (rec.blobs || []).length) ptForget(rowId);
  }
  function bkPending(p) { return !BK_SAVED[p.token] || p.items.some(function (x) { return x.state === "local" && x.bk !== "done" && x.bk !== "skip"; }); }
  function ptBatch() {
    if (!pt) return null;
    var left = pt.items.slice(pt.sent || 0).filter(function (x) { return x.state === "local"; });
    if (!left.length) return null;
    return BIG_SHARE ? left : left.slice(0, PT_BATCH);
  }
  function ptShareLabel() {
    var b = ptBatch(), n = pt.items.length; if (!b) return "";
    if (b.length === n) return "SEND " + n + " PHOTO" + (n === 1 ? "" : "S");
    var from = (pt.sent || 0) + 1;
    return "SEND PHOTOS " + from + "–" + (from + b.length - 1) + " OF " + n;
  }
  function ptFiles(batch) {
    var reg = (pt.reg || "car").replace(/\s+/g, "");
    return batch.map(function (x) { return x.file instanceof File ? x.file : new File([x.file], reg + "-" + x.n + ".jpg", { type: x.file.type || "image/jpeg" }); });
  }
  // Photos only: text shared with photos lands on every one and stops WhatsApp
  // grouping them into an album. PT is ticked as the first photos go (the tick
  // is saved on the phone at once), and unticked if that first share is cancelled.
  async function ptShare(r, btn) {
    var batch = ptBatch(); if (!batch) return;
    var files = ptFiles(batch);
    try { await navigator.clipboard.writeText(ptCaption(r)); } catch (e) {}
    if (!navigator.canShare || !navigator.canShare({ files: files })) return toast("This phone can't pass photos to WhatsApp from the app. Send them from WhatsApp; the reg is copied.", true);
    btn.disabled = true;
    var row = S.rows.filter(function (x) { return x.id === r.id; })[0] || r, ticked = false;
    if (!row.pt_at) { tapPick(row, "pt"); ticked = true; }
    try { await navigator.share({ files: files }); }
    catch (e) {
      btn.disabled = false;
      if (ticked && !pt.sent && row.pt_at) tapPick(row, "pt");
      // Cancel is a person changing their mind, not the phone refusing the set.
      if (BIG_SHARE && batch.length > PT_BATCH && e.name !== "AbortError") { BIG_SHARE = false; toast("Too many photos in one go for this phone. Sending 10 at a time instead.", true); return openPt(r); }
      if (e.name !== "AbortError") toast("Couldn't open sharing: " + e.message, true);
      return;
    }
    pt.sent = (pt.sent || 0) + batch.length;
    if (pt.sent < pt.items.length) { ptStore(); toast(pt.sent + " of " + pt.items.length + " sent. Now the next ones."); return openPt(r); }
    if (bkPending(pt)) { ptStore(); bkWatch(pt.id, pt.token, pt); } else ptForget(pt.id);
    ptClear();
    toast(ptCaption(r) + ": all photos sent, PT done");
    $("panel").close();
  }

  // ── PT as one PDF ──
  // Every photo on its own page at 2000 px and 82%: sharp enough to zoom into
  // a scratch, about half the size of the photos as taken, so the PDF opens
  // quicker on WhatsApp. Made in the
  // background as soon as the photos are ready, because Chrome only lets a
  // page share within a few seconds of the tap. Android takes 50 MB in one
  // share, so a very big set becomes parts (each one tap).
  var PDF_PART_MAX = 45 * 1048576, PDF_MAX = 2000, PDF_Q = 0.82;
  function ptWantsPdf() { return ptMethod() === "pdf"; }
  function ptPdfState() {
    var n = pt.items.filter(function (x) { return x.state === "local"; }).length, P = pt.pdf;
    if (!P || P.count !== n) { ptPdfMake(pt); return { ready: false, label: ptPdfLabel(pt.pdfDone || 0, n) }; }
    if (P.error) return { failed: true };
    return { ready: true, label: P.parts.length === 1 ? "SEND AS ONE PDF (1 TAP)" : "SEND PDF PART " + ((P.sent || 0) + 1) + " OF " + P.parts.length };
  }
  // "Making the PDF… 12 of 33", so a big set doesn't look stuck.
  function ptPdfLabel(done, n) { return "Making the PDF… " + done + " of " + n; }
  async function ptPdfMake(cur) {
    var items = cur.items.filter(function (x) { return x.state === "local"; });
    if (cur.pdfMaking === items.length) return;
    cur.pdfMaking = items.length; cur.pdfDone = 0;
    var P = { count: items.length, parts: [], sent: cur.pdfSent || 0 };
    try {
      var jpgs = [];
      for (var i = 0; i < items.length; i++) {
        jpgs.push(await ptPdfItem(items[i]));
        if (cur.pdfMaking !== items.length) return;
        cur.pdfDone = i + 1;
        var btn = pt === cur && document.querySelector("#panelBody [data-ptpdf]");
        if (btn && btn.disabled) btn.textContent = ptPdfLabel(i + 1, items.length);
      }
      var group = [], size = 0;
      jpgs.forEach(function (j) { if (group.length && size + j.bytes.length > PDF_PART_MAX) { P.parts.push(group); group = []; size = 0; } group.push(j); size += j.bytes.length; });
      if (group.length) P.parts.push(group);
      var reg = (cur.reg || "car").replace(/\s+/g, "");
      P.parts = P.parts.map(function (g, k) {
        var name = reg + "-PT-" + items.length + "-photos" + (P.parts.length > 1 ? "-part" + (k + 1) : "") + ".pdf";
        return new File([ptPdfBlob(g, reg + " PT photos")], name, { type: "application/pdf" });
      });
      // A phone that can't hand a PDF to another app gets the photos way instead.
      if (!navigator.canShare || !navigator.canShare({ files: [P.parts[0]] })) P.error = true;
    } catch (e) { oopsLog(e); P.error = true; }
    if (pt !== cur || cur.pdfMaking !== items.length) return;
    cur.pdfMaking = 0; cur.pdf = P;
    if ($("panel").open && panelRow && panelRow.id === cur.id && !$("camVideo")) openPt(panelRow);
  }
  // Back in the app (from recent apps, a call, the screen going off): PT
  // carries on, and a PDF finished meanwhile shows its button.
  function ptWake() {
    var cur = pt, r = panelRow;
    if (!cur || !r || r.id !== cur.id || !$("panel").open || $("camVideo")) return;
    if (cur.mode !== "photos") ptPump(r);
    var b = $("panelBody").querySelector("[data-ptpdf]");
    if (b && b.disabled && cur.pdf && !cur.pdfMaking) openPt(r);
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") ptWake(); });
  window.addEventListener("focus", ptWake);
  // Each photo's PDF page is made once, and while the camera is still open
  // (one at a time, between shots), so Done has little left to do: 46 photos
  // took over a minute when all were made after Done (30 Sept).
  function ptPdfItem(x) {
    return x.pdfP || (x.pdfP = ptPdfJpeg(x.file).catch(function (e) { x.pdfP = null; throw e; }));
  }
  async function ptPdfWarm(cur) {
    if (!ptWantsPdf() || cur.pdfWarming) return;
    cur.pdfWarming = true;
    try {
      for (;;) {
        var next = cur.items.filter(function (x) { return x.state === "local" && !x.pdfP; })[0];
        if (!next || pt !== cur) break;
        try { await ptPdfItem(next); } catch (e) { break; }
        await new Promise(function (ok) { setTimeout(ok, 120); });   // let the camera have the phone
      }
    } finally { cur.pdfWarming = false; }
  }
  // The photo made PDF size; kept as it is when it's already small.
  async function ptPdfJpeg(b) {
    try {
      var im = await inTime(createImageBitmap(b), 8000), k = Math.min(1, PDF_MAX / Math.max(im.width, im.height));
      if (k === 1 && b.size < 700000) { if (im.close) im.close(); return await ptJpegBytes(b); }
      var c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); if (im.close) im.close();
      var j = await jpegOf(c, PDF_Q);
      c.width = c.height = 0;
      var bytes = new Uint8Array(await j.arrayBuffer()), d = jpegSize(bytes);
      if (d) return { bytes: bytes, w: d.w, h: d.h, c: d.c };
    } catch (e) {}
    return await ptJpegBytes(b);
  }
  // The photo as JPEG bytes with its size (anything else is turned into a JPEG).
  async function ptJpegBytes(b) {
    var bytes = new Uint8Array(await b.arrayBuffer()), d = jpegSize(bytes);
    if (d) return { bytes: bytes, w: d.w, h: d.h, c: d.c };
    var im = await inTime(createImageBitmap(b), 8000), c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    c.getContext("2d").drawImage(im, 0, 0); if (im.close) im.close();
    var j = await jpegOf(c, PT_Q);
    bytes = new Uint8Array(await j.arrayBuffer()); d = jpegSize(bytes);
    return { bytes: bytes, w: d.w, h: d.h, c: d.c };
  }
  function jpegSize(b) {
    if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
    for (var i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xFF) { i++; continue; }
      var m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { i += 2; continue; }
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], c: b[i + 9] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return null;
  }
  // A plain PDF: one A4-wide page per photo, the photo filling the page.
  function ptPdfBlob(jpgs, title) {
    var enc = new TextEncoder(), parts = [], pos = 0, offs = [], kids = [];
    function add(x) { var b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); pos += b.length; }
    function start(n) { offs[n] = pos; add(n + " 0 obj\n"); }
    add("%PDF-1.4\n");
    jpgs.forEach(function (j, i) {
      var page = 4 + i * 3, cont = page + 1, img = page + 2, W = 595, H = Math.round(595 * j.h / j.w);
      var cs = j.c === 1 ? "/DeviceGray" : j.c === 4 ? "/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]" : "/DeviceRGB";
      start(page); add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + W + " " + H + "] /Resources << /XObject << /Im0 " + img + " 0 R >> >> /Contents " + cont + " 0 R >>\nendobj\n");
      var body = "q " + W + " 0 0 " + H + " 0 0 cm /Im0 Do Q";
      start(cont); add("<< /Length " + body.length + " >>\nstream\n" + body + "\nendstream\nendobj\n");
      start(img); add("<< /Type /XObject /Subtype /Image /Width " + j.w + " /Height " + j.h + " /ColorSpace " + cs + " /BitsPerComponent 8 /Filter /DCTDecode /Length " + j.bytes.length + " >>\nstream\n");
      add(j.bytes); add("\nendstream\nendobj\n");
      kids.push(page + " 0 R");
    });
    start(1); add("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    start(2); add("<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + kids.length + " >>\nendobj\n");
    start(3); add("<< /Title (" + String(title).replace(/[()\\]/g, "") + ") /Producer (Parking Ops) >>\nendobj\n");
    var size = 4 + jpgs.length * 3, xref = pos, x = "xref\n0 " + size + "\n0000000000 65535 f \n";
    for (var n = 1; n < size; n++) x += String(offs[n]).padStart(10, "0") + " 00000 n \n";
    add(x + "trailer\n<< /Size " + size + " /Root 1 0 R /Info 3 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
    return new Blob(parts, { type: "application/pdf" });
  }
  async function ptSharePdf(r, btn) {
    var P = pt && pt.pdf; if (!P || P.error || !P.parts.length) return;
    var file = P.parts[P.sent || 0]; if (!file) return;
    var data = { files: [file], text: ptCaption(r) + (P.parts.length > 1 ? " (" + ((P.sent || 0) + 1) + " of " + P.parts.length + ")" : "") };
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) { P.error = true; toast("This phone can't pass a PDF to WhatsApp from the app. Send them as photos instead.", true); return openPt(r); }
    btn.disabled = true;
    var row = S.rows.filter(function (x) { return x.id === r.id; })[0] || r, ticked = false;
    if (!row.pt_at) { tapPick(row, "pt"); ticked = true; }
    try { await navigator.share(data); }
    catch (e) {
      btn.disabled = false;
      if (ticked && !P.sent && row.pt_at) tapPick(row, "pt");
      if (e.name !== "AbortError") toast("Couldn't open sharing: " + e.message, true);
      return;
    }
    P.sent = (P.sent || 0) + 1; pt.pdfSent = P.sent;
    if (P.sent < P.parts.length) { ptStore(); toast("Part " + P.sent + " of " + P.parts.length + " sent. Now the next part."); return openPt(r); }
    pt.sent = pt.items.length; pt.regSent = true;
    if (bkPending(pt)) { ptStore(); bkWatch(pt.id, pt.token, pt); } else ptForget(pt.id);
    ptClear();
    toast(ptCaption(r) + ": PDF sent, PT done");
    $("panel").close();
  }

  // Kept on the phone (IndexedDB) until every photo is sent: Android often
  // reloads the app while WhatsApp is open, and they'd be gone otherwise.
  var ptDbP = null, PT_KEEP_MS = 36 * 3600000;
  function ptDb() {
    return ptDbP || (ptDbP = new Promise(function (ok, no) {
      var q = indexedDB.open("takeoff-pt", 1);
      q.onupgradeneeded = function () { q.result.createObjectStore("pt", { keyPath: "id" }); };
      q.onsuccess = function () { ok(q.result); }; q.onerror = function () { no(q.error); };
    }));
  }
  async function ptStore() {
    if (!pt || pt.mode !== "photos") return;
    // Taken now, before anything can clear pt.
    var keep = pt.items.filter(function (x) { return x.state === "local"; });
    var rec = { id: pt.id, reg: pt.reg, at: Date.now(), regSent: !!pt.regSent, sent: pt.sent || 0, pdfSent: pt.pdfSent || 0, token: pt.token,
      blobs: keep.map(function (x) { return x.file; }), thumbs: keep.map(function (x) { return x.url || ""; }), bk: keep.map(function (x) { return x.bk === "done"; }) };
    try { (await ptDb()).transaction("pt", "readwrite").objectStore("pt").put(rec); } catch (e) {}
  }
  async function ptForget(id) { try { (await ptDb()).transaction("pt", "readwrite").objectStore("pt").delete(id); } catch (e) {} }
  async function ptSaved() {
    try {
      var db = await ptDb();
      return await new Promise(function (ok) { var q = db.transaction("pt").objectStore("pt").getAll(); q.onsuccess = function () { ok(q.result || []); }; q.onerror = function () { ok([]); }; });
    } catch (e) { return []; }
  }
  function ptRestore(rec) {
    ptClear();
    pt = { id: rec.id, reg: rec.reg, mode: "photos", token: rec.token || ptToken(), items: [], saved: 0, sent: rec.sent || 0, pdfSent: rec.pdfSent || 0, regSent: !!rec.regSent };
    (rec.blobs || []).forEach(function (b, i) { pt.items.push({ file: b, url: (rec.thumbs || [])[i] || "", state: "local", n: i + 1, ready: true, bk: (rec.bk || [])[i] ? "done" : undefined }); });
    bkQueueSet(pt.id, pt.token, pt.items);
  }
  // All sent but the app's copy didn't finish uploading before a reload: finish it quietly.
  function bkRestore(rec) {
    var token = rec.token; if (!token) return ptForget(rec.id);
    var items = (rec.blobs || []).map(function (b, i) { return { file: b, n: i + 1, bk: (rec.bk || [])[i] ? "done" : undefined }; });
    // All up already, but maybe not saved as a set before the reload: save it (saving twice is harmless).
    if (items.every(function (x) { return x.bk === "done"; })) {
      items.forEach(function (x) { x.path = bkPath(rec.id, token, x.n); });
      sb.rpc("pt_link_save", { p_token: token, p_booking: rec.id, p_paths: items.map(function (x) { return x.path; }) }).then(function (res) { if (!res.error) ptForget(rec.id); });
      return;
    }
    bkQueueSet(rec.id, token, items);
  }
  // Tapping PT on a car: carry on where it left off, or straight into the camera.
  async function ptStart(r) {
    companyFresh(true);
    if (!pt || pt.id !== r.id) {
      var rec = (await ptSaved()).filter(function (x) { return x.id === r.id && Date.now() - x.at < PT_KEEP_MS; })[0];
      if (rec && ptMethod() !== "link") ptRestore(rec);
    }
    openPt(r);
    if (!pt.items.length && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ptCamera(r);
  }
  // After a reload: open the PT that was half sent.
  async function ptResume() {
    var list = await ptSaved();
    list.forEach(function (x) { if (Date.now() - x.at >= PT_KEEP_MS) ptForget(x.id); });
    list = list.filter(function (x) { return Date.now() - x.at < PT_KEEP_MS && (x.blobs || []).length; });
    list.filter(function (x) { return x.sent >= x.blobs.length; }).forEach(bkRestore);
    var rec = list.filter(function (x) { return x.sent < x.blobs.length; })[0];
    var row = rec && S.rows.filter(function (x) { return x.id === rec.id; })[0];
    if (!row || pt || $("panel").open) return;
    ptRestore(rec); openPt(row);
    toast("Carrying on PT for " + ptCaption(row) + (rec.sent ? ": " + rec.sent + " of " + rec.blobs.length + " sent" : ""));
  }
  function tapPick(r, key, value) {
    var v = key === "intake" ? (r.intake === value ? "" : value) : key === "pt" ? (r.pt_at ? "" : "Done") : (r.pick_called === value ? "" : value);
    run("tap_pick", { p_booking: r.id, p_key: key, p_value: v }, r, function (x) {
      if (key === "intake") { x.intake = v; x.intake_at = v ? nowIso() : null; x.intake_by = v ? S.me.id : null; markBy(x, "intake_by"); }
      else if (key === "pt") { x.pt_at = v ? nowIso() : null; x.pt_by = v ? S.me.id : null; markBy(x, "pt_by"); }
      else { x.pick_called = v; x.pick_called_at = v ? nowIso() : null; }
    });
  }

