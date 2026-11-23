/* Duro's Crafts — service worker
 * Lives at the site root next to index.html (scope "./").
 *
 * What it does:
 *  - Caches the app shell so the site opens quickly and still loads offline.
 *  - Keeps the live data fresh: Supabase calls, payments and WhatsApp are never cached.
 *  - Shows push notifications for new orders / custom order requests.
 *
 * When you change the site, bump CACHE_VERSION so visitors get the new files.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE   = `duro-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `duro-runtime-${CACHE_VERSION}`;

// Only files that are guaranteed to exist next to this worker.
const PRECACHE_URLS = ['./', './index.html', './manifest.json'];

// Third-party hosts whose static files (fonts) are safe to keep.
const CACHEABLE_EXTERNAL = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/* ───────── Install: pre-cache the shell ───────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

/* ───────── Activate: remove old caches ───────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => (k.startsWith('duro-shell-') || k.startsWith('duro-runtime-')) &&
                       k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// The page can ask a waiting worker to take over right away.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ───────── Fetch ───────── */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Other sites: only cache fonts, leave everything else (Supabase, payments, etc.) alone.
  if (url.origin !== self.location.origin) {
    if (CACHEABLE_EXTERNAL.includes(url.hostname)) {
      event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    }
    return;
  }

  // Page loads: network first so new products/reviews/updates show up,
  // falling back to the cached page when offline.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Icons, manifest and other static files: serve instantly, refresh in the background.
  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req) || await cache.match('./index.html') || await cache.match('./');
    if (cached) return cached;
    return new Response('You are offline. Please reconnect and try again.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then(res => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

/* ───────── Push notifications (admin: new orders / custom requests) ───────── */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : '' }; }

  const title = data.title || '🛒 Duro\'s Crafts';
  const options = {
    body: data.body || '',
    icon: data.icon || './icons/icon-192.png',
    badge: data.badge || './icons/icon-192.png',
    tag: data.tag || 'duro-general',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        client.navigate?.(target).catch(() => {});
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});
