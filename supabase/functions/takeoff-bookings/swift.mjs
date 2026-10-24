// Pure logic for the read-only Swift booking sync: no Deno, no Supabase, so
// checks/swift-sync.mjs can run it with pretend sites and sanitised fixtures.
//   - guarded HTTPS client (approved host, approved scripts, GET only, one login POST)
//   - report validation (HTML, truncation, columns, scope, empty results)
//   - the planner: new / changed / unchanged / review / invalid, with a hash
import { parseExcelGrid, groupForImport, addDaysKey } from "./reader.mjs";

export const DEFAULT_HOSTS = ["www.luton.swiftairportparking.co.uk"];
export const MAX_REQUESTS = 24; // one search + one export per day read, a sign-in, a flights search, a cancelled search
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_SPAN_DAYS = 14;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Scripts that change things on the site. Never allowed, whatever the config says.
const FORBIDDEN = /(edit|cancel|activate|deactivate|status|password|delete|remove|update|save|insert|add|new|refund|payment|user|admin_|logout)/i;

// ── London dates (calendar maths on keys, never "+24h", so DST can't shift a day) ──
export function londonDay(nowMs, offsetDays = 0) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(nowMs));
  const g = (t) => p.find((x) => x.type === t).value;
  return addDaysKey(g("year") + "-" + g("month") + "-" + g("day"), offsetDays);
}
export function siteDate(key) { // "2026-10-05" -> "05-October-2026", as the site's date boxes want it
  const [y, m, d] = key.split("-");
  return d + "-" + MONTHS[+m - 1] + "-" + y;
}
export function windowFor(nowMs, days) {
  const n = Math.max(1, Math.min(MAX_SPAN_DAYS, Math.floor(Number(days) || 1)));
  return { from: londonDay(nowMs, 0), to: londonDay(nowMs, n - 1) };
}

// A date range the office typed: both ends as yyyy-mm-dd, from not after to, at most MAX_SPAN_DAYS days, and
// not further than 30 days back or 60 ahead. Returns { from, to } or throws a sentence for the screen.
export function rangeFor(nowMs, from, to) {
  const ok = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k)) && addDaysKey(String(k), 0) === String(k);
  if (!ok(from) || !ok(to)) throw new Error("Choose a From and a To date.");
  if (from > to) throw new Error("The From date is after the To date.");
  const span = Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86400000) + 1;
  if (span > MAX_SPAN_DAYS) throw new Error("Choose at most " + MAX_SPAN_DAYS + " days at a time.");
  if (from < londonDay(nowMs, -30)) throw new Error("The From date is more than 30 days ago.");
  if (to > londonDay(nowMs, 60)) throw new Error("The To date is more than 60 days ahead.");
  return { from, to };
}
// Requests one run may make for that many days: a search and an export per day for picks and for drops (drops read one day further),
// the flights page per drops day, a sign-in and the cancelled search, with a little spare.
export function requestBudget(days) { return Math.max(MAX_REQUESTS, 5 * Math.max(1, days) + 12); }

// ── the guarded client ──────────────────────────────────────────────────────
// cfg: { base, hosts?, login_path, login_fields, scripts: ["bookinglist-parkandride.php", ...] }
// io:  { fetch, sleep?, user, pass }
export function scriptOf(u) { return u.pathname.split("/").pop(); }

export function assertAllowed(urlStr, base, hosts, scripts, method) {
  let u, b;
  try { u = new URL(urlStr, base); b = new URL(base); } catch { throw new Error("Booking site address isn't valid."); }
  if (b.protocol !== "https:") throw new Error("The booking site must be an https address.");
  if (!hosts.includes(b.hostname)) throw new Error("Booking site host isn't on the approved list.");
  if (u.protocol !== "https:" || u.hostname !== b.hostname || u.port !== b.port) throw new Error("Blocked a request to another address: " + u.origin);
  if (u.username || u.password) throw new Error("Blocked an address with a login in it.");
  if (!u.pathname.startsWith(b.pathname)) throw new Error("Blocked a request outside the admin area.");
  const script = scriptOf(u);
  if (!scripts.includes(script)) throw new Error("Blocked a page that isn't one of the approved reports: " + script);
  if (FORBIDDEN.test(script.replace(/bookinglist/i, "").replace(/parkandride/i, ""))) throw new Error("Blocked a page that could change bookings: " + script);
  if (method !== "GET" && method !== "POST") throw new Error("Blocked a " + method + " request.");
  return u;
}

export function makeClient(cfg, io) {
  const hosts = cfg.hosts && cfg.hosts.length ? cfg.hosts : DEFAULT_HOSTS;
  const loginScript = scriptOf(new URL(cfg.login_path || "index.php?req=login", cfg.base));
  const scripts = Array.from(new Set([loginScript, ...(cfg.scripts || [])]));
  const jar = {}; let count = 0, loginPosted = false, searchPosts = 0;
  const postScripts = cfg.post_scripts || []; // report pages whose search form is a POST (Return Report), one search per day read
  const maxPosts = Math.max(2, Number(cfg.max_search_posts) || 0);
  const sleep = io.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const cookieHeader = () => Object.entries(jar).map(([k, v]) => k + "=" + v).join("; ");
  const store = (res) => {
    const raw = (res.headers.getSetCookie ? res.headers.getSetCookie() : []) || [];
    raw.forEach((c) => { const m = c.match(/^([^=]+)=([^;]*)/); if (m) jar[m[1]] = m[2]; });
  };
  // One request. Redirects are followed by hand (max 3), each checked like the first.
  async function send(urlStr, method, body, follow = true) {
    let url = urlStr, m = method, b = body;
    for (let hop = 0; hop <= 3; hop++) {
      const u = assertAllowed(url, cfg.base, hosts, scripts, m);
      if (m === "POST") {
        const sc = scriptOf(u);
        if (sc === loginScript) { if (loginPosted) throw new Error("Blocked a second sign-in attempt."); loginPosted = true; }
        else if (postScripts.includes(sc)) { if (++searchPosts > maxPosts) throw new Error("Blocked: too many searches in one run."); }
        else throw new Error("Blocked a form submission to " + sc + ".");
      }
      if (++count > (cfg.max_requests || MAX_REQUESTS)) throw new Error("Stopped: too many requests in one run.");
      if (count > 1) await sleep(400);
      const headers = { cookie: cookieHeader(), accept: "*/*" };
      if (m === "POST") headers["content-type"] = "application/x-www-form-urlencoded";
      const res = await io.fetch(u.toString(), { method: m, headers, body: m === "POST" ? b : undefined, redirect: "manual" });
      store(res);
      if (res.status >= 300 && res.status < 400) {
        if (!follow) return { res, url: u, redirect: res.headers.get("location") || "" };
        const loc = res.headers.get("location");
        if (!loc) throw new Error("Booking site redirected without a destination.");
        url = new URL(loc, u).toString(); m = "GET"; b = undefined; continue;
      }
      return { res, url: u };
    }
    throw new Error("Too many redirects from the booking site.");
  }
  return {
    get count() { return count; },
    async login() {
      if (!io.user || !io.pass) throw new Error("No booking login saved (TAKEOFF_BOOKING_LOGIN / _PASSWORD).");
      const f = cfg.login_fields || {};
      const body = new URLSearchParams();
      body.set(f.login || "login", io.user); body.set(f.password || "password", io.pass);
      Object.entries(f.extra || { action: "Sign In", url: "%3F" }).forEach(([k, v]) => body.set(k, v));
      // The sign-in answer is read as it comes; its redirect is never followed.
      const { res, redirect } = await send(new URL(cfg.login_path || "index.php?req=login", cfg.base).toString(), "POST", body.toString(), false);
      const text = redirect ? "" : await res.text();
      const stillLogin = redirect ? /login|req=login|index\.php\?/i.test(redirect) && !/home|main|booking/i.test(redirect) : /name=["']?password/i.test(text);
      if (res.status >= 400 || stillLogin || (!redirect && !Object.keys(jar).length)) {
        const e = new Error("Booking site sign-in failed. Check the saved login; no further attempts are made."); e.code = "login_failed"; throw e;
      }
    },
    // The search page itself, as text (for a report that has no export, like the Return Report).
    async page(searchPath) {
      const s = await send(new URL(searchPath, cfg.base).toString(), "GET");
      const t = await s.res.text();
      if (/name=["']?password/i.test(t)) { const e = new Error("The booking site asked for a sign-in again (session expired). Nothing was imported."); e.code = "session_expired"; throw e; }
      if (!s.res.ok || t.length > MAX_BYTES) throw new Error("The report page didn't load properly. Nothing was imported.");
      return t;
    },
    // A report whose search form is a POST (the Return Report): send the search fields, read the page back.
    async postPage(searchPath, fields) {
      const body = new URLSearchParams(); Object.entries(fields).forEach(([k, v]) => body.set(k, String(v)));
      const s = await send(new URL(searchPath, cfg.base).toString(), "POST", body.toString());
      const t = await s.res.text();
      if (/name=["']?password/i.test(t)) { const e = new Error("The booking site asked for a sign-in again (session expired). Nothing was imported."); e.code = "session_expired"; throw e; }
      if (!s.res.ok || t.length > MAX_BYTES) throw new Error("The report page didn't load properly. Nothing was imported.");
      return t;
    },
    async download(searchPath, exportPath) {
      const s = await send(new URL(searchPath, cfg.base).toString(), "GET");
      const st = await s.res.text();
      if (/name=["']?password/i.test(st)) { const e = new Error("The booking site asked for a sign-in again (session expired). Nothing was imported."); e.code = "session_expired"; throw e; }
      const x = await send(new URL(exportPath, cfg.base).toString(), "GET");
      if (!x.res.ok) throw new Error("Download failed (" + x.res.status + ") for " + exportPath + ".");
      const buf = new Uint8Array(await x.res.arrayBuffer());
      const declared = Number(x.res.headers.get("content-length"));
      if (declared && declared !== buf.length) throw new Error("The download was cut short (" + buf.length + " of " + declared + " bytes). Nothing was imported.");
      const out = checkDownload(buf, x.res.headers.get("content-type") || "");
      // The search page says how many bookings it found ("(125 results)"); the caller compares that with the download.
      const plain = st.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
      const m = plain.match(/(\d[\d,]*)\s+results?\b/i);
      out.siteRows = m ? Number(m[1].replace(/,/g, "")) : null;
      const at = plain.search(/results?\b/i);
      out.siteNote = (at >= 0 ? plain.slice(Math.max(0, at - 60), at + 40) : plain.slice(0, 100)).trim();
      // What the page's own search form holds (names and the chosen values), so a search built by address can be compared with a manual one.
      const ctl = [];
      for (const sm of st.matchAll(/<select[^>]*\bname=["']?([\w.\[\]-]+)["']?[^>]*>([\s\S]*?)<\/select>/gi)) {
        const opts = [...sm[2].matchAll(/<option([^>]*)>([^<]*)/gi)];
        const sel = opts.find((o) => /\bselected\b/i.test(o[1])) || opts[0];
        if (sel) { const v = (sel[1].match(/value=["']?([^"'\s>]*)/i) || [])[1]; ctl.push(sm[1] + "=" + (v ?? "") + " (" + sel[2].trim() + ") of " + opts.map((o) => ((o[1].match(/value=["']?([^"'\s>]*)/i) || [])[1] ?? "") + ":" + o[2].trim()).join("/")); }
      }
      for (const im of st.matchAll(/<input([^>]*)>/gi)) {
        const n = (im[1].match(/\bname=["']?([\w.\[\]-]+)/i) || [])[1], t = (im[1].match(/\btype=["']?(\w+)/i) || [])[1] || "text";
        if (n && !/^(password|hidden)$/i.test(t) || (n && /hidden/i.test(t))) ctl.push(n + "=" + ((im[1].match(/\bvalue=["']([^"']*)/i) || [])[1] ?? ""));
      }
      out.siteForm = ctl.join("; ").slice(0, 1500);
      return out;
    },
  };
}

export function checkDownload(buf, contentType) {
  if (!buf || !buf.length) throw new Error("The download was empty. Nothing was imported.");
  if (buf.length > MAX_BYTES) throw new Error("The download is far bigger than expected. Nothing was imported.");
  const head = new TextDecoder().decode(buf.slice(0, 600)).trim().toLowerCase();
  if (/text\/html/i.test(contentType) || head.startsWith("<!doctype html") || head.startsWith("<html") || /<form|<body/.test(head))
    throw new Error("The booking site sent a web page instead of the report. Nothing was imported.");
  return buf;
}

// The export is plain tab-separated text. Reading it directly is far lighter than SheetJS (the function has a small CPU
// allowance, and a run now reads one export per day). Returns null when the file is not that kind of text.
export function parseTsv(buf) {
  if (!buf || buf.length < 2 || (buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf)) return null; // zip / old binary xls
  const t = new TextDecoder("utf-8").decode(buf).replace(/^\uFEFF/, "");
  const nl = t.indexOf("\n");
  if (t.indexOf("\t") < 0 || (nl >= 0 && t.indexOf("\t") > nl) || t.indexOf("\0") >= 0) return null;
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell === "") q = true;
    else if (c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

// The Return Report page only offers a PDF, but its table (with the Flight No. boxes) is
// plain HTML: read it as a grid. Text of each cell; for a cell holding an <input>, its value.
export function parseHtmlTable(html) {
  const grid = [];
  const text = (h) => h.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&pound;/g, "£").replace(/\s+/g, " ").trim();
  (String(html).match(/<tr[\s\S]*?<\/tr>/gi) || []).forEach((tr) => {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map((c) => {
      // The Flight No. boxes: value="W61601", value='W61601' or value=W61601 (older pages leave out the quotes).
      // Hidden fields (a booking id beside the box) are skipped; several visible boxes are read together.
      const vals = [...c.matchAll(/<input\b([^>]*)>/gi)].filter((m) => !/\btype\s*=\s*["']?hidden/i.test(m[1])).map((m) => {
        const v = m[1].match(/\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        return v ? (v[1] ?? v[2] ?? v[3] ?? "").trim() : "";
      }).filter(Boolean);
      const ta = c.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
      const sel = c.match(/<option[^>]*selected[^>]*>([\s\S]*?)<\/option>/i);
      return vals.length ? vals.join(" ") : ta && text(ta[1]) ? text(ta[1]) : sel ? text(sel[1]) : text(c);
    });
    if (cells.some(Boolean)) grid.push(cells);
  });
  if (!grid.length) throw new Error("No table was found on the report page. Nothing was imported.");
  return grid;
}

// ── report validation ─────────────────────────────────────────────────────
const REQUIRED = ["ref", "name", "meet", "ret"];

// grid -> rows (cancelled ones kept, marked), after scope + structure checks.
// scope: { column: "Supplier", values: ["TakeOff"] }  (case-insensitive, trimmed)
export function readReport(grid, scope, opts = {}) {
  // scope: one {column, values} or a list of them; a booking must match every one
  // (e.g. Supplier Name AND Booking Type).
  // {all: true} = the owner confirmed every booking on this site is TakeOff's (14 Oct).
  const allMine = !!(scope && !Array.isArray(scope) && scope.all === true);
  const conds = allMine ? [] : (Array.isArray(scope) ? scope : scope ? [scope] : []);
  if (!allMine && (!conds.length || conds.some((c) => !c || !c.column || !Array.isArray(c.values) || !c.values.length)))
    throw new Error("Supplier scope isn't configured, so no bookings were read. Nothing was imported.");
  let excludedScope = 0, hr = -1;
  const idx = [];
  if (allMine) hr = 0;
  for (let r = 0; r < Math.min(grid.length, 20) && hr < 0; r++) {
    const cols = conds.map((c) => grid[r].findIndex((x) => String(x).trim().toLowerCase() === String(c.column).trim().toLowerCase()));
    if (cols.every((c) => c >= 0)) { hr = r; idx.push(...cols); }
  }
  if (!allMine && hr < 0) throw new Error("The report has no " + conds.map((c) => "'" + c.column + "'").join(" / ") + " column, so TakeOff's bookings can't be told apart. Nothing was imported.");
  const want = conds.map((c) => c.values.map((v) => String(v).trim().toLowerCase()));
  const body = allMine ? grid.slice(0) : grid.slice(hr + 1).filter((row) => {
    if (!row.some((x) => String(x).trim())) return false;
    const ok = idx.every((c, i) => want[i].includes(String(row[c]).trim().toLowerCase()));
    if (!ok) excludedScope++;
    return ok;
  });
  const g = allMine ? grid : grid.slice(0, hr + 1).concat(body);
  const parsed = parseExcelGrid(g, { keepCancelled: true });
  const need = opts.flights ? ["ref", "flight"] : REQUIRED; // the Return Report has no meet/return columns, only flights
  const missing = need.filter((k) => !parsed.columns.includes(k));
  if (missing.length) throw new Error("The report is missing columns (" + missing.join(", ") + "); it may have changed. Nothing was imported.");
  if (!opts.flights && !parsed.columns.includes("reg") && !parsed.columns.includes("vehicle")) throw new Error("The report has no registration or vehicle column. Nothing was imported.");
  if (!parsed.rows.length) {
    if (opts.allowEmpty) return { rows: [], excludedScope, columns: parsed.columns };
    throw new Error("The report has no bookings for this scope and dates. An empty result isn't accepted without a reason; nothing was imported.");
  }
  // The export is whatever the site last searched, so prove it matches the dates we asked for.
  if (opts.window && opts.field) {
    const off = parsed.rows.filter((r) => !r.cancelled && r[opts.field] && r[opts.field].key && (r[opts.field].key < opts.window.from || r[opts.field].key > opts.window.to));
    if (off.length) throw new Error("The export doesn't match the dates searched (" + off.length + " booking(s) outside " + opts.window.from + " to " + opts.window.to + "). Nothing was imported.");
  }
  if (opts.pageSize && body.length >= opts.pageSize) throw new Error("The report has exactly one page of rows (" + body.length + "), so it may be incomplete. Nothing was imported.");
  if (parsed.rows.length > 1000) throw new Error("More than 1000 bookings in one report; narrow the dates. Nothing was imported.");
  return { rows: parsed.rows, excludedScope, columns: parsed.columns };
}

// ── planner ───────────────────────────────────────────────────────────────
const squash = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const same = (a, b) => String(a || "").trim() === String(b || "").trim();

// existing: Map "kind|ref" -> { reg,name,phone,make,drop_local,return_local,flight,flight_typed,note,sheet_day,cleared,removed,early,sent }
// onSheets: the cars the app holds on the sheets whose days were read in full ({ kind, day, ref, reg, name }),
// so a booking the site no longer lists at all (24 Oct: a deleted temp booking) reaches the review list too.
export function plan({ drops = [], picks = [], existing, window: win, cutoff = "06:00", cancelledRows = [], onSheets = [] }) {
  const out = { window: win, counts: { new: 0, changed: 0, unchanged: 0, review: 0, invalid: 0, outside: 0 }, items: [], reviews: [], invalid: [], batches: [], existing: [...existing.values()].sort((a,b) => (a.kind + a.ref).localeCompare(b.kind + b.ref)) };
  const slack = { from: addDaysKey(win.from, -1), to: addDaysKey(win.to, 1) };
  const seen = new Map();
  const batchOf = new Map();
  const review = (kind, ref, detail) => { out.reviews.push({ ref, kind, detail }); out.counts.review++; };

  [["drops", drops], ["picks", picks]].forEach(([kind, rows]) => {
    const live = rows.filter((r) => !r.cancelled);
    // Duplicate refs inside one report with different content = ambiguous: nothing from them is imported.
    const byRef = {};
    live.forEach((r) => { if (r.ref) (byRef[r.ref] = byRef[r.ref] || []).push(r); });
    const bad = new Set();
    Object.keys(byRef).forEach((ref) => {
      const a = byRef[ref];
      if (a.length > 1 && new Set(a.map((r) => JSON.stringify([r.reg, r.name, r.meet, r.ret]))).size > 1) {
        bad.add(ref); out.invalid.push({ kind, ref, reason: "ambiguous: the same reference appears " + a.length + " times with different details" }); out.counts.invalid++;
      }
    });
    const usable = live.filter((r) => {
      if (!r.ref) { out.invalid.push({ kind, ref: "", reason: "no booking reference", name: r.name }); out.counts.invalid++; return false; }
      if (!r.reg) { out.invalid.push({ kind, ref: r.ref, reason: "missing registration" }); out.counts.invalid++; return false; }
      if (bad.has(r.ref)) return false;
      const need = kind === "drops" ? r.ret : r.meet;
      if (!need || !need.key || (kind === "drops" && !r.meet) ) { out.invalid.push({ kind, ref: r.ref, reason: "missing or unreadable date" }); out.counts.invalid++; return false; }
      if (kind === "drops" && !r.ret.time) { out.invalid.push({ kind, ref: r.ref, reason: "return has no time" }); out.counts.invalid++; return false; }
      return true;
    });
    // dedupe identical repeats
    const uniq = []; usable.forEach((r) => { const k = kind + "|" + r.ref; if (!seen.has(k)) { seen.set(k, 1); uniq.push(r); } });
    groupForImport(uniq, kind, cutoff).forEach((g) => {
      if (g.day < slack.from || g.day > slack.to) { out.counts.outside += g.rows.length; return; }
      g.rows.forEach((row) => {
        const ex = existing.get(kind + "|" + row.ref);
        const item = { kind, day: g.day, ref: row.ref, reg: row.reg, name: row.name, booking_id: ex?.id, yard: ex?.yard, number: ex?.num, lane: ex?.lane, position: ex?.position };
        if (ex) item.attention = row.return_local && ex.return_local && row.return_local < ex.return_local ? 'Earlier return — check yard access' : row.reg && squash(row.reg)!==squash(ex.reg) ? 'Registration changed — check key tag' : '';
        if (!ex) { out.counts.new++; out.items.push({ ...item, status: "new" }); push(kind, g.day, row); return; }
        const changes = [];
        const chk = (f, a, b) => { if (a) changes.push({ field: f, from: b || "", to: a }); };
        if (row.reg && squash(row.reg) !== squash(ex.reg)) chk("reg", row.reg, ex.reg);
        ["name", "phone", "make"].forEach((f) => { if (row[f] && !same(row[f], ex[f])) chk(f, row[f], ex[f]); });
        if (row.drop_local && !same(row.drop_local, ex.drop_local)) chk("drop", row.drop_local, ex.drop_local);
        if (row.return_local && !same(row.return_local, ex.return_local)) chk("return", row.return_local, ex.return_local);
        if (kind === "drops" && row.flight && !ex.flight_typed && !same(row.flight, ex.flight)) chk("flight", row.flight, ex.flight);
        if (row.note && !ex.note) chk("note", row.note, "");
        const dayMoved = ex.sheet_day && ex.sheet_day !== g.day;
        const done = ex.cleared || ex.removed;
        const critical = changes.some((c) => ["reg", "drop", "return"].includes(c.field));
        const typed = changes.some((c) => c.field === "reg" && ex.reg_typed || c.field === "return" && ex.return_typed || c.field === "drop" && ex.drop_typed);
        if (typed || ex.sent && critical) { review("conflict", row.ref, { kind, why: typed ? "the office has edited these details; open the booking to confirm the change" : "car is with a driver; check before changing its details", changes }); out.items.push({ ...item, status: "review", changes }); return; }
        if (done && (critical || dayMoved)) { review("conflict", row.ref, { kind, why: "already handed back or removed, but the booking site now shows different details", changes }); out.items.push({ ...item, status: "review", changes }); return; }
        if (dayMoved) {
          const laterReturn = kind === "drops" && row.return_local && ex.return_local && row.return_local > ex.return_local && !ex.early;
          if (!laterReturn) { review("conflict", row.ref, { kind, why: "moved from sheet " + ex.sheet_day + " to " + g.day + "; the app can't move it safely", changes }); out.items.push({ ...item, status: "review", changes }); return; }
        }
        if (!changes.length && !dayMoved) { out.counts.unchanged++; out.items.push({ ...item, status: "unchanged" }); return; }
        out.counts.changed++; out.items.push({ ...item, status: "changed", attention: changes.some(c => c.field === "return" && c.to < c.from) ? "Earlier return — check yard access" : changes.some(c => c.field === "reg") ? "Registration changed — check key tag" : "", changes: dayMoved ? changes.concat([{ field: "day", from: ex.sheet_day, to: g.day }]) : changes });
        // A typed flight wins: never send ours for that car.
        push(kind, g.day, ex.flight_typed ? { ...row, flight: "" } : row);
      });
    });
  });

  // Cancelled in the report: flag for the office; never remove anything. Only cars the app has.
  const done = new Set();
  cancelledRows.forEach(({ kind, row }) => {
    const k = kind + "|" + row.ref;
    if (!row.ref || done.has(k)) return; done.add(k);
    const ex = existing.get(k);
    if (ex && !ex.removed) review("cancelled", row.ref, { kind, name: row.name, reg: row.reg, return: row.ret ? row.ret.key + " " + row.ret.time : "", on_sheet: ex.sheet_day });
  });
  // Not listed by the site any more, on a day it listed in full: the same question manual import asks
  // ("isn't in this file any more"). Office review only; nothing is removed.
  const listed = new Set();
  [["drops", drops], ["picks", picks]].forEach(([kind, rows]) => rows.forEach((r) => { if (r.ref) listed.add(kind + "|" + r.ref); }));
  onSheets.forEach((c) => {
    const k = c.kind + "|" + c.ref;
    if (!c.ref || listed.has(k) || done.has(k) || out.reviews.some((r) => r.ref === c.ref && r.kind === "cancelled")) return; done.add(k);
    review("cancelled", c.ref, { kind: c.kind, name: c.name || "", reg: c.reg || "", on_sheet: c.day, missing: true });
  });

  function push(kind, day, row) {
    const k = kind + "|" + day;
    if (!batchOf.has(k)) { const b = { kind, day, rows: [] }; batchOf.set(k, b); out.batches.push(b); }
    batchOf.get(k).rows.push(row);
  }
  out.batches.sort((a, b) => (a.kind + a.day < b.kind + b.day ? -1 : 1));
  out.reviews.sort((a, b) => (a.kind + a.ref < b.kind + b.ref ? -1 : 1));
  return out;
}

export async function planHash(p) {
  const s = JSON.stringify({ b: p.batches, r: p.reviews, i: p.items, e: p.existing, w: p.window });
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

// What the app shows: counts and short lists, no phone numbers.
// How many rows each report held, per day and per status, so the office can compare with the booking site.
// The Return Report's search fields for one day. The site's product filter is "producttype"
// (14 Oct); a saved "productype" is sent under both names so the site never falls back to its default product.
export function flightFields(fields, day, siteDay) {
  const out = {};
  Object.entries(fields || {}).forEach(([k, v]) => { out[k] = String(v).replace(/\{FROM\}|\{TO\}/g, siteDay(day)); });
  if ("productype" in out && !("producttype" in out)) out.producttype = out.productype;
  return out;
}

export function reportStats(rows, field, site) {
  const by_day = {}, by_status = {};
  rows.forEach((r) => {
    const d = r[field] && r[field].key ? r[field].key : "?";
    by_day[d] = (by_day[d] || 0) + 1;
    const st = r.cancelled ? "Cancelled" : (r.status || "—");
    by_status[st] = (by_status[st] || 0) + 1;
  });
  return { rows: rows.length, by_day, by_status, site: site || {} };
}

export function previewView(p, hash) {
  return {
    hash, selection_supported: true, window: p.window, counts: p.counts, can_apply: p.counts.invalid === 0 && (p.batches.length > 0 || p.reviews.length > 0),
    items: p.items.filter((i) => i.status !== "unchanged"), reviews: p.reviews, invalid: p.invalid,
    // The unchanged ones, for the optional "Unchanged" view: just which booking, nothing else.
    unchanged: p.items.filter((i) => i.status === "unchanged").slice(0, 600).map((i) => ({ kind: i.kind, day: i.day, ref: i.ref, reg: i.reg })),
  };
}

// Selection is checked against the freshly collected full plan, never a client supplied row.
export function selectedBatches(p, keys) {
  if (keys === undefined) return p.batches; // scheduled and older clients keep their existing behaviour
  if (!Array.isArray(keys) || keys.length > 10000 || keys.some(k => typeof k !== "string")) throw new Error("Invalid booking selection.");
  const wanted = new Set(keys), allowed = new Set(p.items.filter(i => i.status === "new" || i.status === "changed").map(i => i.kind + "|" + i.ref));
  if (wanted.size !== keys.length || [...wanted].some(k => !allowed.has(k))) throw new Error("A selected booking needs review or is no longer available. Check again.");
  return p.batches.map(b => ({ ...b, rows: b.rows.filter(r => wanted.has(b.kind + "|" + r.ref)) })).filter(b => b.rows.length);
}

// ── scheduled runs ──────────────────────────────────────────────────────────
// times: "HH:MM" in London time. The slot due now is the latest time that has passed in the last GRACE minutes today and
// is later than the last slot already handled ("2026-10-14 12:00"), so a slot is attempted once, never retried every tick.
export const SLOT_GRACE_MIN = 30;
export function cleanTimes(times) {
  const ok = Array.from(new Set((Array.isArray(times) ? times : []).map((t) => String(t).trim()).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))).sort();
  return ok.slice(0, 6);
}
export function dueSlot(nowMs, times, lastSlot) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(nowMs));
  const now = (+p.find((x) => x.type === "hour").value % 24) * 60 + +p.find((x) => x.type === "minute").value;
  const day = londonDay(nowMs, 0);
  let best = "";
  cleanTimes(times).forEach((t) => {
    const m = +t.slice(0, 2) * 60 + +t.slice(3);
    if (m <= now && now - m <= SLOT_GRACE_MIN) best = t;
  });
  const slot = best ? day + " " + best : "";
  return slot && slot > String(lastSlot || "") ? slot : "";
}
// "Import if clean": nothing invalid, no review case the office hasn't already been told about, and no unusually large change.
// knownReviews: Set of "kind|ref" already on the open review list. Returns { go, why }.
export function scheduleDecision(p, knownReviews, maxChanges = 200) {
  if (p.counts.invalid > 0) return { go: false, why: p.counts.invalid + (p.counts.invalid === 1 ? " booking can't be read" : " bookings can't be read") };
  const fresh = p.reviews.filter((r) => !knownReviews.has(r.kind + "|" + r.ref));
  if (fresh.length) return { go: false, why: fresh.length + (fresh.length === 1 ? " booking needs" : " bookings need") + " a decision" };
  const n = p.counts.new + p.counts.changed;
  if (n > maxChanges) return { go: false, why: n + " changes is more than a scheduled run imports on its own" };
  return { go: true, why: "" };
}
