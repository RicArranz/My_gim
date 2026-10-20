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
  if (!sameOrigin && !isCdn) return;            // el resto (p. ej. la API, que es POST) va directo
  e.respondWith((async () => {
    try {
      // Si la red tarda más de 6 s se tira de la copia guardada. (AbortSignal.timeout no existe en iOS < 16: temporizador propio.)
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(req, { cache: 'no-cache', signal: ctl.signal }).finally(() => clearTimeout(timer));
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
