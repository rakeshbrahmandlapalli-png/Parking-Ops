  // ── archive (owner, manager, office) ──────
  function renderArchive() {
    if (!can("log")) return '<div class="msg">Only the office can open the archive.</div>';
    var A = S.arch || (S.arch = { q: "", results: null, days: null });
    if (!A.days) loadArchiveDays();
    var h = '<form class="box" id="archSearch" style="padding:14px;max-width:640px" novalidate><strong>Find a car on any day</strong><div style="height:8px"></div>' +
      '<div class="toolbar" style="margin:0"><input type="search" id="archQ" value="' + esc(A.q) + '" placeholder="e.g. AB12CDE or LFFLGT" autocomplete="off" style="flex:1 1 180px;min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:var(--r);font-size:16px">' +
      '<button class="btn small" id="archGo">Search</button></div></form>';
    if (A.results) {
      h += '<div class="section-label">' + (A.results.length ? A.results.length + (A.results.length === 50 ? "+" : "") + " found" : "Nothing found") + "</div>";
      if (A.results.length && opsDesk()) h += '<div class="box ops-tbl arch-tbl"><div class="ot-tr ot-th"><span>Registration</span><span>Customer</span><span>Reference</span><span>Board</span><span>Day</span><span>Time</span><span></span></div>' + A.results.map(function (r) {
        var sh = r.sheets || {}, kind = sh.kind || r.kind;
        return '<div class="ot-tr"><span><b>' + esc(r.reg || "NO REG") + "</b></span><span>" + esc(r.name || "(details removed)") + '</span><span class="num">' + esc(r.ref) + "</span><span>" + esc(String(kind || "").toUpperCase()) + "</span><span>" + esc(sh.day ? longDate(sh.day) + " " + sh.day.slice(0, 4) : "") +
          "</span><span>" + esc(r.kind === "picks" ? "drop-off " + hhmm(r.drop_at) : "back " + hhmm(r.return_at)) + '</span><span><button type="button" class="btn ghost small" data-archopen="' + r.sheet_id + '" data-archq="' + esc(r.reg || r.ref) + '">Open day</button></span></div>';
      }).join("") + "</div>";
      else if (A.results.length) h += '<div class="box">' + A.results.map(function (r) {
        var sh = r.sheets || {};
        return '<div class="rowline"><div class="grow"><strong>' + esc(r.reg || "NO REG") + "</strong> · " + esc(r.name || "(details removed)") + '<div class="note">' + esc(sheetLabel({ day: sh.day, kind: sh.kind || r.kind })) + " · " + esc(r.ref) +
          " · " + esc(r.kind === "picks" ? "drop-off " + hhmm(r.drop_at) : "back " + hhmm(r.return_at)) + '</div></div><button type="button" class="btn ghost small" data-archopen="' + r.sheet_id + '" data-archq="' + esc(r.reg || r.ref) + '">Open day</button></div>';
      }).join("") + "</div>";
    }
    var hand = (S.handArchived || []).slice().sort(function (a, b) { return a.day < b.day ? 1 : -1; });
    if (hand.length) {
      h += '<div class="section-label">Archived by hand</div><div class="box">' + hand.map(function (d) {
        return '<div class="rowline"><span class="grow">' + esc(sheetLabel(d)) + '</span><button type="button" class="btn ghost small" data-archopen="' + d.id + '">Open</button>' +
          (can("import") ? '<button type="button" class="btn ghost small" data-unarchive="' + d.id + '">Bring back</button>' : "") + "</div>";
      }).join("") + "</div>";
    }
    h += '<div class="section-label">Days older than ' + PICKER_DAYS + " days</div>";
    if (!A.days || A.daysState === "loading") h += '<div class="msg">Loading…</div>';
    else if (A.daysState === "fail") h += '<p class="note">Couldn\'t load the older days. <button type="button" class="link" data-archretry>Try again</button></p>';
    else if (!A.days.length) h += '<p class="note">None yet.</p>';
    else {
      var months = {};
      A.days.forEach(function (d) { (months[d.day.slice(0, 7)] = months[d.day.slice(0, 7)] || []).push(d); });
      h += Object.keys(months).sort().reverse().map(function (m) {
        return '<details class="box" style="margin-bottom:8px"><summary style="padding:12px;font-weight:700;cursor:pointer">' + new Date(m + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) +
          ' <span class="note">· ' + months[m].length + " sheets</span></summary>" + months[m].map(function (d) {
            return '<div class="rowline"><span class="grow">' + esc(sheetLabel(d)) + '</span><button type="button" class="btn ghost small" data-archopen="' + d.id + '">Open</button></div>';
          }).join("") + "</details>";
      }).join("");
    }
    return h;
  }
  async function loadArchiveDays() {
    S.arch.days = []; S.arch.daysState = "loading";
    var r = await sb.from("sheets").select("id, kind, day").lt("day", addDaysKey(londonParts(new Date()).key, -PICKER_DAYS)).order("day", { ascending: false }).order("kind").limit(2000);
    S.arch.days = r.error ? [] : r.data; S.arch.daysState = r.error ? "fail" : "ok";
    if (S.view === "archive") render();
  }
  async function searchArchive() {
    var raw = $("archQ").value.trim(), q = raw.replace(/[^A-Za-z0-9 '-]/g, "").trim(), tight = q.replace(/[\s'-]/g, "").toUpperCase();
    S.arch.q = raw;
    if (tight.length < 3) { toast("Type at least 3 letters or numbers.", true); return; }
    $("archGo").disabled = true;
    var r = await sb.from("bookings").select("id, sheet_id, kind, reg, name, ref, drop_at, return_at, sheets!bookings_sheet_id_fkey(day, kind)")
      .or('reg.ilike."%' + tight + '%",ref.ilike."%' + tight + '%",name.ilike."%' + q + '%"').order("updated_at", { ascending: false }).limit(50);
    if (r.error) { toast(r.error.message, true); $("archGo").disabled = false; return; }
    S.arch.results = r.data.sort(function (a, b) { return ((b.sheets || {}).day || "") < ((a.sheets || {}).day || "") ? -1 : 1; });
    render();
  }
  async function openArchived(sheetId, q) {
    var arch = null;
    if (!S.sheets.some(function (s) { return s.id === sheetId; })) {
      arch = (S.handArchived || []).filter(function (x) { return x.id === sheetId; })[0];
      if (!arch) {
        var r = await sb.from("sheets").select("id, kind, day, imported_at, source").eq("id", sheetId).maybeSingle();
        if (r.error || !r.data) { toast("Couldn't open that day.", true); return; }
        arch = r.data;
      }
    }
    if ($("menu").open) $("menu").close();
    return switchSheet(sheetId, { archive: arch, q: q || "", filter: "all", force: true });
  }
  async function archiveSheet(id, on) {
    var sh = S.sheets.concat(S.handArchived || [], S.archiveSheet ? [S.archiveSheet] : []).filter(function (x) { return x.id === id; })[0];
    if (!sh) return;
    if (on && !confirm("Archive " + sheetLabel(sh) + "? It leaves the list at the top and stays in Archive.")) return;
    if ($("menu").open) $("menu").close();
    var r = await sb.rpc("archive_sheet", { p_sheet: id, p_archive: on });
    if (r.error) { toast(/archive_sheet/.test(r.error.message) ? "Archiving needs database part 8 first." : r.error.message, true); return; }
    S.archiveSheet = null;
    if (S.arch) S.arch.days = null;
    await loadSheets();
    if (on) { S.sheetId = null; pickDefaultSheet(); await loadRows(); S.view = "board"; }
    else { S.sheetId = id; await loadRows(); }
    render(); toast(sheetLabel(sh) + (on ? " archived" : " is back in the list"));
  }
  async function deleteSheet(id) {
    var sh = S.sheets.concat(S.handArchived || [], S.archiveSheet ? [S.archiveSheet] : []).filter(function (x) { return x.id === id; })[0];
    if (!sh) return;
    var cars = sh.id === S.sheetId ? S.rows.length : null;
    if (!confirm("Delete " + sheetLabel(sh) + (cars !== null ? " and its " + cars + " car(s)" : "") + "?\n\nThis can't be undone. It only works if nobody has tapped, set a yard or typed a note on it.")) return;
    if ($("menu").open) $("menu").close();
    var r = await sb.rpc("delete_sheet", { p_sheet: id });
    if (r.error) { toast(/delete_sheet/.test(r.error.message) ? "Deleting needs database part 8 first." : r.error.message, true); return; }
    if (S.archiveSheet && S.archiveSheet.id === id) S.archiveSheet = null;
    if (S.arch) S.arch.days = null;
    await loadSheets();
    S.sheetId = null; pickDefaultSheet(); await loadRows(); S.view = "board";
    render(); toast(sheetLabel(sh) + " deleted");
  }

  // ── settings (owner and manager) ─────────
  // Flight check timings. The database refuses anything not offered here.
  var TIMING_DEFAULT = { enabled: true, live_every_min: 30, schedule_every_hours: 2, active_from: 6, active_to: 24, before_min: 90, after_hours: 5 };
  function timing() { return Object.assign({}, TIMING_DEFAULT, (S.company && S.company.flight_settings) || {}); }
  function hourName(h) { return h === 24 ? "Midnight (end of day)" : pad(h) + ":00"; }
  function renderSettings() {
    if (!can("settings")) return '<div class="msg">Only an owner or manager can change settings.</div>';
    var T = S.settingsDraft || (S.settingsDraft = timing());
    function sel(key, opts, label) {
      return '<label class="field">' + label + '<select data-setting="' + key + '">' + opts.map(function (o) {
        return '<option value="' + o[0] + '"' + (String(T[key]) === String(o[0]) ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("") + "</select></label>";
    }
    // Operations: shorter words, so two boxes fit side by side; a note when there are unsaved changes.
    var o = isOps(), base = timing(), dirty = o && Object.keys(T).some(function (k) { return String(T[k]) !== String(base[k]); });
    var hrs = []; for (var h = 0; h <= 24; h++) hrs.push([h, o && h === 24 ? "Midnight" : hourName(h)]);
    // Operations Refined says it in the Flight checks box itself, beside its Save.
    // Looks with features (Operations Refined aside, which says it in each box): a bar names what isn't saved yet.
    var rf = isRefined(), unsaved = hasFeatures() && !rf ? '<div id="setUnsaved" class="setdirty' + (o ? " ops-unsaved" : "") + '"' + (flightsDirty() ? "" : " hidden") + "><span>Unsaved changes" + (flightsDirty() ? " in Flight checks" : "") + '</span><button type="button" class="btn small" data-savedirty>Save changes</button></div>' : "";
    var flights = setBox("flights", "Flight checks", "Automatic checks " + (String(T.enabled) === "false" ? "off" : "on"), '<div class="box fchecks" style="padding:14px;margin-top:14px;max-width:560px">',
      (o ? '<p class="note">Set when to check live landing times.</p>' : "") +
      sel("enabled", [["true", "On"], ["false", o ? "Off" : "Off: no automatic checks"]], "Automatic checks") +
      (String(T.enabled) === "false" ? "" :
        '<div class="section-label">Live landing times (FlightRadar24)</div>' +
        sel("live_every_min", [[10, "Every 10 minutes"], [15, "Every 15 minutes"], [20, "Every 20 minutes"], [30, "Every 30 minutes"], [45, "Every 45 minutes"], [60, "Every hour"], [90, "Every 90 minutes"], [120, "Every 2 hours"]].map(function (x) { return o ? [x[0], x[1].replace("Every ", "").replace("minutes", "min").replace(/^hour$/, "1 hour")] : x; }), "Check every") +
        '<div class="pair">' + sel("active_from", hrs.slice(0, 24), "From") + sel("active_to", hrs.slice(1), "Until") + "</div>" +
        sel("before_min", o ? [[30, "30 min before"], [60, "1 hour before"], [90, "90 min before"], [120, "2 hours before"], [180, "3 hours before"], [240, "4 hours before"]]
          : [[30, "30 minutes before landing"], [60, "1 hour before"], [90, "90 minutes before"], [120, "2 hours before"], [180, "3 hours before"], [240, "4 hours before"]], o ? "Start watching" : "Start watching a flight") +
        sel("after_hours", [[1, "1 hour after its time"], [2, "2 hours after"], [3, "3 hours after"], [4, "4 hours after"], [5, "5 hours after"], [6, "6 hours after"]].map(function (x) { return o && x[0] === 1 ? [1, "1 hour after"] : x; }), o ? "Stop watching" : "Give up on a flight not seen")) +
      '<div class="row-actions">' + (rf ? '<span class="rf-dirty" role="status">' + (dirty ? "Unsaved changes" : "") + "</span>" : "") + '<button type="button" class="btn ghost" data-resetsettings>' + (o ? "Restore defaults" : "Back to defaults") + '</button><button type="button" class="btn brand" data-savesettings>' + (o ? "Save flight settings" : "Save") + "</button></div>", "fchecks");
    var cap = capacityHtml(), disc = discordHtml(), ptn = ptNumberHtml(), ovr = overstayRateHtml(), ycol = yardColoursHtml(), exit = exitFeeHtml(), bsite = bookingSiteHtml(), txt = textsHtml(), cls = callsHtml(), oph = officePhoneHtml(), back = backupHtml();
    if (!opsDesk() && !rf) return unsaved + cap + flights + disc + ptn + ovr + ycol + exit + bsite + txt + cls + oph + back;
    // A wide screen: the same boxes in groups, with a list of them on the left.
    var groups = [["parking", "Parking & yards", cap + ycol, "Parking"], ["flights", "Flight checks", flights, "Flights"], ["charges", "Exit fees & charges", exit + ovr, "Charges"],
      ["alerts", "Alerts & photos", disc + ptn, "Alerts"], ["texts", "Customer texts", txt, "Texts"], ["calls", "Calls & office phone", cls + oph, "Calls"], ["bookings", "Booking website", bsite, "Booking website"], ["data", "Backup", back, "Backup"]].filter(function (g) { return g[2]; });
    // Operations Refined on a phone or tablet: the sections as tabs, one open at a time
    // (the others stay on the page, hidden, so nothing typed is lost by switching).
    if (!opsDesk()) {
      var cur = groups.some(function (g) { return g[0] === S.setTab; }) ? S.setTab : groups[0][0];
      return unsaved + '<div class="set-tabs" role="tablist" aria-label="Settings sections">' + groups.map(function (g) {
        return '<button type="button" role="tab" id="settab-' + g[0] + '" data-settab="' + g[0] + '" aria-controls="set-' + g[0] + '" aria-selected="' + (g[0] === cur) + '">' + esc(g[3]) + "</button>";
      }).join("") + "</div>" + groups.map(function (g) {
        return '<section class="set-group" id="set-' + g[0] + '" role="tabpanel" aria-labelledby="settab-' + g[0] + '"' + (g[0] === cur ? "" : " hidden") + ">" + g[2] + "</section>";
      }).join("") +
        // Under the open section, the others in a line each with what they're set to; a tap opens one.
        '<div class="set-more">' + groups.map(function (g) {
          var c = S.company || {}, what = {
            parking: [c.capacity ? c.capacity + " spaces" : "", (c.yards || []).length ? c.yards.length + " yards" : ""],
            flights: ["Automatic checks " + (String(T.enabled) === "false" ? "off" : "on")],
            texts: [textsOn() ? "On" : "Off"],
            calls: [callsOn() ? "On" : "Off"],
            charges: [exitFee() > 0 ? "Exit fee " + money(exitFee()) : "", +c.overstay_rate ? money(c.overstay_rate) + " a day" : ""]
          }[g[0]] || [];
          return '<button type="button" data-settab="' + g[0] + '"' + (g[0] === cur ? " hidden" : "") + "><b>" + esc(g[1]) + "</b><small>" + esc(what.filter(Boolean).join(" · ")) + "</small></button>";
        }).join("") + "</div>";
    }
    return unsaved + '<div class="set-desk"><nav class="set-nav" aria-label="Settings sections">' + groups.map(function (g) { return '<button type="button" data-setgo="' + g[0] + '">' + esc(g[1]) + "</button>"; }).join("") + "</nav>" +
      '<div class="set-body">' + groups.map(function (g) { return '<section class="set-group" id="set-' + g[0] + '" aria-labelledby="set-' + g[0] + '-h"><h2 class="set-gh" id="set-' + g[0] + '-h">' + esc(g[1]) + "</h2>" + g[2] + "</section>"; }).join("") + "</div></div>";
  }
  // A settings box's title; Operations adds what it's set to on the right.
  function boxTitle(t, aside) { return "<strong>" + esc(t) + (isOps() && aside ? "<small>" + esc(aside) + "</small>" : "") + "</strong>"; }
  // A settings section. Looks with features on a phone (not Operations Refined,
  // which has tabs, nor the Operations desktop, which has groups): a header (title,
  // what it's set to) that opens it, one at a time. Those two keep their boxes,
  // marked so unsaved changes are noticed. Other looks: the box exactly as before.
  function setFold() { return hasFeatures() && !opsDesk() && !isRefined(); }
  function setBox(key, title, aside, open0, inner, cls) {
    if (!hasFeatures()) return open0 + boxTitle(title, aside) + inner + "</div>";
    if (!setFold()) return open0.replace('<div class="box', '<div data-sec="' + key + '" data-title="' + esc(title) + '" class="box') + boxTitle(title, aside) + inner + "</div>";
    var open = S.setOpen === key;
    return '<section class="box setsec' + (cls ? " " + cls : "") + (open ? " open" : "") + '" data-sec="' + key + '" data-title="' + esc(title) + '">' +
      '<button type="button" class="sethead" data-setsec="' + key + '" aria-expanded="' + open + '"><b>' + esc(title) + "</b><small>" + esc(aside || "") + "</small></button>" +
      '<div class="setbody"' + (open ? "" : " hidden") + ">" + inner + "</div></section>";
  }
  // Unsaved changes: the flight checks draft, or a field typed in and not saved.
  function flightsDirty() { var T = S.settingsDraft, base = timing(); return !!T && Object.keys(T).some(function (k) { return String(T[k]) !== String(base[k]); }); }
  function setFields(sec) { return Array.prototype.slice.call(sec.querySelectorAll("input:not([type=file]):not([type=checkbox]):not([data-nodirty]),textarea")); }
  function fieldEdited(el) {
    if (el.dataset.ycol !== undefined) return el.hasAttribute("data-off") !== el.hasAttribute("data-offdef") || (!el.hasAttribute("data-off") && el.value.toLowerCase() !== el.defaultValue.toLowerCase());
    return el.value !== el.defaultValue;
  }
  function secDirty(sec) { return sec.dataset.sec === "flights" ? flightsDirty() : setFields(sec).some(fieldEdited); }
  function dirtySecs() {
    if (S.view !== "settings" || !hasFeatures()) return [];
    return Array.prototype.filter.call(document.querySelectorAll("#main [data-sec]"), secDirty);
  }
  // Back to what's saved: the fields as they were drawn.
  function discardSec(sec) {
    if (sec.dataset.sec === "flights") S.settingsDraft = null;
    setFields(sec).forEach(function (el) { el.value = el.defaultValue; if (el.dataset.ycol !== undefined) el.toggleAttribute("data-off", el.hasAttribute("data-offdef")); });
  }
  // Saved: the section's fields (on the page now; it may have been redrawn while saving) start again from what's saved.
  function savedSec(btn) { var s0 = btn.closest("[data-sec]"), sec = s0 && document.querySelector('#main [data-sec="' + s0.dataset.sec + '"]'); if (sec) discardSec(sec); }
  function showUnsaved() {
    var bar = $("setUnsaved"); if (!bar) return;
    var d = dirtySecs();
    bar.hidden = !d.length;
    if (d.length) bar.firstChild.textContent = "Unsaved changes in " + d.map(function (s) { return s.dataset.title; }).join(", ");
  }
  // Leaving Settings (or closing a section) with something not saved asks first.
  function leaveOk(secs) {
    var d = secs || dirtySecs();
    return !d.length || confirm("Unsaved changes in " + d.map(function (s) { return s.dataset.title; }).join(", ") + ". Leave without saving?");
  }
  function toggleSec(key) {
    var cur = S.setOpen && document.querySelector('#main [data-sec="' + S.setOpen + '"]');
    if (cur && secDirty(cur)) { if (!leaveOk([cur])) return; discardSec(cur); }
    S.setOpen = S.setOpen === key ? null : key; render();
    var h = document.querySelector('#main [data-setsec="' + key + '"]'); if (h && h.getBoundingClientRect().top < 0) h.scrollIntoView();
  }
  // A redraw while a field is being typed in (a live update) keeps what was typed.
  function setEdits() {
    var out = [];
    document.querySelectorAll("#main [data-sec]").forEach(function (sec) {
      setFields(sec).forEach(function (el, i) { if (fieldEdited(el)) out.push({ sec: sec.dataset.sec, i: i, def: el.defaultValue, val: el.value, off: el.hasAttribute("data-off") }); });
    });
    return out;
  }
  function settingsDrawn(keep) {
    (keep || []).forEach(function (k) {
      var sec = document.querySelector('#main [data-sec="' + k.sec + '"]'), el = sec && setFields(sec)[k.i];
      if (!el || el.defaultValue !== k.def) return;
      el.value = k.val;
      if (el.dataset.ycol !== undefined) { if (k.off) yardOff(el); else el.dispatchEvent(new Event("input", { bubbles: true })); }
    });
    showUnsaved();
  }
  // Car park capacity (database part 71): how many cars fit, in all and per
  // yard. The dashboard shows Parked now against it.
  function capacityHtml() {
    var C = S.company || {}, cap = +C.capacity || 0, yc = C.yard_capacity || {}, ys = C.yards || [];
    return setBox("cap", "Car park capacity", cap ? cap + " spaces" : "Not set", '<div class="box" style="padding:14px;max-width:560px">',
      '<p class="note">How many cars you can park. Now: <b>' + (cap ? cap + " cars" : "not set") + "</b>.</p>" +
      '<label class="field">Total spaces<input id="capTotal" type="number" inputmode="numeric" min="0" step="1" placeholder="e.g. 400" value="' + (cap || "") + '"></label>' +
      (ys.length ? '<div class="section-label">Per yard (optional)</div><div class="capyards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:0 10px">' + ys.map(function (y) {
        return '<label class="field">' + esc(YARD_LABEL[y] || y) + '<input data-capyard="' + esc(y) + '" type="number" inputmode="numeric" min="0" step="1" value="' + (+yc[y] || "") + '"></label>';
      }).join("") + "</div>" : "") +
      '<div class="row-actions"><button type="button" class="btn brand" data-savecap>Save capacity</button></div>');
  }
  async function saveCapacity(btn) {
    var yards = {}, bad = "";
    document.querySelectorAll("[data-capyard]").forEach(function (i) { var v = i.value.trim(); if (v && !/^\d+$/.test(v)) bad = i.dataset.capyard; yards[i.dataset.capyard] = v; });
    var t = $("capTotal").value.trim();
    if (bad || (t && !/^\d+$/.test(t))) return toast("Enter whole numbers of spaces.", true);
    btn.disabled = true;
    var r = await sb.rpc("set_capacity", { p_total: t ? +t : null, p_yards: yards });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.capacity = r.data.capacity; S.company.yard_capacity = r.data.yard_capacity || {}; S.dash = null;
    toast(r.data.capacity ? "Saved: " + r.data.capacity + " spaces" : "Capacity cleared"); render();
  }
  // Operations dashboard panels fold open and closed; each person's choice is kept on their phone.
  function foldIsOpen(id) { try { var m = JSON.parse(localStorage.getItem("takeoff_dash_fold") || "{}"); return m[id] !== false; } catch (e) { return true; } }
  function foldSave(id, open) { try { var m = JSON.parse(localStorage.getItem("takeoff_dash_fold") || "{}"); m[id] = !!open; localStorage.setItem("takeoff_dash_fold", JSON.stringify(m)); } catch (e) {} }
  function foldOpen(id, title, note, summary, attrs, cls) {
    return '<details class="ops-panel ops-fold' + (cls ? " " + cls : "") + '" data-fold="' + id + '"' + (attrs ? " " + attrs : "") + (foldIsOpen(id) ? " open" : "") + '><summary class="ops-panelhead"><span class="ops-foldtitle"><strong>' + title + "</strong>" + (note ? "<small>" + note + "</small>" : "") + '</span><span class="ops-foldsum">' + summary + '</span><i class="ops-chev" aria-hidden="true"></i></summary><div class="ops-foldbody">';
  }
  var FOLD_END = "</div></details>";
  document.addEventListener("toggle", function (e) { var d = e.target; if (d && d.dataset && d.dataset.fold) foldSave(d.dataset.fold, d.open); }, true);
  // Cars on site per day (database part 82): counted by the app from its own cars, against capacity.
  function onsiteSummary(D) {
    var r = (D.onsite || [])[0], cap = +S.company.capacity || 0;
    return r ? "Tonight " + r.here + (cap ? " of " + cap : "") : "";
  }
  function bookedBody(D, PK) {
    var rows = (D.onsite || []).slice(0, 14), cap = +S.company.capacity || 0, today = currentShiftKey();
    var k0 = function (k) { return k === today ? "Today" : k === addDaysKey(today, 1) ? "Tomorrow" : longDay(k); };
    if (!rows.length) return '<div class="empty">No cars yet.</div>';
    var max = Math.max.apply(null, rows.map(function (r) { return +r.here || 0; }).concat([cap, 1])), peak = rows[0];
    rows.forEach(function (r) { if (r.here > peak.here) peak = r; });
    var h = '<div class="booked-top"><span>Busiest: <b>' + esc(k0(peak.day)) + "</b> " + peak.here + (cap ? " of " + cap : "") + "</span><span>Cars staying the night</span></div>";
    h += '<div class="booked-rows">' + rows.map(function (r) {
      var n = +r.here || 0, pct = Math.round(n / max * 100), lvl = !cap ? "" : n > cap ? " over" : n >= cap * 0.9 ? " near" : "";
      var note = cap ? (n > cap ? (n - cap) + " over" : (cap - n) + " free") : "";
      return '<div class="booked-row' + lvl + '"><span class="booked-day">' + esc(k0(r.day)) + '</span><span class="booked-bar" role="img" aria-label="' + n + (cap ? " of " + cap : "") + '"><i style="width:' + pct + '%"></i>' + (cap && cap < max ? '<u style="left:' + Math.round(cap / max * 100) + '%"></u>' : "") + '</span><strong class="num">' + n + "</strong><small>" + note + '</small><em class="booked-flow">+' + (+r.in || 0) + " in · " + (+r.out || 0) + " out</em></div>";
    }).join("") + "</div>";
    return h + '<p class="note">Counted from the bookings in the app. Later days fill in as their bookings are imported.</p>';
  }
  function overstayRateHtml() {
    var rate = +(S.company && S.company.overstay_rate) || 0;
    return setBox("overstay", "Overstay charges", rate ? money(rate) + " a day" : "Off", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<p class="note">Booked back before ' + esc(((S.company.drops_day_end) || "06:00").slice(0, 5)) + ": free until 12:00 that day, then one day's rate and one more every midnight. Booked back later: free until " + esc(((S.company.drops_day_end) || "06:00").slice(0, 5)) + " the next morning, then one day's rate and one more every morning at that time. 0 switches charging off." + (rate ? " Now: <b>" + money(rate) + " a day</b>." : " Now: <b>off</b>.") + "</p>" +
      '<label class="field">Daily rate (£)<input id="ovRate" type="number" inputmode="decimal" min="0" step="0.5" value="' + rate + '"></label>' +
      '<div class="row-actions"><button type="button" class="btn brand" data-saverate>Save rate</button></div>');
  }
  // Yard colours (database part 77): owners only.
  function yardColoursHtml() {
    var ys = (S.company && S.company.yards) || [];
    if (!S.me || S.me.role !== "owner" || !ys.length) return "";
    var set = ys.filter(function (y) { return yardColour(y); }).length;
    return setBox("ycol", "Yard colours", set ? set + " of " + ys.length + " set" : "Not set", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<div class="ycols">' + ys.map(function (y) {
        var c = yardColour(y);
        return '<div class="ycol"><span class="code ' + esc(y) + '">' + esc(YARD_LABEL[y] || y) + '</span><input type="color" data-ycol="' + esc(y) + '" aria-label="Colour for ' + esc(YARD_LABEL[y] || y) + '" value="' + (c || "#9AA0A6") + '"' + (c ? "" : " data-off" + (hasFeatures() ? " data-offdef" : "")) + '>' +
          (c ? '<button type="button" class="link" data-ycoff="' + esc(y) + '">No colour</button>' : '<span class="note">Not set</span>') + "</div>";
      }).join("") + "</div>" +
      '<div class="row-actions"><button type="button" class="btn brand" data-saveycol>Save colours</button></div>');
  }
  // "No colour": the yard's tag goes back to the look's own.
  function yardOff(yi) {
    yi.setAttribute("data-off", "");
    var yt = yi.parentNode.querySelector(".code"); if (yt) yt.removeAttribute("style");
    var b = yi.parentNode.querySelector("[data-ycoff]"); if (b) b.outerHTML = '<span class="note">Not set</span>';
  }
  async function saveYardColours(btn) {
    var cols = {};
    document.querySelectorAll("[data-ycol]").forEach(function (i) { cols[i.dataset.ycol] = i.hasAttribute("data-off") ? "" : i.value; });
    btn.disabled = true;
    var r = await sb.rpc("set_yard_colours", { p_colours: cols });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.yard_colours = r.data.yard_colours || {}; applyYardColours(S.company);
    toast("Saved: yard colours"); render();
  }
  // Exit fee (database part 76): owners only.
  function exitFeeHtml() {
    if (!S.me || S.me.role !== "owner") return "";
    var fee = exitFee(), free = S.company.exit_free || [];
    return setBox("exit", "Exit fee", fee ? money(fee) : "Off", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<label class="field">Exit fee (£)<input id="exitFee" type="number" inputmode="decimal" min="0" max="999" step="0.01" placeholder="0 = off" value="' + (fee || "") + '"></label>' +
      '<label class="field">No exit fee for references starting with<input id="exitFree" autocomplete="off" autocapitalize="characters" placeholder="e.g. CAP, APD, VIP APB-1147" value="' + esc(free.join(", ")) + '"></label>' +
      '<p class="note">Agent codes or whole references, separated by commas.</p>' +
      '<div class="row-actions"><button type="button" class="btn brand" data-saveexit>Save exit fee</button></div>');
  }
  async function saveExitFee(btn) {
    var fee = $("exitFee").value.trim(), free = $("exitFree").value.split(/[,\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (fee && !(+fee >= 0)) return toast("Check the exit fee.", true);
    btn.disabled = true;
    var r = await sb.rpc("set_exit_fee", { p_fee: +fee || 0, p_free: free });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.exit_fee = r.data.exit_fee; S.company.exit_free = r.data.exit_free || [];
    toast(+r.data.exit_fee ? "Saved: exit fee " + money(r.data.exit_fee) : "Exit fee off"); render();
  }
  async function saveOverstayRate(btn) {
    btn.disabled = true;
    var r = await sb.rpc("set_overstay_rate", { p_rate: parseFloat($("ovRate").value) || 0 });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.overstay_rate = r.data; toast(r.data ? "Saved: " + money(r.data) + " a day" : "Overstay charges off"); render();
  }
  // Owner only: the company's own data, to keep a copy outside the app.
  function backupHtml() {
    if (!S.me || S.me.role !== "owner") return "";
    return setBox("backup", "Backup", "Download a copy", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<p class="note">A copy of everything is kept automatically every night for 7 days. To keep one of your own as well, download it and save it somewhere safe, like OneDrive. PINs, links and Discord links are not included.</p>' +
      '<div class="row-actions"><button type="button" class="btn ghost" data-backup>Download a backup</button></div>');
  }
  // Booking website (database part 101): owners only. The address and login the automatic
  // import signs in with; the password is never sent back, only whether one is saved.
  function bookingSiteHtml() {
    if (!S.me || S.me.role !== "owner") return "";
    if (S.bsite === undefined) { S.bsite = null; sb.rpc("booking_site_status").then(function (r) { S.bsite = r.error ? false : r.data; if (S.view === "settings") render(); }); }
    if (S.bsite === false) return "";
    var B = S.bsite || {}, set = !!(B.login && B.has_pass);
    return setBox("bsite", "Booking website", !S.bsite ? "" : set ? "Saved" : "Not set", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<label class="field">Website address<input id="bsUrl" type="url" autocomplete="off" placeholder="https://" value="' + esc(B.url || "") + '"></label>' +
      '<label class="field">Login name<input id="bsLogin" autocomplete="off" autocapitalize="none" spellcheck="false" value="' + esc(B.login || "") + '"></label>' +
      '<label class="field">Password <span class="note">' + (S.bsite ? (B.has_pass ? "✓ saved" : "not set") : "…") + '</span><input id="bsPass" type="password" autocomplete="new-password" placeholder="' + (B.has_pass ? "Type a new one to replace it" : "") + '"></label>' +
      (set && B.saved_at ? '<p class="note">Saved by ' + esc(B.saved_by) + " " + esc(dayShort(B.saved_at)) + " " + esc(hhmm(B.saved_at)) + ".</p>" : "") +
      '<div class="row-actions">' + (set ? '<button type="button" class="btn ghost small" data-bsclear>Remove login</button>' : "") + '<button type="button" class="btn brand" data-bssave>Save login</button></div>');
  }
  async function saveBookingSite(btn, clear) {
    var u = clear ? "" : $("bsUrl").value.trim(), l = clear ? "" : $("bsLogin").value.trim(), p = clear ? "" : ($("bsPass").value || null);
    btn.disabled = true;
    var r = await sb.rpc("booking_site_set", { p_url: u, p_login: l, p_password: p });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.bsite = r.data; toast(clear ? "Booking website login removed" : "Saved: booking website login"); render();
  }
  async function downloadBackup(btn) {
    btn.disabled = true;
    var r = await sb.rpc("download_my_company");
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    var blob = new Blob([JSON.stringify(r.data)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (S.company.slug || "company") + "-backup-" + londonParts(new Date()).key + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    S.lastDownload = new Date().toISOString(); if (S.view === "board") render();
    toast("Backup downloaded: " + (r.data.bookings || []).length + " cars. Save it somewhere safe, like OneDrive.");
  }
  function ptNumberHtml() {
    var n = (S.company && S.company.pt_whatsapp) || "";
    return setBox("pt", "PT photos: WhatsApp number", n ? "+" + n : "Not set", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      '<p class="note">PT opens this chat with the reg typed, before the photos are sent.' + (n ? " Now: <b>+" + esc(n) + "</b>" : " Not set.") + "</p>" +
      '<label class="field">Number<input id="ptNumber" type="tel" autocomplete="off" placeholder="07932 029349 or +44 7932 029349" value="' + esc(n ? "+" + n : "") + '"></label>' +
      '<div class="row-actions"><button type="button" class="btn brand" data-savept>Save number</button></div>' +
      '<label class="field" style="margin-top:14px">How PT gets the photos<select data-ptmethod>' +
      '<option value="photos"' + (S.company.pt_method !== "link" && S.company.pt_method !== "pdf" ? " selected" : "") + ">In the WhatsApp chat: reg, then the photos (10 at a time on Android)</option>" +
      '<option value="pdf"' + (S.company.pt_method === "pdf" ? " selected" : "") + ">As one PDF with all the photos (one tap)</option>" +
      '<option value="link"' + (S.company.pt_method === "link" ? " selected" : "") + ">As one link to all the photos (only once PT has agreed)</option></select></label>" +
      ptIosSelect(S.company.pt_method_ios || S.company.pt_method));
  }
  // iPhones have their own choice (part 49); the one above is for every other phone.
  function ptIosSelect(now) {
    function o(v, t) { return '<option value="' + v + '"' + (now === v || (v === "photos" && now !== "pdf" && now !== "link") ? " selected" : "") + ">" + t + "</option>"; }
    return '<label class="field" style="margin-top:14px">How PT gets the photos on iPhones<select data-ptmethod="ios">' +
      o("photos", "In the WhatsApp chat: reg, then the photos") + o("pdf", "As one PDF with all the photos (one tap)") +
      o("link", "As one link to all the photos (only once PT has agreed)") + "</select></label>";
  }
  async function savePtMethod(sel) {
    var ios = sel.dataset.ptmethod === "ios";
    var r = await sb.rpc(ios ? "set_pt_method_ios" : "set_pt_method", { p_method: sel.value });
    if (r.error) { toast(r.error.message, true); return render(); }
    S.company[ios ? "pt_method_ios" : "pt_method"] = r.data;
    toast((ios ? "iPhones: " : "") + (r.data === "link" ? "PT photos now go as a link" : r.data === "pdf" ? "PT photos now go as one PDF" : "PT photos now go in the WhatsApp chat"));
  }
  async function savePtNumber(btn) {
    btn.disabled = true;
    var r = await sb.rpc("set_pt_whatsapp", { p_number: $("ptNumber").value });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    savedSec(btn); S.company.pt_whatsapp = r.data || "";
    toast(r.data ? "Saved: +" + r.data : "Number removed"); render();
  }
  // Discord links work like passwords for the channel, so the app never shows
  // them back: it only knows whether each one is set.
  function discordHtml() {
    if (S.discord === undefined) { S.discord = null; sb.rpc("discord_status").then(function (r) { S.discord = r.error ? false : r.data; if (S.view === "settings") render(); }); }
    if (S.discord === false) return "";
    var D = S.discord || {};
    function field(key, label) {
      return '<label class="field">' + label + ' <span class="note">' + (S.discord ? (D[key] ? "✓ set" : "not set") : "…") + '</span><input data-discord="' + key + '" type="url" autocomplete="off" placeholder="' + (D[key] ? "Paste a new link to replace it" : "https://discord.com/api/webhooks/…") + '"></label>';
    }
    return setBox("discord", "Discord alerts", !S.discord ? "" : D.drops || D.picks ? [D.drops && "Drops", D.picks && "Picks"].filter(Boolean).join(" and ") + " set" : "Not set", '<div class="box" style="padding:14px;margin-top:14px;max-width:560px">',
      field("drops", "DROPS channel") + field("picks", "PICKS channel") +
      '<div class="row-actions">' + (D.drops || D.picks ? '<button type="button" class="btn ghost small" data-discordtest>Send a test to Discord</button><button type="button" class="btn ghost small" data-discordclear>Remove both</button>' : "") +
      '<button type="button" class="btn brand" data-discordsave>Save links</button></div>');
  }
  async function saveDiscord(btn, clear) {
    var d = clear ? "" : (document.querySelector('[data-discord="drops"]').value.trim() || null);
    var p = clear ? "" : (document.querySelector('[data-discord="picks"]').value.trim() || null);
    if (!clear && d === null && p === null) { toast("Paste a Discord link first.", true); return; }
    btn.disabled = true;
    var r = await sb.rpc("set_discord", { p_drops: d, p_picks: p });
    btn.disabled = false;
    if (r.error) { toast(r.error.message, true); return; }
    savedSec(btn); S.discord = r.data; toast(clear ? "Discord links removed" : "Saved"); render();
  }
  async function saveSettings(btn) {
    var T = S.settingsDraft; btn.disabled = true;
    var body = { enabled: String(T.enabled) !== "false" };
    ["live_every_min", "schedule_every_hours", "active_from", "active_to", "before_min", "after_hours"].forEach(function (k) { body[k] = Number(T[k]); });
    var r = await sb.rpc("set_flight_settings", { p: body });
    btn.disabled = false;
    if (r.error) { toast(r.error.message, true); return; }
    S.company.flight_settings = r.data; S.settingsDraft = null;
    toast("Saved. The next automatic check uses the new times.");
    render();
  }

