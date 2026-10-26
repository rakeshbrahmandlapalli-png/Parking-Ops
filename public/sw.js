// TakeOff: keeps the app's own files on the phone so it opens with no signal.
// Bookings are never cached here; they come from Supabase every time.
const CACHE = "takeoff-ops-v15";
const FILES = ["/", "/index.html", "/app.css", "/pro.css", "/cards.css", "/premium.css", "/board.css", "/stdplus.css", "/ops.css", "/ops-refined.css", "/lanes.css", "/notifications.css", "/calls.css", "/fonts/barlow-400.woff2", "/fonts/barlow-600.woff2", "/fonts/barlow-700.woff2", "/fonts/barlow-semi-condensed-700.woff2", "/app.js", "/reader.js", "/vendor/supabase-2.117.2.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Tutorial videos stream straight from the network (too big to keep, and
  // phones ask for them in pieces).
  if (url.pathname.startsWith("/tutorials/") || url.pathname.startsWith("/phone/")) return;
  // Newest copy from the network, but on a weak signal the saved copy after
  // 4 seconds, so the app never sits on a blank screen waiting.
  const net = fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  });
  const saved = () => caches.match(e.request).then(hit => hit || (e.request.mode === "navigate" ? caches.match("/index.html") : undefined));
  const slow = new Promise(ok => setTimeout(ok, 4000)).then(saved);
  e.respondWith(Promise.race([net.catch(saved), slow.then(hit => hit || net)]).then(res => res || net).catch(saved));
});

// Alerts from send-alerts: {title, body, url, tag}. iPhones require every push
// to show a notification, so one is always shown. The TakeOff plane goes on
// TakeOff's own app only; other clients' phones show their own app icon and a P.
var TAKEOFF = self.location.hostname === "takeoff-ops.vercel.app";
var NOTE_ICON = TAKEOFF ? "/icons/icon-192.png" : undefined, NOTE_BADGE = TAKEOFF ? "/icons/badge.png" : "/icons/badge-p.png";
self.addEventListener("push", e => {
  let note = {};
  try { note = e.data ? e.data.json() : {}; } catch (err) { note = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(note.title || (TAKEOFF ? "TakeOff" : "Parking Ops"), {
    body: note.body || "", tag: note.tag || undefined, renotify: false, silent: note.silent === true,
    icon: NOTE_ICON, badge: NOTE_BADGE, data: { url: note.url || "/" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  let target;
  try {
    target = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin);
    if (target.origin !== self.location.origin || target.pathname !== "/") target = new URL("/", self.location.origin);
  } catch (_) { target = new URL("/", self.location.origin); }
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).origin === self.location.origin && new URL(c.url).pathname === "/");
    if (!open) return self.clients.openWindow(target.href);
    // Do not navigate an existing app: it may contain an unsaved booking edit.
    // Its authenticated handler opens the destination and preserves its PIN link.
    open.postMessage({ type: "OPEN_NOTIFICATION", url: target.href });
    return open.focus();
  }));
});

// Browsers may rotate a push subscription. Resubscribe using the existing key;
// only the signed-in app can save it to the server. No credentials live here.
self.addEventListener("pushsubscriptionchange", e => {
  e.waitUntil((async () => {
    try {
      if (e.oldSubscription && e.oldSubscription.options) await self.registration.pushManager.subscribe(e.oldSubscription.options);
    } catch (_) { /* The signed-in screen explains a blocked/unsupported device. */ }
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach(c => c.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED" }));
  })());
});
