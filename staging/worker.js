// Same-origin static cache only. No API caching, forwarding or background writes.
const CACHE='synthetic-preview-v1';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const u=new URL(event.request.url);
 if(u.origin!==self.location.origin){event.respondWith(Promise.resolve(new Response('External request blocked',{status:403})));return;}
 if(event.request.method!=='GET'||u.pathname.startsWith('/_staging/'))return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);try{const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;}catch{const saved=await cache.match(event.request);return saved||new Response('Synthetic Preview offline',{status:503});}})());
});
self.addEventListener('notificationclick',event=>{event.notification.close();const u=new URL(event.notification.data?.url||'/staging.html',self.location.origin);if(u.origin!==self.location.origin)return;event.waitUntil(self.clients.openWindow(u.href));});
