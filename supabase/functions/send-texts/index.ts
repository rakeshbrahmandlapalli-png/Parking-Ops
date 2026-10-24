// Supabase Edge Function: send-texts (database part 114)
//
// Texts to customers through Twilio, for clients with the Customer texts add-on
// (companies.brand.texts) and texts switched on in Settings (companies.texts):
//   landed    DROPS: the flight landed          } the database trigger bookings_text,
//   sent      DROPS: a driver was SENT          } { type: "booking", id, rule }, x-timer header
//   reminder  PICKS: the day before drop-off, at the owner's time: the 10-minute
//             timer, { type: "reminders" }, x-timer header
//   manual    the office, from the car's Texts: { type: "manual", booking, rule }, with a sign-in
//   test      an owner, from Settings: { type: "test", to, text }, with a sign-in
// Demo (companies.texts.demo): everything as above, but each text is written down
// as "demo" and never sent, so a client can see a week of texts for free.
//   Twilio's delivery reports: POST ?status=<secret> (form), signed by Twilio.
// Nothing in a message is trusted but which car: the car and the company's
// settings are re-read here. Each automatic text goes once (alert_log
// 'text:<rule>:<booking>'); every text is written to customer_texts and the
// activity log (TEXT). Only UK mobiles are texted.
//
// Secrets (Edge Functions → Secrets), never in the repo or a chat:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
// "Verify JWT" must be OFF: the database and Twilio call it without a sign-in.
import { createClient } from "npm:@supabase/supabase-js@2";
import { ukMobile, fillText, textParts, LABEL, londonNow, nextDay } from "./texts.mjs";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "", TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const SELF = URL_ + "/functions/v1/send-texts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const FRESH_MIN = 30;   // a SENT tap or a landing older than this is history, not news
type Rule = "landed" | "sent" | "reminder" | "manual" | "test";
type Cfg = { on?: boolean; sender?: string; office?: string; meet?: string; at?: string; [k: string]: unknown };

async function once(key: string) {
  const { error } = await db.from("alert_log").insert({ key });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw error;
}
async function fromTimer(req: Request) {
  const { data: ok } = await db.rpc("timer_secret_ok", { p_secret: req.headers.get("x-timer") ?? "" });
  return ok === true;
}
async function companyOf(id: string) {
  const { data } = await db.from("companies").select("id, name, brand, texts").eq("id", id).maybeSingle();
  if (!data || data.brand?.texts !== true) return null;
  return data as { id: string; name: string; brand: Record<string, unknown>; texts: Cfg };
}
// Sends one text and writes it down. Returns the customer_texts row's status.
async function send(company: { id: string; name: string; texts: Cfg }, rule: Rule, b: Record<string, any> | null, toRaw: string, body: string,
  who: { id?: string; name?: string } = {}) {
  const to = ukMobile(toRaw);
  const row = { company_id: company.id, booking_id: b?.id ?? null, rule: rule, to_number: to || String(toRaw || "").slice(0, 40), body, parts: textParts(body),
    staff_id: who.id ?? null, staff_name: who.name ?? "", status: "queued", error: "" };
  if (!to) { row.status = "skipped"; row.error = "not a UK mobile"; }
  else if (company.texts.demo === true && rule !== "test") { row.status = "demo"; }
  else if (!SID || !TOKEN) { row.status = "failed"; row.error = "texting not set up"; }
  else {
    const form = new URLSearchParams({ To: to, From: String(company.texts.sender || "").replace(/\s+/g, "").slice(0, 11) || "PARKING", Body: body, StatusCallback: SELF + "?status=1" });
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
        method: "POST", body: form, headers: { Authorization: "Basic " + btoa(SID + ":" + TOKEN), "Content-Type": "application/x-www-form-urlencoded" } });
      const out = await res.json().catch(() => ({}));
      if (res.ok) { row.status = "sent"; (row as any).provider_id = out.sid ?? null; }
      else { row.status = "failed"; row.error = String(out.message || "Twilio error " + res.status).slice(0, 200); }
    } catch (e) { row.status = "failed"; row.error = "couldn't reach Twilio"; }
  }
  if (rule !== "test") {
    await db.from("customer_texts").insert(row);
    await db.from("activity").insert({ company_id: company.id, booking_id: b?.id ?? null, sheet_id: b?.sheet_id ?? null, reg: b?.reg ?? "", customer: b?.name ?? "",
      staff_id: who.id ?? null, staff_name: who.name ?? "", action: "TEXT",
      value: `${LABEL[rule === "manual" ? "manual" : rule]} to ${to || "—"}: ${row.status === "sent" ? "sent" : row.status === "demo" ? "demo, not sent" : row.status === "skipped" ? "not sent, " + row.error : "failed, " + row.error}` });
  }
  return row;
}

// The trigger: a DROPS car landed or was SENT. Re-checked here before anything goes.
async function onBooking(req: Request, msg: Record<string, unknown>) {
  if (!(await fromTimer(req))) return reply(403, { error: "Not the timer." });
  const rule = msg.rule === "landed" || msg.rule === "sent" ? msg.rule : null;
  if (!rule || typeof msg.id !== "string") return reply(400, { error: "Bad request." });
  const { data: b } = await db.from("bookings").select("*").eq("id", msg.id).maybeSingle();
  if (!b || b.kind !== "drops" || b.cleared_at || b.removed_at || !b.phone) return reply(200, { skipped: "not due" });
  const now = Date.now(), fresh = (iso: string | null) => !!iso && now - new Date(iso).getTime() < FRESH_MIN * 60000;
  if (rule === "landed" && (b.flight_status !== "landed" || b.sent_at || b.overstay || (b.est_at && !fresh(b.est_at)))) return reply(200, { skipped: "not due" });
  if (rule === "sent" && !fresh(b.sent_at)) return reply(200, { skipped: "not due" });
  // The return is tonight's: not a car booked back days away whose flight number happens to land today.
  if (Math.abs(new Date(b.return_at).getTime() - now) > 12 * 3600000) return reply(200, { skipped: "not tonight" });
  const co = await companyOf(b.company_id);
  const cfg = co?.texts ?? {};
  if (!co || cfg.on !== true || (cfg[rule] as any)?.on === false) return reply(200, { skipped: "off" });
  if (!(await once(`text:${rule}:${b.id}`))) return reply(200, { skipped: "already sent" });
  const row = await send(co, rule, b, b.phone, fillText(rule, b, cfg, co.name));
  return reply(200, { status: row.status });
}

// Every 10 minutes: companies whose reminder time has come today text tomorrow's PICKS customers.
async function onReminders(req: Request) {
  if (!(await fromTimer(req))) return reply(403, { error: "Not the timer." });
  const { day, time } = londonNow();
  const { data: cos } = await db.from("companies").select("id, name, brand, texts").eq("brand->>texts", "true");
  let sent = 0;
  for (const co of cos ?? []) {
    const cfg = (co.texts ?? {}) as Cfg;
    if (cfg.on !== true || (cfg.reminder as any)?.on === false) continue;
    // From the chosen time until 22:00, so a missed run still sends them, never at night.
    if (time < String(cfg.at || "18:00") || time >= "22:00") continue;
    const { data: sheet } = await db.from("sheets").select("id").eq("company_id", co.id).eq("kind", "picks").eq("day", nextDay(day)).maybeSingle();
    if (!sheet) continue;   // tomorrow's PICKS not imported yet: the next run tries again
    const { data: cars } = await db.from("bookings").select("*").eq("sheet_id", sheet.id).is("removed_at", null).neq("phone", "");
    for (const b of cars ?? []) {
      if (b.intake || !(await once(`text:reminder:${b.id}`))) continue;
      await send(co, "reminder", b, b.phone, fillText("reminder", b, cfg, co.name));
      sent++;
    }
  }
  return reply(200, { sent });
}

function asCaller(req: Request) {
  return createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
}

// The office sends one by hand from the car's Texts.
async function onManual(req: Request, msg: Record<string, unknown>) {
  const me = (await asCaller(req).rpc("me")).data;
  if (!me?.id) return reply(401, { error: "Sign in again." });
  const { data: allowed } = await asCaller(req).rpc("can", { p_action: "called" });
  if (allowed !== true) return reply(403, { error: "Only the office can send texts." });
  const rule = ["landed", "sent", "reminder"].includes(String(msg.rule)) ? String(msg.rule) as Rule : null;
  const { data: b } = await db.from("bookings").select("*").eq("id", String(msg.booking ?? "")).maybeSingle();
  if (!rule || !b || b.company_id !== me.company_id) return reply(400, { error: "Car not found." });
  const co = await companyOf(b.company_id);
  if (!co || co.texts?.on !== true) return reply(400, { error: "Customer texts are off. An owner switches them on in Settings." });
  if (!ukMobile(b.phone)) return reply(400, { error: "This booking has no UK mobile number." });
  // Two taps in a row send one text.
  if (!(await once(`text:hand:${rule}:${b.id}:${Math.floor(Date.now() / 120000)}`))) return reply(429, { error: "That text was just sent." });
  const row = await send(co, "manual", b, b.phone, fillText(rule, b, co.texts, co.name), { id: me.id, name: me.acting || me.name });
  if (row.status !== "sent" && row.status !== "demo") return reply(400, { error: "Not sent: " + row.error });
  return reply(200, { status: row.status });
}

// Settings → Send me a test: an owner's own phone, the words as typed.
async function onTest(req: Request, msg: Record<string, unknown>) {
  const me = (await asCaller(req).rpc("me")).data;
  if (!me?.id) return reply(401, { error: "Sign in again." });
  if (me.role !== "owner") return reply(403, { error: "Only an owner can send a test." });
  const co = await companyOf(me.company_id);
  if (!co) return reply(400, { error: "Customer texts aren't switched on for this company." });
  if (!(await once(`text:test:${me.id}:${Math.floor(Date.now() / 60000)}`))) return reply(429, { error: "One test a minute." });
  const row = await send(co, "test", null, String(msg.to ?? ""), String(msg.text ?? "").slice(0, 459) || "Test text from Parking Ops.");
  if (row.status !== "sent") return reply(400, { error: "Not sent: " + row.error });
  await db.from("activity").insert({ company_id: co.id, staff_id: me.id, staff_name: me.name, action: "TEXT", value: "Test text sent" });
  return reply(200, { status: "sent" });
}

// Twilio's delivery report: checked against Twilio's signature (HMAC-SHA1 of the
// address and the sorted fields, with the auth token), then the text's status.
async function onStatus(req: Request) {
  const raw = await req.text(), f = new URLSearchParams(raw);
  const data = SELF + "?status=1" + [...f.keys()].sort().map((k) => k + f.get(k)).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)))));
  if (!TOKEN || sig !== (req.headers.get("x-twilio-signature") ?? "")) return new Response("no", { status: 403 });
  const st = f.get("MessageStatus"), id = f.get("MessageSid");
  const status = st === "delivered" ? "delivered" : st === "failed" || st === "undelivered" ? "failed" : null;
  if (status && id) await db.from("customer_texts").update({ status, error: status === "failed" ? "code " + (f.get("ErrorCode") || "?") : "" }).eq("provider_id", id).neq("status", "delivered");
  return new Response("", { status: 204 });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "POST only." });
  try {
    if (new URL(req.url).searchParams.has("status")) return await onStatus(req);
    let msg: Record<string, unknown>;
    try { msg = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
    if (msg.type === "booking") return await onBooking(req, msg);
    if (msg.type === "reminders") return await onReminders(req);
    if (msg.type === "manual") return await onManual(req, msg);
    if (msg.type === "test") return await onTest(req, msg);
    return reply(400, { error: "Unknown request." });
  } catch (e) {
    console.error(e);
    return reply(500, { error: "Something went wrong sending the text." });
  }
});
