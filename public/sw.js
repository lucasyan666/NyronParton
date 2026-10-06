/* Nyron — service worker.
 *
 * Content-addressed files never change under the same name, so they are
 * cache-first: built JS/CSS (hashed by Next), the room photographs (named
 * drop-<hash> by the scan) and the fonts. Anything else under /photos/ — the
 * landing photograph — can be replaced under the same name, so it is served
 * from the cache at once and refreshed behind it for the next visit. Pages
 * are network-first so a deploy is seen at once, with the cached shell as the
 * offline fallback.
 */
const VERSION = 'nyron-v2';
const IMMUTABLE = /^\/(_next\/static\/|fonts\/|photos\/drop-[0-9a-f]{10})/;
const REFRESH = /^\/photos\//;

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (IMMUTABLE.test(url.pathname)) {
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (REFRESH.test(url.pathname)) {
    const fresh = fetch(req).then(async (res) => {
      if (res.ok) await (await caches.open(VERSION)).put(req, res.clone());
      return res;
    });
    e.waitUntil(fresh.then(() => undefined, () => undefined));
    e.respondWith(caches.match(req).then((hit) => hit || fresh));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/'))),
    );
  }
});
