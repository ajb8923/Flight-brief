// Service Worker: cachea la app la primera vez que se visita con conexión,
// y a partir de ahí la sirve desde caché aunque no haya internet.
const CACHE_NAME = 'nomina-aea-cache-v1';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Se cachea cada archivo por separado: si uno falla (p.ej. un icono con
      // ruta incorrecta), los demás se guardan igualmente en vez de perderse todos.
      return Promise.allSettled(
        URLS_TO_CACHE.map(url =>
          cache.add(url).catch(err => console.warn('No se pudo cachear', url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Estrategia: responder desde caché al instante si existe, y en paralelo
// intentar refrescar desde la red para la próxima vez (stale-while-revalidate).
// Si no hay red, se usa lo que haya en caché sin más.
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if(networkResponse && networkResponse.ok){
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
