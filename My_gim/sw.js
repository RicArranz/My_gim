// Service worker: red primero (así cada despliegue nuevo llega al instante) y caché como respaldo sin conexión.
const CACHE = 'mygim-runtime';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const isCdn = url.hostname === 'cdn.jsdelivr.net';
  if (!sameOrigin && !isCdn) return;            // las llamadas a Supabase van directas
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache', signal: AbortSignal.timeout(6000) }); // si la red tarda, tirar de la copia guardada
      if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      if (req.mode === 'navigate') { const idx = await caches.match('./') || await caches.match('index.html'); if (idx) return idx; }
      throw err;
    }
  })());
});
