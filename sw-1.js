/* Duro's Crafts — Service Worker
 * Must be served as a real file at the site root (not a blob URL) so that
 * push subscriptions remain valid across browser restarts.
 */
const CACHE = 'duros-crafts-v3';
const PRECACHE = [
  './',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Dancing+Script:wght@600;700&display=swap'
];

// Hosts that serve dynamic data and must NEVER be served from the cache.
// Supabase REST/Realtime/Auth/Storage calls all need to hit the network
// every time, or deletes/edits will appear to "not save" until the cache
// is cleared (the old cache-first strategy below was serving stale
// dc_orders / dc_custom_orders / dc_messages responses forever).
const NEVER_CACHE_HOSTS = ['supabase.co', 'supabase.in'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Always go straight to the network for Supabase (and any other API) calls.
  // No cache read, no cache write — every order/admin fetch must be live.
  if (NEVER_CACHE_HOSTS.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(fetch(e.request));
    return;
  }

  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const c = r.clone();
          caches.open(CACHE).then((cc) => cc.put(e.request, c));
          return r;
        })
        .catch(() => caches.match(e.request).then((r) => r || caches.match('./')))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request)
          .then((r) => {
            const c = r.clone();
            caches.open(CACHE).then((cc) => cc.put(e.request, c));
            return r;
          })
          .catch(() => cached);
      })
    );
  }
});

/* ── Push notifications (fires even when no tab is open) ── */
self.addEventListener('push', (event) => {
  let data = { title: "Duro's Crafts", body: 'You have a new update.', url: './' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const icon =
    "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27%3E%3Crect width=%2764%27 height=%2764%27 rx=%2714%27 fill=%27%233d2314%27/%3E%3Ctext x=%2732%27 y=%2746%27 font-size=%2736%27 text-anchor=%27middle%27%3E%F0%9F%A7%B6%3C/text%3E%3C/svg%3E";

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon,
      badge: icon,
      tag: data.tag || 'duro-push',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: data.url || './' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
