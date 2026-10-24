// The words of a customer text and where it goes: plain functions, shared by
// send-texts (Deno) and checks/customer-texts.mjs (node). The app's Settings
// preview (src/app/16-texts.js) fills the words the same way.

// A UK mobile as +447xxxxxxxxx, or "" for anything else (a landline, a foreign
// number, two numbers run together: those are never texted).
export function ukMobile(p) {
  const groups = String(p || "").split(/[^\d+]+/).filter(Boolean);
  let acc = "";
  for (const g of groups) { acc += g; if (acc.replace(/\D/g, "").length >= 10) break; }
  const d = acc.replace(/[^\d+]/g, "").replace(/^\+/, "").replace(/^00/, "");
  if (/^447\d{9}$/.test(d)) return "+" + d;
  if (/^07\d{9}$/.test(d)) return "+44" + d.slice(1);
  if (/^7\d{9}$/.test(d)) return "+44" + d;
  return "";
}

// Bookings come as "KHAIRA MS" or "MR JOHN SMITH": "Ms Khaira", "Mr Smith"; else the name as given.
const TITLES = /^(MR|MRS|MS|MISS|DR|MX)\.?$/i;
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();
export function customerName(n) {
  const w = String(n || "").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "there";
  if (w.length > 1 && TITLES.test(w[w.length - 1])) return cap(w[w.length - 1].replace(".", "")) + " " + cap(w[0]);
  if (w.length > 1 && TITLES.test(w[0])) return cap(w[0].replace(".", "")) + " " + cap(w[w.length - 1]);
  return w.map(cap).join(" ");
}

const TZ = "Europe/London";
const hhmm = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dayShort = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));

export const DEFAULT_TEXT = {
  landed: "Welcome back {name}. Once you have your bags, call us on {office} and we'll bring your car {reg} to {meet}. {company}",
  sent: "Hi {name}, your car {reg} is on its way to {meet}. Please wait there for our driver. {company}",
  reminder: "Hi {name}, a reminder from {company}: we meet you at {meet} on {date} at {time}. Please call {office} 30 min before you arrive.",
};
export const LABEL = { landed: "Flight landed", sent: "Car on its way", reminder: "Reminder", manual: "Text", test: "Test" };

// cfg is companies.texts; b the booking.
export function fillText(rule, b, cfg, companyName) {
  const tpl = (cfg[rule] && cfg[rule].text) || DEFAULT_TEXT[rule] || "";
  const v = { name: customerName(b.name), reg: b.reg || "", office: cfg.office || "", meet: cfg.meet || "",
    company: cfg.sender || companyName || "", time: b.drop_at ? hhmm(b.drop_at) : "", date: b.drop_at ? dayShort(b.drop_at) : "" };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)).replace(/\s+/g, " ").trim();
}

// 160 letters go as one text, longer ones in parts of 153 (each part costs one text).
export const textParts = (s) => (String(s).length <= 160 ? 1 : Math.ceil(String(s).length / 153));

// The London date and time now, as "2026-10-24" and "18:05".
export function londonNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export function nextDay(day) { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
