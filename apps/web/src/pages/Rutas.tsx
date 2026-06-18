import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { Link } from "react-router-dom";
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
  vehicle: { plate: string; type: string; isElectric: boolean };
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
      <p className="mt-3 text-sm text-navy/50">
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

export default function Rutas() {
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<Record<string, string>>({});
  const [inserting, setInserting] = useState<Record<string, string>>({});
  const [mapOpen, setMapOpen] = useState<Set<string>>(new Set());
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

  function toggleMap(id: string) {
    setMapOpen((s) => {
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
      <PageHeader title="Rutas" />
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
      {routes.map((r) => (
        <Card
          key={r.id}
          title={`${r.date} · ${r.vehicle.plate} (${r.vehicle.type}${r.vehicle.isElectric ? " ⚡" : ""}) · ${r.totalDistanceKm} km${r.depot ? ` · 🏭 ${r.depot.name}` : ""}`}
          actions={
            <div className="flex items-center gap-2">
              {r.driver ? (
                <span className="text-sm text-navy/70">
                  Conductor: <strong>{r.driver.name}</strong>
                </span>
              ) : r.status === "PLANNED" ? (
                <>
                  <select
                    aria-label="Asignar conductor a la ruta"
                    className="rounded-lg border border-cielo bg-white px-2 py-1 text-sm text-navy focus:border-navy focus:outline-none focus:ring-2 focus:ring-cielo/50"
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
                  <Button onClick={() => dispatch(r.id)} disabled={!assigning[r.id]}>
                    Despachar
                  </Button>
                </>
              ) : (
                <span className="text-sm text-navy/50">Sin conductor</span>
              )}
              <StatusBadge status={r.status} />
            </div>
          }
        >
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={theadRowClass}>
                <th className="py-1">#</th>
                <th>Cliente</th>
                <th>Dirección</th>
                <th>ETA</th>
                <th>POD</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {r.stops.map((s) => (
                <tr key={s.id} className={tableRowClass}>
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5">
                      {s.sequence}
                      <span
                        className={`rounded px-1 py-0.5 text-[10px] font-bold ${
                          s.kind === "PICKUP" ? "bg-cielo/40 text-navy" : "bg-lima/50 text-navy"
                        }`}
                      >
                        {s.kind === "PICKUP" ? "REC" : "ENT"}
                      </span>
                    </span>
                  </td>
                  <td>{s.order.customerName}</td>
                  <td className="max-w-xs truncate">
                    {s.kind === "PICKUP"
                      ? (s.order.pickupAddressRaw ?? s.order.addressRaw)
                      : s.order.addressRaw}
                  </td>
                  <td className="font-mono text-xs">{formatEta(s.etaMin)}</td>
                  <td className="text-xs">
                    {s.pod ? (
                      <span className="flex items-center gap-1.5">
                        {s.pod.geofenceOk === false
                          ? "⚠ fuera de geocerca"
                          : `✓ ${s.pod.receivedBy ?? ""}`}
                        {s.pod.photoUrl && (
                          <a
                            href={s.pod.photoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-navy underline"
                          >
                            foto
                          </a>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div className="mt-2 flex flex-wrap gap-4">
            <button
              onClick={() => toggleMap(r.id)}
              className="text-xs font-medium text-navy underline hover:text-navy/70"
            >
              {mapOpen.has(r.id) ? "Ocultar mapa" : "Ver mapa de la ruta"}
            </button>
            <button
              onClick={() => void toggleManifest(r.id)}
              className="text-xs font-medium text-navy underline hover:text-navy/70"
            >
              {manifestOpen.has(r.id) ? "Ocultar manifiesto" : "Manifiesto de carga"}
            </button>
          </div>
          {mapOpen.has(r.id) && <RouteMap stops={r.stops} />}
          {/* Manifiesto de carga (Tier 2 §11): cadena de custodia depósito → puerta. */}
          {manifestOpen.has(r.id) && (
            <div className="mt-2 rounded-lg border border-niebla p-3">
              {!manifests[r.id] ? (
                <p className="text-xs text-navy/50">Cargando manifiesto…</p>
              ) : (
                <>
                  <div className="mb-2 text-xs font-semibold uppercase text-navy/50">
                    Manifiesto · {manifests[r.id]!.loaded} de {manifests[r.id]!.total}{" "}
                    bultos cargados
                  </div>
                  <ul className="space-y-1 text-sm">
                    {manifests[r.id]!.orders.map((o) => (
                      <li
                        key={o.orderId}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-xs text-navy/60">
                            {o.trackingNumber ?? "—"}
                          </span>{" "}
                          · {o.customerName}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                            o.loaded
                              ? "bg-success-bg text-success"
                              : "bg-niebla text-navy/50"
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
          {["PLANNED", "DISPATCHED", "IN_PROGRESS"].includes(r.status) &&
            pendingOrders.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-niebla pt-3">
                <span className="text-xs font-semibold uppercase text-navy/50">
                  Inserción express
                </span>
                <select
                  aria-label="Pedido a insertar en la ruta"
                  className="min-w-0 flex-1 rounded-lg border border-cielo bg-white px-2 py-1 text-sm text-navy focus:border-navy focus:outline-none sm:max-w-xs"
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
                  variant="secondary"
                  onClick={() => insertOrder(r.id)}
                  disabled={!inserting[r.id]}
                >
                  Insertar en ruta
                </Button>
              </div>
            )}
        </Card>
      ))}
    </div>
  );
}
