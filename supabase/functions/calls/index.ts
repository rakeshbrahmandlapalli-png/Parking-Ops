// Supabase Edge Function: calls (database part 115)
//
// Customers ring the office when they land (DROPS) and when they're on their way
// to drop the car off (PICKS). Either the company mobile tells this function
// about each call (?step=phone, below), or the office number is forwarded to the
// client's Twilio number, whose "A call comes in" webhook is this function:
//   ?step=in      a call: call_in finds the client and the caller's car and writes
//                 the call (every phone pops it up). Auto-answer on: "press 1 if
//                 you've landed, 2 if you're on your way to drop off"; else straight
//                 through to the numbers to ring (with the customer's number showing).
//   ?step=digit   the key pressed: call_digit marks the car CALLED, then through.
//   ?step=dial    how the ringing ended: call_end (answered, missed, auto).
// Every Twilio request is checked against Twilio's signature (X-Twilio-Signature).
//   ?step=phone   the company mobile instead (free, no auto-answer): see onPhone.
//
// Secrets: TWILIO_AUTH_TOKEN (the same as send-texts). "Verify JWT" must be OFF.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const SELF = URL_ + "/functions/v1/calls";
const VOICE = 'voice="Polly.Amy" language="en-GB"';

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const twiml = (body: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } });
const say = (t: string) => `<Say ${VOICE}>${xml(t)}</Say>`;

// Twilio signs the full address it called and the posted fields, sorted, with the auth token.
async function signed(req: Request, f: URLSearchParams) {
  if (!TOKEN) return false;
  const u = new URL(req.url), data = SELF + u.search + [...new Set(f.keys())].sort().map((k) => k + f.get(k)).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)))));
  return sig === (req.headers.get("x-twilio-signature") ?? "");
}

// Ring the office numbers together, the customer's number showing; then ?step=dial.
function dial(ring: string[], from: string) {
  const nums = ring.map((n) => `<Number>${xml(n)}</Number>`).join("");
  return `<Dial timeout="25" callerId="${xml(from)}" action="${xml(SELF + "?step=dial")}">${nums}</Dial>`;
}

async function ringOf(sid: string) {
  const { data: k } = await db.from("customer_calls").select("company_id, from_number").eq("sid", sid).maybeSingle();
  if (!k) return { ring: [] as string[], from: "" };
  const { data: c } = await db.from("companies").select("calls").eq("id", k.company_id).maybeSingle();
  return { ring: ((c?.calls?.ring ?? []) as string[]), from: k.from_number as string };
}

// The company mobile (calls.via 'phone'): MacroDroid on an Android phone with the
// company SIM sends ?step=phone&key=<the phone's key>&event=ringing|answered|missed|ended
// &number=<caller>[&seconds=N], as the address or as a form or JSON body. Free.
async function onPhone(req: Request, u: URL) {
  const raw = await req.text();
  let body: Record<string, unknown> = {};
  try { body = raw.trim().startsWith("{") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); } catch { body = {}; }
  const get = (k: string) => String(body[k] ?? u.searchParams.get(k) ?? "").trim();
  const event = get("event").toLowerCase(), secs = parseInt(get("seconds"));
  const { data, error } = await db.rpc("call_phone", { p_key: get("key"), p_event: event, p_from: get("number"), p_seconds: Number.isFinite(secs) ? secs : null });
  if (error) throw error;
  return new Response(JSON.stringify(data), { status: data?.ok === false ? 403 : 200, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  try {
    const u = new URL(req.url);
    if (u.searchParams.get("step") === "phone") return await onPhone(req, u);
    const f = new URLSearchParams(await req.text());
    if (!(await signed(req, f))) return new Response("no", { status: 403 });
    const step = new URL(req.url).searchParams.get("step") ?? "in";
    const sid = f.get("CallSid") ?? "", from = f.get("From") ?? "";

    if (step === "in") {
      const { data: r, error } = await db.rpc("call_in", { p_to: f.get("To") ?? "", p_from: from, p_sid: sid });
      if (error) throw error;
      if (!r?.company) return twiml(say("Sorry, this number isn't taking calls at the moment.") + "<Hangup/>");
      if (r.auto) {
        const words = (r.words as string) || `Thank you for calling ${r.name}. If you have landed, press 1. If you are on your way to drop off your car, press 2. To speak to someone, stay on the line.`;
        return twiml(`<Gather numDigits="1" timeout="6" action="${xml(SELF + "?step=digit")}">${say(words)}</Gather><Redirect>${xml(SELF + "?step=digit")}</Redirect>`);
      }
      return twiml(dial(r.ring ?? [], from));
    }

    if (step === "digit") {
      const d = f.get("Digits") ?? "";
      const { data: m } = d ? await db.rpc("call_digit", { p_sid: sid, p_digit: d }) : { data: null };
      const { ring, from: caller } = await ringOf(sid);
      const thanks = m?.marked === "CALLED" ? (m.kind === "drops" ? "Thank you. The team has been told you've landed and will bring your car." : "Thank you. The team has been told you're on your way.")
        : m?.marked === "already" ? "Thank you, the team already knows." : "";
      return twiml((thanks ? say(thanks + " Please hold to speak to someone, or hang up.") : "") + dial(ring, caller || from));
    }

    if (step === "dial") {
      const st = f.get("DialCallStatus") ?? "", secs = parseInt(f.get("DialCallDuration") ?? "0") || 0;
      await db.rpc("call_end", { p_sid: sid, p_status: st, p_seconds: secs });
      if (st === "completed" && secs > 0) return twiml("<Hangup/>");
      return twiml(say("Sorry, no one could answer just now. We have your number and will call you back.") + "<Hangup/>");
    }
    return twiml("<Hangup/>");
  } catch (e) {
    console.error(e);
    // Whatever went wrong here, the customer still gets through: Twilio's fallback
    // address (Twilio console) should be set to dial the office number directly.
    return twiml(say("Sorry, something went wrong. Please call again.") + "<Hangup/>");
  }
});
