// Supabase Edge Function: send-texts (database part 116)
//
// Texts to customers through the company's Android SIM, for clients with the Customer texts add-on
// (companies.brand.texts) and texts switched on in Settings (companies.texts):
//   landed    DROPS: the flight landed          } the database trigger bookings_text writes an
//   sent      DROPS: a driver was SENT          } outbox line and nudges { type: "outbox" };
//                                                 the minute timer retries open lines (part 118)
//   reminder  PICKS: the day before drop-off, at the owner's time: the 10-minute
//             timer, { type: "reminders" }, x-timer header
//   manual    the office, from the car's Texts: { type: "manual", booking, rule }, with a sign-in
//   test      an owner, from Settings: { type: "test", to, text }, with a sign-in
// Demo (companies.texts.demo): everything as above, but each text is written down
// as "demo" and never sent, so a client can see a week of texts for free.
// Valid messages are queued in customer_texts. The TakeOff Android app claims
// them and sends them from the company SIM; the SMS plan/carrier may charge.
// Nothing in a message is trusted but which car: the car and the company's
// settings are re-read here. Each automatic text is queued once (customer_texts.dedupe_key
// 'text:<rule>:<booking>'); every text is written to customer_texts and the
// activity log (TEXT). Only UK mobiles are texted.
//
// "Verify JWT" must be OFF: the database calls this function without a sign-in.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { ukMobile, fillText, textParts, LABEL, londonNow, nextDay } from "./texts.mjs";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

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

async function fromTimer(req: Request) {
  const { data: ok } = await db.rpc("timer_secret_ok", { p_secret: req.headers.get("x-timer") ?? "" });
  return ok === true;
}
async function companyOf(id: string) {
  const { data } = await db.from("companies").select("id, name, brand, texts").eq("id", id).maybeSingle();
  if (!data || data.brand?.texts !== true) return null;
  return data as { id: string; name: string; brand: Record<string, unknown>; texts: Cfg };
}
// Queue one text for the company's signed-in Android phone and write it down.
async function send(company: { id: string; name: string; texts: Cfg }, rule: Rule, b: Record<string, any> | null, toRaw: string, body: string,
  dedupeKey: string, who: { id?: string; name?: string } = {}) {
  const to = ukMobile(toRaw);
  const row = { company_id: company.id, dedupe_key: dedupeKey, booking_id: b?.id ?? null, rule: rule, to_number: to || String(toRaw || "").slice(0, 40), body, parts: textParts(body),
    staff_id: who.id ?? null, staff_name: who.name ?? "", status: "queued", error: "",
    expires_at: new Date(Date.now() + (rule === "reminder" ? 6 * 3600000 : rule === "landed" ? 3600000 : 10 * 60000)).toISOString() };
  if (!to) { row.status = "skipped"; row.error = "not a UK mobile"; }
  else if (company.texts.demo === true && rule !== "test") { row.status = "demo"; }
  const { error } = await db.from("customer_texts").insert(row);
  if (error?.code === "23505") return { ...row, duplicate: true };
  if (error) throw error;
  // The database trigger records activity in the same transaction as the row.
  return row;
}

// A DROPS car landed or was SENT. Re-checked here before anything goes; the answer
// is what happened (written on the outbox line).
async function bookingText(id: string, rule: "landed" | "sent") {
  const { data: b, error } = await db.from("bookings").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!b || b.kind !== "drops" || b.cleared_at || b.removed_at || !b.phone) return "not due";
  const now = Date.now(), fresh = (iso: string | null) => !!iso && now - new Date(iso).getTime() < FRESH_MIN * 60000;
  if (rule === "landed" && (b.flight_status !== "landed" || b.sent_at || b.overstay || (b.est_at && !fresh(b.est_at)))) return "not due";
  if (rule === "sent" && !fresh(b.sent_at)) return "not due";
  // The return is tonight's: not a car booked back days away whose flight number happens to land today.
  if (Math.abs(new Date(b.return_at).getTime() - now) > 12 * 3600000) return "not tonight";
  const co = await companyOf(b.company_id);
  const cfg = co?.texts ?? {};
  if (!co || cfg.on !== true || (cfg[rule] as any)?.on === false) return "off";
  const row = await send(co, rule, b, b.phone, fillText(rule, b, cfg, co.name), `text:${rule}:${b.id}`);
  return "duplicate" in row ? "already queued" : row.status;
}
async function onBooking(req: Request, msg: Record<string, unknown>) {
  if (!(await fromTimer(req))) return reply(403, { error: "Not the timer." });
  const rule = msg.rule === "landed" || msg.rule === "sent" ? msg.rule : null;
  if (!rule || typeof msg.id !== "string") return reply(400, { error: "Bad request." });
  return reply(200, { status: await bookingText(msg.id, rule) });
}
// The outbox (part 118): the booking trigger's lines, nudged at once and retried by the
// minute timer. A line is done only once its text is queued or known not due.
async function onOutbox(req: Request) {
  if (!(await fromTimer(req))) return reply(403, { error: "Not the timer." });
  const { data: lines, error } = await db.rpc("text_outbox_take", { p_limit: 50 });
  if (error) throw error;
  let done = 0, failed = 0;
  for (const l of (lines ?? []) as { id: number; booking_id: string; rule: "landed" | "sent" }[]) {
    try {
      const result = await bookingText(l.booking_id, l.rule);
      const { error: e2 } = await db.rpc("text_outbox_done", { p_id: l.id, p_result: result });
      if (e2) throw e2;
      done++;
    } catch (e) { console.error(e); failed++; }   // left open: the next minute tries again
  }
  return reply(200, { done, failed });
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
      if (b.intake) continue;
      const row = await send(co, "reminder", b, b.phone, fillText("reminder", b, cfg, co.name), `text:reminder:${b.id}`);
      if (!("duplicate" in row)) sent++;
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
  // Retries of one confirmation use one key, even across a timeout or minute boundary.
  const requestId = String(msg.request ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return reply(400, { error: "Update TakeOff and reopen this text before sending." });
  const row = await send(co, "manual", b, b.phone, fillText(rule, b, co.texts, co.name), `text:hand:${rule}:${b.id}:${requestId}`, { id: me.id, name: me.acting || me.name });
  if ("duplicate" in row) return reply(429, { error: "That text was already queued or sent. Check its history." });
  if (row.status !== "queued" && row.status !== "demo") return reply(400, { error: "Not queued: " + row.error });
  return reply(200, { status: row.status });
}

// Settings → Send me a test: an owner's own phone, the words as typed.
async function onTest(req: Request, msg: Record<string, unknown>) {
  const me = (await asCaller(req).rpc("me")).data;
  if (!me?.id) return reply(401, { error: "Sign in again." });
  if (me.role !== "owner") return reply(403, { error: "Only an owner can send a test." });
  const co = await companyOf(me.company_id);
  if (!co) return reply(400, { error: "Customer texts aren't switched on for this company." });
  const row = await send(co, "test", null, String(msg.to ?? ""), String(msg.text ?? "").slice(0, 459) || "Test text from Parking Ops.", `text:test:${me.id}:${Math.floor(Date.now() / 60000)}`, { id: me.id, name: me.acting || me.name });
  if ("duplicate" in row) return reply(429, { error: "One test a minute." });
  if (row.status !== "queued") return reply(400, { error: "Not queued: " + row.error });
  return reply(200, { status: "queued" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "POST only." });
  try {
    let msg: Record<string, unknown>;
    try { msg = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
    if (msg.type === "outbox") return await onOutbox(req);
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
