// ═══════════════════════════════════════════════════════════════
//  Farm Tracker Pro — Service Worker  (sw.js)
//  Handles: Web Push delivery, offline caching, background sync
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'ftp-cache-v4';
const OFFLINE_URL = './index.html';

// ── Install: pre-cache the shell ────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.add(OFFLINE_URL))
    );
    self.skipWaiting(); // activate immediately
});

// ── Activate: clean up old caches ───────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim()) // take control of all open tabs
    );
});

// ── Fetch: serve from cache, fallback to network ─────────────────
self.addEventListener('fetch', event => {
    // Only handle GET requests for same-origin resources
    if (event.request.method !== 'GET') return;
    if (!event.request.url.startsWith(self.location.origin)) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Clone and cache successful responses
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request).then(cached => cached || caches.match(OFFLINE_URL)))
    );
});

// ── Push: receive and display push notifications ─────────────────
self.addEventListener('push', event => {
    let data = { title: '🌱 Farm Tracker Pro', body: 'You have a new farm alert.' };

    if (event.data) {
        try {
            data = event.data.json();
        } catch(e) {
            data.body = event.data.text() || data.body;
        }
    }

    const options = {
        body:             data.body || '',
        icon:             data.icon  || './icon-192.png',
        badge:            data.badge || './icon-192.png',
        tag:              data.tag   || 'ftp-alert-' + Date.now(),
        data:             { url: data.url || './' },
        requireInteraction: data.requireInteraction || false,
        vibrate:          [200, 100, 200],
        actions: data.actions || [
            { action: 'open',    title: 'Open App' },
            { action: 'dismiss', title: 'Dismiss'  }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title || '🌱 Farm Tracker Pro', options)
    );
});

// ── Notification click: open or focus the app ────────────────────
self.addEventListener('notificationclick', event => {
    event.notification.close();

    if (event.action === 'dismiss') return;

    const targetUrl = (event.notification.data && event.notification.data.url) || './';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            // If the app is already open, focus it
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise open a new window
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});

// ── Periodic Background Sync: morning briefing ───────────────────
self.addEventListener('periodicsync', event => {
    if (event.tag === 'morning-briefing') {
        event.waitUntil(handleMorningBriefing());
    }
});

async function handleMorningBriefing() {
    // Get all open clients
    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    // Ask the app to check and fire the briefing (if app is open)
    if (clientList.length > 0) {
        clientList.forEach(client => client.postMessage({ type: 'CHECK_BRIEFING' }));
        return;
    }

    // App is closed — read prefs from IndexedDB or fire a generic briefing
    // We can't access localStorage from SW, so fire a default morning notification
    const now = new Date();
    const hour = now.getHours();
    if (hour >= 5 && hour <= 11) { // only fire in the morning
        await self.registration.showNotification('🌅 Good morning from Farm Tracker Pro!', {
            body: 'Tap to open your farm dashboard and check today\'s tasks and alerts.',
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: 'morning-brief-' + now.toISOString().slice(0,10),
            data: { url: './' },
            requireInteraction: false,
            vibrate: [200, 100, 200]
        });
    }
}
self.addEventListener('pushsubscriptionchange', event => {
    event.waitUntil(
        self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: event.oldSubscription
                ? event.oldSubscription.options.applicationServerKey
                : null
        }).then(sub => {
            // Notify the main app so it can save the new subscription
            return self.clients.matchAll().then(clientList => {
                clientList.forEach(client => {
                    client.postMessage({ type: 'PUSH_RESUBSCRIBED', subscription: sub.toJSON() });
                });
            });
        }).catch(e => console.warn('[SW] pushsubscriptionchange resubscribe failed:', e))
    );
});

// ── Message: allow the app to trigger notifications directly ─────
self.addEventListener('message', event => {
    if (!event.data) return;

    if (event.data.type === 'SHOW_NOTIFICATION') {
        const { title, body, tag, icon, requireInteraction } = event.data;
        self.registration.showNotification(title || '🌱 Farm Alert', {
            body:  body  || '',
            tag:   tag   || 'ftp-msg-' + Date.now(),
            icon:  icon  || './icon-192.png',
            badge: './icon-192.png',
            requireInteraction: requireInteraction || false,
            vibrate: [200, 100, 200]
        });
    }

    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
