/* Passt. – Service Worker für Wiederbesuch und Offline-Demo.
 *
 * - App-Hülle (HTML, Bundle, nötige Cesium-Dateien) wird beim Installieren gecacht (precache.json).
 * - Eigene Dateien: Cache zuerst, sonst Netz (und dann in den Cache). HTML: Netz zuerst.
 * - Die Offline-Demo füllt den Daten-Cache gezielt aus offline-files.json (siehe src/offline.ts).
 * - Fremde Dienste (WMS, Nominatim) laufen nie über den Cache.
 */
const VERSION = '__PASST_VERSION__';
const SHELL = `passt-shell-${VERSION}`;
const DATA = 'passt-daten';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const list = await (await fetch('./precache.json', { cache: 'no-cache' })).json();
      const cache = await caches.open(SHELL);
      await cache.addAll(list);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('passt-shell-') && k !== SHELL) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(SHELL).then((c) => c.put(req, copy));
          return r;
        })
        .catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('./index.html')),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const r = await fetch(req);
      // Daten und Cesium-Dateien beim normalen Benutzen mitnehmen: Wiederbesuche laden schneller
      if (r.ok && /\/(data|cesium|assets)\//.test(url.pathname)) {
        const copy = r.clone();
        caches.open(url.pathname.includes('/data/') ? DATA : SHELL).then((c) => c.put(req, copy));
      }
      return r;
    })(),
  );
});
