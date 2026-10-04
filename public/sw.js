// Offline cache. Bump VERSION whenever any shell file or the data changes.
const VERSION = 'v13';
const CACHE = `hk-srs-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'srs.js',
  'reminders.js',
  'config.json',
  'manifest.webmanifest',
  'data/chars.json',
  'data/sentences.json',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache first, falling back to network (and caching same-origin GETs).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match('index.html'))),
  );
});

// ---------- daily study reminders (sent by worker/) ----------

self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data?.json() || {}; } catch { /* not JSON */ }
  event.waitUntil(Promise.all([
    self.registration.showNotification(msg.title || '溫習時間 · Time to study', {
      body: msg.body || 'Your characters are waiting for you.',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'study-reminder',
      lang: 'zh-Hant-HK',
    }),
    msg.count && self.navigator.setAppBadge ? self.navigator.setAppBadge(msg.count).catch(() => {}) : null,
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).pathname.startsWith(new URL(self.registration.scope).pathname));
    return open ? open.focus() : self.clients.openWindow('./');
  }));
});

// Some browsers rotate the subscription; move the server record to the new one.
self.addEventListener('pushsubscriptionchange', (event) => {
  const old = event.oldSubscription;
  if (!old) return;
  event.waitUntil((async () => {
    const { pushServer } = await (await fetch('config.json')).json();
    const sub = event.newSubscription || await self.registration.pushManager.subscribe(old.options);
    // Only the endpoint moves; the app re-sends the time zone, time and plan next time it opens.
    await fetch(`${pushServer}/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ old: old.endpoint, subscription: sub.toJSON() }),
    });
  })().catch(() => {}));
});
