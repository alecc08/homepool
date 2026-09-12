// Service worker — see the header comment for the caching strategy.
//
// IMPORTANT: this file is the one the browser keeps between deploys, so it must
// never be served stale. nginx marks it no-cache (see nginx.conf.template).
//
// Caching strategy:
// - Hashed assets (assets/*.js, *.css, ...): cache-first. Filenames embed a
//   content hash, so anything cached is permanent and safe.
// - HTML (/, /index.html, SPA routes): network-first. This is what used to
//   serve a stale index.html whose hashed bundles no longer exist on disk ->
//   module 404 -> empty <div id="root"> -> white page.
// - /api/: network-first with offline fallback.
// - Cache names are versioned per deploy (SW_VERSION, bumped in CI); each
//   new service worker deletes the previous version's cache on activate, so a
//   browser that already had the PWA installed is fully purged and re-fetched.

const SW_VERSION = 'v3'; // bump per deploy; CI injects the app version.
const STATIC_CACHE = 'hp-static-' + SW_VERSION;
const API_CACHE = 'hp-api-' + SW_VERSION;

const CORE_ASSETS = ['/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache that isn't one of ours (previous versions, or the
      // legacy unversioned 'homepool-v2' that caused the stale-index bug).
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== STATIC_CACHE && k !== API_CACHE).map((k) => caches.delete(k))
      );
      // Take control of open tabs immediately so they switch to this strategy.
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept cross-origin requests or non-GETs.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API: network-first, cache the last good response for offline.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }))
    );
    return;
  }

  // HTML documents: network-first (stale-while-revalidate so we still respond
  // offline), never serve a stale index.
  if (request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }))
    );
    return;
  }

  // Hashed assets and other same-origin statics: cache-first.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return res;
        })
    )
  );
});
