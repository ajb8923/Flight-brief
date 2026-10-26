// FlightBrief — guarda la app en el iPad para que abra sin internet.
// No hace falta tocar este archivo al actualizar: basta con subir el index.html nuevo.
// La app se abre siempre desde la copia guardada; con internet, comprueba en segundo plano si hay
// un index.html nuevo en GitHub y, si lo hay, lo guarda y avisa ("Nueva versión disponible").
const CACHE = 'flightbrief-v1';
const INDEX = './index.html';
const MARKER = 'FLIGHTBRIEF-APP'; // solo se acepta como actualización un index.html que contenga esto
const LOCAL = ['./index.html', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'];
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap';
const CACHEABLE_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(LOCAL.map(u => new Request(u, { cache: 'reload' })));
    try { const r = await fetch(PDFJS, { mode: 'cors' }); if (r.ok) await c.put(PDFJS, r); } catch (e) {}
    try {
      const r = await fetch(FONTS_CSS, { mode: 'cors' });
      if (r.ok) {
        const css = await r.clone().text();
        await c.put(FONTS_CSS, r);
        const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
        await Promise.all(urls.map(async u => {
          try { const fr = await fetch(u, { mode: 'cors' }); if (fr.ok) await c.put(u, fr); } catch (e) {}
        }));
      }
    } catch (e) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Busca un index.html nuevo. Descarta cualquier cosa que no sea la app de verdad (p. ej. la página de
// login del Wi-Fi del avión): tiene que venir de GitHub sin redirecciones y llevar la marca.
async function refreshIndex() {
  const c = await caches.open(CACHE);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(INDEX, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok || r.redirected) return null;
    const text = await r.text();
    if (!text.includes(MARKER)) return null;
    const old = await c.match(INDEX);
    const oldText = old ? await old.text() : null;
    if (oldText !== text) {
      await c.put(INDEX, new Response(text, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
      if (oldText !== null) {
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        clients.forEach(cl => cl.postMessage({ type: 'update-ready' }));
      }
    }
    return text;
  } catch (e) { return null; }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate' && url.origin === location.origin) {
    event.respondWith((async () => {
      const c = await caches.open(CACHE);
      const cached = await c.match(INDEX);
      if (cached) { event.waitUntil(refreshIndex()); return cached; }
      const fresh = await refreshIndex();
      if (fresh) return new Response(fresh, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return fetch(req);
    })());
    return;
  }

  // Lo de fuera de la app (proxies de meteo/perfil, mapas, base de waypoints) va siempre por la red.
  const cacheable = url.origin === location.origin || CACHEABLE_HOSTS.includes(url.hostname);
  if (!cacheable) return;

  event.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r.ok || r.type === 'opaque') c.put(req, r.clone());
      return r;
    } catch (e) { return Response.error(); }
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'check-update') event.waitUntil(refreshIndex());
});
