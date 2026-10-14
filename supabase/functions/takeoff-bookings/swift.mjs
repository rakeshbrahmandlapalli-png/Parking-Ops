// Pure logic for the read-only Swift booking sync: no Deno, no Supabase, so
// checks/swift-sync.mjs can run it with pretend sites and sanitised fixtures.
//   - guarded HTTPS client (approved host, approved scripts, GET only, one login POST)
//   - report validation (HTML, truncation, columns, scope, empty results)
//   - the planner: new / changed / unchanged / review / invalid, with a hash
import { parseExcelGrid, groupForImport, addDaysKey } from "./reader.mjs";

export const DEFAULT_HOSTS = ["www.luton.swiftairportparking.co.uk"];
export const MAX_REQUESTS = 8;
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
  const postScripts = cfg.post_scripts || []; // report pages whose search form is a POST (Return Report), one search per run each
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
        else if (postScripts.includes(sc)) { if (++searchPosts > 2) throw new Error("Blocked: too many searches in one run."); }
        else throw new Error("Blocked a form submission to " + sc + ".");
      }
      if (++count > MAX_REQUESTS) throw new Error("Stopped: too many requests in one run.");
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
      return checkDownload(buf, x.res.headers.get("content-type") || "");
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

// The Return Report page only offers a PDF, but its table (with the Flight No. boxes) is
// plain HTML: read it as a grid. Text of each cell; for a cell holding an <input>, its value.
export function parseHtmlTable(html) {
  const grid = [];
  const text = (h) => h.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&pound;/g, "£").replace(/\s+/g, " ").trim();
  (String(html).match(/<tr[\s\S]*?<\/tr>/gi) || []).forEach((tr) => {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map((c) => {
      const inp = c.match(/<input[^>]*value=["']([^"']*)["']/i);
      const sel = c.match(/<option[^>]*selected[^>]*>([\s\S]*?)<\/option>/i);
      return inp ? inp[1].trim() : sel ? text(sel[1]) : text(c);
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
export function plan({ drops = [], picks = [], existing, window: win, cutoff = "06:00", cancelledRows = [] }) {
  const out = { window: win, counts: { new: 0, changed: 0, unchanged: 0, review: 0, invalid: 0, outside: 0 }, items: [], reviews: [], invalid: [], batches: [] };
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
        const item = { kind, day: g.day, ref: row.ref, reg: row.reg, name: row.name };
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
        if (done && (critical || dayMoved)) { review("conflict", row.ref, { kind, why: "already handed back or removed, but the booking site now shows different details", changes }); out.items.push({ ...item, status: "review", changes }); return; }
        if (dayMoved) {
          const laterReturn = kind === "drops" && row.return_local && ex.return_local && row.return_local > ex.return_local && !ex.early;
          if (!laterReturn) { review("conflict", row.ref, { kind, why: "moved from sheet " + ex.sheet_day + " to " + g.day + "; the app can't move it safely", changes }); out.items.push({ ...item, status: "review", changes }); return; }
        }
        if (!changes.length && !dayMoved) { out.counts.unchanged++; out.items.push({ ...item, status: "unchanged" }); return; }
        out.counts.changed++; out.items.push({ ...item, status: "changed", changes: dayMoved ? changes.concat([{ field: "day", from: ex.sheet_day, to: g.day }]) : changes });
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
  const s = JSON.stringify({ b: p.batches, r: p.reviews.map((x) => [x.kind, x.ref]), w: p.window });
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

// What the app shows: counts and short lists, no phone numbers.
// How many rows each report held, per day and per status, so the office can compare with the booking site.
export function reportStats(rows, field) {
  const by_day = {}, by_status = {};
  rows.forEach((r) => {
    const d = r[field] && r[field].key ? r[field].key : "?";
    by_day[d] = (by_day[d] || 0) + 1;
    const st = r.cancelled ? "Cancelled" : (r.status || "—");
    by_status[st] = (by_status[st] || 0) + 1;
  });
  return { rows: rows.length, by_day, by_status };
}

export function previewView(p, hash) {
  const lim = (a) => a.slice(0, 200);
  return {
    hash, window: p.window, counts: p.counts, can_apply: p.counts.invalid === 0 && (p.batches.length > 0 || p.reviews.length > 0),
    items: lim(p.items.filter((i) => i.status !== "unchanged")), reviews: lim(p.reviews), invalid: lim(p.invalid),
  };
}
