// Supabase Edge Function: send-alerts
//
// Phone notifications (web push) and Discord messages for:
//   DROPS  CALLED / OVERSTAY on a car no driver has been SENT to yet
//          AT DESK (the customer is at the desk) on a car not SENT yet
//          still no driver SENT 20 minutes after CALLED (not OVERSTAY)
//          COMPLAINT
//          flight CANCELLED on a car not yet handed back
//   PICKS  RTC
//
// Called two ways (POST JSON):
//   { type: "booking", id }  by the database trigger in setup/04-alerts.sql.
//       Nothing in the message is trusted except which booking to look at:
//       the booking is re-read here, an alert only goes if it is really due
//       and recent, and alert_log makes sure each one goes out once.
//   { type: "call", id }  by the customer_calls trigger (setup/123-call-popups.sql): a new ringing call is pushed
//       once to the people in call_alert_staff() (the Call pop-ups permission, their own switch on), not to Discord.
//   { type: "test", discord? }  by the "Send a test" buttons, with a sign-in.
//       Sends to the caller's own phones; Discord only for owner/manager.
//   { type: "longwait" }  by the 5-minute timer (setup/88-long-wait-alert.sql),
//       with the x-timer header. A DROPS car CALLED more than LONG_WAIT_MIN ago
//       with no driver SENT (and not cleared) is pushed once to everyone.
//       OVERSTAY cars are left out: their one OVERSTAY alert is enough.
//   { type: "import_held" }  by takeoff-bookings (service-role key as the bearer) when a scheduled booking import
//       is held or fails: owners, managers and the office are pushed once per saved time.
//   { type: "usage" }  by the morning timer (setup/38-usage-warning.sql), with
//       the x-timer header. If usage_status() finds a free-plan limit getting
//       close (or no backup last night), the owners and managers of the
//       companies in private.settings 'usage_alert_to' are told, once a day.
//   { type: "health" }  by the 15-minute timer (setup/100-health-and-errors.sql),
//       with the x-timer header. Each warning from health_status() (a timer
//       failing, no backup, AeroDataBox units, a failed scheduled import, many
//       phone errors) goes once a day to the product owner, never to clients.
//   A push that fails for any reason but "phone gone" is noted (note_push_failure)
//   for Clients → Health.
//
// Secrets (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY   same value as VAPID_PUBLIC_KEY in public/app.js
//   VAPID_PRIVATE_KEY  never in a page, a file in the repo or a chat
// "Verify JWT" must be OFF: the database calls it without a sign-in.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
webpush.setVapidDetails("https://takeoff-ops.vercel.app", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TZ = "Europe/London";
const time = (iso: string | null) => iso ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";
const FRESH_MIN = 30;   // a tap older than this is history, not news
const LONG_WAIT_MIN = 20;   // CALLED this long with no driver SENT

type Kind = "drops" | "picks" | "flights";
type Note = { title: string; body: string; url: string; tag: string; eventKey?: string; bookingId?: string; category?: string; urgency?: "urgent" | "routine"; persist?: boolean; inboxStaff?: string[]; deliveryKey?: string };

async function once(key: string) {
  const { error } = await db.from("alert_log").insert({ key });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw error;
}

// kind null: an account warning, sent whatever the person's alert choices.
async function pushTo(staffIds: string[], kind: Kind | null, note: Note, endpoint?: string) {
  if (!staffIds.length) return 0;
  const { data: prefs } = kind ? await db.from("alert_prefs").select("*").in("staff_id", staffIds) : { data: [] };
  const off = new Set((prefs ?? []).filter((p) => kind && p[kind] === false).map((p) => p.staff_id));
  let wanted = staffIds.filter((id) => !off.has(id));
  if (!wanted.length) return 0;
  // An inbox entry does not depend on having a push subscription. Optional
  // schema compatibility: existing alerts keep working before the new part lands.
  if (note.persist !== false) {
    const key = note.eventKey || `${note.tag}:${new Date().toISOString().slice(0, 10)}`;
    const { error } = await db.rpc("record_ops_notification", { p_staff: note.inboxStaff || wanted, p_key: key, p_kind: note.category || kind || "usage", p_title: note.title, p_body: note.body, p_booking: note.bookingId || null, p_urgency: note.urgency || "routine" });
    if (error) console.error("notification inbox unavailable", error.code);
    else { note.eventKey = key; note.url = "/?notice=" + encodeURIComponent(key); }
  }
  const { data: options } = await db.rpc("ops_notification_delivery", { p_staff: wanted });
  const choices = Array.isArray(options) ? options : [];
  if (note.tag !== "test" && note.category !== "health" && note.category !== "usage") wanted = wanted.filter(id => !choices.some(o => o.staff_id === id && o.paused));
  const deliveryKey = note.tag === "test" ? "test:" + crypto.randomUUID() : note.deliveryKey || note.eventKey || note.tag + ":" + new Date().toISOString().slice(0,10);
  const category = note.tag === "test" ? "test" : kind || note.category || "usage";
  const payload = { title: note.title.slice(0,160), body: note.body.slice(0,600), url: note.url, tag: note.tag, eventKey: note.eventKey };
  const ttl = category === "calls" ? 180 : category === "test" ? 60 : note.urgency === "urgent" ? 600 : category === "health" || category === "usage" ? 7200 : 1800;
  const queued = await db.rpc("ops_push_enqueue", { p_staff: wanted, p_key: deliveryKey, p_kind: category, p_payload: payload, p_ttl: ttl, p_urgency: note.urgency === "urgent" ? "high" : "normal", p_endpoint: endpoint || null });
  if (!queued.error && queued.data === true) return sendQueuedPushes(deliveryKey);
  if (queued.error) console.error("push queue unavailable; using legacy delivery", queued.error.code);
  // Compatible fallback while the reviewed database part is being installed.
  const { data: subs } = await db.from("push_subscriptions").select("id, staff_id, company_id, endpoint, p256dh, auth").in("staff_id", wanted);
  let sent = 0;
  await Promise.all((subs ?? []).filter(s => !endpoint || s.endpoint === endpoint).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ ...payload, silent: note.urgency !== "urgent" && choices.some(o => o.staff_id === s.staff_id && o.routine_silent) }), { TTL: ttl, urgency: note.urgency === "urgent" ? "high" : "normal", topic: await pushTopic(note.tag), timeout: 15000 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);   // phone gone
      else {
        const detail = String((e as { body?: string }).body ?? e);
        console.error("push failed", code, detail);
        await db.rpc("note_push_failure", { p_company: s.company_id, p_code: code ?? null, p_detail: detail });
      }
    }
  }));
  return sent;
}

// The provider can keep only the newest update for a booking while a phone
// is offline. This supplements the visible notification tag on the device.
async function pushTopic(tag: string) {
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(tag));
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("").slice(0,32);
}

// A lease is per device and attempt. Provider acceptance is never described as
// proof that a lock-screen notification was displayed. Stale/disabled devices
// and operationally resolved events are discarded by the claim RPC.
async function sendQueuedPushes(key: string | null = null) {
  const { data, error } = await db.rpc("ops_push_claim", { p_key: key });
  if (error) { console.error("push queue claim failed", error.code); return 0; }
  const jobs = Array.isArray(data) ? data : []; let sent = 0;
  for (let i = 0; i < jobs.length; i += 10) await Promise.all(jobs.slice(i,i+10).map(async job => {
    let success = false, code: number | null = null;
    try {
      await webpush.sendNotification({ endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } }, JSON.stringify(job.payload), { TTL: job.ttl, urgency: job.urgency, topic: await pushTopic(job.payload.tag || job.id), timeout: 15000 });
      success = true; sent++;
    } catch (e) {
      code = (e as {statusCode?: number}).statusCode ?? null;
      if (code !== 404 && code !== 410) await db.rpc("note_push_failure", { p_company: job.company_id, p_code: code, p_detail: "Push request failed; bounded retry queued when appropriate." });
    }
    const { error: saved } = await db.rpc("ops_push_result", {p_id:job.id,p_lease:job.lease,p_success:success,p_code:code});
    if (saved) console.error("push queue result unavailable", saved.code);
  }));
  return sent;
}

async function discord(companyId: string, channel: "drops" | "picks", title: string, body: string) {
  const { data: d } = await db.rpc("alert_discord", { p_company: companyId });
  const url = d?.[channel + "_url"];
  if (!url) return false;
  const mention = String(d.mention ?? "").trim();
  // A Discord problem must not stop the phone alerts or the next alert.
  let res: Response;
  try { res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    // Without allowed_mentions Discord posts but pings nobody.
    body: JSON.stringify({ content: (mention ? mention + " " : "") + `**${title}**\n${body}`, allowed_mentions: { parse: ["everyone", "roles", "users"] } }),
  }); } catch (e) { console.error("discord failed", String(e)); return false; }
  if (!res.ok) console.error("discord failed", res.status, (await res.text()).slice(0, 200));
  return res.ok;
}

async function onBooking(id: string) {
  const { data: b } = await db.from("bookings").select("*, sheets(day)").eq("id", id).maybeSingle();
  if (!b) return { sent: 0 };
  const { data: people } = await db.from("staff").select("id, name").eq("company_id", b.company_id).eq("active", true);
  const nameOf = (sid: string | null) => (people ?? []).find((p) => p.id === sid)?.name ?? "";
  const everyoneBut = (sid: string | null) => (people ?? []).map((p) => p.id).filter((x) => x !== sid);
  const fresh = (iso: string | null) => !!iso && Date.now() - new Date(iso).getTime() < FRESH_MIN * 60000;

  const car = `${b.num ? "#" + b.num + " · " : ""}${b.reg || "no reg"}${b.yard ? " (" + b.yard + ")" : ""}`;
  const who = b.name || "Customer";
  const flightLine = b.flight ? `${b.flight} · due ${b.est_time && b.est_time !== "DELAY" ? b.est_time : b.sched_time || time(b.return_at)}` : `back ${time(b.return_at)}`;
  const alerts: { key: string; kind: Kind; channel: "drops" | "picks"; label: string; at: string; by: string | null }[] = [];

  // AT DESK (setup 112/113): the customer is at the desk, once each time it is turned on.
  const desk = b.kind === "drops" && b.desk_at && !b.sent_at && !b.cleared_at && b.called_word !== "Overstay" && fresh(b.desk_at);
  // OVERSTAY goes once per car, however often it is tapped off and on again.
  // AT DESK on a car not called yet calls it in the same tap: then only the AT DESK push goes.
  const sameTap = desk && b.called_at && Math.abs(new Date(b.called_at).getTime() - new Date(b.desk_at).getTime()) < 5000;
  if (b.kind === "drops" && b.called_at && !b.sent_at && !b.cleared_at && fresh(b.called_at) && !sameTap) {
    const over = b.called_word === "Overstay";
    alerts.push({ key: over ? `overstay:${b.id}` : `called:${b.id}:${b.called_at}`, kind: "drops", channel: "drops", label: over ? "OVERSTAY" : "CALLED", at: b.called_at, by: b.called_by });
  }
  if (desk) alerts.push({ key: `desk:${b.id}:${b.desk_at}`, kind: "drops", channel: "drops", label: "AT DESK", at: b.desk_at, by: b.desk_by });
  if (b.kind === "drops" && b.clear_word === "COMPLAINT" && fresh(b.cleared_at)) {
    alerts.push({ key: `complaint:${b.id}:${b.cleared_at}`, kind: "drops", channel: "drops", label: "🚨 COMPLAINT", at: b.cleared_at, by: b.cleared_by });
  }
  if (b.kind === "picks" && b.intake === "RTC" && fresh(b.intake_at)) {
    alerts.push({ key: `rtc:${b.id}:${b.intake_at}`, kind: "picks", channel: "picks", label: "RTC", at: b.intake_at, by: b.intake_by });
  }
  if (b.kind === "drops" && b.flight_status === "cancelled" && !b.cleared_at) {
    alerts.push({ key: `cancel:${b.id}:${b.flight}:${b.sheets?.day ?? ""}`, kind: "flights", channel: "drops", label: "✈️ FLIGHT CANCELLED", at: new Date().toISOString(), by: null });
  }

  let sent = 0;
  for (const a of alerts) {
    if (!(await once(a.key))) continue;
    const byName = nameOf(a.by);
    const title = `${a.label}: ${car} — ${who}`;
    const body = a.kind === "flights"
      ? `${b.flight} has been cancelled by the airline. The customer may not be coming back as booked.`
      : `${a.label.replace(/^[^A-Z]+ /, "")} at ${time(a.at)}${byName ? " by " + byName : ""} · ${a.kind === "picks" ? "drop-off " + time(b.drop_at) : flightLine}${b.note ? " · " + b.note.replace(/^!\s*/, "") : ""}`;
    // OVERSTAY is not a customer waiting: its own routine entry, never escalated (as it never gets the WAITING push).
    const task = a.kind === "drops" && !a.key.startsWith("complaint:") && !a.key.startsWith("overstay:");
    sent += await pushTo(everyoneBut(a.by), a.kind, { title, body, url: "/?booking=" + b.id, tag: `${a.kind}-${b.id}`, bookingId: b.id, deliveryKey: a.key, inboxStaff: (people ?? []).map(p => p.id), eventKey: task ? `collection:${b.id}:${b.called_at || a.at}` : a.key, category: a.key.startsWith("complaint:") ? "complaint" : a.kind, urgency: a.kind === "flights" || a.key.startsWith("overstay:") ? "routine" : "urgent" });
    await discord(b.company_id, a.channel, title, body);
  }
  return { sent };
}

// An incoming call (setup 123): once per call, to everyone allowed call pop-ups with their switch on.
async function onCall(id: number) {
  const { data: k } = await db.from("customer_calls").select("*").eq("id", id).maybeSingle();
  if (!k || k.status !== "ringing" || Date.now() - new Date(k.at).getTime() > 3 * 60000) return { sent: 0 };
  if (!(await once(`call:${k.id}`))) return { sent: 0 };
  const { data: b } = k.booking_id ? await db.from("bookings").select("kind, reg, name, yard, num, return_at, drop_at").eq("id", k.booking_id).maybeSingle() : { data: null };
  const { data: ids } = await db.rpc("call_alert_staff", { p_company: k.company_id });
  const d = String(k.from_number || "").replace(/\D/g, "");
  const mask = d.length >= 8 ? (d.startsWith("44") ? "+44 " : d.slice(0, 2)) + "••• •••" + d.slice(-3) : "number hidden";
  const title = b ? `📞 Incoming call: ${b.reg || "no reg"} — ${b.name || "Customer"}` : "📞 Incoming call: not on today's cars";
  const bits = b
    ? [b.kind === "picks" ? "PICKS" : "DROPS", b.return_at ? "return " + new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(b.return_at)) : "", b.yard ? "yard " + b.yard : "", b.num ? "key " + b.num : "", mask]
    : [mask];
  const sent = await pushTo((ids ?? []) as string[], null, { title, body: bits.filter(Boolean).join(" · "), url: "/", tag: `call-${k.id}`, eventKey: `call:${k.id}`, category: "calls", urgency: "urgent" });
  return { sent };
}

async function fromTimer(req: Request) {
  const { data: ok } = await db.rpc("timer_secret_ok", { p_secret: req.headers.get("x-timer") ?? "" });
  return ok === true;
}

// Cars called between LONG_WAIT_MIN and an hour ago: older calls are history,
// and alert_log keeps it to one push per call.
async function onLongWait(req: Request) {
  if (!(await fromTimer(req))) return reply(403, { error: "Not the timer." });
  const now = Date.now();
  const { data: cars, error } = await db.from("bookings")
    .select("id, company_id, num, reg, yard, name, flight, est_time, sched_time, return_at, called_at, called_word, called_by, note")
    .eq("kind", "drops").is("sent_at", null).is("cleared_at", null)
    .lte("called_at", new Date(now - LONG_WAIT_MIN * 60000).toISOString())
    .gte("called_at", new Date(now - 60 * 60000).toISOString());
  if (error) throw error;
  const waiting = (cars ?? []).filter((b) => b.called_word !== "Overstay");
  const staffOf = new Map<string, { id: string; name: string }[]>();
  let sent = 0;
  for (const b of waiting) {
    if (!(await once(`wait:${b.id}:${b.called_at}`))) continue;
    if (!staffOf.has(b.company_id)) {
      const { data } = await db.from("staff").select("id, name").eq("company_id", b.company_id).eq("active", true);
      staffOf.set(b.company_id, data ?? []);
    }
    const people = staffOf.get(b.company_id)!;
    const byName = people.find((p) => p.id === b.called_by)?.name ?? "";
    const mins = Math.floor((now - new Date(b.called_at).getTime()) / 60000);
    const car = `${b.num ? "#" + b.num + " · " : ""}${b.reg || "no reg"}${b.yard ? " (" + b.yard + ")" : ""}`;
    const title = `⏱ WAITING ${mins} MIN: ${car} — ${b.name || "Customer"}`;
    const due = b.flight ? `${b.flight} · due ${b.est_time && b.est_time !== "DELAY" ? b.est_time : b.sched_time || time(b.return_at)}` : `back ${time(b.return_at)}`;
    const body = `CALLED at ${time(b.called_at)}${byName ? " by " + byName : ""}, no driver SENT yet · ${due}${b.note ? " · " + b.note.replace(/^!\s*/, "") : ""}`;
    sent += await pushTo(people.map((p) => p.id), "drops", { title, body, url: "/?booking=" + b.id, tag: `drops-${b.id}`, bookingId: b.id, eventKey: `collection:${b.id}:${b.called_at}`, deliveryKey: `wait:${b.id}:${b.called_at}`, category: "drops", urgency: "urgent" });
    await discord(b.company_id, "drops", title, body);
  }
  sent += await centreTimer();
  return reply(200, { waiting: waiting.length, sent });
}

// Shared five-minute timer: real missing-key / physical-lane candidates and
// supervisor escalation. No new cron or additional customer messaging.
async function centreTimer() {
  let sent = await sendQueuedPushes();
  const { data: candidates, error } = await db.rpc("ops_notification_candidates");
  if (error) console.error("notification candidates unavailable", error.code);
  for (const n of Array.isArray(candidates) ? candidates : []) {
    if (!n.staff?.length || !(await once("centre:" + n.event_key))) continue;
    sent += await pushTo(n.staff, null, { title: n.title, body: n.body, url: "/?booking=" + n.booking_id, tag: n.event_key, eventKey: n.event_key, bookingId: n.booking_id, category: n.kind, urgency: "urgent" });
  }
  const { data: escalations, error: escalationError } = await db.rpc("ops_notification_escalations");
  if (escalationError) console.error("notification escalation unavailable", escalationError.code);
  for (const n of Array.isArray(escalations) ? escalations : []) {
    sent += await pushTo(n.staff, null, { title: n.title, body: n.body, url: "/?notice=" + n.id, tag: n.key, category: "escalation", urgency: "urgent", persist: false });
  }
  if (await once("centre-trim:" + new Date().toISOString().slice(0,10))) {
    const { error } = await db.rpc("ops_notification_trim");
    if (error) console.error("notification retention unavailable", error.code);
  }
  return sent;
}

// A scheduled booking import that was held or did not run: owners, managers and the office are told, once per saved
// time. Called by takeoff-bookings with the service-role key as the bearer; nothing else may send this.
async function onImportHeld(req: Request, msg: Record<string, unknown>) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!key || (req.headers.get("authorization") ?? "") !== "Bearer " + key) return reply(403, { error: "Not allowed." });
  const company = String(msg.company_id ?? ""), slot = String(msg.slot ?? "").slice(0, 16), text = String(msg.text ?? "").slice(0, 200);
  if (!/^[0-9a-f-]{36}$/i.test(company) || !text) return reply(400, { error: "Bad request." });
  if (!(await once(`importheld:${company}:${slot}`))) return reply(200, { sent: 0, note: "already sent" });
  const { data: people } = await db.from("staff").select("id").eq("company_id", company).eq("active", true).in("role", ["owner", "manager", "office"]);
  const { data: co } = await db.from("companies").select("name").eq("id", company).maybeSingle();
  const sent = await pushTo((people ?? []).map((p) => p.id), null, { title: `${co?.name ?? "Parking Ops"}: bookings need a decision`, body: text, url: "/", tag: "import-held", eventKey: `importheld:${company}:${slot}`, category: "import", urgency: "urgent" });
  return reply(200, { sent });
}

async function onUsage(req: Request) {
  if (!(await fromTimer(req))) return reply(403, { error: "Not the timer." });
  const { data: u, error } = await db.rpc("usage_status");
  if (error) throw error;
  const warnings: string[] = u?.warnings ?? [];
  if (!warnings.length) return reply(200, { warnings: 0 });
  if (!(await once("usage:" + new Date().toISOString().slice(0, 10)))) return reply(200, { warnings: warnings.length, sent: "already today" });
  const { data: cos } = await db.from("companies").select("id, slug").in("slug", (u.to ?? []).map((x: string) => x.trim()));
  const ids = (cos ?? []).map((c) => c.id);
  const { data: people } = ids.length ? await db.from("staff").select("id").in("company_id", ids).eq("active", true).in("role", ["owner", "manager"]) : { data: [] };
  const title = "⚠️ Parking Ops: plan check";
  const body = warnings.join(" ") + " Tell whoever looks after the app.";
  const sent = await pushTo((people ?? []).map((p) => p.id), null, { title, body, url: "/", tag: "usage", category: "usage" });
  for (const c of cos ?? []) await discord(c.id, "drops", title, body);
  return reply(200, { warnings: warnings.length, sent });
}

// Platform warnings for the product owner only (they can name any client).
async function onHealth(req: Request) {
  if (!(await fromTimer(req))) return reply(403, { error: "Not the timer." });
  const { data: h, error } = await db.rpc("health_status");
  if (error) throw error;
  const day = new Date().toISOString().slice(0, 10);
  const fresh: string[] = [];
  for (const w of (h?.warnings ?? []) as { key: string; text: string }[]) {
    if (await once(`health:${w.key}:${day}`)) fresh.push(w.text);
  }
  if (!fresh.length) return reply(200, { warnings: (h?.warnings ?? []).length, sent: 0 });
  const title = "⚠️ Parking Ops: needs a look";
  const body = fresh.join(" ") + " Details: Clients → Health.";
  const sent = await pushTo((h?.to ?? []) as string[], null, { title, body, url: "/", tag: "health", category: "health" });
  const hook = String(h?.discord ?? "");
  if (/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(hook)) {
    try { await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `**${title}**\n${body}`, allowed_mentions: { parse: [] } }) }); }
    catch (e) { console.error("discord failed", String(e)); }
  }
  return reply(200, { warnings: fresh.length, sent });
}

async function onTest(req: Request, body: Record<string, unknown>) {
  const asCaller = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: me } = await asCaller.rpc("me");
  if (!me?.id) return reply(401, { error: "Sign in again." });
  const sent = await pushTo([me.id], null, { title: "Test notification", body: `Test alert for ${me.name}.`, url: "/", tag: "test", persist: false }, typeof body.endpoint === "string" ? body.endpoint : undefined);
  const result: Record<string, unknown> = { sent };
  if (body.discord) {
    const { data: allowed } = await asCaller.rpc("can", { p_action: "settings" });
    if (allowed !== true) return reply(403, { error: "Only an owner or manager can test Discord." });
    const { data: co } = await db.from("companies").select("name").eq("id", me.company_id).maybeSingle();
    const app = co?.name ?? "Parking Ops";
    const text = `Test from the ${app} app by ${me.name}. Alerts will arrive in this channel.`;
    result.drops = await discord(me.company_id, "drops", `${app} test (DROPS channel)`, text);
    result.picks = await discord(me.company_id, "picks", `${app} test (PICKS channel)`, text);
  }
  return reply(200, result);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "POST only." });
  let msg: Record<string, unknown>;
  try { msg = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
  try {
    if (msg.type === "booking" && /^[0-9a-f-]{36}$/i.test(String(msg.id))) return reply(200, await onBooking(String(msg.id)));
    if (msg.type === "call" && Number.isInteger(msg.id)) return reply(200, await onCall(Number(msg.id)));
    if (msg.type === "test") return await onTest(req, msg);
    if (msg.type === "longwait") return await onLongWait(req);
    if (msg.type === "usage") return await onUsage(req);
    if (msg.type === "health") return await onHealth(req);
    if (msg.type === "import_held") return await onImportHeld(req, msg);
    return reply(400, { error: "Unknown message." });
  } catch (e) {
    console.error(e);
    return reply(500, { error: String((e as Error).message ?? e) });
  }
});
