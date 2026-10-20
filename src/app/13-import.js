  // ── import ────────────────────────────────
  // Booking import, "Auto import" tab: bookings from the connected booking site, by hand only.
  // "Check bookings" shows what would change and writes nothing; "Import N bookings" then imports
  // exactly that (same hash check as before). Shown only for a company that has it set up on the
  // platform. The schedule is off.
  var BI_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var BI_FIELD = { reg: "Registration", name: "Name", phone: "Phone", make: "Vehicle", drop: "Drop-off", "return": "Return", flight: "Flight", note: "Note", day: "Sheet day" };
  var BI_STATUS = { "new": "New", changed: "Changed", review: "Review", unchanged: "Unchanged", invalid: "Can't read" };
  function biDay(k) { var m = String(k || "").match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? (+m[3]) + " " + BI_MON[+m[2] - 1] : String(k || ""); }
  function biWhen(v) { var m = String(v || "").match(/^(\d{4}-\d\d-\d\d)(?: (\d\d:\d\d))?/); return m ? biDay(m[1]) + (m[2] ? " " + m[2] : "") : String(v || ""); }
  function biStamp(ts) { return ts ? (dayShort(ts) === dayShort(Date.now()) ? hhmm(ts) : dayShort(ts) + " " + hhmm(ts)) : ""; }
  function biChange(c) {
    var f = c.field, a = c.from, b = c.to;
    if (f === "phone") return "Phone number updated";
    if (f === "drop" || f === "return") {
      var pa = String(a || "").match(/^(\S+) (\d\d:\d\d)$/), pb = String(b || "").match(/^(\S+) (\d\d:\d\d)$/);
      if (pa && pb && pa[1] === pb[1]) return (f === "return" ? "Return time" : "Drop-off time") + ": " + pa[2] + " → " + pb[2];
      return BI_FIELD[f] + ": " + (a ? biWhen(a) : "–") + " → " + biWhen(b);
    }
    if (f === "day") return "Sheet day: " + biDay(a) + " → " + biDay(b);
    return (BI_FIELD[f] || f) + ": " + (a || "–") + " → " + (b || "–");
  }
  function biQ(ref, reg) { return (String(ref || "") + String(reg || "")).toLowerCase().replace(/\s+/g, ""); }
  // The preview as one list of rows: new, changed, held for review, can't be read; the unchanged ones when the check sent them.
  function biRows(P) {
    var rows = [], conflict = {};
    (P.reviews || []).forEach(function (r) { if (r.kind === "conflict" && r.detail) conflict[(r.detail.kind || "") + "|" + r.ref] = r; });
    (P.items || []).forEach(function (i) {
      var r = { key: i.kind + "|" + i.ref, board: String(i.kind).toUpperCase(), date: biDay(i.day), ref: i.ref, reg: i.reg || "", status: i.status, lines: [], sub: [], explain: "" };
      if (i.status === "new") r.lines = ["New booking"];
      else if (i.status === "changed") r.lines = (i.changes || []).map(biChange);
      else if (i.status === "review") {
        var rv = conflict[i.kind + "|" + i.ref], why = rv && rv.detail && rv.detail.why ? String(rv.detail.why).replace(/\b\d{4}-\d\d-\d\d\b/g, biDay) : "";
        r.lines = [why ? why.charAt(0).toUpperCase() + why.slice(1) : "Needs an office decision"];
        r.sub = (i.changes || []).map(biChange);
        r.explain = "Held back. This booking stays out of the import until the office decides.";
        r.acts = revActs(i.kind, i.ref, rv && rv.detail && rv.detail.why, i.changes, revId(i.kind, i.ref));
      }
      rows.push(r);
    });
    (P.reviews || []).forEach(function (r) {
      if (r.kind !== "cancelled") return;
      var d = r.detail || {};
      rows.push({ key: "x|" + (d.kind || "") + "|" + r.ref, board: String(d.kind || "").toUpperCase(), date: d.on_sheet ? biDay(d.on_sheet) : "", ref: r.ref, reg: d.reg || "", status: "review",
        lines: ["Cancellation requires review"], sub: d.name ? [d.name] : [], explain: "Cancelled on the booking site. Nothing is removed here; check the car and remove it by hand if it really is cancelled.",
        acts: revActs(d.kind || "", r.ref, "", [], revId(d.kind || "", r.ref, "cancelled")) });
    });
    (P.invalid || []).forEach(function (i) { rows.push({ key: "i|" + (i.kind || "") + "|" + (i.ref || ""), board: String(i.kind || "").toUpperCase(), date: "", ref: i.ref || "No reference", reg: "", status: "invalid", lines: [i.reason || "Can't be read"], sub: [], explain: "Fix this record on the booking site, then check again." }); });
    return rows;
  }
  function biUnchangedRows(P) {
    return (P.unchanged || []).map(function (i) { return { key: "u|" + i.kind + "|" + i.ref, board: String(i.kind).toUpperCase(), date: biDay(i.day), ref: i.ref, reg: i.reg || "", status: "unchanged", lines: ["No changes"], sub: [], explain: "" }; });
  }
  function biRowHtml(r, open, hide) {
    var more = r.lines.slice(1).concat(r.sub || []);
    return '<div class="bi-row s-' + r.status + (open ? " open" : "") + '" data-biq="' + esc(biQ(r.ref, r.reg)) + '"' + (hide ? " hidden" : "") + ">" +
      '<button type="button" class="bi-hd" data-birow="' + esc(r.key) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
      '<span class="bi-board">' + esc(r.board) + '</span><span class="bi-date">' + esc(r.date) + '</span><span class="bi-ref">' + esc(r.ref) + '</span><span class="bi-reg">' + esc(r.reg) + "</span>" +
      '<span class="bi-chg"><span class="bi-main">' + esc(r.lines[0] || "") + "</span>" + (more.length ? '<span class="bi-more">' + more.map(function (x) { return "<small>" + esc(x) + "</small>"; }).join("") + "</span>" : "") + "</span>" +
      '<span class="bi-st"><em class="bi-pill s-' + r.status + '">' + esc(BI_STATUS[r.status] || r.status) + '</em></span><span class="bi-chev" aria-hidden="true"></span></button>' +
      (r.explain ? '<p class="bi-ex bi-more">' + esc(r.explain) + "</p>" : "") + (r.acts ? '<div class="bi-ex bi-more bi-racts">' + r.acts + "</div>" : "") + "</div>";
  }
  function biConn(a) {
    if (a.running) return { cls: "busy", text: "Importing…" };
    if (a.checking) return { cls: "busy", text: "Checking…" };
    if (a.blocked_until) return { cls: "bad", text: "Paused", note: "Sign-in failed. Paused until " + hhmm(a.blocked_until) + ". Check the saved login." };
    if (a.error && !a.stale) return { cls: "bad", text: "Check failed" };
    if (a.last_error && !a.checked_at) return { cls: "bad", text: "Last try failed", note: String(a.last_error).slice(0, 160) };
    if (a.checked_at || a.last_ok) return { cls: "ok", text: "Connected" };
    return { cls: "idle", text: "Not checked yet" };
  }
  function biReport(P) {
    if (!P.report) return "";
    return ["picks", "drops"].map(function (k) {
      var X = P.report[k]; if (!X) return "";
      return "<p>" + esc("On the booking site, " + k + ": " + X.rows + " · " + Object.keys(X.by_day).sort().map(function (d) { return d.slice(8) + "th " + X.by_day[d] + (X.site && X.site[d] != null ? " of " + X.site[d] : ""); }).join(" · ") + " · " + Object.keys(X.by_status).map(function (x) { return x + " " + X.by_status[x]; }).join(", ")) + "</p>" +
        (X.form ? "<p>" + esc("Search form: " + X.form) + "</p>" : "");
    }).join("") + (P.report.flights ? (function (F) {
      return "<p>" + esc("Return flights: " + F.matched + " of " + F.cars + " drops matched · Return Report " + F.rows + " · " + Object.keys(F.by_day || {}).sort().map(function (d) { return d.slice(8) + "th " + F.by_day[d]; }).join(" · ")) + "</p>" +
        (F.head && F.head.length ? "<p>" + esc("Return Report columns: " + F.head.join(" | ")) + "</p>" : "") +
        (F.sample && F.sample.length ? "<p>" + esc("Read as: " + F.sample.join(" · ")) + "</p>" : "");
    })(P.report.flights) : "");
  }
  function biChecked(P) {
    var seen = 0, ok = true;
    ["picks", "drops"].forEach(function (k) { var X = P.report && P.report[k]; if (!X) return; seen++; if (!X.site || !Object.keys(X.site).length) ok = false; });
    return seen && ok;
  }
  function biToday() { return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); }
  // The dates the check reads: today and the next two days unless the office picks its own (up to 14 days).
  function biRange(a) { return a.custom ? { from: a.from, to: a.to } : { from: biToday(), to: addDaysKey(biToday(), 2) }; }
  function biRangeHtml(a, busy) {
    var r = biRange(a), t = biToday(), dis = busy ? " disabled" : "";
    return '<div class="bi-range" data-birange><label>From <input type="date" id="biFrom" value="' + esc(r.from) + '" min="' + addDaysKey(t, -30) + '" max="' + addDaysKey(t, 60) + '"' + dis + "></label>" +
      '<label>To <input type="date" id="biTo" value="' + esc(r.to) + '" min="' + addDaysKey(t, -30) + '" max="' + addDaysKey(t, 60) + '"' + dis + "></label>" +
      (a.custom ? '<button type="button" class="link" data-birangereset' + dis + ">Today and next 2 days</button>" : '<span class="bi-hint">Today and the next 2 days. Up to 14 days at a time.</span>') + "</div>";
  }
  // Scheduled import: everyone who can import sees whether it is on and how the last run went; owners and managers set it.
  function biSchedHtml(a) {
    var sc = a.schedule || {}, on = !!sc.on, times = sc.times || [], last = sc.last, D = a.schedDraft, edit = S.me.role === "owner" || S.me.role === "manager";
    var lastTxt = !last ? "" : last.outcome === "imported" ? "Last run " + last.slot.slice(11) + ": imported."
      : last.outcome === "held" ? "Last run " + last.slot.slice(11) + ": not imported, " + last.why + "."
      : "Last run " + last.slot.slice(11) + ": didn't run, " + last.why;
    var h = '<details class="bi-sched" data-bisched' + (D ? " open" : "") + '><summary><span>Scheduled import</span><span class="bi-chk' + (on ? "" : " off") + '">' + (on ? "On · " + esc(times.join(", ")) : "Off") + "</span></summary>";
    h += '<div class="bi-schedbody"><p class="bi-hint">At the saved times it checks the bookings and imports them only if nothing needs a decision. Otherwise it waits, and the owner, managers and office are notified.' + (sc.by && on ? " Imports are recorded as " + esc(sc.by) + "." : "") + "</p>";
    if (lastTxt) h += '<p class="bi-hint" data-bischedlast>' + esc(lastTxt) + "</p>";
    if (edit) {
      var d = D || { on: on, times: times.slice() };
      h += '<label class="bi-sw"><input type="checkbox" id="schedOn"' + (d.on ? " checked" : "") + '> Import automatically at these times</label><div class="bi-times">' +
        d.times.map(function (t, i) { return '<span class="bi-time"><input type="time" data-schedtime="' + i + '" value="' + esc(t) + '" aria-label="Time ' + (i + 1) + '"><button type="button" class="link" data-schedrm="' + i + '" aria-label="Remove ' + esc(t) + '">Remove</button></span>'; }).join("") +
        (d.times.length < 6 ? '<button type="button" class="btn ghost small" data-schedadd>Add a time</button>' : "") + "</div>" +
        '<div><button type="button" class="btn brand small" data-schedsave' + (D ? "" : " disabled") + ">Save schedule</button></div>";
    }
    return h + "</div></details>";
  }
  function biSchedChange(a, fn) { var sc = a.schedule || {}; a.schedDraft = a.schedDraft || { on: !!sc.on, times: (sc.times || []).slice() }; fn(a.schedDraft); render(); }
  async function biSchedSave(a) {
    var d = a.schedDraft; if (!d) return;
    var times = d.times.filter(Boolean);
    if (d.on && !times.length) return toast("Add at least one time.", true);
    var r = await sb.rpc("swift_schedule_set", { p_times: times, p_on: !!d.on });
    if (r.error) return toast(r.error.message, true);
    a.schedDraft = null; toast(d.on ? "Scheduled import on." : "Scheduled import off."); loadAutoImport();
  }
  function autoPanel(a) {
    var P = a.preview, busy = a.running || a.checking, c = (P && P.counts) || {}, B = S.bi;
    var conn = biConn(a), nImp = (c["new"] || 0) + (c.changed || 0);
    var canGo = !busy && P && P.can_apply && !a.stale;
    var go = a.running ? "Importing…" : !P ? "Import bookings" : nImp ? "Import " + nImp + (nImp === 1 ? " booking" : " bookings") : c.review ? "Save review list" : "Nothing to import";
    var h = '<div class="bi-panel" data-autobox>' +
      '<div class="bi-status"><span class="bi-conn ' + conn.cls + '"><i class="bi-dot"></i>' + esc(conn.text) + "</span>" +
      "<span>Last checked " + (a.checked_at ? esc(biStamp(a.checked_at)) : "–") + "</span><span>Last imported " + (a.last_ok ? esc(biStamp(a.last_ok)) : "–") + "</span>" +
      (conn.note ? '<span class="bi-note">' + esc(conn.note) + "</span>" : "") + "</div>" +
      '<div class="bi-act"><button type="button" class="btn ghost" data-autopreview' + (busy ? " disabled" : "") + ">" + (a.checking ? "Checking…" : "Check bookings") + "</button>" +
      '<button type="button" class="btn brand" data-autorun' + (canGo ? "" : " disabled") + ">" + esc(go) + "</button></div>" +
      biRangeHtml(a, busy) + biSchedHtml(a) + '<div class="bi-body">';
    if (a.error) h += '<div class="alert" role="alert">' + esc(a.error) + "</div>";
    if (!P) {
      if (!a.error && !busy) h += '<p class="bi-hint">Check bookings to see what would change. Nothing is saved until you import.</p>';
    } else {
      var rows = biRows(P), un = biUnchangedRows(P), f = B.f || "all";
      var list = f === "unchanged" ? un : f === "all" ? rows : rows.filter(function (r) { return r.status === f; });
      var q = String(B.q || "").toLowerCase().replace(/\s+/g, "");
      h += '<div class="bi-counts" data-autopreviewsum role="group" aria-label="Check result">' +
        [["new", "New"], ["changed", "Changed"], ["review", "Needs review"], ["unchanged", "Unchanged"]].map(function (x) { return '<div class="' + (x[0] === "review" && c.review ? "warn" : "") + '"><b class="num">' + (c[x[0]] || 0) + "</b><span>" + x[1] + "</span></div>"; }).join("") + "</div>";
      if (c.invalid) h += '<div class="alert" role="alert">' + c.invalid + (c.invalid === 1 ? " record can't" : " records can't") + " be read. Fix " + (c.invalid === 1 ? "it" : "them") + " on the booking site before importing.</div>";
      if (c.review) h += '<div class="bi-warn" role="status">' + c.review + (c.review === 1 ? " booking needs" : " bookings need") + " an office decision. These will stay out of this import.</div>";
      var tabs = [["all", "All changes", rows.length], ["new", "New", c["new"] || 0], ["changed", "Changed", c.changed || 0], ["review", "Needs review", c.review || 0]];
      if (c.unchanged) tabs.push(["unchanged", "Unchanged", c.unchanged]);
      h += '<div class="bi-filters" role="group" aria-label="Filter the check result">' + tabs.map(function (x) {
        return '<button type="button" class="bi-chip" data-bifilter="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + ' <span class="num">' + x[2] + "</span></button>";
      }).join("") + '<input type="search" id="biQ" class="bi-search" placeholder="Reference or reg" aria-label="Search by reference or registration" autocomplete="off" value="' + esc(B.q || "") + '"></div>';
      if (!list.length) {
        h += '<p class="bi-hint" data-autoitems>' + (f === "unchanged" ? (c.unchanged ? "This check didn't list the " + c.unchanged + " unchanged bookings. They already match the app." : "No unchanged bookings.")
          : f === "all" && !rows.length ? "No booking changes. Everything on the booking site already matches the app." : "Nothing in this view.") + "</p>";
      } else {
        h += '<div class="bi-tbl" data-autoitems><div class="bi-th" aria-hidden="true"><span>Board</span><span>Date</span><span>Reference</span><span>Registration</span><span>Change</span><span>Status</span><span></span></div>' +
          list.map(function (r) { return biRowHtml(r, !!B.open[r.key], q && biQ(r.ref, r.reg).indexOf(q) < 0); }).join("") + "</div>";
        h += '<p class="bi-hint" id="biShown">' + (P.items && P.items.length >= 200 ? "Showing the first 200 changes. " : "") + "</p>";
      }
      h += '<details class="bi-diag"><summary><span>Diagnostics</span>' + (biChecked(P) ? '<span class="bi-chk">Report checks passed</span>' : '<span class="bi-chk off">Report counts not verified</span>') + '</summary><div class="bi-diagbody" data-autoreport>' + biReport(P) + "</div></details>";
    }
    if (a.reviews && a.reviews.length) {
      h += '<div class="bi-held"><h3>Held for the office</h3><div data-autoreviews>' + a.reviews.map(function (r) {
        var d = r.detail || {}, b = S.revCars[(d.kind || "") + "|" + r.ref], reg = (b && b.reg) || d.reg || "";
        var why = r.kind === "cancelled" ? ((d.name || "") + " · " + (d.kind || "")) : String(d.why || "").replace(/\b\d{4}-\d\d-\d\d\b/g, biDay).replace(/^./, function (x) { return x.toUpperCase(); });
        var chg = r.kind === "cancelled" ? [] : (d.changes || []).map(biChange);
        return '<div class="bi-hr"><span>' + esc((r.kind === "cancelled" ? "Cancelled · " : "Changed · ") + r.ref) + (reg ? ' · <b class="bi-hreg">' + esc(reg) + "</b>" : "") + "<small>" + esc(why) + "</small>" +
          (chg.length ? "<small>" + esc(chg.join(" · ")) + "</small>" : "") + '</span><span class="bi-acts">' + revActs(d.kind || "", r.ref, r.kind === "cancelled" ? "" : d.why, d.changes, r.id) +
          '<button type="button" class="btn ghost small" data-reviewdone="' + esc(r.id) + '">Done</button></span></div>';
      }).join("") + "</div></div>";
    } else if (a.open_reviews) h += '<p class="bi-hint">' + a.open_reviews + " to check.</p>";
    return h + '<p class="bi-hint">It only reads from the booking site. Cancelled or changed bookings are listed for you; nothing is removed.</p></div></div>';
  }
  // The recent imports of the last 24 hours, newest first, for both tabs. Undo only where the backend says it can still be undone.
  function recentImportsHtml() {
    if (!S.recentImports) loadRecentImports();
    var L = S.recentImports || [];
    var h = '<section class="bi-recent" aria-labelledby="biRecent"><div class="bi-rh"><h3 id="biRecent">Recent imports</h3><button type="button" class="link" data-view="summary">View history</button></div>';
    if (!L.length) return h + '<p class="bi-hint">No imports in the last 24 hours.</p></section>';
    return h + '<div class="bi-rlist">' + L.map(function (x) {
      var src = x.source === "auto" ? "Auto import" : x.source === "manual" ? "Manual import" : "Import";
      var res = x.undone ? "Undone" : (x.added || x.changed) ? x.added + " added · " + x.changed + " updated" : "No booking changes";
      var undo = x.latest && !x.undone && (x.added || x.changed);
      return '<div class="bi-rr"><span class="bi-t num">' + esc(biStamp(x.at)) + '</span><span class="bi-by">' + esc(x.by || "") + '</span><span class="bi-src">' + esc(src) + '</span><span class="bi-bd">' + esc(String(x.kind || "").toUpperCase() + " " + biDay(x.day).toUpperCase()) +
        '</span><span class="bi-res">' + esc(res) + "</span>" + (undo ? '<button type="button" class="link bi-undo" data-undoimport="' + esc(x.id) + '">Undo</button>' : '<span class="bi-undo">–</span>') + "</div>";
    }).join("") + "</div></section>";
  }
  function autoInfo() {
    if (S.autoImport === undefined) { S.autoImport = null; loadAutoImport(); }
    var a = S.autoImport;
    return a && a.available && can("import") ? a : null;
  }
  async function loadAutoImport() {
    var r = await sb.rpc("auto_import_status");
    var d = r && !r.error ? (r.data || {}) : {};
    var keep = S.autoImport || {};
    S.autoImport = { available: !!d.available, running: !!d.running, blocked_until: d.blocked_until, last_ok: d.last_ok, last_error: d.last_error, open_reviews: d.open_reviews || 0, preview: keep.preview, error: keep.error, stale: keep.stale, checked_at: keep.checked_at, reviews: keep.reviews, custom: keep.custom, from: keep.from, to: keep.to, schedule: d.schedule, schedDraft: keep.schedDraft };
    if (d.available && d.open_reviews) {
      var rv = await sb.rpc("swift_reviews_open");
      S.autoImport.reviews = rv && !rv.error ? rv.data : null;
    } else S.autoImport.reviews = null;
    if (S.view === "import") render();
  }
  async function previewAutoImport() {
    var a = S.autoImport; if (!a || a.checking || a.running) return;
    a.checking = true; a.error = ""; a.preview = null; render();
    var r;
    r = await callBookings(Object.assign({ action: "preview" }, a.custom ? biRange(a) : {}));
    a.checking = false;
    var out = r && r.data;
    if ((r && r.error) || !out) a.error = "Couldn't reach the booking import. Try again in a minute.";
    else if (out.ok === false) a.error = out.error || "The booking site didn't answer.";
    else if (out.error) a.error = out.error;
    else { a.preview = out.preview; a.checked_at = Date.now(); a.stale = false; S.bi.open = {}; }
    render(); loadAutoImport();
  }
  async function runAutoImport(btn) {
    var a = S.autoImport; if (!a || !a.preview || !a.preview.can_apply) return;
    a.running = true; a.error = ""; render();
    toast("Getting bookings… this can take a moment.");
    var r;
    r = await callBookings(Object.assign({ action: "apply", expect_hash: a.preview.hash }, a.custom ? biRange(a) : {}));
    a.running = false;
    var out = r && r.data;
    if ((r && r.error) || !out || out.ok === false) {
      a.error = (out && out.error) || "Couldn't get the bookings. Nothing was imported. Try again in a minute.";
      a.stale = out && /changed since the preview/.test(a.error);
      toast(a.error, true); render(); return loadAutoImport();
    }
    var days = (out.summary && out.summary.days) || [];
    var added = days.reduce(function (n, d) { return n + (d.added || 0); }, 0);
    var updated = days.reduce(function (n, d) { return n + (d.updated || 0); }, 0);
    a.preview = null; a.stale = false;
    await loadSheets(); await loadRows();
    toast("✓ Bookings in: " + added + " added, " + updated + " updated across " + days.length + " sheet(s).");
    S.recentImports = null; loadAutoImport();
  }
  // Held bookings (19 Oct): the car each one is about, so the reg shows beside the
  // reference and the office can open it, or move it to the booking site's night
  // with the app's own EARLY RETURN (an earlier night) or return change (a later one).
  S.revCars = {};
  function loadRevCars(list) {
    var want = list.filter(function (x) { return x.ref && S.revCars[x.kind + "|" + x.ref] === undefined; });
    if (!want.length) return;
    want.forEach(function (x) { S.revCars[x.kind + "|" + x.ref] = null; });
    var refs = want.map(function (x) { return x.ref; }).filter(function (x, i, l) { return l.indexOf(x) === i; });
    sb.from("bookings").select("id, sheet_id, kind, ref, reg, name, cleared_at, removed_at, early, return_at, sheets!bookings_sheet_id_fkey(day, kind)").in("ref", refs).then(function (r) {
      if (r.error) { want.forEach(function (x) { delete S.revCars[x.kind + "|" + x.ref]; }); return; }
      want.forEach(function (x) { S.revCars[x.kind + "|" + x.ref] = false; });
      // One car per booking: one still on a board before a removed one, then the latest night.
      (r.data || []).forEach(function (b) {
        var k = b.kind + "|" + b.ref, cur = S.revCars[k], day = (b.sheets || {}).day || "";
        if (!cur || (cur.removed_at && !b.removed_at) || (!cur.removed_at === !b.removed_at && day > ((cur.sheets || {}).day || ""))) S.revCars[k] = b;
      });
      if (S.view === "import") render();
    }, function () { want.forEach(function (x) { delete S.revCars[x.kind + "|" + x.ref]; }); });
  }
  // The open held review for this booking, if there is one (its Done button).
  function revId(kind, ref, type) {
    var a = S.autoImport, m = ((a && a.reviews) || []).filter(function (r) { return r.ref === ref && (r.detail || {}).kind === kind && (!type || r.kind === type); })[0];
    return m ? m.id : "";
  }
  // The move the app can make safely: DROPS only, a car not gone, not already early.
  function revMove(kind, why, changes, b) {
    var m = /moved from sheet (\d{4}-\d\d-\d\d) to (\d{4}-\d\d-\d\d)/.exec(why || "");
    if (!m || kind !== "drops" || !b || b.cleared_at || b.removed_at || b.early) return null;
    var to = m[2], here = (b.sheets || {}).day || m[1];
    if (to < here) return to >= currentShiftKey() && can("called") ? { day: to } : null;
    var ret = (changes || []).filter(function (c) { return c.field === "return"; })[0];
    if (to > here && can("import") && ret && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(ret.to || "")) return { day: to, ret: ret.to };
    return null;
  }
  S.revCtx = {};
  var revWant = [], revTimer = null;
  function revActs(kind, ref, why, changes, rid) {
    var k = kind + "|" + ref, b = S.revCars[k];
    if (b === undefined) { revWant.push({ kind: kind, ref: ref }); clearTimeout(revTimer); revTimer = setTimeout(function () { var w = revWant; revWant = []; loadRevCars(w); }, 0); }
    if (!b) return "";
    var mv = revMove(kind, why, changes, b);
    S.revCtx[k] = { mv: mv, rid: rid };
    return (mv ? '<button type="button" class="btn small" data-rvmove="' + esc(k) + '">Move to ' + esc(sheetLabel({ kind: "drops", day: mv.day }).replace(/^DROPS /, "")) + "</button>" : "") +
      '<button type="button" class="btn ghost small" data-rvopen="' + esc(k) + '">' + (b.removed_at ? "Removed cars" : "Open") + "</button>";
  }
  async function revOpen(k) {
    var b = S.revCars[k]; if (!b) return;
    await openArchived(b.sheet_id, b.removed_at ? "" : b.reg);
    if (S.sheetId !== b.sheet_id) return;
    if (b.removed_at) return openRemoved();
    var row = S.rows.filter(function (x) { return x.id === b.id; })[0];
    if (row) openPanel(row);
  }
  async function revMoveGo(k, btn) {
    var b = S.revCars[k], c = S.revCtx[k], mv = c && c.mv; if (!b || !mv) return;
    var to = sheetLabel({ kind: "drops", day: mv.day });
    if (!confirm("Move " + (b.reg || "this car") + " to " + to + (mv.ret ? ", back " + biWhen(mv.ret) + "?" : " as an early return?"))) return;
    btn.disabled = true;
    var x = mv.ret ? await sb.rpc("set_return", { p_booking: b.id, p_return_local: mv.ret }) : await sb.rpc("early_return", { p_booking: b.id, p_day: mv.day });
    btn.disabled = false;
    if (x.error) return toast(x.error.message, true);
    if (c.rid) await sb.rpc("swift_review_resolve", { p_id: Number(c.rid) });
    delete S.revCars[k];
    toast((b.reg || "Car") + (x.data && x.data.sheet_id !== b.sheet_id ? " moved to " + to + "." : " stays on its night as staying longer until " + to + " is imported."));
    await loadSheets(); loadAutoImport();
  }
  async function reviewDone(id) {
    var r = await sb.rpc("swift_review_resolve", { p_id: Number(id) });
    if (r.error) return toast(r.error.message, true);
    loadAutoImport();
  }
  function renderImport() {
    var I = S.imp || (S.imp = newImport("drops")), B = S.bi || (S.bi = { tab: "", f: "all", q: "", open: {} });
    var auto = autoInfo(), tab = auto ? (B.tab || "auto") : "manual";
    var h = '<div class="bi">';
    if (auto) h += '<div class="bi-tabs" role="tablist" aria-label="Booking source"><button type="button" role="tab" data-bitab="auto" aria-selected="' + (tab === "auto") + '">Auto import</button><button type="button" role="tab" data-bitab="manual" aria-selected="' + (tab === "manual") + '">Manual import</button></div>';
    if (tab === "auto") return h + autoPanel(auto) + recentImportsHtml() + "</div>";
    if (I.stage !== "preview") {
      h += '<div class="toolbar"><div class="seg" role="group" aria-label="Sheet type"><button type="button" data-impkind="drops" aria-pressed="' + (I.kind === "drops") + '">Drops</button><button type="button" data-impkind="picks" aria-pressed="' + (I.kind === "picks") + '">Picks</button></div></div>';
      var joblist = I.excelFile && /\.pdf$/i.test(I.excelFile.name || "");
      h += '<div class="steps">' + dropZone("excel", "1. Bookings", I.kind === "drops" ? "The booking list covering two days, e.g. 17th to 18th, exactly as downloaded. Excel or a Joblist PDF." : "The booking list for the day, exactly as downloaded. Excel or a Joblist PDF.", I.excelFile) +
        (I.kind === "drops" && !joblist ? dropZone("pdf", "2. Flight numbers (PDF)", "Return Report PDF for the same days. Not needed with a Joblist PDF, which already carries the flights.", I.pdfFile) : "") + "</div>" +
        (I.error ? '<div class="alert" role="alert">' + esc(I.error) + "</div>" : "") +
        '<div class="row-actions"><button type="button" class="btn brand" data-read' + (I.excelFile && I.stage !== "reading" ? "" : " disabled") + ">" + (I.stage === "reading" ? "Reading…" : "Read files") + "</button></div>";
      return h + recentImportsHtml() + "</div>";
    }
    var P = I.preview, miss = P.rows.filter(function (r) { return I.kind === "drops" && !r.flight; }).length;
    var existing = S.sheets.filter(function (s) { return s.kind === I.kind && s.day === P.dateKey; })[0];
    h += '<div class="result"><div><strong class="num">' + P.rows.length + "</strong><span>bookings</span></div>" +
      (I.kind === "drops" ? '<div><strong class="num">' + (P.rows.length - miss) + '</strong><span>flights from the PDF</span></div><div class="' + (miss ? "bad" : "") + '"><strong class="num">' + miss + "</strong><span>need a flight number</span></div>"
        : '<div><strong class="num">' + I.real.dates.length + "</strong><span>day(s) in file</span></div><div></div>") + "</div>" +
      '<div class="inline-selects"><label class="note" for="impDate">' + (I.kind === "drops" ? "Sheet" : "Day") + '</label><select id="impDate" data-impdate>' +
      I.real.dates.map(function (k) { return '<option value="' + k + '"' + (k === P.dateKey ? " selected" : "") + ">" + esc(R.boardName(k, I.kind)) + " · " + I.real.counts[k] + "</option>"; }).join("") + "</select>" +
      (I.kind === "drops" ? '<label class="note" for="impCut">Day ends at</label><select id="impCut" data-impcut>' + ["04:00", "05:00", "06:00", "07:00"].map(function (t) { return "<option" + (t === I.cutoff ? " selected" : "") + ">" + t + "</option>"; }).join("") + "</select>" : "") + "</div>" +
      (existing ? '<div class="alert" style="border-color:var(--brand);background:var(--brand-soft);color:var(--brand-text)">This sheet already exists. Importing again adds new bookings and refreshes details; everything the team has done stays.</div>' : "") +
      '<div class="table-wrap"><table><thead><tr><th>Ref</th><th>Reg</th><th>Customer</th><th>Car</th>' + (I.kind === "drops" ? "<th>Back</th><th>Flight</th>" : "<th>Drop-off</th>") + "</tr></thead><tbody>" +
      P.rows.map(function (r, i) {
        return '<tr class="' + (I.kind === "drops" && !r.flight ? "miss" : "") + '"><td>' + esc(r.ref) + "</td><td>" + esc(r.reg) + "</td><td>" + esc(r.name) + "</td><td>" + esc(r.make) + "</td>" +
          (I.kind === "drops" ? '<td class="num">' + esc(r.ret ? r.ret.time : "") + "</td><td>" + (r.flight ? esc(r.flight) : '<input data-fix="' + i + '" placeholder="U22305" aria-label="Flight for ' + esc(r.reg) + '">') + "</td>" : '<td class="num">' + esc(r.meet ? r.meet.time : "") + "</td>") + "</tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="row-actions"><button type="button" class="btn ghost" data-restart>Start again</button><button type="button" class="btn brand" data-create' + (I.saving ? " disabled" : "") + ">" + (I.saving ? "Saving…" : "Create " + esc(R.boardName(P.dateKey, I.kind))) + "</button></div>";
    return h + "</div>";
  }
  function dropZone(key, title, text, file) {
    return '<div class="drop' + (file ? " filled" : "") + '"><strong>' + esc(title) + '</strong><p class="note">' + (file ? "✓ " + esc(file.name) : esc(text)) + "</p>" +
      "<label>" + (file ? "Choose another" : "Choose file") + '<input type="file" data-file="' + key + '" accept="' + (key === "pdf" ? ".pdf" : ".xls,.xlsx,.csv,.txt,.pdf") + '"></label></div>';
  }
  async function readImport() {
    var I = S.imp; I.stage = "reading"; I.error = ""; render();
    try {
      // Two booking systems, two shapes of download. One exports a spreadsheet
      // with a separate flights PDF; the other only exports a PDF, and that PDF
      // is the booking list. Told apart by the file, not by a setting, so the
      // office never has to know which is which.
      var isJoblist = /\.pdf$/i.test(I.excelFile.name || "");
      var xl = isJoblist ? await R.readJoblistPdf(I.excelFile) : await R.readExcel(I.excelFile);
      if (isJoblist && xl.kind && xl.kind !== I.kind) {
        throw new Error("That is a " + xl.kind.toUpperCase() + " sheet, but " + I.kind.toUpperCase() +
          " is selected above. Switch it, or choose the other file.");
      }
      if (!isJoblist && I.kind === "drops" && I.pdfFile) R.matchFlights(xl.rows, await R.readPdf(I.pdfFile), "flightIn");
      I.real = { all: xl.rows };
      // Every car at the same time means the file's times weren't read (26 Sept: all 01:00).
      var field = I.kind === "drops" ? "ret" : "meet", times = {};
      xl.rows.forEach(function (r) { if (r[field]) times[r[field].time || "none"] = 1; });
      if (xl.rows.length >= 5 && Object.keys(times).length === 1)
        throw new Error("Every car in this file has the same " + (I.kind === "drops" ? "return" : "drop-off") + " time (" + (Object.keys(times)[0] === "none" ? "no time" : Object.keys(times)[0]) +
          "), so the times weren't read. Nothing was imported. Close the app completely, open it again and retry; if it still happens, send the file to whoever looks after the app.");
      groupImport();
      if (!I.real.dates.length) throw new Error("Found " + xl.rows.length + " bookings but no dates in them.");
      var inner = I.real.dates.length >= 3 ? I.real.dates.slice(1, -1) : I.real.dates;
      buildPreview(inner.reduce(function (a, b) { return I.real.counts[b] > I.real.counts[a] ? b : a; }));
    } catch (err) { I.stage = "pick"; I.error = err.message || String(err); render(); }
  }
  function groupImport() {
    var I = S.imp, field = I.kind === "drops" ? "ret" : "meet", counts = {};
    I.real.all.forEach(function (r) { var k = shiftKey(r[field], I.cutoff); if (k) counts[k] = (counts[k] || 0) + 1; });
    I.real.counts = counts; I.real.dates = Object.keys(counts).sort();
  }
  function buildPreview(dateKey) {
    var I = S.imp, field = I.kind === "drops" ? "ret" : "meet";
    var rows = I.real.all.filter(function (r) { return r[field] && shiftKey(r[field], I.cutoff) === dateKey; })
      .sort(function (a, b) { return a[field].date - b[field].date; })
      .map(function (r) { return Object.assign({}, r, { flight: I.kind === "drops" ? (r.flightIn || "") : "" }); });
    I.preview = { dateKey: dateKey, rows: rows }; I.stage = "preview"; render();
  }
  function local(dt) { return dt ? dt.key + " " + (dt.time || "00:00") : ""; }
  async function createSheet() {
    var I = S.imp, P = I.preview;
    I.saving = true; render();
    var rows = P.rows.map(function (r) { return { ref: r.ref, reg: r.reg, name: r.name, phone: r.phone, make: r.make, drop_local: local(r.meet), return_local: local(r.ret), flight: r.flight || "", note: r.note || "" }; });
    var r = await sb.rpc("import_sheet", { p_kind: I.kind, p_day: P.dateKey, p_rows: rows,
      p_source: { excel: I.excelFile && I.excelFile.name, pdf: I.pdfFile && I.pdfFile.name, bookings: rows.length, flights: rows.filter(function (x) { return x.flight; }).length } });
    I.saving = false;
    if (r.error) { toast(r.error.message, true); render(); return; }
    await loadSheets();
    S.sheetId = r.data.sheet_id; S.view = "board"; S.filter = "all"; S.imp = newImport(I.kind);
    await loadRows(); render();
    toast("✓ " + r.data.added + " added" + (r.data.new_marked ? " (" + r.data.new_marked + " marked NEW BOOKING)" : "") + ", " + r.data.updated + " updated" + (r.data.moved ? ", " + r.data.moved + " moved here from an earlier day (return changed)" : "") + ". On every phone now.");
    // A re-import adds and updates but never takes a car away. Cars the booking
    // site no longer lists (usually cancelled) are shown for someone to confirm.
    var inFile = {}; rows.forEach(function (x) { if (x.ref) inFile[x.ref] = 1; });
    // Overstays were carried in from older days and early returns from later
    // ones, so they're never in today's file.
    var gone = S.rows.filter(function (x) { return x.ref && !inFile[x.ref] && !x.overstay && !x.early; });
    // New cars in a re-imported PICKS file: any back on a day whose DROPS is already in?
    if (I.kind === "picks" && r.data.new_marked) await askDrops(r.data.added_ids);
    if (gone.length) openGone(gone, r.data.undo_id);
    S.recentImports = null;
  }
  function openGone(gone, undoId) {
    panelRow = null;
    var top = '<div class="pbtns top"><button type="button" data-close>Keep them all</button>' + (undoId ? '<button type="button" class="undo" data-undoimport="' + esc(undoId) + '">Undo this import</button>' : "") + "</div>";
    $("panelBody").innerHTML = '<button type="button" class="pclose" data-close aria-label="Close">✕</button><h2 id="panelTitle">' + gone.length + (gone.length === 1 ? " car isn't" : " cars aren't") + " in this file any more</h2>" +
      '<p class="sub">They were in an earlier import but this file no longer lists them: cancelled, or the date was changed to another day. Only remove cars you know are cancelled.' +
        (gone[0] && gone[0].kind === "drops" ? " A car whose return moved to another day goes there, with its yard and notes, when that day is imported; removing it here loses them." : "") + '</p>' +
      (undoId ? '<p class="sub"><b>Wrong file?</b> Undo this import puts the sheet back as it was before.</p>' : "") + top +
      '<div class="rmlist">' + gone.map(function (r) {
        return '<div><span><b>' + esc(r.reg || "NO REG") + "</b>" + (r.num ? " #" + r.num : "") + " " + esc(r.name) + "<small>Ref " + esc(r.ref) + (r.drop_at ? " · drop " + esc(dayShort(r.drop_at) + " " + hhmm(r.drop_at)) : "") + (r.return_at ? " · back " + esc(dayShort(r.return_at) + " " + hhmm(r.return_at)) : "") +
          '</small></span><button type="button" data-gone="' + r.id + '">Remove as cancelled</button></div>';
      }).join("") + "</div>" +
      '<div class="pbtns"><button type="button" data-close>Keep them</button>' + (gone.length > 1 ? '<button type="button" class="save" data-goneall>Remove all ' + gone.length + " as cancelled</button>" : "") + "</div>";
    if (!$("panel").open) $("panel").showModal();
  }
  // Undo an import (database part 44): cars it added go, what it changed comes back.
  async function undoImport(id, btn) {
    var it = (S.recentImports || []).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!confirm("Undo this import?" + (it ? "\n\n" + it.kind.toUpperCase() + " " + it.day + ", imported " + hhmm(it.at) + " by " + it.by + ": " + it.added + " cars added, " + it.changed + " changed." : "") +
      "\n\nThe cars it added are taken off, and what it changed goes back to how it was. Taps made since are kept.")) return;
    btn.disabled = true;
    var r = await sb.rpc("undo_import", { p_id: +id });
    btn.disabled = false;
    if (r.error) return toast(r.error.message, true);
    toast("Import undone: " + r.data.removed + " cars taken off, " + r.data.restored + " put back" + (r.data.kept ? ", " + r.data.kept + " kept (already worked on)" : "") + ".");
    S.recentImports = null;
    if ($("panel").open) $("panel").close();
    await loadSheets();
    if (r.data.sheet_gone && S.sheetId === r.data.sheet_id) S.sheetId = null;
    if (!S.sheetId) pickDefaultSheet();
    await loadRows(); render();
  }
  async function loadRecentImports() {
    S.recentImports = [];
    var r = await sb.rpc("recent_imports");
    S.recentImports = r.error ? [] : (r.data || []);
    if (S.view === "import") render();
  }
  async function removeGone(ids, btn) {
    btn.disabled = true;
    for (var i = 0; i < ids.length; i++) {
      var x = await sb.rpc("remove_booking", { p_booking: ids[i], p_reason: "Cancelled" });
      if (x.error) { btn.disabled = false; return toast(x.error.message, true); }
      S.rows = S.rows.filter(function (y) { return y.id !== ids[i]; });
      dropRemoved(ids[i]); S.removed.push(x.data);
    }
    toast(ids.length + (ids.length === 1 ? " car" : " cars") + " removed as cancelled");
    var left = Array.prototype.map.call($("panelBody").querySelectorAll("[data-gone]"), function (b) { return b.dataset.gone; }).filter(function (id) { return ids.indexOf(id) === -1; });
    if (!left.length) return $("panel").close();
    var u = $("panelBody").querySelector("[data-undoimport]");
    openGone(S.rows.filter(function (y) { return left.indexOf(y.id) !== -1; }), u ? u.dataset.undoimport : null);
  }

