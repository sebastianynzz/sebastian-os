import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  api,
  apiOrQueue,
  compressImage,
  flushQueue,
  getToken,
  queueSize,
  SESSION_EXPIRED_EVENT,
  setToken,
  uploadPodPhoto,
} from "./api";
import { ChargerSheet, RangeBanner, remainingRouteKm } from "./EnergyPanel";
import { navLinks } from "./nav";
import RouteMap, { type MapStop } from "./RouteMap";
import ScanSheet, { type ScanResult } from "./Scan";
import { canOfferPush, enablePushAlerts, precacheRouteTiles } from "./sw";
import {
  DELIVERY_TYPES,
  DELIVERY_TYPE_LABELS,
  PICKUP_TYPES,
  PICKUP_TYPE_LABELS,
} from "@moveos/shared";

interface Stop {
  id: string;
  kind: "PICKUP" | "DELIVERY";
  sequence: number;
  etaMin: number;
  status: string;
  order: {
    id: string;
    trackingNumber: string | null;
    customerName: string;
    customerPhone: string;
    addressRaw: string;
    addressNotes: string | null;
    lat: number | null;
    lng: number | null;
    pickupAddressRaw: string | null;
    pickupNotes: string | null;
    pickupLat: number | null;
    pickupLng: number | null;
    // Política POD del comercio cliente (pruebas exigidas para la entrega).
    client: { podRequired: string[] } | null;
  };
  pod: unknown | null;
}
interface DriverRoute {
  id: string;
  status: string;
  depotLat: number;
  depotLng: number;
  vehicle: {
    plate: string;
    type: string;
    isElectric: boolean;
    batteryKwh: number | null;
    nominalRangeKm: number | null;
    socPercent: number | null;
  };
  stops: Stop[];
}

const FAIL_REASONS = [
  ["CLIENTE_AUSENTE", "Cliente ausente"],
  ["DIRECCION_ERRADA", "Dirección errada"],
  ["RECHAZO_PRODUCTO", "Rechazó el producto"],
  ["ZONA_INSEGURA", "Zona insegura"],
  ["OTRO", "Otro"],
] as const;

function formatEta(etaMin: number): string {
  const h = Math.floor(etaMin / 60);
  const m = etaMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Distancia en metros entre dos puntos (haversine). */
function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Si llega a >300 m del pin guardado, proponemos corregirlo (flywheel). */
const ADDRESS_FIX_THRESHOLD_M = 300;

/** Radio de la geocerca: dentro de esto se considera "en el punto de entrega". */
const GEOFENCE_RADIUS_M = 80;

/**
 * Cada cuánto la hoja de entrega sondea el GPS en vivo. `watchPosition`
 * actualiza el ref sin re-render; sondeamos para que la distancia a la
 * geocerca se mueva mientras el conductor se acerca al punto.
 */
const GEOFENCE_POLL_MS = 2000;

/**
 * Filtro de precisión del GPS: por encima de esta imprecisión (m) se ignora el
 * fix para no contaminar la geocerca (un fix de antena a 2 km marcaría "estás
 * en el punto" en falso). En modo ahorro toleramos fixes más gruesos a
 * propósito, así que el umbral se relaja.
 */
const GPS_ACCURACY_MAX_M = 100;
const GPS_ACCURACY_MAX_LOW_POWER_M = 500;

/** Descargando y por debajo de esta carga, bajamos el GPS a modo ahorro. */
const GPS_LOW_BATTERY_LEVEL = 0.2;

/** Ventana para confirmar el SOS antes de auto-desarmarse (toque accidental). */
const SOS_CONFIRM_WINDOW_MS = 10_000;

/** Motivos de fallo disputables: exigen foto de evidencia. */
const EVIDENCE_REQUIRED_REASONS = ["CLIENTE_AUSENTE", "RECHAZO_PRODUCTO"];

/**
 * Chequeo de calidad de la foto POD en el dispositivo (lite): brillo medio y
 * varianza. Detiene fotos negras/quemadas en el origen, antes de subirlas.
 */
async function checkPhotoQuality(
  blob: Blob,
): Promise<{ ok: boolean; warning?: string }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const w = 64;
    const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * 64));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: true };
    ctx.drawImage(bitmap, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let sum = 0;
    const lums: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const lum =
        0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
      lums.push(lum);
      sum += lum;
    }
    const mean = sum / lums.length;
    const variance = lums.reduce((a, l) => a + (l - mean) ** 2, 0) / lums.length;
    if (mean < 35) return { ok: false, warning: "La foto se ve muy oscura — vuelve a tomarla" };
    if (mean > 235) return { ok: false, warning: "La foto se ve quemada por la luz — vuelve a tomarla" };
    if (variance < 80) {
      return { ok: false, warning: "La foto se ve plana o tapada — verifica que el paquete sea visible" };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/** Subconjunto de la Battery Status API que usamos (no está en lib.dom). */
interface BatteryLike {
  charging: boolean;
  level: number;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
}

function useGeo() {
  const pos = useRef<{ lat: number; lng: number } | null>(null);

  // Modo ahorro: el watchPosition de alta precisión drena el GPS. Si el celular
  // del conductor está descargando y con poca batería, bajamos a modo grueso —
  // un repartidor no puede quedarse sin teléfono a media ruta.
  const [lowPower, setLowPower] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryLike>;
    };
    if (!nav.getBattery) return;
    let battery: BatteryLike | null = null;
    let cancelled = false;
    const apply = () => {
      if (!battery) return;
      const save = !battery.charging && battery.level <= GPS_LOW_BATTERY_LEVEL;
      setLowPower((prev) => (prev === save ? prev : save));
    };
    void nav.getBattery().then((b) => {
      if (cancelled) return;
      battery = b;
      apply();
      b.addEventListener("levelchange", apply);
      b.addEventListener("chargingchange", apply);
    });
    return () => {
      cancelled = true;
      battery?.removeEventListener("levelchange", apply);
      battery?.removeEventListener("chargingchange", apply);
    };
  }, []);

  // Re-suscribe el watch cuando cambia el modo de energía.
  useEffect(() => {
    if (!navigator.geolocation) return;
    const maxAccuracyM = lowPower
      ? GPS_ACCURACY_MAX_LOW_POWER_M
      : GPS_ACCURACY_MAX_M;
    const options: PositionOptions = lowPower
      ? { enableHighAccuracy: false, maximumAge: 30000 }
      : { enableHighAccuracy: true, maximumAge: 0 };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        // Filtro de precisión: descarta fixes muy imprecisos salvo que aún no
        // tengamos ninguno (mejor algo que nada para encuadrar el mapa).
        if (
          typeof p.coords.accuracy === "number" &&
          p.coords.accuracy > maxAccuracyM &&
          pos.current !== null
        ) {
          return;
        }
        pos.current = { lat: p.coords.latitude, lng: p.coords.longitude };
      },
      () => {},
      options,
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [lowPower]);

  return pos;
}

/** Coordenadas de cada parada para el mapa offline (D2). */
function toMapStops(route: DriverRoute): MapStop[] {
  const result: MapStop[] = [];
  for (const stop of route.stops) {
    const isPickup = stop.kind === "PICKUP";
    const lat = isPickup ? stop.order.pickupLat : stop.order.lat;
    const lng = isPickup ? stop.order.pickupLng : stop.order.lng;
    if (lat === null || lng === null) continue;
    result.push({
      id: stop.id,
      lat,
      lng,
      sequence: stop.sequence,
      done: stop.status === "COMPLETED" || stop.status === "FAILED",
      isPickup,
    });
  }
  return result;
}

/**
 * Caché de la ruta del día (stale-while-revalidate): al abrir sin señal el
 * conductor ve de inmediato su última ruta conocida, y luego se revalida.
 */
const ROUTE_CACHE_KEY = "moveos_driver_route";
function readCachedRoute(): DriverRoute | null {
  try {
    const raw = localStorage.getItem(ROUTE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as DriverRoute) : null;
  } catch {
    return null;
  }
}
function writeCachedRoute(route: DriverRoute | null) {
  try {
    if (route) localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(route));
    else localStorage.removeItem(ROUTE_CACHE_KEY);
  } catch {
    // cuota llena / modo privado: la caché es best-effort.
  }
}

/** Esqueleto de carga inicial: evita el parpadeo de "sin ruta" antes del fetch. */
function RouteSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-40 animate-pulse rounded-xl bg-white/70 shadow-sm" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-xl bg-white/70 shadow-sm" />
      ))}
    </div>
  );
}

const PULL_REFRESH_THRESHOLD = 70;

/**
 * Tema conmutable del conductor. Default OSCURO (spec "dark-first"), pero el
 * repartidor puede cambiar a claro para luz solar directa. La preferencia se
 * persiste y se aplica como clase `.dark` en <html> (variante Tailwind).
 */
const THEME_KEY = "moveos-driver-theme";
type Theme = "dark" | "light";
function getInitialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "dark";
}
function applyTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
}

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  const [route, setRoute] = useState<DriverRoute | null>(() => readCachedRoute());
  const [loaded, setLoaded] = useState(false);
  const [activeStop, setActiveStop] = useState<Stop | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(queueSize());
  const [pushOffer, setPushOffer] = useState(canOfferPush());
  const [showChargers, setShowChargers] = useState(false);
  const [starting, setStarting] = useState(false);
  // SOS: idle → confirm (armado) → sent. Evita disparos por toque accidental.
  const [sos, setSos] = useState<"idle" | "confirm" | "sent">("idle");
  const [online, setOnline] = useState(navigator.onLine);
  const [sessionExpired, setSessionExpired] = useState(false);
  // Pull-to-refresh: distancia tirada (px) y estado de recarga.
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullStart = useRef<number | null>(null);
  const geo = useGeo();

  // Una sola derivación por cambio de ruta: estabiliza la identidad del
  // array para que RouteMap no redibuje/re-encuadre en cada render.
  const mapStops = useMemo(() => (route ? toMapStops(route) : []), [route]);

  // Parada actual: la primera que no esté terminada — se resalta para que el
  // conductor sepa cuál sigue tras una re-secuenciación del despachador.
  const currentStopId = route?.stops.find(
    (s) => s.status !== "COMPLETED" && s.status !== "FAILED",
  )?.id;

  // Firma de la secuencia de paradas para detectar re-secuenciación en vivo
  // (inserciones exprés del despachador) sin perder el lugar del conductor.
  const stopsSignature = useRef<string | null>(null);
  // Pre-cachear los tiles de la ruta UNA vez por secuencia (datos móviles).
  const tilesSignature = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!getToken()) return;
    try {
      const next = await api<DriverRoute | null>("GET", "/routes/driver/today");
      const signature = next
        ? next.stops.map((s) => `${s.id}:${s.sequence}`).join("|")
        : "";
      if (
        stopsSignature.current !== null &&
        signature !== stopsSignature.current &&
        next
      ) {
        const prevCount = stopsSignature.current.split("|").filter(Boolean).length;
        if (next.stops.length > prevCount) {
          setMessage("🆕 Despacho agregó una parada a tu ruta — revisa la secuencia");
        } else if (signature !== "") {
          setMessage("🔄 Tu ruta fue re-secuenciada por despacho");
        }
      }
      stopsSignature.current = signature;
      setRoute(next);
      writeCachedRoute(next); // revalidado: actualiza la caché SWR
      // D2: dejar los tiles de la ruta listos para zonas sin señal.
      if (next && signature !== tilesSignature.current) {
        tilesSignature.current = signature;
        void precacheRouteTiles(toMapStops(next));
      }
    } catch {
      // sin red: se mantiene la última vista (la caché ya hidrató al abrir)
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, authed]);

  // Re-secuenciación en vivo: refrescar la ruta cada 45 s mientras esté
  // activa, para absorber paradas insertadas sin que el conductor recargue.
  useEffect(() => {
    if (!route || !["DISPATCHED", "IN_PROGRESS"].includes(route.status)) return;
    const interval = setInterval(() => {
      if (navigator.onLine) void load();
    }, 45000);
    return () => clearInterval(interval);
  }, [route, load]);

  // Cola offline: reintentar al volver la señal y refrescar contador.
  useEffect(() => {
    const flush = async () => {
      const n = await flushQueue();
      setPending(queueSize());
      if (n > 0) {
        setMessage(`${n} acciones sincronizadas`);
        await load();
      }
    };
    window.addEventListener("online", flush);
    const interval = setInterval(flush, 20000);
    return () => {
      window.removeEventListener("online", flush);
      clearInterval(interval);
    };
  }, [load]);

  // Telemetría: ping de posición cada 30 s con la ruta activa.
  useEffect(() => {
    if (!route || route.status !== "IN_PROGRESS") return;
    const interval = setInterval(() => {
      if (!geo.current) return;
      // Ping GPS: efímero — sin señal NO se encola (reproducir posiciones
      // viejas no aporta y saturaría la cola del conductor).
      void apiOrQueue(
        "/tracking/pings",
        { lat: geo.current.lat, lng: geo.current.lng, routeId: route.id },
        { ephemeral: true },
      );
    }, 30000);
    return () => clearInterval(interval);
  }, [route, geo]);

  // Sesión expirada: cualquier petición autenticada que reciba 401 (token
  // vencido) emite el evento; aquí cerramos sesión y mostramos el aviso en la
  // pantalla de ingreso, sin perder lo que el conductor estaba viendo.
  useEffect(() => {
    const onExpired = () => {
      setSessionExpired(true);
      setAuthed(false);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // Indicador de conexión: el conductor debe distinguir "sin señal" de
  // "tengo cola pendiente" — en zona muerta lo ve de inmediato.
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // SOS armado: si no se confirma dentro de la ventana, se auto-desarma para
  // que un toque accidental no quede pendiente. El estado "sent" sí persiste
  // (el conductor puede querer reenviar).
  useEffect(() => {
    if (sos !== "confirm") return;
    const t = setTimeout(() => setSos("idle"), SOS_CONFIRM_WINDOW_MS);
    return () => clearTimeout(t);
  }, [sos]);

  if (!authed) {
    return (
      <Login
        notice={
          sessionExpired ? "Tu sesión expiró. Ingresa de nuevo." : null
        }
        onLogin={() => {
          setSessionExpired(false);
          setAuthed(true);
        }}
      />
    );
  }

  async function startRoute() {
    // Doble-guard: el botón se deshabilita Y la función rechaza la re-entrada,
    // para que un doble-toque no dispare dos POST /start (arranque duplicado).
    if (!route || starting) return;
    setStarting(true);
    try {
      await api("POST", `/routes/${route.id}/start`);
      await load();
    } catch (err) {
      // Iniciar ruta no se encola (es un arranque puntual, no una entrega):
      // si falla, el conductor lo ve y reintenta.
      setMessage(
        err instanceof TypeError
          ? "Sin conexión: no se pudo iniciar la ruta. Reintenta con señal."
          : err instanceof Error
            ? err.message
            : "No se pudo iniciar la ruta",
      );
    } finally {
      setStarting(false);
    }
  }

  async function sendPanic() {
    if (!route) return;
    const { queued } = await apiOrQueue("/safety/panic", {
      routeId: route.id,
      lat: geo.current?.lat,
      lng: geo.current?.lng,
    });
    setSos("sent");
    setMessage(
      queued
        ? "🚨 Sin señal: la alerta se enviará apenas vuelva la conexión"
        : "🚨 Alerta de pánico enviada a la central",
    );
  }

  // Pull-to-refresh: tirar hacia abajo desde el tope recarga la ruta. Se
  // inhabilita con una hoja abierta para no robarle el gesto.
  const overlayOpen = Boolean(activeStop) || sos !== "idle" || showChargers;
  function onTouchStart(e: React.TouchEvent) {
    if (overlayOpen || refreshing || window.scrollY > 0) return;
    pullStart.current = e.touches[0]?.clientY ?? null;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (pullStart.current === null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - pullStart.current;
    setPull(dy > 0 ? Math.min(dy, PULL_REFRESH_THRESHOLD * 1.6) : 0);
  }
  async function onTouchEnd() {
    if (pullStart.current === null) return;
    const trigger = pull >= PULL_REFRESH_THRESHOLD;
    pullStart.current = null;
    setPull(0);
    if (!trigger) return;
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div
      className="mx-auto flex min-h-screen max-w-md flex-col"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <header className="sticky top-0 z-10 flex items-center justify-between bg-navy px-4 py-3 text-white">
        <div>
          <div className="font-bold">
            move<span className="text-lima">.</span> conductor
          </div>
          {route && (
            <div className="text-xs opacity-80">
              {route.vehicle.plate} {route.vehicle.isElectric && "⚡"}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            role="status"
            aria-label={online ? "En línea" : "Sin conexión"}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
              online ? "bg-success-bg text-success" : "bg-niebla dark:bg-navy-900 text-text-secondary dark:text-sky"
            }`}
          >
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${online ? "bg-success" : "bg-text-tertiary"}`}
            />
            {online ? "En línea" : "Sin conexión"}
          </span>
          {pending > 0 && (
            <span className="rounded-full bg-warning px-2 py-0.5 text-xs font-bold">
              {pending} sin sync
            </span>
          )}
          <button
            onClick={() => setSos("confirm")}
            aria-label="Abrir confirmación de alerta de pánico"
            className="rounded-lg bg-danger px-3 py-1.5 text-sm font-bold active:bg-danger"
          >
            SOS
          </button>
          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
            title="Cambiar tema"
            className="text-base leading-none opacity-80"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button
            onClick={() => {
              setToken(null);
              setAuthed(false);
            }}
            className="text-xs underline opacity-80"
          >
            Salir
          </button>
        </div>
      </header>

      {message && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 bg-success-bg px-4 py-2 text-sm text-success"
        >
          <span>{message}</span>
          <button
            onClick={() => setMessage(null)}
            aria-label="Cerrar aviso"
            className="shrink-0 font-bold opacity-60"
          >
            ✕
          </button>
        </div>
      )}

      <main className="flex-1 space-y-3 p-4">
        {/* Indicador de pull-to-refresh. */}
        {(pull > 0 || refreshing) && (
          <div
            role="status"
            className="flex items-center justify-center overflow-hidden text-xs font-medium text-navy/60 dark:text-niebla/60"
            style={{
              height: refreshing ? 28 : Math.min(pull, PULL_REFRESH_THRESHOLD),
            }}
          >
            {refreshing
              ? "Actualizando…"
              : pull >= PULL_REFRESH_THRESHOLD
                ? "Suelta para actualizar"
                : "Tira para actualizar"}
          </div>
        )}

        {/* Carga inicial: esqueleto en vez del parpadeo de "sin ruta". */}
        {!loaded && !route && <RouteSkeleton />}

        {/* Avisos push (D5): requiere un toque del conductor (gesto). */}
        {pushOffer && (
          <button
            onClick={async () => {
              const ok = await enablePushAlerts();
              setPushOffer(false);
              setMessage(
                ok
                  ? "🔔 Avisos activados: te llegará una notificación con cada ruta"
                  : "No se pudieron activar los avisos en este dispositivo",
              );
            }}
            className="w-full rounded-xl border border-navy/30 bg-white dark:bg-navy-700 py-3 text-sm font-bold text-navy shadow-sm"
          >
            🔔 Activar avisos de rutas asignadas
          </button>
        )}

        {loaded && !route && (
          <div className="rounded-xl bg-white dark:bg-navy-700 p-6 text-center text-text-tertiary dark:text-sky/70 shadow-sm">
            No tiene ruta asignada hoy.
            <button onClick={load} className="mt-3 block w-full rounded-lg bg-niebla dark:bg-navy-900 py-2 text-sm font-medium">
              Actualizar
            </button>
          </div>
        )}

        {/* Mapa offline de la ruta (D2): tiles pre-cacheados, nunca en blanco. */}
        {route && mapStops.length > 0 && <RouteMap stops={mapStops} geo={geo} />}

        {/* D7: SoC en vivo + "¿alcanza para terminar?" (núcleo EV-only). */}
        {route && (
          <RangeBanner
            vehicle={route.vehicle}
            remainingKm={remainingRouteKm(
              geo.current,
              mapStops.filter((s) => !s.done),
              { lat: route.depotLat, lng: route.depotLng },
            )}
            onFindCharger={() => setShowChargers(true)}
          />
        )}

        {route?.status === "DISPATCHED" && (
          <button
            onClick={startRoute}
            disabled={starting}
            className="w-full rounded-xl bg-lima py-4 text-lg font-bold text-navy active:brightness-95 disabled:opacity-60"
          >
            {starting
              ? "Iniciando…"
              : `Iniciar ruta (${route.stops.length} paradas)`}
          </button>
        )}

        {route?.stops.map((stop) => (
          <StopCard
            key={stop.id}
            stop={stop}
            routeActive={route.status === "IN_PROGRESS"}
            isCurrent={stop.id === currentStopId}
            onAction={() => setActiveStop(stop)}
            onArrive={async () => {
              await apiOrQueue(`/routes/stops/${stop.id}/arrive`);
              setPending(queueSize());
              await load();
            }}
          />
        ))}
      </main>

      {activeStop && (
        <StopActionSheet
          stop={activeStop}
          geo={geo}
          onClose={() => setActiveStop(null)}
          onDone={async (queued) => {
            setActiveStop(null);
            setPending(queueSize());
            if (queued) setMessage("Sin señal: la entrega se sincronizará automáticamente");
            await load();
          }}
        />
      )}

      {/* D8: cargador más cercano con deeplink (directorio de carga). */}
      {showChargers && (
        <ChargerSheet geo={geo.current} onClose={() => setShowChargers(false)} />
      )}

      {/* SOS: confirmar antes de enviar (evita falsas alarmas) y reenviar si
          el conductor sigue en peligro. La alerta va a la central, no al
          consumidor (B2B). */}
      {sos !== "idle" && (
        <div
          className="fixed inset-0 z-30 flex items-end bg-black/50"
          onClick={() => sos === "confirm" && setSos("idle")}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Alerta de pánico"
            className="w-full rounded-t-2xl bg-white dark:bg-navy-700 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            {sos === "confirm" ? (
              <>
                <div className="text-lg font-bold text-danger">
                  🚨 ¿Enviar alerta de pánico?
                </div>
                <p className="mt-1 text-sm text-text-secondary dark:text-sky">
                  Se notificará a la central con tu ubicación. Úsalo solo ante
                  una emergencia real.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setSos("idle")}
                    className="flex-1 rounded-xl bg-niebla dark:bg-navy-900 py-4 text-base font-bold text-navy"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={sendPanic}
                    className="flex-1 rounded-xl bg-danger py-4 text-base font-bold text-white active:bg-danger"
                  >
                    Confirmar SOS
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-lg font-bold text-danger">
                  🚨 Alerta enviada
                </div>
                <p className="mt-1 text-sm text-text-secondary dark:text-sky">
                  La central fue notificada. Si sigues en peligro, puedes
                  reenviarla.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setSos("idle")}
                    className="flex-1 rounded-xl bg-niebla dark:bg-navy-900 py-4 text-base font-bold text-navy"
                  >
                    Cerrar
                  </button>
                  <button
                    onClick={sendPanic}
                    className="flex-1 rounded-xl bg-danger py-4 text-base font-bold text-white active:bg-danger"
                  >
                    Reenviar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Login({
  notice,
  onLogin,
}: {
  notice: string | null;
  onLogin: () => void;
}) {
  const [email, setEmail] = useState("carlos@demo.moveos.co");
  const [password, setPassword] = useState("moveos123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ token: string }>("POST", "/auth/login", {
        email,
        password,
      });
      setToken(res.token);
      onLogin();
    } catch (err) {
      // Distinguir falta de red de credenciales malas: el conductor necesita
      // saber si reintentar (señal) o corregir sus datos.
      setError(
        err instanceof TypeError
          ? "Sin conexión. Verifica tu internet e intenta de nuevo."
          : err instanceof Error
            ? err.message
            : "No se pudo ingresar",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white dark:bg-navy-700 p-6 shadow-sm">
        <h1 className="text-xl font-bold text-navy">move<span className="text-lima">.</span> conductor</h1>
        {notice && (
          <p
            role="status"
            className="rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning"
          >
            {notice}
          </p>
        )}
        <input
          className="w-full rounded-lg border border-cielo px-3 py-3 text-base focus:border-navy focus:outline-none"
          type="email"
          placeholder="Correo"
          aria-label="Correo electrónico"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-cielo px-3 py-3 text-base focus:border-navy focus:outline-none"
          type="password"
          placeholder="Contraseña"
          aria-label="Contraseña"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-navy py-3 font-bold text-white disabled:opacity-60"
        >
          {busy ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}

function StopCard({
  stop,
  routeActive,
  isCurrent,
  onAction,
  onArrive,
}: {
  stop: Stop;
  routeActive: boolean;
  isCurrent: boolean;
  onAction: () => void;
  onArrive: () => void;
}) {
  const done = stop.status === "COMPLETED" || stop.status === "FAILED";
  const arrived = stop.status === "ARRIVED";
  const isPickup = stop.kind === "PICKUP";
  // En recogida se muestra la dirección de origen; en entrega, la del destino.
  const address = isPickup
    ? stop.order.pickupAddressRaw ?? stop.order.addressRaw
    : stop.order.addressRaw;
  const notes = isPickup ? stop.order.pickupNotes : stop.order.addressNotes;
  const navLat = isPickup ? stop.order.pickupLat : stop.order.lat;
  const navLng = isPickup ? stop.order.pickupLng : stop.order.lng;
  const nav = navLat !== null && navLng !== null ? navLinks(navLat, navLng) : null;
  return (
    <div
      className={`rounded-xl bg-white dark:bg-navy-700 p-4 shadow-sm ${done ? "opacity-60" : ""} ${
        isPickup && !done ? "border-l-4 border-cielo" : ""
      } ${isCurrent && !done ? "ring-2 ring-lima" : ""}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span
              className={`rounded px-1.5 py-0.5 ${
                isPickup ? "bg-cielo/40 text-navy" : "bg-lima/50 text-navy"
              }`}
            >
              {isPickup ? "📦 RECOGER" : "📍 ENTREGAR"}
            </span>
            <span className="text-navy/60 dark:text-niebla/60">
              Parada {stop.sequence} · ETA {formatEta(stop.etaMin)}
            </span>
            {isCurrent && !done && (
              <span className="rounded bg-navy px-1.5 py-0.5 text-white">
                {arrived ? "EN SITIO" : "SIGUIENTE"}
              </span>
            )}
          </div>
          <div className="mt-1 font-semibold">{stop.order.customerName}</div>
          <div className="text-sm text-text-secondary dark:text-sky">{address}</div>
          {notes && (
            <div className="mt-1 rounded bg-warning-bg px-2 py-1 text-xs text-warning">
              📍 {notes}
            </div>
          )}
        </div>
        <a
          href={`tel:${stop.order.customerPhone}`}
          className="rounded-lg bg-niebla dark:bg-navy-900 px-3 py-2 text-sm"
        >
          📞
        </a>
      </div>

      {/* Navegación: deeplink a Waze / Google Maps — integrar, no construir. */}
      {nav && !done && (
        <div className="mt-2 flex gap-2">
          <a
            href={nav.waze}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-lg bg-sky-50 py-2 text-center text-xs font-bold text-info"
          >
            🧭 Waze
          </a>
          <a
            href={nav.gmaps}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-lg bg-success-bg py-2 text-center text-xs font-bold text-success"
          >
            🗺️ Maps
          </a>
        </div>
      )}

      {routeActive && !done && (
        <div className="mt-3 flex gap-2">
          {stop.status === "PENDING" && (
            <button
              onClick={onArrive}
              className="flex-1 rounded-lg border border-navy py-2.5 text-sm font-bold text-navy dark:text-niebla"
            >
              Llegué
            </button>
          )}
          <button
            onClick={onAction}
            className="flex-1 rounded-lg bg-navy py-2.5 text-sm font-bold text-white"
          >
            {isPickup ? "Confirmar recogida" : "Gestionar entrega"}
          </button>
        </div>
      )}
      {done && (
        <div className="mt-2 text-sm font-medium">
          {stop.status === "COMPLETED"
            ? isPickup
              ? "✅ Recogido"
              : "✅ Entregado"
            : "❌ No completado"}
        </div>
      )}
    </div>
  );
}

function StopActionSheet({
  stop,
  geo,
  onClose,
  onDone,
}: {
  stop: Stop;
  geo: React.MutableRefObject<{ lat: number; lng: number } | null>;
  onClose: () => void;
  onDone: (queued: boolean) => void;
}) {
  const [mode, setMode] = useState<"deliver" | "fail">("deliver");
  const [receivedBy, setReceivedBy] = useState("");
  const [failReason, setFailReason] = useState("CLIENTE_AUSENTE");
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [photoWarning, setPhotoWarning] = useState<string | null>(null);
  const [fixPin, setFixPin] = useState(true);
  const [busy, setBusy] = useState(false);
  // Escaneo del paquete (D3): vínculo bulto↔parada, validado localmente.
  const [scanOpen, setScanOpen] = useState(false);
  const [scan, setScan] = useState<ScanResult | null>(null);
  // Tipo de entrega/recogida (política POD por tipo, D2): determina qué evidencia
  // exige el servidor; se envía en la finalización.
  const [stopType, setStopType] = useState<string>(
    stop.kind === "PICKUP" ? "FROM_CUSTOMER" : "RECIPIENT",
  );
  const photoRef = useRef<HTMLInputElement>(null);

  // Geocerca en vivo: `geo` es un ref que `watchPosition` actualiza sin
  // re-render. Lo sondeamos para que la distancia al punto, el estado de la
  // geocerca y la oferta de corregir pin se muevan mientras el conductor
  // camina hacia la puerta — no congelados al abrir la hoja.
  const [livePos, setLivePos] = useState(geo.current);
  useEffect(() => {
    const tick = () => {
      const next = geo.current;
      setLivePos((prev) =>
        prev?.lat === next?.lat && prev?.lng === next?.lng ? prev : next,
      );
    };
    tick();
    const id = setInterval(tick, GEOFENCE_POLL_MS);
    return () => clearInterval(id);
  }, [geo]);

  const isPickup = stop.kind === "PICKUP";
  const refLat = isPickup ? stop.order.pickupLat : stop.order.lat;
  const refLng = isPickup ? stop.order.pickupLng : stop.order.lng;
  const sheetAddress = isPickup
    ? stop.order.pickupAddressRaw ?? stop.order.addressRaw
    : stop.order.addressRaw;

  // Política POD del comercio: en entregas, las pruebas que este cliente exige.
  const podRequired = isPickup ? [] : stop.order.client?.podRequired ?? [];
  const requiresPhoto = podRequired.includes("PHOTO");
  const requiresReceiver = podRequired.includes("RECEIVER_NAME");

  // Opciones del tipo de parada (política POD por tipo, D2).
  const typeOptions: [string, string][] = isPickup
    ? PICKUP_TYPES.map((t) => [t, PICKUP_TYPE_LABELS[t]])
    : DELIVERY_TYPES.map((t) => [t, DELIVERY_TYPE_LABELS[t]]);

  // Corrección de pin (el tap más valioso del producto): si el GPS real está
  // a >300 m del pin guardado de la ENTREGA, proponemos guardar la ubicación
  // verdadera — cada confirmación enseña al grafo de direcciones.
  const pinDriftM =
    !isPickup && livePos && refLat !== null && refLng !== null
      ? Math.round(distanceM(livePos, { lat: refLat, lng: refLng }))
      : null;
  const offerPinFix = pinDriftM !== null && pinDriftM > ADDRESS_FIX_THRESHOLD_M;

  async function onPickPhoto(file: File) {
    setError(null);
    setPhotoWarning(null);
    setBusy(true);
    try {
      const blob = await compressImage(file);
      // Chequeo de calidad en el dispositivo: detener mal POD en el origen.
      const quality = await checkPhotoQuality(blob);
      if (!quality.ok && quality.warning) setPhotoWarning(`⚠️ ${quality.warning}`);
      setPhoto((prev) => {
        if (prev) URL.revokeObjectURL(prev.preview);
        return { blob, preview: URL.createObjectURL(blob) };
      });
    } catch {
      setError("No se pudo procesar la foto");
    } finally {
      setBusy(false);
    }
  }

  async function deliver() {
    setError(null);
    // Política POD del comercio: exigir nombre antes de gastar la subida; el
    // servidor re-valida (esto es solo UX — no se puede saltar por offline).
    if (requiresReceiver && !receivedBy.trim()) {
      setError("Este cliente exige el nombre de quien recibe.");
      return;
    }
    if (requiresPhoto && !photo) {
      setError("Este cliente exige una foto de evidencia. Tómala antes de confirmar.");
      return;
    }
    setBusy(true);
    try {
      // Subir la foto primero; si no hay señal se entrega sin foto.
      let photoUrl: string | undefined;
      let photoSkipped = false;
      if (photo) {
        const url = await uploadPodPhoto(photo.blob);
        if (url) photoUrl = url;
        else photoSkipped = true;
      }
      // Foto exigida pero no se pudo subir (sin señal): no se confirma sin la
      // prueba que el cliente exige — se reintenta con señal (offline no la salta).
      if (requiresPhoto && !photoUrl) {
        setError(
          "Sin conexión no se puede confirmar: este cliente exige foto y aún no se ha subido. Reintenta con señal.",
        );
        setBusy(false);
        return;
      }

      // Posición más fresca al confirmar: lee el ref directo, no el sondeo de
      // hace ~2 s, para que la evidencia de geocerca sea la del momento exacto.
      // Fallback demo: sin GPS del navegador, usar la coordenada de la parada.
      const here = geo.current ?? livePos;
      const subLat = here?.lat ?? refLat ?? undefined;
      const subLng = here?.lng ?? refLng ?? undefined;

      // El POD solo declara las pruebas que REALMENTE tiene (el servidor
      // valida la evidencia). Sin foto subida ni GPS no hay prueba verificable:
      // se bloquea en lugar de fingir una foto (B2B: defensa ante disputas).
      const types: string[] = [];
      if (photoUrl) types.push("PHOTO");
      if (subLat !== undefined && subLng !== undefined) types.push("GEOFENCE");
      if (types.length === 0) {
        setError(
          "Sin foto ni señal GPS no se puede confirmar la entrega. Toma una foto o espera la ubicación.",
        );
        setBusy(false);
        return;
      }

      const { queued } = await apiOrQueue(`/routes/stops/${stop.id}/complete`, {
        types,
        deliveryType: isPickup ? undefined : stopType,
        pickupType: isPickup ? stopType : undefined,
        photoUrl,
        receivedBy: receivedBy || undefined,
        lat: subLat,
        lng: subLng,
      });
      // Pin-drop: aprender la ubicación real de la entrega si difiere del pin.
      if (offerPinFix && fixPin && here) {
        await apiOrQueue(`/addresses/orders/${stop.order.id}/driver-fix`, {
          lat: here.lat,
          lng: here.lng,
        });
      }
      if (photoSkipped) {
        console.warn("Foto no subida (sin señal): entrega registrada sin foto");
      }
      onDone(queued);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function fail() {
    setError(null);
    // Motivos disputables exigen foto de evidencia (defensa ante disputas).
    if (EVIDENCE_REQUIRED_REASONS.includes(failReason) && !photo) {
      setError("Este motivo requiere foto de evidencia. Tómala antes de registrar.");
      return;
    }
    setBusy(true);
    try {
      let photoUrl: string | undefined;
      if (photo) {
        const url = await uploadPodPhoto(photo.blob);
        if (url) photoUrl = url;
      }
      // Evidencia obligatoria para motivos disputables: si la foto no se pudo
      // subir (sin señal), NO se encola sin evidencia — el servidor la
      // rechazaría igual. El conductor reintenta con señal (offline no se salta
      // la evidencia).
      if (EVIDENCE_REQUIRED_REASONS.includes(failReason) && !photoUrl) {
        setError(
          "Sin conexión no se puede registrar este fallo: requiere foto de evidencia. Reintenta con señal.",
        );
        setBusy(false);
        return;
      }
      // Posición más fresca al registrar el fallo (igual que en la entrega).
      const here = geo.current ?? livePos;
      const { queued } = await apiOrQueue(`/routes/stops/${stop.id}/fail`, {
        reason: failReason,
        lat: here?.lat ?? refLat ?? undefined,
        lng: here?.lng ?? refLng ?? undefined,
        photoUrl,
      });
      onDone(queued);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Gestionar entrega de la parada ${stop.sequence}`}
        className="w-full rounded-t-2xl bg-white dark:bg-navy-700 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Contexto de la parada: evita confirmar la entrega equivocada. */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold text-navy/70 dark:text-niebla/70">
              Parada {stop.sequence}
            </div>
            <div className="truncate font-semibold">{stop.order.customerName}</div>
            <div className="truncate text-sm text-text-secondary dark:text-sky">{sheetAddress}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 rounded-lg bg-niebla dark:bg-navy-900 px-3 py-1.5 text-sm font-bold text-navy"
          >
            ✕
          </button>
        </div>
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setMode("deliver")}
            className={`flex-1 rounded-lg py-2 text-sm font-bold ${mode === "deliver" ? "bg-lima text-navy" : "bg-niebla dark:bg-navy-900"}`}
          >
            {isPickup ? "Recoger" : "Entregar"}
          </button>
          <button
            onClick={() => setMode("fail")}
            className={`flex-1 rounded-lg py-2 text-sm font-bold ${mode === "fail" ? "bg-danger text-white" : "bg-niebla dark:bg-navy-900"}`}
          >
            No se pudo
          </button>
        </div>

        {mode === "deliver" ? (
          <div className="space-y-3">
            {/* Tipo de parada (política POD por tipo): define qué evidencia se exige. */}
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-navy/70 dark:text-niebla/70">
                {isPickup ? "Tipo de recogida" : "Tipo de entrega"}
              </span>
              <select
                value={stopType}
                onChange={(e) => setStopType(e.target.value)}
                className="w-full rounded-lg border border-cielo bg-white px-3 py-3 text-navy focus:border-navy focus:outline-none dark:bg-navy-700 dark:text-niebla"
              >
                {typeOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            {/* Política POD del comercio: qué pruebas exige para esta entrega. */}
            {podRequired.length > 0 && (
              <div className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-info">
                Este cliente exige:{" "}
                {[
                  requiresPhoto ? "foto de evidencia" : null,
                  requiresReceiver ? "nombre de quien recibe" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}

            {/* Escaneo del paquete: evita entregar el bulto equivocado. */}
            {scan === null ? (
              <button
                onClick={() => setScanOpen(true)}
                className="w-full rounded-lg border border-dashed border-navy/40 py-3 text-sm font-medium text-navy/70 dark:text-niebla/70"
              >
                📷 Escanear paquete {stop.order.trackingNumber ?? ""}
              </button>
            ) : scan.match ? (
              <div className="rounded-lg bg-success-bg px-3 py-2 text-sm font-medium text-success">
                ✅ Paquete verificado ({scan.code})
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
                <span>
                  ❌ Este paquete es de otra guía ({scan.code}) — esperada{" "}
                  {stop.order.trackingNumber}
                </span>
                <button
                  onClick={() => {
                    setScan(null);
                    setScanOpen(true);
                  }}
                  className="shrink-0 font-bold underline"
                >
                  Repetir
                </button>
              </div>
            )}

            {!isPickup && (
              <input
                className="w-full rounded-lg border border-cielo px-3 py-3 focus:border-navy focus:outline-none"
                placeholder={requiresReceiver ? "¿Quién recibe? (obligatorio)" : "¿Quién recibe?"}
                aria-label="Nombre de quien recibe"
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
              />
            )}
            {/* Evidencia fotográfica del POD */}
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              aria-label="Foto de evidencia de entrega"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPickPhoto(f);
                e.target.value = "";
              }}
            />
            {photo ? (
              <div className="flex items-center gap-3">
                <img
                  src={photo.preview}
                  alt="Evidencia de entrega"
                  className="h-20 w-20 rounded-lg border border-cielo/60 object-cover"
                />
                <button
                  onClick={() => photoRef.current?.click()}
                  className="rounded-lg border border-navy px-3 py-2 text-sm font-medium text-navy dark:text-niebla"
                >
                  Cambiar foto
                </button>
              </div>
            ) : (
              <button
                onClick={() => photoRef.current?.click()}
                className="w-full rounded-lg border border-dashed border-navy/40 py-3 text-sm font-medium text-navy/70 dark:text-niebla/70"
              >
                📷 Tomar foto de evidencia
              </button>
            )}
            {photoWarning && (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning">
                <span>{photoWarning}</span>
                <button
                  onClick={() => photoRef.current?.click()}
                  className="shrink-0 font-bold underline"
                >
                  Repetir
                </button>
              </div>
            )}

            {/* Geocerca: dónde estás respecto al punto de entrega, antes de
                confirmar (el servidor re-valida y guarda geofenceOk). */}
            {pinDriftM !== null && (
              <div
                role="status"
                className={`rounded-lg px-3 py-2 text-xs font-medium ${
                  pinDriftM <= GEOFENCE_RADIUS_M
                    ? "bg-success-bg text-success"
                    : pinDriftM <= ADDRESS_FIX_THRESHOLD_M
                      ? "bg-warning-bg text-warning"
                      : "bg-danger-bg text-danger"
                }`}
              >
                {pinDriftM <= GEOFENCE_RADIUS_M
                  ? "✅ Estás en el punto de entrega"
                  : `📍 Estás a ~${pinDriftM} m del punto de entrega`}
              </div>
            )}

            {/* Pin-drop: el tap que alimenta el grafo de direcciones. */}
            {offerPinFix && (
              <label className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-info">
                <input
                  type="checkbox"
                  checked={fixPin}
                  onChange={(e) => setFixPin(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Estás a ~{pinDriftM} m del pin guardado. Guardar tu ubicación
                  actual como el punto correcto de esta dirección.
                </span>
              </label>
            )}

            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <button
              onClick={deliver}
              disabled={busy}
              className="w-full rounded-xl bg-lima py-4 text-lg font-bold text-navy active:brightness-95 disabled:opacity-60"
            >
              {busy
                ? "Enviando…"
                : isPickup
                  ? "Confirmar recogida"
                  : "Confirmar entrega"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {FAIL_REASONS.map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFailReason(value)}
                  className={`rounded-lg border py-2.5 text-sm font-medium ${failReason === value ? "border-danger/30 bg-danger-bg text-danger" : "border-border dark:border-white/10"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Evidencia obligatoria en motivos disputables (defensa B2B). */}
            {photo ? (
              <div className="flex items-center gap-3">
                <img
                  src={photo.preview}
                  alt="Evidencia del fallo"
                  className="h-20 w-20 rounded-lg border border-cielo/60 object-cover"
                />
                <button
                  onClick={() => photoRef.current?.click()}
                  className="rounded-lg border border-navy px-3 py-2 text-sm font-medium text-navy dark:text-niebla"
                >
                  Cambiar foto
                </button>
              </div>
            ) : (
              <button
                onClick={() => photoRef.current?.click()}
                className={`w-full rounded-lg border border-dashed py-3 text-sm font-medium ${
                  EVIDENCE_REQUIRED_REASONS.includes(failReason)
                    ? "border-danger/30 text-danger"
                    : "border-navy/40 text-navy/70 dark:text-niebla/70"
                }`}
              >
                📷 Foto de evidencia
                {EVIDENCE_REQUIRED_REASONS.includes(failReason) && " (obligatoria)"}
              </button>
            )}
            {photoWarning && (
              <div className="rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning">
                {photoWarning}
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <button
              onClick={fail}
              disabled={busy}
              className="w-full rounded-xl bg-danger py-4 text-lg font-bold text-white active:bg-danger disabled:opacity-60"
            >
              {busy ? "Registrando…" : "Registrar fallo"}
            </button>
          </div>
        )}
      </div>

      {scanOpen && (
        <ScanSheet
          stopId={stop.id}
          expected={stop.order.trackingNumber}
          onResult={(result) => {
            setScan(result);
            setScanOpen(false);
          }}
          onClose={() => setScanOpen(false)}
        />
      )}
    </div>
  );
}
