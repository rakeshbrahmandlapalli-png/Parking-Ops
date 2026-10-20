// Supabase Edge Function: send-alerts
//
// Phone notifications (web push) and Discord messages for:
//   DROPS  CALLED / OVERSTAY on a car no driver has been SENT to yet
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
type Note = { title: string; body: string; url: string; tag: string };

async function once(key: string) {
  const { error } = await db.from("alert_log").insert({ key });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw error;
}

// kind null: an account warning, sent whatever the person's alert choices.
async function pushTo(staffIds: string[], kind: Kind | null, note: Note) {
  if (!staffIds.length) return 0;
  const { data: prefs } = kind ? await db.from("alert_prefs").select("*").in("staff_id", staffIds) : { data: [] };
  const off = new Set((prefs ?? []).filter((p) => kind && p[kind] === false).map((p) => p.staff_id));
  const wanted = staffIds.filter((id) => !off.has(id));
  if (!wanted.length) return 0;
  const { data: subs } = await db.from("push_subscriptions").select("id, company_id, endpoint, p256dh, auth").in("staff_id", wanted);
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(note), { TTL: 2 * 3600, urgency: "high" });
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

  // OVERSTAY goes once per car, however often it is tapped off and on again.
  if (b.kind === "drops" && b.called_at && !b.sent_at && !b.cleared_at && fresh(b.called_at)) {
    const over = b.called_word === "Overstay";
    alerts.push({ key: over ? `overstay:${b.id}` : `called:${b.id}:${b.called_at}`, kind: "drops", channel: "drops", label: over ? "OVERSTAY" : "CALLED", at: b.called_at, by: b.called_by });
  }
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
      : `${a.label.replace(/^\S+ /, "")} at ${time(a.at)}${byName ? " by " + byName : ""} · ${a.kind === "picks" ? "drop-off " + time(b.drop_at) : flightLine}${b.note ? " · " + b.note.replace(/^!\s*/, "") : ""}`;
    sent += await pushTo(everyoneBut(a.by), a.kind, { title, body, url: "/", tag: `${a.kind}-${b.id}` });
    await discord(b.company_id, a.channel, title, body);
  }
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
    sent += await pushTo(people.map((p) => p.id), "drops", { title, body, url: "/", tag: `drops-${b.id}` });
    await discord(b.company_id, "drops", title, body);
  }
  return reply(200, { waiting: waiting.length, sent });
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
  const sent = await pushTo((people ?? []).map((p) => p.id), null, { title: `${co?.name ?? "Parking Ops"}: bookings need a decision`, body: text, url: "/", tag: "import-held" });
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
  const sent = await pushTo((people ?? []).map((p) => p.id), null, { title, body, url: "/", tag: "usage" });
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
  const sent = await pushTo((h?.to ?? []) as string[], null, { title, body, url: "/", tag: "health" });
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
  const sent = await pushTo([me.id], "drops", { title: "Test notification", body: `Notifications work on this phone, ${me.name}.`, url: "/", tag: "test" });
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
