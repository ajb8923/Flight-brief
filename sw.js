// fetch con límite de tiempo: en el Wi-Fi del avión sin pagar las peticiones se quedan colgadas
function fetchT(req, ms, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 10000);
  return fetch(req, Object.assign({}, opts || {}, { signal: ctrl.signal })).finally(() => clearTimeout(t));
}

// FlightBrief — guarda la app en el iPad para que abra sin internet.
// No hace falta tocar este archivo al actualizar: basta con subir el index.html nuevo.
// La app se abre siempre desde la copia guardada; con internet, comprueba en segundo plano si hay
// un index.html nuevo en GitHub y, si lo hay, lo guarda y avisa ("Nueva versión disponible").
const CACHE = 'flightbrief-v4';
const TILE_CACHE = 'flightbrief-tiles-v1'; // fondo de los mapas: se conserva entre versiones
const INDEX = './index.html';
const MARKER = 'FLIGHTBRIEF-APP'; // solo se acepta como actualización un index.html que contenga esto
const LOCAL = ['./index.html', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'];
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap';
const LEAFLET = ['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css'];
const CACHEABLE_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'raw.githubusercontent.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(LOCAL.map(u => new Request(u, { cache: 'reload' })));
    // lo que ya estaba guardado en versiones anteriores (pdf.js, Leaflet, fuentes) se copia a la nueva
    for (const k of await caches.keys()) {
      if (k === CACHE || k.indexOf('flightbrief-tiles') === 0) continue;
      const old = await caches.open(k);
      for (const r of await old.keys()) { if (!(await c.match(r))) { const v = await old.match(r); if (v) await c.put(r, v); } }
    }
    try { const r = await fetchT(PDFJS, 20000, { mode: 'cors' }); if (r.ok) await c.put(PDFJS, r); } catch (e) {}
    for (const u of LEAFLET) { try { const r = await fetchT(u, 20000, { mode: 'cors' }); if (r.ok) await c.put(u, r); } catch (e) {} }
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
    await Promise.all(keys.filter(k => k !== CACHE && k !== TILE_CACHE).map(k => caches.delete(k)));
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

  // Teselas del fondo de los mapas (Esri): primero las guardadas; si no están, se descargan y se guardan.
  if (url.hostname === 'server.arcgisonline.com') {
    event.respondWith((async () => {
      const c = await caches.open(TILE_CACHE);
      const hit = await c.match(req.url);
      if (hit) return hit;
      try {
        const r = await fetchT(req, 10000);
        if (r.ok || r.type === 'opaque') c.put(req.url, r.clone());
        return r;
      } catch (e) { return new Response('', { status: 504 }); }
    })());
    return;
  }

  // Lo de fuera de la app (proxies de meteo/perfil, radar, Open-Meteo) va siempre por la red.
  const cacheable = url.origin === location.origin || CACHEABLE_HOSTS.includes(url.hostname);
  if (!cacheable) return;

  event.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = (await c.match(req, { ignoreSearch: url.origin === location.origin })) || (await c.match(req.url));
    if (hit) return hit;
    try {
      const r = await fetchT(req, 12000);
      if (r.ok || r.type === 'opaque') c.put(req, r.clone());
      return r;
    } catch (e) { return Response.error(); }
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'check-update') event.waitUntil(refreshIndex());
});
