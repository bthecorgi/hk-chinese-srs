// Offline cache. Bump VERSION whenever any shell file or the data changes.
const VERSION = 'v20';
const CACHE = `hk-srs-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'srs.js',
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hk-srs-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache first, falling back to network (and caching same-origin GETs).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // The Japanese app in ja/ has its own service worker and cache.
  if (new URL(req.url).pathname.startsWith(new URL('ja/', self.registration.scope).pathname)) return;
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
