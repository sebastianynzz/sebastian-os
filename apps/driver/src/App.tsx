import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Bell,
  Camera,
  Check,
  ChevronLeft,
  Info,
  Loader,
  LogOut,
  MapPin,
  Moon,
  Navigation,
  Package,
  Phone,
  Play,
  RefreshCw,
  ScanBarcode,
  Siren,
  Sun,
  X,
  Zap,
} from "lucide-react";
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
import { ChargerSheet, EnergyTiles, RangeBanner, remainingRouteKm } from "./EnergyPanel";
import { navLinks } from "./nav";
import RouteMap, { type MapStop } from "./RouteMap";
import ScanSheet, { type ScanResult } from "./Scan";
import { canOfferPush, enablePushAlerts, precacheRouteTiles } from "./sw";
import {
  DELIVERY_TYPES,
  DELIVERY_TYPE_LABELS,
  PICKUP_TYPES,
  PICKUP_TYPE_LABELS,
  type NavApp,
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
    // Campos personalizados visibles para el conductor (Tier 2 §9), ya
    // etiquetados por el API (el JSON crudo nunca llega a la app).
    customProperties?: { id: string; name: string; value: string }[];
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

/** Etiqueta del estado de la ruta para el chip de la tarjeta "Ruta de hoy". */
const ROUTE_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planificada",
  DISPATCHED: "Planificada",
  IN_PROGRESS: "En curso",
  COMPLETED: "Completada",
};

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
      <div className="h-40 animate-pulse rounded-xl bg-white/70 shadow-soft dark:bg-navy-700/60" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-xl bg-white/70 shadow-soft dark:bg-navy-700/60" />
      ))}
    </div>
  );
}

/**
 * Botón SOS fijo (52×44): siempre a mano, en la cabecera y en la hoja de
 * entrega. Solo ARMA la confirmación — la ventana de 10 s sigue intacta.
 */
function SosButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Abrir confirmación de alerta de pánico"
      className="flex h-11 min-w-[52px] shrink-0 items-center justify-center rounded-xl border-[1.5px] border-danger bg-danger-bg text-[13px] font-bold tracking-[.04em] text-danger dark:border-[#c65454] dark:bg-danger/18 dark:text-[#ff9d9d]"
    >
      SOS
    </button>
  );
}

const PULL_REFRESH_THRESHOLD = 70;

/**
 * Tema conmutable del conductor. Default OSCURO (spec "dark-first"), pero el
 * repartidor puede cambiar a claro para luz solar directa. La preferencia se
 * persiste y se aplica como clase `.dark` en <html> (variante Tailwind).
 */
const THEME_KEY = "moveos-driver-theme";
/** Cache de la app de navegación preferida (Tier 2 §10) para uso offline. */
const NAV_APP_KEY = "moveos_driver_navapp";
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
  // App de navegación preferida (Tier 2 §10): la fija el operador en
  // "Permisos de conductor". Cacheada para que la app respete la preferencia
  // también sin señal (offline-first).
  const [navApp, setNavApp] = useState<NavApp>(
    () => (localStorage.getItem(NAV_APP_KEY) as NavApp) ?? "INTERNAL_GMAPS",
  );
  const [loaded, setLoaded] = useState(false);
  const [activeStop, setActiveStop] = useState<Stop | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(queueSize());
  const [pushOffer, setPushOffer] = useState(canOfferPush());
  const [showChargers, setShowChargers] = useState(false);
  // Manifiesto de carga (Tier 2 §11): verificar bultos antes de salir.
  const [loadSheet, setLoadSheet] = useState(false);
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

  // Km que faltan (D7): posición → paradas pendientes → depósito. Alimenta el
  // banner de autonomía, las fichas de energía y el caption de la ruta.
  const kmLeft = route
    ? remainingRouteKm(
        geo.current,
        mapStops.filter((s) => !s.done),
        { lat: route.depotLat, lng: route.depotLng },
      )
    : 0;

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
          setMessage("Despacho agregó una parada a tu ruta — revisa la secuencia");
        } else if (signature !== "") {
          setMessage("Tu ruta fue re-secuenciada por despacho");
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

  // Permisos de conductor (Tier 2 §10): leer la app de navegación preferida que
  // fijó el operador. Sin señal se conserva el último valor cacheado.
  useEffect(() => {
    if (!authed) return;
    void api<{ navApp: NavApp }>("GET", "/controls/driver-permissions")
      .then((p) => {
        setNavApp(p.navApp);
        localStorage.setItem(NAV_APP_KEY, p.navApp);
      })
      .catch(() => {
        /* offline: se mantiene la preferencia cacheada */
      });
  }, [authed]);

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
        ? "Sin señal: la alerta se enviará apenas vuelva la conexión"
        : "Alerta de pánico enviada a la central",
    );
  }

  // Pull-to-refresh: tirar hacia abajo desde el tope recarga la ruta. Se
  // inhabilita con una hoja abierta para no robarle el gesto.
  const overlayOpen =
    Boolean(activeStop) || sos !== "idle" || showChargers || loadSheet;
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
      {/* Cabecera fija: marca + placa/vehículo, SOS siempre a mano (52×44),
          toggle claro (sol directo) y salida. */}
      <header className="sticky top-0 z-10 border-b border-border/70 bg-niebla/95 backdrop-blur dark:border-sky/12 dark:bg-navy-900/95">
        <div className="flex items-center gap-2.5 px-4 py-2.5">
          <img src="/move-navy.svg" alt="move" className="h-[18px] w-auto dark:hidden" />
          <img src="/move-lime.svg" alt="move" className="hidden h-[18px] w-auto dark:block" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-navy dark:text-niebla">
              Conductor
            </div>
            <div className="flex items-center gap-1 text-[11px] text-text-tertiary dark:text-sky/70">
              {route && (
                <>
                  <span className="font-mono">{route.vehicle.plate}</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{route.vehicle.type}</span>
                  {route.vehicle.isElectric && (
                    <Zap
                      size={11}
                      fill="currentColor"
                      strokeWidth={0}
                      aria-label="Vehículo eléctrico"
                      className="shrink-0 text-success dark:text-lima"
                    />
                  )}
                  <span aria-hidden>·</span>
                </>
              )}
              <span
                role="status"
                aria-label={online ? "En línea" : "Sin conexión"}
                className="inline-flex shrink-0 items-center gap-1"
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${
                    online ? "animate-livepulse bg-success dark:bg-lima" : "bg-text-tertiary"
                  }`}
                />
                {online ? "En línea" : "Sin conexión"}
              </span>
            </div>
          </div>
          {pending > 0 && (
            <span className="shrink-0 rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-bold text-warning dark:bg-warning/25 dark:text-[#e8b96a]">
              {pending} sin sync
            </span>
          )}
          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
            title="Cambiar tema"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-secondary dark:text-sky"
          >
            {theme === "dark" ? (
              <Sun size={17} strokeWidth={1.75} aria-hidden />
            ) : (
              <Moon size={17} strokeWidth={1.75} aria-hidden />
            )}
          </button>
          <button
            onClick={() => {
              setToken(null);
              setAuthed(false);
            }}
            aria-label="Cerrar sesión"
            title="Salir"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-secondary dark:text-sky"
          >
            <LogOut size={16} strokeWidth={1.75} aria-hidden />
          </button>
          <SosButton onClick={() => setSos("confirm")} />
        </div>
      </header>

      {message && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 bg-success-bg px-4 py-1.5 text-sm text-success dark:bg-lima/15 dark:text-lima"
        >
          <span>{message}</span>
          <button
            onClick={() => setMessage(null)}
            aria-label="Cerrar aviso"
            className="-my-1 flex h-11 w-11 shrink-0 items-center justify-center opacity-70"
          >
            <X size={15} strokeWidth={2} aria-hidden />
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

        {loaded && !route && (
          <div className="rounded-xl border border-border bg-white p-6 text-center text-sm text-text-tertiary shadow-soft dark:border-sky/18 dark:bg-navy-700 dark:text-sky/70">
            No tiene ruta asignada hoy.
            <button
              onClick={load}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-niebla text-sm font-semibold text-navy dark:bg-navy-900 dark:text-niebla"
            >
              <RefreshCw size={14} strokeWidth={2} aria-hidden />
              Actualizar
            </button>
          </div>
        )}

        {/* D7: SoC en vivo + "¿alcanza para terminar?" (núcleo EV-only). */}
        {route && (
          <RangeBanner
            vehicle={route.vehicle}
            remainingKm={kmLeft}
            onFindCharger={() => setShowChargers(true)}
          />
        )}

        {/* Energía restante + paradas/km que faltan (EV-only: kWh, nunca combustible). */}
        {route && (
          <EnergyTiles
            vehicle={route.vehicle}
            remainingKm={kmLeft}
            pendingStops={
              route.stops.filter(
                (s) => s.status !== "COMPLETED" && s.status !== "FAILED",
              ).length
            }
          />
        )}

        {/* Mapa offline de la ruta (D2): tiles pre-cacheados, nunca en blanco. */}
        {route && mapStops.length > 0 && (
          <RouteMap stops={mapStops} geo={geo} dark={theme === "dark"} />
        )}

        {/* Ruta de hoy como línea de tiempo: siguiente en limón, hechas
            atenuadas con check, pendientes neutras. Tocar una parada abre la
            gestión (con la ruta en curso). */}
        {route && route.stops.length > 0 && (
          <section className="rounded-[14px] border border-border bg-white p-3.5 shadow-soft dark:border-sky/18 dark:bg-navy-700">
            <div className="mb-2.5 flex items-start justify-between gap-2">
              <div>
                <div className="text-[15px] font-semibold text-navy dark:text-niebla">
                  Ruta de hoy
                </div>
                <div className="text-[11.5px] text-text-tertiary dark:text-sky/70">
                  {route.stops.length} paradas · ~{Math.max(1, Math.round(kmLeft))} km ·
                  regreso al depósito
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-navy/10 px-2.5 py-0.5 text-[11px] font-semibold text-text-secondary dark:bg-sky/15 dark:text-sky">
                {ROUTE_STATUS_LABELS[route.status] ?? route.status}
              </span>
            </div>
            <div className="flex flex-col">
              {route.stops.map((stop, i) => (
                <StopRow
                  key={stop.id}
                  stop={stop}
                  last={i === route.stops.length - 1}
                  isCurrent={stop.id === currentStopId}
                  routeActive={route.status === "IN_PROGRESS"}
                  canOpen={
                    route.status === "IN_PROGRESS" || route.status === "DISPATCHED"
                  }
                  onOpen={() => setActiveStop(stop)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Avisos push (D5): requiere un toque del conductor (gesto). */}
        {pushOffer && (
          <button
            onClick={async () => {
              const ok = await enablePushAlerts();
              setPushOffer(false);
              setMessage(
                ok
                  ? "Avisos activados: te llegará una notificación con cada ruta"
                  : "No se pudieron activar los avisos en este dispositivo",
              );
            }}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-border bg-white px-3 py-2.5 text-left shadow-soft dark:border-sky/18 dark:bg-navy-700"
          >
            <Bell
              size={15}
              strokeWidth={2}
              aria-hidden
              className="shrink-0 text-text-tertiary dark:text-sky"
            />
            <span className="flex-1 text-[11.5px] leading-snug text-text-secondary dark:text-sky">
              Activa los avisos para enterarte de rutas asignadas y paradas
              insertadas.
            </span>
            <span className="shrink-0 text-xs font-semibold text-success dark:text-lima">
              Activar
            </span>
          </button>
        )}

        {/* Pila de CTAs: un único CTA limón (iniciar ruta) + manifiesto en
            fantasma (Tier 2 §11: verificar la carga antes de salir). */}
        {route && ["DISPATCHED", "IN_PROGRESS"].includes(route.status) && (
          <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-col gap-2 border-t border-border/60 bg-niebla/95 p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] backdrop-blur dark:border-sky/12 dark:bg-navy-900/95">
            {route.status === "DISPATCHED" && (
              <button
                onClick={startRoute}
                disabled={starting}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-lima text-[15px] font-bold text-navy-900 shadow-glow transition duration-200 ease-brand active:brightness-95 disabled:opacity-60 disabled:shadow-none"
              >
                <Play size={16} fill="currentColor" strokeWidth={0} aria-hidden />
                {starting
                  ? "Iniciando…"
                  : `Iniciar ruta (${route.stops.length} paradas)`}
              </button>
            )}
            <button
              onClick={() => setLoadSheet(true)}
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-navy/25 bg-transparent text-[13px] font-semibold text-navy transition duration-200 ease-brand dark:border-sky/35 dark:text-sky"
            >
              <ScanBarcode size={14} strokeWidth={2} aria-hidden />
              Escanear manifiesto
            </button>
          </div>
        )}
      </main>

      {activeStop && route && (
        <StopActionSheet
          stop={activeStop}
          totalStops={route.stops.length}
          actionsEnabled={route.status === "IN_PROGRESS"}
          plate={route.vehicle.plate}
          navApp={navApp}
          online={online}
          geo={geo}
          onArrive={async () => {
            await apiOrQueue(`/routes/stops/${activeStop.id}/arrive`);
            setPending(queueSize());
            await load();
          }}
          onSos={() => setSos("confirm")}
          onClose={() => setActiveStop(null)}
          onDone={async (queued) => {
            setActiveStop(null);
            setPending(queueSize());
            if (queued) setMessage("Sin señal: la entrega se guardará y enviará sola");
            await load();
          }}
        />
      )}

      {/* D8: cargador más cercano con deeplink (directorio de carga). */}
      {showChargers && (
        <ChargerSheet
          geo={geo.current}
          vehicle={route?.vehicle ?? null}
          onClose={() => setShowChargers(false)}
        />
      )}

      {/* Tier 2 §11: manifiesto de carga — escanear cada bulto antes de salir. */}
      {loadSheet && route && (
        <LoadManifestSheet routeId={route.id} onClose={() => setLoadSheet(false)} />
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
            className="w-full rounded-t-2xl border-t border-border bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] dark:border-sky/25 dark:bg-navy-700"
            onClick={(e) => e.stopPropagation()}
          >
            {sos === "confirm" ? (
              <>
                <div className="flex items-center gap-2 text-lg font-bold text-danger dark:text-[#ff9d9d]">
                  <Siren size={20} strokeWidth={2} aria-hidden />
                  ¿Enviar alerta de pánico?
                </div>
                <p className="mt-1 text-sm text-text-secondary dark:text-sky">
                  Se notificará a la central con tu ubicación. Úsalo solo ante
                  una emergencia real.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setSos("idle")}
                    className="flex-1 rounded-xl bg-niebla py-4 text-base font-bold text-navy dark:bg-navy-900 dark:text-niebla"
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
                <div className="flex items-center gap-2 text-lg font-bold text-danger dark:text-[#ff9d9d]">
                  <Siren size={20} strokeWidth={2} aria-hidden />
                  Alerta enviada
                </div>
                <p className="mt-1 text-sm text-text-secondary dark:text-sky">
                  La central fue notificada. Si sigues en peligro, puedes
                  reenviarla.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setSos("idle")}
                    className="flex-1 rounded-xl bg-niebla py-4 text-base font-bold text-navy dark:bg-navy-900 dark:text-niebla"
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
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-white p-6 shadow-soft dark:border-sky/18 dark:bg-navy-700"
      >
        <h1 className="flex items-center gap-2 text-xl font-bold text-navy dark:text-niebla">
          <img src="/move-navy.svg" alt="move" className="h-6 w-auto dark:hidden" />
          <img src="/move-lime.svg" alt="move" className="hidden h-6 w-auto dark:block" />
          conductor
        </h1>
        {notice && (
          <p
            role="status"
            className="rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning dark:bg-warning/25 dark:text-[#e8b96a]"
          >
            {notice}
          </p>
        )}
        <input
          className="w-full rounded-lg border border-cielo bg-white px-3 py-3 text-base text-navy focus:border-navy focus:outline-none dark:border-sky/25 dark:bg-navy-900 dark:text-niebla dark:placeholder:text-sky/50 dark:focus:border-lima"
          type="email"
          placeholder="Correo"
          aria-label="Correo electrónico"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-cielo bg-white px-3 py-3 text-base text-navy focus:border-navy focus:outline-none dark:border-sky/25 dark:bg-navy-900 dark:text-niebla dark:placeholder:text-sky/50 dark:focus:border-lima"
          type="password"
          placeholder="Contraseña"
          aria-label="Contraseña"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-danger dark:text-[#ff9d9d]">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          className="min-h-[48px] w-full rounded-lg bg-navy font-bold text-white disabled:opacity-60 dark:bg-lima dark:text-navy-900 dark:shadow-glow"
        >
          {busy ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}

/**
 * Manifiesto de carga (Tier 2 §11): en el depósito, el conductor escanea cada
 * bulto antes de salir. Muestra el progreso (cargados/total) y, por bulto, si ya
 * fue verificado. El escaneo se encola offline (sirve sin señal); el manifiesto
 * se refresca al volver la señal.
 */
function LoadManifestSheet({
  routeId,
  onClose,
}: {
  routeId: string;
  onClose: () => void;
}) {
  const [manifest, setManifest] = useState<{
    total: number;
    loaded: number;
    orders: {
      orderId: string;
      trackingNumber: string | null;
      customerName: string;
      loaded: boolean;
    }[];
  } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setManifest(
        await api<{
          total: number;
          loaded: number;
          orders: {
            orderId: string;
            trackingNumber: string | null;
            customerName: string;
            loaded: boolean;
          }[];
        }>("GET", `/routes/${routeId}/manifest`),
      );
    } catch {
      /* offline: el escaneo se encola; el manifiesto se refresca con señal */
    }
  }, [routeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const trackingNumbers = (manifest?.orders ?? [])
    .map((o) => o.trackingNumber)
    .filter((t): t is string => Boolean(t));

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manifiesto de carga"
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] dark:border-sky/25 dark:bg-navy-700"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          aria-hidden
          className="mx-auto mb-3 block h-1 w-[38px] rounded-full bg-border-strong dark:bg-sky/35"
        />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold text-navy dark:text-niebla">
            <Package
              size={16}
              strokeWidth={1.75}
              aria-hidden
              className="text-text-secondary dark:text-lima"
            />
            Cargar vehículo
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-11 w-11 items-center justify-center rounded-lg bg-niebla text-navy dark:bg-sky/12 dark:text-sky"
          >
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>
        {message && (
          <p className="mb-2 rounded-lg bg-lima/30 px-3 py-2 text-xs font-medium text-lime-ink dark:bg-lima/15 dark:text-lima">
            {message}
          </p>
        )}
        {manifest === null ? (
          <p className="text-sm text-text-tertiary dark:text-sky/70">
            Cargando manifiesto…
          </p>
        ) : (
          <>
            <p className="mb-1.5 text-sm font-semibold text-navy dark:text-niebla">
              {manifest.loaded} de {manifest.total} bultos cargados
            </p>
            <div
              aria-hidden
              className="mb-3 h-1.5 overflow-hidden rounded-full bg-navy/10 dark:bg-sky/15"
            >
              <span
                className="block h-full rounded-full bg-lima"
                style={{
                  width: `${manifest.total > 0 ? Math.round((manifest.loaded / manifest.total) * 100) : 0}%`,
                }}
              />
            </div>
            <ul className="space-y-2">
              {manifest.orders.map((o) => (
                <li
                  key={o.orderId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 dark:border-sky/18"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-bold text-navy dark:text-niebla">
                      {o.trackingNumber ?? "—"}
                    </div>
                    <div className="truncate text-sm text-text-secondary dark:text-sky">
                      {o.customerName}
                    </div>
                  </div>
                  <span
                    className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                      o.loaded
                        ? "bg-success-bg text-success dark:bg-lima/18 dark:text-lima"
                        : "bg-niebla text-navy/50 dark:bg-navy-900 dark:text-sky/60"
                    }`}
                  >
                    {o.loaded && <Check size={11} strokeWidth={2.5} aria-hidden />}
                    {o.loaded ? "Cargado" : "Pendiente"}
                  </span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setScanOpen(true)}
              className="mt-4 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-navy text-sm font-bold text-white dark:border dark:border-sky/25 dark:bg-sky/12 dark:text-niebla"
            >
              <ScanBarcode size={15} strokeWidth={2} aria-hidden />
              Escanear paquete
            </button>
          </>
        )}
      </div>
      {scanOpen && (
        <ScanSheet
          endpoint={`/routes/${routeId}/load-scan`}
          expectedAny={trackingNumbers}
          onResult={(result) => {
            setScanOpen(false);
            setMessage(
              result.match
                ? `Bulto ${result.code} cargado`
                : `${result.code} no pertenece a esta ruta`,
            );
            void refresh();
          }}
          onClose={() => setScanOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Fila de la línea de tiempo "Ruta de hoy": círculo numerado + conector.
 * Siguiente parada = círculo limón con número navy; completada = atenuada con
 * check; fallida = X; pendiente = círculo neutro. Con la ruta en curso, tocar
 * la fila abre la gestión de la parada (hoja 7b).
 */
function StopRow({
  stop,
  last,
  isCurrent,
  routeActive,
  canOpen,
  onOpen,
}: {
  stop: Stop;
  last: boolean;
  isCurrent: boolean;
  routeActive: boolean;
  /** Ruta despachada o en curso: la hoja se puede abrir (aunque las
      acciones de entrega solo se habilitan con la ruta iniciada). */
  canOpen: boolean;
  onOpen: () => void;
}) {
  const done = stop.status === "COMPLETED" || stop.status === "FAILED";
  const failed = stop.status === "FAILED";
  const arrived = stop.status === "ARRIVED";
  const isPickup = stop.kind === "PICKUP";
  // En recogida se muestra la dirección de origen; en entrega, la del destino.
  const address = isPickup
    ? stop.order.pickupAddressRaw ?? stop.order.addressRaw
    : stop.order.addressRaw;
  const tappable = canOpen && !done;

  const circle = done ? (
    <span
      aria-hidden
      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border ${
        failed
          ? "border-danger/40 text-danger dark:border-[#c65454]/60 dark:text-[#ff9d9d]"
          : "border-navy/20 text-text-tertiary dark:border-sky/30 dark:text-sky/70"
      }`}
    >
      {failed ? (
        <X size={12} strokeWidth={2.5} />
      ) : (
        <Check size={12} strokeWidth={2.5} />
      )}
    </span>
  ) : (
    <span
      aria-hidden
      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
        isCurrent
          ? "bg-lima text-navy-900"
          : "bg-navy/10 text-navy dark:bg-sky/20 dark:text-sky"
      }`}
    >
      {stop.sequence}
    </span>
  );

  const content = (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center">
        {circle}
        {!last && (
          <span
            aria-hidden
            className="my-0.5 w-0.5 flex-1 rounded bg-navy/10 dark:bg-sky/20"
          />
        )}
      </div>
      <div
        className={`flex min-w-0 flex-1 items-start justify-between gap-2 ${
          last ? "" : "pb-3"
        }`}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span
              className={`truncate text-[13px] font-semibold ${
                done
                  ? "text-text-tertiary dark:text-sky/60"
                  : "text-navy dark:text-niebla"
              }`}
            >
              {stop.order.customerName}
            </span>
            {isPickup && !done && (
              <span className="shrink-0 rounded-md bg-sky-50 px-1.5 py-px text-[10px] font-bold text-info dark:bg-sky/15 dark:text-sky">
                REC
              </span>
            )}
            {isCurrent && !done && routeActive && (
              <span className="shrink-0 rounded-full bg-navy px-1.5 py-px text-[10px] font-bold text-white dark:bg-lima/20 dark:text-lima">
                {arrived ? "En sitio" : "Siguiente"}
              </span>
            )}
          </span>
          <span
            className={`block truncate text-[11px] ${
              done
                ? "text-text-tertiary/70 dark:text-sky/40"
                : "text-text-tertiary dark:text-sky/70"
            }`}
          >
            {address}
          </span>
          {failed && (
            <span className="block text-[11px] font-medium text-danger dark:text-[#ff9d9d]">
              No completada
            </span>
          )}
        </span>
        <span className="mt-0.5 shrink-0 font-mono text-[11px] text-text-secondary dark:text-sky">
          {formatEta(stop.etaMin)}
        </span>
      </div>
    </div>
  );

  if (!tappable) return <div>{content}</div>;
  return (
    <button
      onClick={onOpen}
      aria-label={`Gestionar parada ${stop.sequence}: ${stop.order.customerName}`}
      className="-mx-1.5 block min-h-11 w-full rounded-lg px-1.5 text-left transition duration-200 ease-brand active:bg-navy/5 dark:active:bg-sky/10"
    >
      {content}
    </button>
  );
}

function StopActionSheet({
  stop,
  totalStops,
  actionsEnabled,
  plate,
  navApp,
  online,
  geo,
  onArrive,
  onSos,
  onClose,
  onDone,
}: {
  stop: Stop;
  totalStops: number;
  /** Solo con la ruta iniciada se permiten llegada/confirmación/fallo. */
  actionsEnabled: boolean;
  plate: string;
  navApp: NavApp;
  online: boolean;
  geo: React.MutableRefObject<{ lat: number; lng: number } | null>;
  onArrive: () => Promise<void>;
  onSos: () => void;
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
  // "Llegué": registro de llegada sin salir de la hoja (se encola offline).
  const [arriveBusy, setArriveBusy] = useState(false);
  const [arrivedLocal, setArrivedLocal] = useState(false);
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
  const sheetNotes = isPickup ? stop.order.pickupNotes : stop.order.addressNotes;

  // Deeplinks de navegación (integrar, no construir): Waze / Maps + llamada.
  const nav = refLat !== null && refLng !== null ? navLinks(refLat, refLng) : null;

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
      if (!quality.ok && quality.warning) setPhotoWarning(quality.warning);
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

  const navButtonClass =
    "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong bg-sky-50 text-[12.5px] font-semibold text-navy dark:border-sky/25 dark:bg-sky/12 dark:text-[#dfe5ec]";

  const evidenceTileClass =
    "flex min-h-[88px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-navy/30 text-xs font-semibold text-text-secondary transition duration-200 ease-brand dark:border-sky/35 dark:text-sky";

  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Gestionar entrega de la parada ${stop.sequence}`}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-niebla p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-sky/25 dark:bg-navy-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Barra superior: volver + "Parada N de M" + SOS (mismo botón fijo). */}
        <div className="mb-3 flex items-center gap-2.5">
          <button
            onClick={onClose}
            aria-label="Volver a la ruta"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-navy dark:border-sky/25 dark:bg-navy-700 dark:text-sky"
          >
            <ChevronLeft size={16} strokeWidth={2} aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-navy dark:text-niebla">
              Parada {stop.sequence} de {totalStops}
            </div>
            <div className="truncate text-[11px] text-text-tertiary dark:text-sky/70">
              Ruta <span className="font-mono">{plate}</span> · en curso
            </div>
          </div>
          <SosButton onClick={onSos} />
        </div>

        {/* Contexto de la parada PRIMERO: evita confirmar la entrega equivocada. */}
        <div className="rounded-[14px] border border-border bg-white p-3.5 shadow-soft dark:border-sky/18 dark:bg-navy-700">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-navy dark:text-niebla">
                {stop.order.customerName}
              </div>
              <div className="mt-0.5 text-xs text-text-secondary dark:text-sky">
                {sheetAddress}
              </div>
              {stop.order.trackingNumber && (
                <div className="mt-1 font-mono text-[10.5px] text-text-tertiary dark:text-sky/70">
                  {stop.order.trackingNumber}
                </div>
              )}
            </div>
            <span className="shrink-0 rounded-md bg-lima/25 px-2 py-0.5 text-[10.5px] font-bold text-lime-ink dark:bg-lima/20 dark:text-lima">
              {isPickup ? "REC" : "ENT"}
            </span>
          </div>
          {sheetNotes && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-warning-bg px-2.5 py-1.5 text-xs text-warning dark:bg-warning/20 dark:text-[#e8b96a]">
              <MapPin size={12} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
              <span>{sheetNotes}</span>
            </div>
          )}
          {/* Campos personalizados visibles para el conductor (Tier 2 §9). */}
          {stop.order.customProperties && stop.order.customProperties.length > 0 && (
            <dl className="mt-2 space-y-0.5 text-xs">
              {stop.order.customProperties.map((cp) => (
                <div key={cp.id} className="flex gap-1">
                  <dt className="text-navy/50 dark:text-sky/60">{cp.name}:</dt>
                  <dd className="font-semibold text-navy dark:text-niebla">{cp.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {/* Navegación por deeplink (Waze/Maps según preferencia del operador,
              Tier 2 §10) + llamada. Integrar, no construir. */}
          <div className="mt-3 flex gap-2">
            {nav &&
              (navApp === "WAZE"
                ? (["waze", "gmaps"] as const)
                : (["gmaps", "waze"] as const)
              ).map((target) =>
                target === "waze" ? (
                  <a
                    key="waze"
                    href={nav.waze}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={navButtonClass}
                  >
                    <Navigation size={13} strokeWidth={2} aria-hidden />
                    Waze
                  </a>
                ) : (
                  <a
                    key="gmaps"
                    href={nav.gmaps}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={navButtonClass}
                  >
                    <MapPin size={13} strokeWidth={2} aria-hidden />
                    Maps
                  </a>
                ),
              )}
            <a href={`tel:${stop.order.customerPhone}`} className={navButtonClass}>
              <Phone size={13} strokeWidth={2} aria-hidden />
              Llamar
            </a>
          </div>
        </div>

        {/* "Llegué": registrar la llegada sin cerrar la hoja (se encola offline). */}
        {actionsEnabled && stop.status === "PENDING" && !arrivedLocal && (
          <button
            onClick={async () => {
              setArriveBusy(true);
              try {
                await onArrive();
                setArrivedLocal(true);
              } finally {
                setArriveBusy(false);
              }
            }}
            disabled={arriveBusy}
            className="mt-2.5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-navy/25 bg-transparent text-[13px] font-semibold text-navy disabled:opacity-60 dark:border-sky/35 dark:text-sky"
          >
            <MapPin size={14} strokeWidth={2} aria-hidden />
            {arriveBusy ? "Registrando llegada…" : "Llegué al punto"}
          </button>
        )}

        {/* Geocerca: dónde estás respecto al punto de entrega, antes de
            confirmar (el servidor re-valida y guarda geofenceOk). */}
        {pinDriftM !== null &&
          (pinDriftM <= GEOFENCE_RADIUS_M ? (
            <div
              role="status"
              className="mt-2.5 flex items-center gap-2 rounded-xl border border-success/25 bg-success-bg px-3 py-2.5 dark:border-lima/40 dark:bg-lima/14"
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 animate-livepulse rounded-full bg-success dark:bg-lima"
              />
              <span className="text-[12.5px] font-semibold text-success dark:text-lima">
                Estás en el punto de entrega
              </span>
              <span className="ml-auto shrink-0 text-[11px] text-text-secondary dark:text-sky">
                a ~{pinDriftM} m
              </span>
            </div>
          ) : (
            <div
              role="status"
              className={`mt-2.5 flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[12.5px] font-medium ${
                pinDriftM <= ADDRESS_FIX_THRESHOLD_M
                  ? "border-warning/25 bg-warning-bg text-warning dark:border-[#e8b96a]/30 dark:bg-warning/20 dark:text-[#e8b96a]"
                  : "border-danger/25 bg-danger-bg text-danger dark:border-[#c65454]/50 dark:bg-danger/16 dark:text-[#ff9d9d]"
              }`}
            >
              <MapPin size={14} strokeWidth={2} aria-hidden className="shrink-0" />
              Estás a ~{pinDriftM} m del punto de entrega
            </div>
          ))}

        {!actionsEnabled ? (
          <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2.5 dark:border-sky/18 dark:bg-navy-700">
            <Info
              size={14}
              strokeWidth={2}
              aria-hidden
              className="shrink-0 text-text-tertiary dark:text-sky/70"
            />
            <span className="text-[11.5px] text-text-secondary dark:text-sky">
              Inicia la ruta para registrar llegada y confirmar la{" "}
              {isPickup ? "recogida" : "entrega"}.
            </span>
          </div>
        ) : mode === "deliver" ? (
          <div className="mt-2.5 space-y-2.5">
            {/* Evidencia: foto/escaneo como fichas, requisito visible desde el
                inicio (no como error al final). */}
            <div className="rounded-[14px] border border-border bg-white p-3.5 shadow-soft dark:border-sky/18 dark:bg-navy-700">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-navy dark:text-niebla">
                  Evidencia de {isPickup ? "recogida" : "entrega"}
                </span>
                {requiresPhoto && (
                  <span className="shrink-0 rounded-full bg-warning-bg px-2.5 py-0.5 text-[10.5px] font-bold text-warning dark:bg-warning/25 dark:text-[#e8b96a]">
                    Foto obligatoria
                  </span>
                )}
              </div>

              {/* Tipo de parada (política POD por tipo): define qué evidencia se exige. */}
              <label className="mb-2 block text-sm">
                <span className="mb-1 block text-xs font-medium text-text-secondary dark:text-sky/70">
                  {isPickup ? "Tipo de recogida" : "Tipo de entrega"}
                </span>
                <select
                  value={stopType}
                  onChange={(e) => setStopType(e.target.value)}
                  className="min-h-11 w-full rounded-lg border border-cielo bg-white px-3 text-navy focus:border-navy focus:outline-none dark:border-sky/25 dark:bg-navy-900 dark:text-niebla dark:focus:border-lima"
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
                <div className="mb-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-info dark:bg-sky/12 dark:text-sky">
                  Este cliente exige:{" "}
                  {[
                    requiresPhoto ? "foto de evidencia" : null,
                    requiresReceiver ? "nombre de quien recibe" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {/* Ficha de foto (POD). */}
                {photo ? (
                  <button
                    onClick={() => photoRef.current?.click()}
                    aria-label="Cambiar foto de evidencia"
                    className="relative flex min-h-[88px] items-center justify-center overflow-hidden rounded-xl border border-border dark:border-sky/25"
                  >
                    <img
                      src={photo.preview}
                      alt="Evidencia de entrega"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                    <span className="relative rounded-md bg-black/55 px-2 py-1 text-[11px] font-semibold text-white">
                      Cambiar foto
                    </span>
                  </button>
                ) : (
                  <button onClick={() => photoRef.current?.click()} className={evidenceTileClass}>
                    <Camera size={20} strokeWidth={1.75} aria-hidden />
                    Tomar foto
                  </button>
                )}
                {/* Ficha de escaneo: evita entregar el bulto equivocado. */}
                {scan === null ? (
                  <button onClick={() => setScanOpen(true)} className={evidenceTileClass}>
                    <ScanBarcode size={20} strokeWidth={1.75} aria-hidden />
                    Escanear paquete
                  </button>
                ) : scan.match ? (
                  <div className="flex min-h-[88px] flex-col items-center justify-center gap-1 rounded-xl border border-success/25 bg-success-bg px-2 text-center dark:border-lima/40 dark:bg-lima/14">
                    <Check
                      size={18}
                      strokeWidth={2.5}
                      aria-hidden
                      className="text-success dark:text-lima"
                    />
                    <span className="text-xs font-semibold text-success dark:text-lima">
                      Paquete verificado
                    </span>
                    <span className="font-mono text-[10px] text-text-secondary dark:text-sky">
                      {scan.code}
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setScan(null);
                      setScanOpen(true);
                    }}
                    className="flex min-h-[88px] flex-col items-center justify-center gap-0.5 rounded-xl border border-danger/30 bg-danger-bg px-2 text-center dark:border-[#c65454]/50 dark:bg-danger/16"
                  >
                    <span className="text-xs font-bold text-danger dark:text-[#ff9d9d]">
                      Guía equivocada
                    </span>
                    <span className="font-mono text-[10px] text-danger/80 dark:text-[#e8a8a8]">
                      {scan.code} · esperada {stop.order.trackingNumber ?? "—"}
                    </span>
                    <span className="text-[11px] font-semibold text-danger underline dark:text-[#ff9d9d]">
                      Repetir
                    </span>
                  </button>
                )}
              </div>

              {photoWarning && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning dark:bg-warning/20 dark:text-[#e8b96a]">
                  <span>{photoWarning}</span>
                  <button
                    onClick={() => photoRef.current?.click()}
                    className="shrink-0 font-bold underline"
                  >
                    Repetir
                  </button>
                </div>
              )}

              {!isPickup && (
                <input
                  className="mt-2 min-h-11 w-full rounded-[10px] border border-cielo bg-white px-3 text-[13px] text-navy focus:border-navy focus:outline-none dark:border-sky/25 dark:bg-navy-900 dark:text-niebla dark:placeholder:text-sky/50 dark:focus:border-lima"
                  placeholder={
                    requiresReceiver ? "¿Quién recibe? — nombre (obligatorio)" : "¿Quién recibe? — nombre"
                  }
                  aria-label="Nombre de quien recibe"
                  value={receivedBy}
                  onChange={(e) => setReceivedBy(e.target.value)}
                />
              )}
            </div>

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

            {/* Pin-drop: el tap que alimenta el grafo de direcciones. */}
            {offerPinFix && (
              <label className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-info dark:bg-sky/12 dark:text-sky">
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

            {/* Cola offline como estado del sistema, no como error. */}
            {!online && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 dark:border-sky/18 dark:bg-navy-700">
                <Loader
                  size={14}
                  strokeWidth={2}
                  aria-hidden
                  className="shrink-0 text-warning dark:text-[#e8b96a]"
                />
                <span className="text-[11.5px] text-text-secondary dark:text-sky">
                  Sin señal: la confirmación se encola y se envía sola al volver
                  la conexión.
                </span>
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-danger dark:text-[#ff9d9d]">
                {error}
              </p>
            )}
            {/* CTA limón único; deshabilitado hasta tener la foto exigida. */}
            <button
              onClick={deliver}
              disabled={busy || (requiresPhoto && !photo)}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-lima text-[15px] font-bold text-navy-900 shadow-glow transition duration-200 ease-brand active:brightness-95 disabled:opacity-50 disabled:shadow-none"
            >
              <Check size={16} strokeWidth={2.5} aria-hidden />
              {busy
                ? "Enviando…"
                : isPickup
                  ? "Confirmar recogida"
                  : "Confirmar entrega"}
            </button>
            {/* "No se pudo" visible pero secundario (borde peligro). */}
            <button
              onClick={() => setMode("fail")}
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-danger/50 bg-transparent text-[13px] font-semibold text-danger dark:border-[#c65454]/50 dark:text-[#ff9d9d]"
            >
              {isPickup ? "No se pudo recoger" : "No se pudo entregar"}
            </button>
          </div>
        ) : (
          <div className="mt-2.5 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              {FAIL_REASONS.map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFailReason(value)}
                  aria-pressed={failReason === value}
                  className={`min-h-11 rounded-lg border px-2 py-2.5 text-sm font-medium ${
                    failReason === value
                      ? "border-danger/40 bg-danger-bg text-danger dark:border-[#c65454]/60 dark:bg-danger/18 dark:text-[#ff9d9d]"
                      : "border-border bg-white text-navy dark:border-sky/20 dark:bg-navy-700 dark:text-niebla"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Evidencia obligatoria en motivos disputables (defensa B2B). */}
            {photo ? (
              <button
                onClick={() => photoRef.current?.click()}
                aria-label="Cambiar foto de evidencia"
                className="relative flex min-h-[88px] w-full items-center justify-center overflow-hidden rounded-xl border border-border dark:border-sky/25"
              >
                <img
                  src={photo.preview}
                  alt="Evidencia del fallo"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <span className="relative rounded-md bg-black/55 px-2 py-1 text-[11px] font-semibold text-white">
                  Cambiar foto
                </span>
              </button>
            ) : (
              <button
                onClick={() => photoRef.current?.click()}
                className={`flex min-h-[88px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed text-xs font-semibold ${
                  EVIDENCE_REQUIRED_REASONS.includes(failReason)
                    ? "border-danger/40 text-danger dark:border-[#c65454]/60 dark:text-[#ff9d9d]"
                    : "border-navy/30 text-text-secondary dark:border-sky/35 dark:text-sky"
                }`}
              >
                <Camera size={20} strokeWidth={1.75} aria-hidden />
                Foto de evidencia
                {EVIDENCE_REQUIRED_REASONS.includes(failReason) && " (obligatoria)"}
              </button>
            )}
            {photoWarning && (
              <div className="rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning dark:bg-warning/20 dark:text-[#e8b96a]">
                {photoWarning}
              </div>
            )}

            {!online && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 dark:border-sky/18 dark:bg-navy-700">
                <Loader
                  size={14}
                  strokeWidth={2}
                  aria-hidden
                  className="shrink-0 text-warning dark:text-[#e8b96a]"
                />
                <span className="text-[11.5px] text-text-secondary dark:text-sky">
                  Sin señal: el registro se encola y se envía solo al volver la
                  conexión.
                </span>
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-danger dark:text-[#ff9d9d]">
                {error}
              </p>
            )}
            <button
              onClick={fail}
              disabled={busy}
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-danger text-[15px] font-bold text-white active:bg-danger disabled:opacity-60 dark:bg-[#c65454]"
            >
              {busy ? "Registrando…" : "Registrar fallo"}
            </button>
            <button
              onClick={() => setMode("deliver")}
              className="flex min-h-[46px] w-full items-center justify-center rounded-xl border border-navy/25 bg-transparent text-[13px] font-semibold text-navy dark:border-sky/35 dark:text-sky"
            >
              Volver a {isPickup ? "la recogida" : "la entrega"}
            </button>
          </div>
        )}
      </div>

      {scanOpen && (
        <ScanSheet
          endpoint={`/routes/stops/${stop.id}/scan`}
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
