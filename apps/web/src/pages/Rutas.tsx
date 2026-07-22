import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { Link } from "react-router-dom";
import {
  BatteryCharging,
  CalendarDays,
  Camera,
  FileText,
  Map as MapIcon,
  Plus,
  TriangleAlert,
  Warehouse,
  Zap,
} from "lucide-react";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import {
  Button,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  StatusBadge,
  formatEta,
  tableRowClass,
  theadRowClass,
} from "../components/ui";

interface Driver {
  id: string;
  name: string;
}
interface RouteData {
  id: string;
  date: string;
  status: string;
  totalDistanceKm: number;
  totalDurationMin: number;
  warnings: string[];
  vehicle: {
    plate: string;
    type: string;
    isElectric: boolean;
    /** Último SoC conocido (EV) — el API lo incluye en /routes. */
    socPercent?: number | null;
  };
  driver: { id: string; name: string } | null;
  depot: { id: string; name: string } | null;
  stops: {
    id: string;
    kind: "PICKUP" | "DELIVERY";
    sequence: number;
    etaMin: number;
    status: string;
    order: {
      customerName: string;
      addressRaw: string;
      pickupAddressRaw: string | null;
      lat: number | null;
      lng: number | null;
      pickupLat: number | null;
      pickupLng: number | null;
    };
    pod: {
      geofenceOk: boolean | null;
      receivedBy: string | null;
      photoUrl: string | null;
    } | null;
  }[];
}

type Stop = RouteData["stops"][number];

// Depósito de referencia (Chapinero) — mismo punto que el resto del panel.
const DEPOT: [number, number] = [4.6486, -74.0628];

/** Coordenada de la parada: recogida usa pickupLat/Lng; entrega, lat/lng. */
function stopCoords(s: Stop): [number, number] | null {
  const lat = s.kind === "PICKUP" ? (s.order.pickupLat ?? s.order.lat) : s.order.lat;
  const lng = s.kind === "PICKUP" ? (s.order.pickupLng ?? s.order.lng) : s.order.lng;
  return lat != null && lng != null ? [lat, lng] : null;
}

function seqIcon(n: number, kind: "PICKUP" | "DELIVERY") {
  const color = kind === "PICKUP" ? "#3a5169" : "#5a6b18";
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${color};color:#fff;font-size:11px;font-weight:700;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.3)">${n}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}
const depotIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;background:#233955;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

/** Encuadra el mapa sobre las paradas + el depósito (una sola vez). */
function FitStops({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds([...points, DEPOT]).pad(0.25));
    }
  }, [points, map]);
  return null;
}

/** Mapa de detalle de una ruta: paradas numeradas en secuencia + polilínea. */
function RouteMap({ stops }: { stops: Stop[] }) {
  const pts = stops
    .map((s) => ({ s, c: stopCoords(s) }))
    .filter((x): x is { s: Stop; c: [number, number] } => x.c !== null);
  if (pts.length === 0) {
    return (
      <p className="mt-3 text-sm text-text-tertiary">
        Sin coordenadas para mapear esta ruta todavía.
      </p>
    );
  }
  const line: [number, number][] = [DEPOT, ...pts.map((p) => p.c)];
  return (
    <div className="mt-3 h-72 overflow-hidden rounded-lg">
      <MapContainer center={DEPOT} zoom={12} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitStops points={pts.map((p) => p.c)} />
        <Marker position={DEPOT} icon={depotIcon}>
          <Popup>Depósito</Popup>
        </Marker>
        <Polyline
          positions={line}
          pathOptions={{ color: "#233955", weight: 3, opacity: 0.5, dashArray: "6 6" }}
        />
        {pts.map(({ s, c }) => (
          <Marker key={s.id} position={c} icon={seqIcon(s.sequence, s.kind)}>
            <Popup>
              <strong>
                #{s.sequence} · {s.kind === "PICKUP" ? "Recogida" : "Entrega"}
              </strong>
              <br />
              {s.order.customerName}
              <br />
              {s.kind === "PICKUP"
                ? (s.order.pickupAddressRaw ?? s.order.addressRaw)
                : s.order.addressRaw}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

interface PendingOrder {
  id: string;
  customerName: string;
  addressRaw: string;
}

interface Manifest {
  total: number;
  loaded: number;
  orders: {
    orderId: string;
    trackingNumber: string | null;
    customerName: string;
    loaded: boolean;
  }[];
}

/* ————— Ayudas visuales del revamp (1f) ————— */

const selectClass =
  "rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-navy focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/25";

/** Iniciales del conductor para el avatar (máx. dos palabras). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "—";
}

/** Píldora de SoC: limón (sano) o ámbar (bajo) con rayo relleno. */
function SocPill({ soc }: { soc: number }) {
  return (
    <span
      className={`inline-flex items-center gap-[3px] rounded-full px-2 py-px text-[11px] font-semibold ${
        soc < 30 ? "bg-warning-bg text-warning" : "bg-lima/45 text-lime-ink"
      }`}
    >
      <Zap aria-hidden="true" className="h-2.5 w-2.5" fill="currentColor" strokeWidth={0} />
      {Math.round(soc)}%
    </span>
  );
}

/** Avatar navy de 28px con iniciales — identidad del conductor. */
function DriverIdentity({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-[7px]">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-[11px] font-bold text-white"
      >
        {initials(name)}
      </span>
      <span className="text-[13px] font-medium text-navy">{name}</span>
    </span>
  );
}

/**
 * Barra de progreso de la ruta (150×6): tramo limón = entregadas; tramo rojo
 * al 55 % = fallidas. El estado se lee sin recorrer la tabla.
 */
function RouteProgress({
  delivered,
  failed,
  total,
}: {
  delivered: number;
  failed: number;
  total: number;
}) {
  if (total === 0) return null;
  return (
    <span className="flex min-w-[150px] flex-col gap-[3px]">
      <span className="text-[11px] text-text-secondary">
        {delivered}/{total} entregadas
        {failed > 0 && (
          <>
            {" · "}
            <span className="font-semibold text-danger">
              {failed} fallida{failed === 1 ? "" : "s"}
            </span>
          </>
        )}
      </span>
      <span
        aria-hidden="true"
        className="flex h-1.5 overflow-hidden rounded-full bg-niebla"
      >
        <span className="h-full bg-lima" style={{ width: `${(delivered / total) * 100}%` }} />
        {failed > 0 && (
          <span
            className="h-full bg-danger opacity-55"
            style={{ width: `${(failed / total) * 100}%` }}
          />
        )}
      </span>
    </span>
  );
}

/** Círculo del número de parada: navy = completada, cielo = pendiente, rojo = fallida. */
function StopNumber({ n, status }: { n: number; status: string }) {
  const tone =
    status === "COMPLETED"
      ? "bg-navy text-white"
      : status === "FAILED"
        ? "bg-danger text-white"
        : "bg-sky-50 text-info";
  return (
    <span
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${tone}`}
    >
      {n}
    </span>
  );
}

/** Ícono de las advertencias del plan: batería si habla de carga/autonomía. */
function warningIcon(text: string) {
  const cls = "h-3 w-3 shrink-0";
  return /bater|carg|autonom|soc|rango|range/i.test(text) ? (
    <BatteryCharging aria-hidden="true" className={cls} strokeWidth={2} />
  ) : (
    <TriangleAlert aria-hidden="true" className={cls} strokeWidth={2} />
  );
}

export default function Rutas() {
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<Record<string, string>>({});
  const [inserting, setInserting] = useState<Record<string, string>>({});
  const [mapOpen, setMapOpen] = useState<Set<string>>(new Set());
  // Inserción express plegada tras el botón fantasma "Insertar pedido" (1f).
  const [insertOpen, setInsertOpen] = useState<Set<string>>(new Set());
  // Manifiesto de carga (Tier 2 §11): bultos escaneados al cargar el vehículo.
  const [manifests, setManifests] = useState<Record<string, Manifest>>({});
  const [manifestOpen, setManifestOpen] = useState<Set<string>>(new Set());
  // Conductores sugeridos por zona (D5): routeId → ids sugeridos.
  const [suggested, setSuggested] = useState<Record<string, string[]>>({});
  const toast = useToast();

  // Conductores ya ocupados en rutas activas: no re-asignables (dedupe).
  const assignedDriverIds = useMemo(
    () =>
      new Set(
        routes
          .filter((r) => r.driver && ["DISPATCHED", "IN_PROGRESS"].includes(r.status))
          .map((r) => r.driver!.id),
      ),
    [routes],
  );

  // Chips contextuales del encabezado (día operativo América/Bogotá).
  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("es-CO", {
        day: "numeric",
        month: "short",
        timeZone: "America/Bogota",
      }).format(new Date()),
    [],
  );
  const totalStops = useMemo(
    () => routes.reduce((n, r) => n + r.stops.length, 0),
    [routes],
  );

  function toggleMap(id: string) {
    setMapOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleInsert(id: string) {
    setInsertOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  /** Manifiesto de carga: se carga bajo demanda al abrirlo. */
  async function toggleManifest(id: string) {
    const willOpen = !manifestOpen.has(id);
    setManifestOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    if (willOpen) {
      try {
        const m = await api<Manifest>("GET", `/routes/${id}/manifest`);
        setManifests((prev) => ({ ...prev, [id]: m }));
      } catch (err) {
        toast.error(err);
      }
    }
  }

  async function load() {
    try {
      const [r, d, p] = await Promise.all([
        api<RouteData[]>("GET", "/routes"),
        api<Driver[]>("GET", "/drivers"),
        api<PendingOrder[]>("GET", "/orders?status=GEOCODED"),
      ]);
      setRoutes(r);
      setDrivers(d);
      setPendingOrders(p);
      // Sugerencias de conductor por zona (D5) para las rutas por despachar.
      const planned = r.filter((rt) => rt.status === "PLANNED" && !rt.driver);
      const entries = await Promise.all(
        planned.map(async (rt) => {
          try {
            const res = await api<{ drivers: { id: string }[] }>(
              "GET",
              `/routes/${rt.id}/suggested-drivers`,
            );
            return [rt.id, res.drivers.map((dr) => dr.id)] as const;
          } catch {
            return [rt.id, [] as string[]] as const;
          }
        }),
      );
      setSuggested(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function dispatch(routeId: string) {
    const driverId = assigning[routeId];
    if (!driverId) return;
    try {
      await api("POST", `/routes/${routeId}/dispatch`, { driverId });
      await load();
    } catch (err) {
      // Conflicto de transición (otro despachador la tomó): el toast ya explica
      // y recargamos; no ofrecemos reintentar porque volvería a chocar.
      const isConflict = err instanceof ApiError && err.status === 409;
      toast.error(err, isConflict ? undefined : { retry: () => void dispatch(routeId) });
      if (isConflict) await load();
    }
  }

  /** Inserción express: añade un pedido pendiente a una ruta activa. */
  async function insertOrder(routeId: string) {
    const orderId = inserting[routeId];
    if (!orderId) return;
    try {
      const res = await api<{ insertedAt: number }>(
        "POST",
        `/optimization/routes/${routeId}/insert`,
        { orderId },
      );
      toast.success(`Pedido insertado en la posición ${res.insertedAt + 1} de la ruta.`);
      setInserting((s) => ({ ...s, [routeId]: "" }));
      await load();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      // 422 INSERTION_INFEASIBLE: el pedido no cabe en esta ruta sin romper
      // ventanas/capacidad/autonomía — reintentar es inútil; se sugiere una
      // alternativa accionable en vez de un botón de reintento.
      if (status === 422) {
        toast.error(
          new Error(
            `${(err as ApiError).message} — replanifica o prueba con otra ruta.`,
          ),
        );
        return;
      }
      // 409 conflicto de transición (otro despachador tomó la ruta): recargar,
      // sin reintentar (volvería a chocar).
      const isConflict = status === 409;
      toast.error(err, isConflict ? undefined : { retry: () => void insertOrder(routeId) });
      if (isConflict) await load();
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rutas"
        actions={
          !loading && routes.length > 0 ? (
            <>
              <span className="rounded-full border border-border bg-surface px-3 py-[5px] text-xs text-text-secondary">
                Hoy · {todayLabel}
              </span>
              <span className="rounded-full border border-border bg-surface px-3 py-[5px] text-xs text-text-secondary">
                {routes.length} ruta{routes.length === 1 ? "" : "s"} · {totalStops}{" "}
                parada{totalStops === 1 ? "" : "s"}
              </span>
            </>
          ) : undefined
        }
      />
      {loading && (
        <Card>
          <Loading label="Cargando rutas…" />
        </Card>
      )}
      {!loading && routes.length === 0 && (
        <Card>
          <EmptyState
            phrase="Última milla con máxima eficiencia."
            action={
              <Link
                to="/planificacion"
                className="rounded-md bg-lima px-4 py-2 text-sm font-semibold text-navy hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
              >
                Ir a Planificación
              </Link>
            }
          >
            No hay rutas todavía. Genere un plan en Planificación.
          </EmptyState>
        </Card>
      )}
      {routes.map((r) => {
        const total = r.stops.length;
        const delivered = r.stops.filter((s) => s.status === "COMPLETED").length;
        const failed = r.stops.filter((s) => s.status === "FAILED").length;
        const manifest = manifests[r.id];
        return (
          <Card key={r.id}>
            {/* Encabezado de la ruta: placa + píldoras + chips + clúster derecho. */}
            <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
              <span className="text-base font-semibold text-navy">
                {r.vehicle.plate}
              </span>
              <span className="rounded-full bg-sky-50 px-2 py-px text-[11px] font-semibold text-info">
                {r.vehicle.type}
              </span>
              {r.vehicle.isElectric && r.vehicle.socPercent != null && (
                <SocPill soc={r.vehicle.socPercent} />
              )}
              {/* Fecha y depósito como chips, no concatenados en el título. */}
              <span className="inline-flex items-center gap-[5px] text-xs text-text-secondary">
                <CalendarDays aria-hidden="true" className="h-3 w-3 shrink-0" strokeWidth={2} />
                <span className="font-mono">{r.date}</span>
              </span>
              <span className="inline-flex items-center gap-[5px] text-xs text-text-secondary">
                <Warehouse aria-hidden="true" className="h-3 w-3 shrink-0" strokeWidth={2} />
                {r.depot ? `${r.depot.name} · ` : ""}
                {r.totalDistanceKm} km
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-3.5">
                {r.driver ? (
                  <>
                    <RouteProgress delivered={delivered} failed={failed} total={total} />
                    <DriverIdentity name={r.driver.name} />
                  </>
                ) : r.status === "PLANNED" ? (
                  <span className="flex items-center gap-2.5">
                    <select
                      aria-label="Asignar conductor a la ruta"
                      className={selectClass}
                      value={assigning[r.id] ?? ""}
                      onChange={(e) =>
                        setAssigning((a) => ({ ...a, [r.id]: e.target.value }))
                      }
                    >
                      <option value="">Asignar conductor…</option>
                      {(() => {
                        const sug = new Set(suggested[r.id] ?? []);
                        // Conductores de la zona primero, marcados como sugeridos.
                        return drivers
                          .filter((d) => !assignedDriverIds.has(d.id))
                          .slice()
                          .sort((a, b) => Number(sug.has(b.id)) - Number(sug.has(a.id)))
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                              {sug.has(d.id) ? " — sugerido (zona)" : ""}
                            </option>
                          ));
                      })()}
                    </select>
                    <Button
                      variant="primary"
                      onClick={() => dispatch(r.id)}
                      disabled={!assigning[r.id]}
                    >
                      Despachar
                    </Button>
                  </span>
                ) : (
                  <span className="text-sm text-text-tertiary">Sin conductor</span>
                )}
                <StatusBadge status={r.status} />
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[13px] text-navy">
                <thead>
                  <tr className={theadRowClass}>
                    <th className="w-[70px] py-1.5 font-semibold">#</th>
                    <th className="font-semibold">Cliente</th>
                    <th className="font-semibold">Dirección</th>
                    <th className="w-[60px] font-semibold">ETA</th>
                    <th className="w-[140px] font-semibold">POD</th>
                    <th className={`${failed > 0 ? "w-[150px]" : "w-[110px]"} font-semibold`}>
                      Estado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.stops.map((s) => {
                    const isFailed = s.status === "FAILED";
                    return (
                      <tr
                        key={s.id}
                        className={
                          isFailed
                            ? "border-b border-border/60 bg-danger-bg/55"
                            : tableRowClass
                        }
                      >
                        <td
                          className={`py-1.5 ${isFailed ? "border-l-[3px] border-l-danger pl-1" : ""}`}
                        >
                          <span className="flex items-center gap-1.5">
                            <StopNumber n={s.sequence} status={s.status} />
                            <span
                              className={`rounded px-1 py-0.5 text-[10px] font-bold ${
                                s.kind === "PICKUP"
                                  ? "bg-cielo/40 text-navy"
                                  : "bg-lima/50 text-navy"
                              }`}
                            >
                              {s.kind === "PICKUP" ? "REC" : "ENT"}
                            </span>
                          </span>
                        </td>
                        <td className="font-medium">{s.order.customerName}</td>
                        <td className="max-w-[280px] truncate text-text-secondary">
                          {s.kind === "PICKUP"
                            ? (s.order.pickupAddressRaw ?? s.order.addressRaw)
                            : s.order.addressRaw}
                        </td>
                        <td className="font-mono text-xs">{formatEta(s.etaMin)}</td>
                        <td className="text-xs">
                          {s.pod ? (
                            <span className="flex items-center gap-1.5">
                              {/* Miniatura de la foto POD (o marcador de posición). */}
                              {s.pod.photoUrl ? (
                                <a
                                  href={s.pod.photoUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label="Ver foto de la entrega"
                                  className="shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                                >
                                  <img
                                    src={s.pod.photoUrl}
                                    alt=""
                                    className="h-6 w-6 rounded-[5px] object-cover"
                                  />
                                </a>
                              ) : s.pod.geofenceOk !== false ? (
                                <span
                                  aria-hidden="true"
                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] bg-niebla text-text-tertiary"
                                >
                                  <Camera className="h-3 w-3" strokeWidth={2} />
                                </span>
                              ) : null}
                              {s.pod.geofenceOk === false ? (
                                <span className="flex items-center gap-1 text-danger">
                                  <TriangleAlert
                                    aria-hidden="true"
                                    className="h-3 w-3 shrink-0"
                                    strokeWidth={2}
                                  />
                                  fuera de geocerca
                                </span>
                              ) : (
                                <span>✓ {s.pod.receivedBy ?? ""}</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-text-tertiary">—</span>
                          )}
                        </td>
                        <td>
                          <span className="flex items-center gap-2">
                            <StatusBadge status={s.status} />
                            {isFailed && (
                              // Recuperación de la entrega fallida → cockpit de excepciones (1b).
                              <Link
                                to="/excepciones"
                                className="whitespace-nowrap text-[11px] font-semibold text-danger hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                              >
                                Recuperar →
                              </Link>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Acciones de la ruta: botones fantasma con ícono (antes enlaces subrayados). */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                icon={<MapIcon strokeWidth={2} />}
                onClick={() => toggleMap(r.id)}
              >
                {mapOpen.has(r.id) ? "Ocultar mapa" : "Ver mapa"}
              </Button>
              <Button
                variant="secondary"
                icon={<FileText strokeWidth={2} />}
                onClick={() => void toggleManifest(r.id)}
              >
                {manifestOpen.has(r.id)
                  ? "Ocultar manifiesto"
                  : `Manifiesto de carga${manifest ? ` · ${manifest.loaded}/${manifest.total}` : ""}`}
              </Button>
              {["PLANNED", "DISPATCHED", "IN_PROGRESS"].includes(r.status) &&
                pendingOrders.length > 0 && (
                  <Button
                    variant="secondary"
                    icon={<Plus strokeWidth={2} />}
                    onClick={() => toggleInsert(r.id)}
                  >
                    Insertar pedido
                  </Button>
                )}
              {r.warnings.length > 0 && (
                <span className="ml-auto flex flex-col items-end gap-1">
                  {r.warnings.map((w, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 text-xs text-warning"
                    >
                      {warningIcon(w)}
                      {w}
                    </span>
                  ))}
                </span>
              )}
            </div>
            {mapOpen.has(r.id) && <RouteMap stops={r.stops} />}
            {/* Manifiesto de carga (Tier 2 §11): cadena de custodia depósito → puerta. */}
            {manifestOpen.has(r.id) && (
              <div className="mt-2 rounded-lg border border-border p-3">
                {!manifest ? (
                  <p className="text-xs text-text-tertiary">Cargando manifiesto…</p>
                ) : (
                  <>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                      Manifiesto · {manifest.loaded} de {manifest.total} bultos cargados
                    </div>
                    <ul className="space-y-1 text-sm">
                      {manifest.orders.map((o) => (
                        <li
                          key={o.orderId}
                          className="flex items-center justify-between gap-3"
                        >
                          <span className="min-w-0 truncate">
                            <span className="font-mono text-xs text-text-secondary">
                              {o.trackingNumber ?? "—"}
                            </span>{" "}
                            · {o.customerName}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                              o.loaded
                                ? "bg-success-bg text-success"
                                : "bg-niebla text-text-secondary"
                            }`}
                          >
                            {o.loaded ? "✓ Cargado" : "Pendiente"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* Inserción express: pedidos pendientes a una ruta activa. */}
            {insertOpen.has(r.id) &&
              ["PLANNED", "DISPATCHED", "IN_PROGRESS"].includes(r.status) &&
              pendingOrders.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Inserción express
                  </span>
                  <select
                    aria-label="Pedido a insertar en la ruta"
                    className={`${selectClass} min-w-0 flex-1 sm:max-w-xs`}
                    value={inserting[r.id] ?? ""}
                    onChange={(e) =>
                      setInserting((s) => ({ ...s, [r.id]: e.target.value }))
                    }
                  >
                    <option value="">Seleccionar pedido pendiente…</option>
                    {pendingOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.customerName} — {o.addressRaw}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="primary"
                    onClick={() => insertOrder(r.id)}
                    disabled={!inserting[r.id]}
                  >
                    Insertar en ruta
                  </Button>
                </div>
              )}
          </Card>
        );
      })}
    </div>
  );
}
