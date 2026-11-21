// Offline cache for the Japanese app. Bump VERSION whenever any file it caches changes,
// including the shared ../srs.js and ../styles.css.
const VERSION = 'v1';
const CACHE = `ja-srs-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'ja.css',
  'app.js',
  'queue.js',
  'manifest.webmanifest',
  'data/phrases.json',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  '../srs.js',
  '../styles.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ja-srs-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true })).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match('index.html'))),
  );
});
