/* Cache only public application files. */
const CACHE = 'mirror-factory-shell-v1.0.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key =>
            key.startsWith('mirror-factory-shell-') &&
            key !== CACHE
          )
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);

  if (url.origin !== scope.origin ||
      !url.pathname.startsWith(scope.pathname)) return;

  if (!ASSETS.some(path =>
    new URL(path, scope).pathname === url.pathname
  )) return;

  event.respondWith(
    fetch(req)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE)
              .then(cache => cache.put(req, copy))
          );
        }
        return response;
      })
      .catch(() =>
        caches.match(req).then(cached =>
          cached ||
          (req.mode === 'navigate'
            ? caches.match(new URL('./index.html', scope))
            : Response.error())
        )
      )
  );
});
