import { api } from "./api";

/**
 * Registro del service worker (solo build de producción: en dev Vite sirve
 * en caliente). El SW hace skipWaiting+claim, así que al tomar control un
 * SW nuevo se recarga una vez para servir la versión recién desplegada —
 * cada release llega al conductor en la siguiente carga (P0.2).
 */
let waitingWorker: ServiceWorker | null = null;
let updateListener: (() => void) | null = null;

/**
 * La app se suscribe para mostrar el toast "nueva versión disponible". Si ya
 * había una versión esperando cuando se suscribe, avisa de inmediato.
 */
export function onUpdateAvailable(cb: () => void): void {
  updateListener = cb;
  if (waitingWorker) cb();
}

/** Activa el SW en espera; `controllerchange` recargará una sola vez. */
export function applyUpdate(): void {
  waitingWorker?.postMessage({ type: "SKIP_WAITING" });
}

function trackWaiting(reg: ServiceWorkerRegistration): void {
  const notify = (sw: ServiceWorker | null) => {
    if (!sw) return;
    waitingWorker = sw;
    updateListener?.();
  };
  // Una versión ya quedó en espera (instalada en una carga anterior).
  if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);
  // Una versión nueva empieza a instalarse con la app abierta.
  reg.addEventListener("updatefound", () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" && navigator.serviceWorker.controller) {
        notify(reg.waiting ?? installing);
      }
    });
  });
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;

  // Distinguir la primera instalación (claim inicial) de una actualización:
  // solo la actualización (tras confirmar el toast) debe recargar.
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    window.location.reload();
  });

  window.addEventListener("load", () => {
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        trackWaiting(reg);
        // Jornadas largas: buscar release nuevo cada vez que el conductor
        // vuelve a la app (el SW se actualiza al detectar bytes distintos).
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void reg.update();
        });
      } catch {
        // Sin SW (navegador raro): la app funciona igual, solo sin offline.
      }
    })();
  });
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Suscripción Web Push (D5): pide permiso (requiere gesto del usuario en
 * iOS/Android), se suscribe con la clave VAPID del backend y la registra.
 * Devuelve false si el push no está configurado o el permiso fue negado.
 */
export async function enablePushAlerts(): Promise<boolean> {
  if (
    !import.meta.env.PROD ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return false;
  }
  try {
    const { publicKey } = await api<{ publicKey: string | null }>(
      "GET",
      "/push/vapid-key",
    );
    if (!publicKey) return false;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
    const json = sub.toJSON();
    if (!json.keys?.p256dh || !json.keys.auth) return false;
    await api("POST", "/push/subscriptions", {
      endpoint: sub.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent,
    });
    return true;
  } catch {
    return false;
  }
}

/** ¿Tiene sentido ofrecer el botón de avisos? (no concedido ni negado aún) */
export function canOfferPush(): boolean {
  return (
    import.meta.env.PROD &&
    "Notification" in window &&
    "PushManager" in window &&
    Notification.permission === "default"
  );
}

const TILE_CACHE = "dalego-tiles-v1";
const TILE_BASE = "https://tile.openstreetmap.org";
/** Tope de tiles a pre-cachear por ruta (datos móviles del conductor). */
const MAX_PRECACHE_TILES = 220;

function tileXY(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

/** Tope del caché de tiles compartido con el service worker. */
const MAX_TILE_CACHE_ENTRIES = 600;

/**
 * Pre-cachea los tiles OSM alrededor de cada parada de la ruta (D2): si el
 * conductor entra a una zona muerta, el mapa de la ruta sigue visible.
 * Cache-first compartido con el service worker (mismo caché y URLs).
 */
export async function precacheRouteTiles(
  points: { lat: number; lng: number }[],
  zooms: number[] = [14, 15],
): Promise<void> {
  if (!("caches" in window) || !navigator.onLine || points.length === 0) return;
  const candidates = new Set<string>();
  for (const zoom of zooms) {
    for (const p of points) {
      const { x, y } = tileXY(p.lat, p.lng, zoom);
      // La parada y su vecindario inmediato (3×3).
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          candidates.add(`${TILE_BASE}/${zoom}/${x + dx}/${y + dy}.png`);
        }
      }
    }
  }
  // El tope se aplica al CONJUNTO final (un break interno no acota los
  // bucles externos): datos móviles del conductor primero.
  const urls = [...candidates].slice(0, MAX_PRECACHE_TILES);
  try {
    const cache = await caches.open(TILE_CACHE);
    await Promise.all(
      urls.map(async (url) => {
        if (await cache.match(url)) return;
        try {
          const res = await fetch(url, { mode: "cors" });
          if (res.ok) await cache.put(url, res);
        } catch {
          // sin señal o tile caído: se intentará en la próxima carga
        }
      }),
    );
    // El precache escribe directo al caché del SW: aplicar aquí el mismo
    // recorte FIFO para que el tope global no dependa de un miss del SW.
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_TILE_CACHE_ENTRIES; i++) {
      const key = keys[i];
      if (key) await cache.delete(key);
    }
  } catch {
    // caches no disponible (modo incógnito estricto): no es crítico
  }
}
