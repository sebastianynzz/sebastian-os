/*
 * MoveOS Conductor — service worker.
 *
 * P0.2 auto-update: skipWaiting() + clients.claim() + versión de caché por
 * build (el placeholder se reemplaza al compilar), así cada release llega
 * al conductor en la siguiente carga sin pasos manuales.
 *
 * D2 tiles offline: los tiles de OSM se sirven cache-first con tope LRU; la
 * app pre-cachea los tiles de la ruta del día al recibirla, y la navegación
 * cae al index cacheado — la app nunca queda en blanco sin señal.
 */
const CACHE_VERSION = "__CACHE_VERSION__";
const SHELL_CACHE = `moveos-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `moveos-assets-${CACHE_VERSION}`;
// Los tiles sobreviven entre releases: re-descargarlos costaría datos y
// dejaría al conductor sin mapa justo después de un deploy.
const TILE_CACHE = "moveos-tiles-v1";
const MAX_TILES = 600;

const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // add() por URL, tolerando fallos: addAll es atómico y un 404 en un
      // asset secundario (p. ej. ícono renombrado) dejaría al SW nuevo sin
      // instalarse NUNCA — matando el auto-update de toda la flota.
      .then((cache) =>
        Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => null))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE, TILE_CACHE]);
      for (const key of await caches.keys()) {
        if (!keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

function isOsmTile(url) {
  return url.hostname.endsWith("tile.openstreetmap.org");
}

async function cacheFirst(cacheName, request, { trimTo } = {}) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    if (trimTo) {
      const keys = await cache.keys();
      // FIFO sencillo: si crece de más, soltar los más antiguos.
      for (let i = 0; i < keys.length - trimTo; i++) {
        await cache.delete(keys[i]);
      }
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Navegación: red primero (HTML siempre fresco → auto-update), y si no hay
  // señal, el shell cacheado — la app nunca queda en blanco.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match("/index.html");
        return cached ?? Response.error();
      }),
    );
    return;
  }

  // Assets con hash de Vite: inmutables → cache-first.
  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(ASSET_CACHE, request));
    return;
  }

  // Tiles OSM: cache-first con tope (navegación sobrevive zonas muertas).
  if (isOsmTile(url)) {
    event.respondWith(cacheFirst(TILE_CACHE, request, { trimTo: MAX_TILES }));
    return;
  }

  // Todo lo demás (API, uploads) va directo a la red: la cola offline de la
  // app maneja los fallos de las mutaciones.
});

// Avisos push (D5): ruta asignada, parada insertada.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // payload no-JSON: se muestra genérico
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "MoveOS Conductor", {
      body: data.body || "",
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const open = wins[0];
      if (open) {
        await open.focus();
        if ("navigate" in open) await open.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
