  // ── import ────────────────────────────────
  // Booking import, "Auto import" tab: bookings from the connected booking site, by hand only.
  // "Check bookings" shows what would change and writes nothing; "Import N bookings" then imports
  // exactly that (same hash check as before). Shown only for a company that has it set up on the
  // platform. The schedule is off.
  var BI_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var BI_FIELD = { reg: "Registration", name: "Name", phone: "Phone", make: "Vehicle", drop: "Drop-off", "return": "Return", flight: "Flight", note: "Note", day: "Sheet day" };
  var BI_STATUS = { "new": "New", changed: "Updated", review: "Review", unchanged: "Unchanged", invalid: "Can't read" };
  function biDay(k) { var m = String(k || "").match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? (+m[3]) + " " + BI_MON[+m[2] - 1] : String(k || ""); }
  function biWhen(v) { var m = String(v || "").match(/^(\d{4}-\d\d-\d\d)(?: (\d\d:\d\d))?/); return m ? biDay(m[1]) + (m[2] ? " " + m[2] : "") : String(v || ""); }
  function biStamp(ts) { return ts ? (dayShort(ts) === dayShort(Date.now()) ? hhmm(ts) : dayShort(ts) + " " + hhmm(ts)) : ""; }
  function biChange(c) {
    var f = c.field, a = c.from, b = c.to;
    if (f === 'drop_at' || f === 'return_at') { return (f === 'drop_at' ? 'Drop-off' : 'Return') + ': ' + (a ? dayShort(a) + ' ' + hhmm(a) : '–') + ' → ' + (b ? dayShort(b) + ' ' + hhmm(b) : '–'); }
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
      r.selectable = !!P.selection_supported && (r.status === "new" || r.status === "changed");
      r.attention = i.attention || ""; r.location = [i.lane ? "Lane " + i.lane + (i.position ? " · Position " + i.position : "") : i.yard ? "Yard " + i.yard : "", i.number ? "Key/board number " + i.number : ""].filter(Boolean).join(" · ");
      if (i.booking_id && !r.acts) r.acts = revActs(i.kind, i.ref, "", i.changes, "");
      rows.push(r);
    });
    (P.reviews || []).forEach(function (r) {
      if (r.kind !== "cancelled") return;
      var d = r.detail || {};
      rows.push({ key: "x|" + (d.kind || "") + "|" + r.ref, board: String(d.kind || "").toUpperCase(), date: d.on_sheet ? biDay(d.on_sheet) : "", ref: r.ref, reg: d.reg || "", status: "review",
        lines: [d.missing ? "Not on the booking site any more" : "Cancellation requires review"], sub: d.name ? [d.name] : [],
        explain: (d.missing ? "The booking site no longer lists it: cancelled, deleted or moved to another day." : "Cancelled on the booking site.") + " Nothing is removed here; check the car and remove it by hand if it really is cancelled.",
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
    return '<div class="bi-row s-' + r.status + (r.selectable ? ' bi-selectable' : '') + (open ? " open" : "") + '" data-biq="' + esc(biQ(r.ref, r.reg)) + '"' + (hide ? " hidden" : "") + ">" +
      (r.selectable ? '<label class="bi-select"><input type="checkbox" data-biselect="' + esc(r.key) + '" aria-label="Select ' + esc(r.ref) + '"' + (S.bi.selected && S.bi.selected[r.key] ? ' checked' : '') + (S.autoImport.running || S.autoImport.checking ? ' disabled' : '') + '></label>' : '') +
      '<button type="button" class="bi-hd" data-birow="' + esc(r.key) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
      '<span class="bi-board">' + esc(r.board) + '</span><span class="bi-date">' + esc(r.date) + '</span><span class="bi-ref">' + esc(r.ref) + '</span><span class="bi-reg">' + esc(r.reg) + "</span>" +
      '<span class="bi-chg"><span class="bi-main">' + esc(r.lines[0] || "") + "</span>" + (more.length ? '<span class="bi-more">' + more.map(function (x) { return "<small>" + esc(x) + "</small>"; }).join("") + "</span>" : "") + "</span>" +
      '<span class="bi-st"><em class="bi-pill s-' + r.status + '">' + esc(BI_STATUS[r.status] || r.status) + '</em></span><span class="bi-chev" aria-hidden="true"></span></button>' +
      (r.attention ? '<p class="bi-attention">' + esc(r.attention) + '</p>' : "") + (r.location ? '<p class="bi-ex">' + esc(r.location) + '</p>' : "") +
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
      '<span class="bi-presets">' + [[1,"Today"],[3,"Next 3 days"],[7,"Next 7 days"]].map(function(x){return '<button type="button" class="btn ghost small" data-bipreset="'+x[0]+'" aria-pressed="'+(r.from===t && r.to===addDaysKey(t,x[0]-1))+'"'+dis+'>'+x[1]+'</button>';}).join("") + '</span>' +
      (a.custom ? '<button type="button" class="link" data-birangereset' + dis + ">Today and next 2 days</button>" : '<span class="bi-hint">Today and the next 2 days. Up to 14 days at a time.</span>') + "</div>";
  }
  // Scheduled import: everyone who can import sees whether it is on and how the last run went; owners and managers set it.
  function biSchedHtml(a) {
    var sc = a.schedule || {}, on = !!sc.on, times = sc.times || [], last = sc.last, D = a.schedDraft, edit = S.me.role === "owner" || S.me.role === "manager";
    var lastTxt = !last ? "" : last.outcome === "imported" ? "Last run " + last.slot.slice(11) + ": imported."
      : last.outcome === "held" ? "Last run " + last.slot.slice(11) + ": not imported, " + last.why + "."
      : "Last run " + last.slot.slice(11) + ": didn't run, " + last.why;
    var clock = new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()), sortedTimes=times.slice().sort(), nextTime=sortedTimes.filter(function(t){return t>clock;})[0];
    if(on && sortedTimes.length) lastTxt = 'Next scheduled: ' + (nextTime?'today '+nextTime:'tomorrow '+sortedTimes[0]) + ' (London).' + (lastTxt?' '+lastTxt:'');
    var h = '<details class="bi-sched" data-bisched' + (D ? " open" : "") + '><summary><span>Scheduled import</span><span class="bi-chk' + (on ? "" : " off") + '">' + (on ? "On · " + esc(times.join(", ")) : "Off") + "</span></summary>";
    h += '<div class="bi-schedbody"><p class="bi-hint">At the saved times it checks the bookings and imports them only if nothing needs a decision.' + (sc.by && on ? " Imports are recorded as " + esc(sc.by) + "." : "") + "</p>";
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
    var conn = biConn(a), nImp = P && P.selection_supported ? autoSelected(P).length : (c["new"] || 0) + (c.changed || 0);
    var canGo = !busy && P && P.can_apply && !a.stale && (nImp > 0 || c.review > 0);
    var go = a.running ? "Importing…" : !P ? "Import bookings" : nImp ? "Import " + nImp + (nImp === 1 ? (P.selection_supported ? " selected" : " booking") : (P.selection_supported ? " selected" : " bookings")) : c.review ? "Save review list" : "Nothing to import";
    var h = '<div class="bi-panel" data-autobox>' +
      '<div class="bi-status"><span class="bi-conn ' + conn.cls + '"><i class="bi-dot"></i>' + esc(conn.text) + "</span>" +
      "<span>Last checked " + (a.checked_at ? esc(biStamp(a.checked_at)) : "–") + "</span><span>Last imported " + (a.last_ok ? esc(biStamp(a.last_ok)) : "–") + "</span>" +
      (conn.note ? '<span class="bi-note">' + esc(conn.note) + "</span>" : "") + "</div>" +
      '<div class="bi-act"><button type="button" class="btn ghost" data-autopreview' + (busy ? " disabled" : "") + ">" + (a.checking ? "Checking…" : "Check bookings") + "</button>" +
      '<button type="button" class="btn brand" data-autorun' + (canGo ? "" : " disabled") + ">" + esc(go) + "</button></div>" +
      biRangeHtml(a, busy) + biSchedHtml(a) + '<div class="bi-body">' + (P ? biSteps(1).replace(/Files/g,"Check") + biProtected() : "");
    if (a.result) h += autoResultHtml(a.result);
    if (a.error) h += '<div class="alert" role="alert">' + esc(a.error) + "</div>";
    if (!P) {
      if (!a.error && !busy && !a.result) h += '<p class="bi-hint">Check bookings to see what would change. Nothing is saved until you import.</p>';
    } else {
      var rows = biRows(P), un = biUnchangedRows(P), f = B.f || "all";
      var list = f === "unchanged" ? un : f === "all" ? rows : rows.filter(function (r) { return r.status === f; });
      var q = String(B.q || "").toLowerCase().replace(/\s+/g, "");
      h += biCoverage(P);
      h += '<div class="bi-counts" data-autopreviewsum role="group" aria-label="Check result">' +
        [["new", "New"], ["changed", "Updated"], ["review", "Needs review"], ["unchanged", "Unchanged"]].map(function (x) { return '<div class="' + (x[0] === "review" && c.review ? "warn" : "") + '"><b class="num">' + (c[x[0]] || 0) + "</b><span>" + x[1] + "</span></div>"; }).join("") + "</div>";
      if (c.invalid) h += '<div class="alert" role="alert">' + c.invalid + (c.invalid === 1 ? " record can't" : " records can't") + " be read. Fix " + (c.invalid === 1 ? "it" : "them") + " on the booking site before importing.</div>";
      if (c.review) h += '<div class="bi-warn" role="status">' + c.review + (c.review === 1 ? " booking needs" : " bookings need") + " an office decision. These will stay out of this import.</div>";
      var tabs = [["all", "All changes", rows.length], ["new", "New", c["new"] || 0], ["changed", "Updated", c.changed || 0], ["review", "Needs review", c.review || 0]];
      if (c.unchanged) tabs.push(["unchanged", "Unchanged", c.unchanged]);
      h += '<div class="bi-filters" role="group" aria-label="Filter the check result">' + tabs.map(function (x) {
        return '<button type="button" class="bi-chip" data-bifilter="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + ' <span class="num">' + x[2] + "</span></button>";
      }).join("") + '<input type="search" id="biQ" class="bi-search" placeholder="Reference or reg" aria-label="Search by reference or registration" autocomplete="off" value="' + esc(B.q || "") + '"></div>';
      if (P.selection_supported) h += '<label class="mi-selectall"><input type="checkbox" data-biselectall' + (autoSelected(P).length === (c.new || 0) + (c.changed || 0) && nImp ? " checked" : "") + (busy ? " disabled" : "") + '> Select all ready changes</label><p class="bi-hint">' + nImp + " selected · " + (c.review || 0) + " held for review</p>";
      if (!list.length) {
        h += '<p class="bi-hint" data-autoitems>' + (f === "unchanged" ? (c.unchanged ? "This check didn't list the " + c.unchanged + " unchanged bookings. They already match the app." : "No unchanged bookings.")
          : f === "all" && !rows.length ? "No booking changes. Everything on the booking site already matches the app." : "Nothing in this view.") + "</p>";
      } else {
        h += '<div class="bi-tbl" data-autoitems><div class="bi-th" aria-hidden="true"><span>Board</span><span>Date</span><span>Reference</span><span>Registration</span><span>Change</span><span>Status</span><span></span></div>' +
          list.map(function (r) { return biRowHtml(r, !!B.open[r.key], q && biQ(r.ref, r.reg).indexOf(q) < 0); }).join("") + "</div>";
        h += '<p class="bi-hint" id="biShown">' + ("") + "</p>";
      }
      h += '<details class="bi-diag"><summary><span>Import details & checks</span>' + (biChecked(P) ? '<span class="bi-chk">Report checks passed</span>' : '<span class="bi-chk off">Report counts not verified</span>') + '</summary><div class="bi-diagbody" data-autoreport>' + biReport(P) + "</div></details>";
    }
    if (a.reviews && a.reviews.length) {
      h += '<div class="bi-held"><h3>Held for the office</h3><div data-autoreviews>' + a.reviews.map(function (r) {
        var d = r.detail || {}, b = S.revCars[(d.kind || "") + "|" + r.ref], reg = (b && b.reg) || d.reg || "";
        var why = r.kind === "cancelled" ? ((d.name || "") + " · " + (d.kind || "")) : String(d.why || "").replace(/\b\d{4}-\d\d-\d\d\b/g, biDay).replace(/^./, function (x) { return x.toUpperCase(); });
        var chg = r.kind === "cancelled" ? [] : (d.changes || []).map(biChange);
        return '<div class="bi-hr"><span>' + esc((r.kind === "cancelled" ? (d.missing ? "Not on the site · " : "Cancelled · ") : "Changed · ") + r.ref) + (reg ? ' · <b class="bi-hreg">' + esc(reg) + "</b>" : "") + "<small>" + esc(why) + "</small>" +
          (chg.length ? "<small>" + esc(chg.join(" · ")) + "</small>" : "") + '</span><span class="bi-acts">' + revActs(d.kind || "", r.ref, r.kind === "cancelled" ? "" : d.why, d.changes, r.id) +
          '<button type="button" class="btn ghost small" data-reviewdone="' + esc(r.id) + '">Done</button></span></div>';
      }).join("") + "</div></div>";
    } else if (a.open_reviews) h += '<p class="bi-hint">' + a.open_reviews + " to check.</p>";
    return h + '<p class="bi-hint">It only reads from the booking site. Cancelled or changed bookings are listed for you; nothing is removed.</p></div></div>';
  }
  // The recent imports of the last 24 hours, newest first, for both tabs. Undo only where the backend says it can still be undone.
  function recentImportsHtml() {
    if (!S.recentImports) loadRecentImports();
    var groups = importGroups(S.recentImports || []);
    return '<section class="bi-recent" aria-labelledby="biRecent"><div class="bi-rh"><h3 id="biRecent">Recent imports</h3><button type="button" class="link" data-bitab="history">View history</button></div>' +
      (groups.length ? groups.slice(0,3).map(importGroupHtml).join('') : '<p class="bi-hint">No imports in the last 24 hours.</p>') + '</section>';
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
    S.autoImport = { available: !!d.available, blocked_until: d.blocked_until, last_ok: d.last_ok, last_error: d.last_error, open_reviews: d.open_reviews || 0, preview: keep.preview, error: keep.error, stale: keep.stale, checked_at: keep.checked_at, reviews: keep.reviews, custom: keep.custom, from: keep.from, to: keep.to, schedule: d.schedule, schedDraft: keep.schedDraft, result: keep.result, running: !!d.running || !!keep.running, checking: keep.checking };
    if (d.available && d.open_reviews) {
      var rv = await sb.rpc("swift_reviews_open");
      S.autoImport.reviews = rv && !rv.error ? rv.data : null;
    } else S.autoImport.reviews = null;
    if (S.view === "import") render();
  }
  async function previewAutoImport() {
    var a = S.autoImport; if (!a || a.checking || a.running) return;
    a.checking = true; a.error = ""; a.preview = null; a.result = null; render();
    var r;
    r = await callBookings(Object.assign({ action: "preview" }, a.custom ? biRange(a) : {}));
    a.checking = false;
    var out = r && r.data;
    if ((r && r.error) || !out) a.error = "Couldn't reach the booking import. Try again in a minute.";
    else if (out.ok === false) a.error = out.error || "The booking site didn't answer.";
    else if (out.error) a.error = out.error;
    else { a.preview = out.preview; a.checked_at = Date.now(); a.stale = false; S.bi.open = {}; S.bi.selected = {}; (out.preview.items || []).forEach(function(i){if(i.status === "new" || i.status === "changed") S.bi.selected[i.kind + "|" + i.ref] = true;}); }
    render(); loadAutoImport();
  }
  async function runAutoImport(btn) {
    var a = S.autoImport; if (!a || !a.preview || !a.preview.can_apply) return;
    if (a.preview.selection_supported && !autoSelected(a.preview).length && !a.preview.counts.review) return;
    a.running = true; a.error = ""; render();
    toast("Getting bookings… this can take a moment.");
    var r;
    r = await callBookings(Object.assign(Object.assign({ action: "apply", expect_hash: a.preview.hash }, a.preview.selection_supported ? { selected: autoSelected(a.preview) } : {}), a.custom ? biRange(a) : {}));
    a.running = false;
    var out = r && r.data;
    if ((r && r.error) || !out || out.ok === false) {
      a.error = (out && out.error) || "The import response was lost. Check bookings again to confirm the result before retrying.";
      a.stale = out && /changed since the preview/.test(a.error);
      toast(a.error, true); render(); return loadAutoImport();
    }
    var days = (out.summary && out.summary.days) || [];
    var added = days.reduce(function (n, d) { return n + (d.added || 0); }, 0);
    var updated = days.reduce(function (n, d) { return n + (d.updated || 0); }, 0);
    a.result = out.summary; a.preview = null; a.stale = false;
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
  // The move the app can make safely: a car not gone; DROPS not already early;
  // PICKS to the booking site's new drop-off, by the office (part 102).
  function revMove(kind, why, changes, b) {
    var m = /moved from sheet (\d{4}-\d\d-\d\d) to (\d{4}-\d\d-\d\d)/.exec(why || "");
    if (m && kind === "picks" && b && !b.removed_at && can("import") && (b.sheets || {}).day !== m[2]) {
      var dr = (changes || []).filter(function (c) { return c.field === "drop"; })[0];
      return dr && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(dr.to || "") && dr.to.slice(0, 10) === m[2] ? { day: m[2], drop: dr.to } : null;
    }
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
    return (mv ? '<button type="button" class="btn small" data-rvmove="' + esc(k) + '">Move to ' + esc(sheetLabel({ kind: kind, day: mv.day }).replace(/^(DROPS|PICKS) /, "")) + "</button>" : "") +
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
    var to = sheetLabel({ kind: b.kind, day: mv.day });
    if (!confirm("Move " + (b.reg || "this car") + " to " + to + (mv.drop ? ", drop-off " + biWhen(mv.drop) + "?" : mv.ret ? ", back " + biWhen(mv.ret) + "?" : " as an early return?"))) return;
    btn.disabled = true;
    var x = mv.drop ? await sb.rpc("move_pick", { p_booking: b.id, p_drop_local: mv.drop }) : mv.ret ? await sb.rpc("set_return", { p_booking: b.id, p_return_local: mv.ret }) : await sb.rpc("early_return", { p_booking: b.id, p_day: mv.day });
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
    var auto = autoInfo(), tab = B.tab === 'history' ? 'history' : auto ? (B.tab || 'auto') : 'manual';
    var h = '<div class="bi">';
    h += '<div class="bi-tabs" role="tablist" aria-label="Booking source">' +
      (auto ? '<button type="button" role="tab" data-bitab="auto" aria-selected="' + (tab === 'auto') + '">Auto import</button>' : '') +
      '<button type="button" role="tab" data-bitab="manual" aria-selected="' + (tab === 'manual') + '">Manual import</button><button type="button" role="tab" data-bitab="history" aria-selected="' + (tab === 'history') + '">History</button></div>';
    if (tab === "history") return h + importHistoryHtml() + "</div>";
    if (tab === "auto") return h + autoPanel(auto) + recentImportsHtml() + "</div>";
    return h + manualPanel(I) + "</div>";
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
    var preview = await sb.rpc("reviewed_import_undo_preview", {p_id:+id});
    if (preview.error) return toast(preview.error.message,true);
    var detail = preview.data || {}, details = (detail.changed || []).map(function(x){return (x.ref || x.reg) + ': ' + (x.changes || []).map(biChange).join('; ');}).concat((detail.added || []).map(function(x){return 'Added booking: ' + (x.ref || '') + ' ' + (x.reg || '');}));
    if (!confirm("Undo this import?" + (it ? "\n\n" + it.kind.toUpperCase() + " " + it.day + ", imported " + hhmm(it.at) + " by " + it.by + ": " + it.added + " cars added, " + it.changed + " changed." : "") +
      "\n\n" + details.slice(0,20).join("\n") + (details.length>20?"\n… and more":"") + "\n\nThe cars it added are taken off, and what it changed goes back to how it was. Taps made since are kept.")) return;
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

