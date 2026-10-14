// Supabase Edge Function: takeoff-bookings — READ-ONLY sync from the Swift
// Airport Parking admin site into TakeOff's board.
//
//   { action: "preview" }                    a signed-in office/manager with the
//                                            import permission. Signs in to the booking
//                                            site, reads the approved reports and returns
//                                            what WOULD change. Writes nothing to bookings.
//   { action: "apply", expect_hash: "…" }    reads again; only if it still gives exactly the
//                                            previewed plan does it import (every day in one
//                                            transaction, through import_sheet_system, so
//                                            activity history and Undo work as for a hand import).
//   { action: "timer" }                      refused: scheduled sync is switched off.
//
// On the booking site it only signs in, searches and downloads (GET, plus the one
// sign-in POST); every address is checked against the approved host and report
// pages (swift.mjs). One run at a time per company (swift_lock); a failed sign-in
// pauses the sync for an hour instead of trying again. "Verify JWT" stays OFF (the
// caller is checked here).
//
// Per-company settings: private.auto_import.config, e.g.
//   { "base": "https://www.luton.swiftairportparking.co.uk/admin/", "manual_enabled": true,
//     "login_path": "index.php?req=login",
//     "login_fields": { "login": "login", "password": "password", "extra": { "action": "Sign In", "url": "%3F" } },
//     "export_path": "export_to_excel.php",
//     "drops_search": "…{FROM}…{TO}…", "picks_search": "…{FROM}…{TO}…", "flights_search": "…",
//     "scope": { "column": "<supplier column in the report>", "values": ["<TakeOff's supplier name>"] },
//     "drops_days": 2, "picks_days": 3, "page_size": 0 }
// The login is NOT here: it's the Supabase secrets TAKEOFF_BOOKING_LOGIN and
// TAKEOFF_BOOKING_PASSWORD. The service-role key is a function secret too.
import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import { matchFlights } from "./reader.mjs";
import { makeClient, readReport, parseHtmlTable, plan, planHash, previewView, windowFor, siteDate, scriptOf } from "./swift.mjs";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });


function gridFrom(buf: Uint8Array): string[][] {
  // The export is a tab-separated "xls"; SheetJS reads it. Dates are already
  // text ("2026-10-05 15:00") in this export, so no serial-date handling.
  const wb = XLSX.read(buf, { type: "array", raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return (XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as unknown[][])
    .map((row) => row.map((v) => (v == null ? "" : String(v))));
}

type Co = { id: string; slug: string; drops_day_end?: string };

// Sign in once, read the approved reports, compare with what the app holds.
async function collect(company: Co, cfg: Record<string, unknown>) {
  const base = String(cfg.base ?? "");
  const exportPath = String(cfg.export_path ?? "export_to_excel.php");
  const dropsSearch = String(cfg.drops_search ?? ""), picksSearch = String(cfg.picks_search ?? "");
  const flightsSearch = cfg.flights_search ? String(cfg.flights_search) : "";
  if (!base || !dropsSearch || !picksSearch) throw new Error("The report addresses aren't set up for " + company.slug + ".");
  const scope = cfg.scope as never; // {all:true} | {column, values} | [{column, values}, …]
  const dw = windowFor(Date.now(), Number(cfg.drops_days ?? 2)), pw = windowFor(Date.now(), Number(cfg.picks_days ?? 3));
  const fill = (path: string, w: { from: string; to: string }) => path.replace(/\{FROM\}/g, siteDate(w.from)).replace(/\{TO\}/g, siteDate(w.to));
  const client = makeClient({
    base, hosts: cfg.hosts as string[] | undefined, login_path: cfg.login_path as string | undefined, login_fields: cfg.login_fields as never,
    scripts: [dropsSearch, picksSearch, flightsSearch, exportPath, String(cfg.flights_export_path ?? exportPath)].filter(Boolean).map((p) => scriptOf(new URL(p, base))),
  }, { fetch, user: Deno.env.get("TAKEOFF_BOOKING_LOGIN") ?? "", pass: Deno.env.get("TAKEOFF_BOOKING_PASSWORD") ?? "" });
  await client.login();
  const opts = { pageSize: Number(cfg.page_size ?? 0) || undefined };
  const drops = readReport(gridFrom(await client.download(fill(dropsSearch, dw), exportPath)), scope, opts);
  if (flightsSearch) {
    // The Return Report has no Excel export: read its results table (flights_format "html"), or a download.
    const fGrid = cfg.flights_format === "html"
      ? parseHtmlTable(await client.page(fill(flightsSearch, dw)))
      : gridFrom(await client.download(fill(flightsSearch, dw), String(cfg.flights_export_path ?? exportPath)));
    const f = readReport(fGrid, scope, { ...opts, allowEmpty: true, flights: true });
    matchFlights(drops.rows, f.rows.map((r: { ref: string; reg: string; flightIn: string; flightOut: string }) => ({ ref: r.ref, reg: r.reg, flight: r.flightIn || r.flightOut })), "flightIn");
  }
  const picks = readReport(gridFrom(await client.download(fill(picksSearch, pw), exportPath)), scope, opts);

  const refs = Array.from(new Set([...drops.rows, ...picks.rows].map((r: { ref: string }) => r.ref).filter(Boolean)));
  const existing = new Map<string, unknown>();
  for (let i = 0; i < refs.length; i += 400) {
    const { data, error } = await admin.rpc("swift_existing", { p_company: company.id, p_refs: refs.slice(i, i + 400) });
    if (error) throw new Error("Couldn't read the current bookings: " + error.message);
    (data as { kind: string; ref: string }[]).forEach((e) => existing.set(e.kind + "|" + e.ref, e));
  }
  const win = { from: dw.from < pw.from ? dw.from : pw.from, to: dw.to > pw.to ? dw.to : pw.to };
  const cancelledRows = [
    ...drops.rows.filter((r: { cancelled: boolean }) => r.cancelled).map((row: unknown) => ({ kind: "drops", row })),
    ...picks.rows.filter((r: { cancelled: boolean }) => r.cancelled).map((row: unknown) => ({ kind: "picks", row })),
  ];
  const p = plan({ drops: drops.rows, picks: picks.rows, existing: existing as never, window: win, cutoff: (company.drops_day_end ?? "06:00").slice(0, 5), cancelledRows: cancelledRows as never });
  return { p, hash: await planHash(p), excluded_scope: drops.excludedScope + picks.excludedScope, requests: client.count };
}

async function record(companyId: string, ok: boolean, error: string, summary: unknown) {
  await admin.rpc("auto_import_record", { p_company: companyId, p_ok: ok, p_error: error, p_summary: summary ?? null });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "POST only." });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const action = String(body.action ?? "preview");

  try {
    if (action === "timer") return reply(403, { error: "Scheduled sync is switched off. Use Get bookings now." });
    if (action !== "preview" && action !== "apply") return reply(400, { error: "Unknown action." });

    const auth = req.headers.get("authorization") ?? "";
    if (!auth) return reply(401, { error: "Sign in first." });
    const asUser = createClient(SB_URL, ANON, { global: { headers: { authorization: auth } }, auth: { persistSession: false } });
    const { data: meRows } = await asUser.rpc("me");
    const me = Array.isArray(meRows) ? meRows[0] : meRows;
    if (!me || !me.company_id) return reply(401, { error: "Sign in first." });
    const { data: canImport } = await asUser.rpc("can", { p_action: "import" });
    if (canImport !== true) return reply(403, { error: "You don't have permission to import." });
    const { data: co } = await admin.from("companies").select("id, slug, drops_day_end, suspended_at").eq("id", me.company_id).single();
    if (!co || co.suspended_at) return reply(403, { error: "Not available." });
    const { data: row } = await admin.rpc("auto_import_row", { p_company: co.id });
    const cfg = ((row ?? {}) as { config?: Record<string, unknown> }).config ?? {};
    // Company isolation: only the company whose own settings carry the Swift connection, never Airport Parking Bay.
    if (co.slug === "airport-parking-bay" || !cfg.base || cfg.manual_enabled !== true) return reply(400, { error: "Automatic bookings aren't set up for this company." });

    const token = await admin.rpc("swift_lock", { p_company: co.id, p_seconds: 300 });
    if (token.error) return reply(200, { ok: false, error: token.error.message });
    let block = 0;
    try {
      const c = await collect(co as Co, cfg);
      if (action === "preview") return reply(200, { ok: true, preview: { ...previewView(c.p, c.hash), excluded_scope: c.excluded_scope } });

      if (String(body.expect_hash ?? "") !== c.hash) return reply(200, { ok: false, error: "The bookings changed since the preview. Check them again before importing." });
      if (c.p.counts.invalid > 0) return reply(200, { ok: false, error: "Some records are invalid or ambiguous. Nothing was imported." });
      if (c.p.reviews.length) {
        const r = await admin.rpc("swift_review_upsert", { p_company: co.id, p_items: c.p.reviews });
        if (r.error) throw new Error("Couldn't save the review list: " + r.error.message);
      }
      let days: unknown[] = [];
      if (c.p.batches.length) {
        const res = await admin.rpc("swift_apply", { p_company: co.id, p_batches: c.p.batches, p_source: { auto: true, manual: true, provider: "swift" } });
        if (res.error) throw new Error("Nothing was imported (" + res.error.message + ").");
        days = res.data as unknown[];
      }
      const summary = { at: new Date().toISOString(), days, counts: c.p.counts, reviews: c.p.reviews.length };
      await admin.rpc("auto_import_record", { p_company: co.id, p_ok: true, p_error: "", p_summary: summary });
      return reply(200, { ok: true, summary });
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "login_failed") block = 60;
      await admin.rpc("auto_import_record", { p_company: co.id, p_ok: false, p_error: err.message, p_summary: null });
      return reply(200, { ok: false, error: err.message });
    } finally {
      await admin.rpc("swift_unlock", { p_company: co.id, p_token: token.data, p_block_minutes: block });
    }
  } catch (err) {
    return reply(500, { error: (err as Error).message || String(err) });
  }
});
