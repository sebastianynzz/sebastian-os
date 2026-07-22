import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import {
  ArrowRight,
  BatteryWarning,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Locate,
  Search,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import {
  OPTIMIZATION_OBJECTIVES,
  OPTIMIZATION_OBJECTIVE_LABELS,
  type OptimizationActionId,
  type OptimizationObjective,
} from "@moveos/shared";
import { api } from "../api";
import { useToast } from "../toast";
import { Button, Card, PageHeader, formatEta } from "../components/ui";
import {
  AiOptimizeButton,
  useAiActionsAvailable,
} from "../components/AiOptimizeButton";

// Iconos de Leaflet empaquetados localmente (sin dependencia de CDN).
import markerIconUrl from "leaflet/dist/images/marker-icon.png";

const markerIcon = new L.Icon({
  iconUrl: markerIconUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

interface Order {
  id: string;
  customerName: string;
  addressRaw: string;
  status: string;
  weightKg: number;
  lat: number | null;
  lng: number | null;
}
interface Vehicle {
  id: string;
  plate: string;
  type: string;
  capacityKg: number;
  isElectric: boolean;
  socPercent: number | null;
  nominalRangeKm: number | null;
}
interface PlanRoute {
  id: string;
  vehicleId: string;
  totalDistanceKm: number;
  totalDurationMin: number;
  warnings: string[];
  stops: { orderId: string; kind: "PICKUP" | "DELIVERY"; sequence: number; etaMin: number }[];
}
interface PlanResponse {
  routes: PlanRoute[];
  unassigned: { orderId: string; reason: string }[];
  excludedVehicles: { vehicleId: string; reason: string }[];
}
interface Depot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  isMain: boolean;
}

// Depósito de respaldo (Chapinero) cuando el tenant aún no creó ninguno.
const DEPOT = { lat: 4.6486, lng: -74.0628 };

/** Las 4 acciones de IA de esta pantalla (gating de la barra del Copiloto). */
const AI_ACTION_IDS: readonly OptimizationActionId[] = [
  "optimize_routes",
  "optimize_load",
  "pick_vehicle",
  "optimize_schedule",
];

/** Selects/inputs fantasma de la barra de herramientas del encabezado. */
const ghostSelect =
  "rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-navy focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/25";

/**
 * Autonomía útil estimada al despachar, SOLO informativa: SoC actual ×
 * autonomía nominal × (1 − margen de seguridad 15%), los mismos valores por
 * defecto de estimateUsableRangeKm. El límite real lo aplica el optimizador.
 */
function usableRangeKm(v: Vehicle): number | null {
  if (v.socPercent == null || v.nominalRangeKm == null) return null;
  return Math.round(v.nominalRangeKm * (v.socPercent / 100) * 0.85);
}

function formatDuration(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}

export default function Planificacion() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState<string>("");
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [selectedVehicles, setSelectedVehicles] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [objective, setObjective] = useState<OptimizationObjective>("BALANCE");
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [orderFilter, setOrderFilter] = useState("");
  // Ajuste manual del orden de visita por ruta (antes de despachar).
  const [seqEdits, setSeqEdits] = useState<Record<string, string[]>>({});
  const [savingRoute, setSavingRoute] = useState<string | null>(null);
  // Parada en arrastre (reordenamiento con GripVertical dentro de su ruta).
  const [dragStop, setDragStop] = useState<{ routeId: string; index: number } | null>(null);
  const toast = useToast();
  const aiAvailable = useAiActionsAvailable(AI_ACTION_IDS);

  useEffect(() => {
    void (async () => {
      const [o, v, d] = await Promise.all([
        api<Order[]>("GET", "/orders?status=GEOCODED"),
        api<Vehicle[]>("GET", "/vehicles"),
        api<Depot[]>("GET", "/depots").catch(() => [] as Depot[]),
      ]);
      setOrders(o);
      setVehicles(v);
      setDepots(d);
      // Por defecto el principal (el listado viene con el principal primero).
      if (d.length > 0) setSelectedDepotId(d[0]!.id);
      setSelectedOrders(new Set(o.map((x) => x.id)));
      setSelectedVehicles(new Set(v.map((x) => x.id)));
    })();
  }, []);

  // Depósito efectivo del plan: el seleccionado, o el de respaldo si el tenant
  // aún no creó depósitos. Sus coordenadas mandan en el optimizador y el mapa.
  const activeDepot = useMemo(() => {
    const d = depots.find((x) => x.id === selectedDepotId);
    return d ? { lat: d.lat, lng: d.lng } : DEPOT;
  }, [depots, selectedDepotId]);

  // Índice acumulado: los pedidos recién planificados dejan de estar en
  // estado GEOCODED, pero sus datos deben seguir visibles en las rutas.
  const [orderArchive, setOrderArchive] = useState<Map<string, Order>>(
    () => new Map(),
  );
  const ordersById = useMemo(() => {
    const m = new Map(orderArchive);
    for (const o of orders) m.set(o.id, o);
    return m;
  }, [orders, orderArchive]);

  /** Elige el depósito más cercano al centroide de los pedidos seleccionados. */
  async function pickNearestDepot() {
    const pts = [...selectedOrders]
      .map((id) => ordersById.get(id))
      .filter((o): o is Order => !!o && o.lat != null && o.lng != null);
    if (pts.length === 0) return;
    const lat = pts.reduce((s, o) => s + (o.lat as number), 0) / pts.length;
    const lng = pts.reduce((s, o) => s + (o.lng as number), 0) / pts.length;
    try {
      const res = await api<{ depot: { id: string } | null }>(
        "GET",
        `/depots/nearest?lat=${lat}&lng=${lng}`,
      );
      if (res.depot) setSelectedDepotId(res.depot.id);
    } catch {
      /* sin red: se mantiene el depósito actual */
    }
  }
  const vehiclesById = useMemo(
    () => new Map(vehicles.map((v) => [v.id, v])),
    [vehicles],
  );

  // Filtro de pedidos: el despachador acota por destinatario o dirección antes
  // de seleccionar (útil con decenas de pedidos por planificar).
  const filteredOrders = useMemo(() => {
    const q = orderFilter.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        o.customerName.toLowerCase().includes(q) ||
        o.addressRaw.toLowerCase().includes(q),
    );
  }, [orders, orderFilter]);

  // Selección masiva sobre el subconjunto visible (respeta el filtro).
  function selectAllFiltered() {
    setSelectedOrders((s) => {
      const next = new Set(s);
      for (const o of filteredOrders) next.add(o.id);
      return next;
    });
  }
  function clearFiltered() {
    setSelectedOrders((s) => {
      const next = new Set(s);
      for (const o of filteredOrders) next.delete(o.id);
      return next;
    });
  }

  async function onPlan() {
    setBusy(true);
    try {
      const res = await api<PlanResponse>("POST", "/optimization/plans", {
        date,
        depot: activeDepot,
        depotId: selectedDepotId || undefined,
        orderIds: [...selectedOrders],
        vehicleIds: [...selectedVehicles],
        objective,
      });
      setOrderArchive((prev) => {
        const next = new Map(prev);
        for (const o of orders) next.set(o.id, o);
        return next;
      });
      setPlan(res);
      setOrders(await api<Order[]>("GET", "/orders?status=GEOCODED"));
    } catch (err) {
      toast.error(err, { retry: () => void onPlan() });
    } finally {
      setBusy(false);
    }
  }

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  /** Pedidos distintos de una ruta, en su orden de paradas actual. */
  function routeOrderIds(r: PlanRoute): string[] {
    const seen: string[] = [];
    for (const s of r.stops) if (!seen.includes(s.orderId)) seen.push(s.orderId);
    return seen;
  }
  function moveOrder(routeId: string, current: string[], idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= current.length) return;
    const next = [...current];
    const tmp = next[idx]!;
    next[idx] = next[j]!;
    next[j] = tmp;
    setSeqEdits((e) => ({ ...e, [routeId]: next }));
  }
  /** Reordena en vivo mientras se arrastra una parada sobre otra de su ruta. */
  function dragOverStop(routeId: string, current: string[], overIdx: number) {
    if (!dragStop || dragStop.routeId !== routeId || dragStop.index === overIdx) return;
    const next = [...current];
    const moved = next.splice(dragStop.index, 1)[0];
    if (moved === undefined) return;
    next.splice(overIdx, 0, moved);
    setSeqEdits((e) => ({ ...e, [routeId]: next }));
    setDragStop({ routeId, index: overIdx });
  }
  function resetSeq(routeId: string) {
    setSeqEdits((e) => {
      const n = { ...e };
      delete n[routeId];
      return n;
    });
  }
  async function saveSeq(r: PlanRoute, orderIds: string[]) {
    setSavingRoute(r.id);
    try {
      const res = await api<{ route: PlanRoute }>(
        "PATCH",
        `/optimization/routes/${r.id}/sequence`,
        { orderIds },
      );
      setPlan((p) =>
        p ? { ...p, routes: p.routes.map((x) => (x.id === r.id ? res.route : x)) } : p,
      );
      resetSeq(r.id);
      toast.success("Orden de la ruta actualizado");
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingRoute(null);
    }
  }

  // Resumen del plan para la franja de estadísticas del Paso 4.
  const planStats = useMemo(() => {
    if (!plan) return null;
    const assigned = new Set<string>();
    let km = 0;
    let min = 0;
    for (const r of plan.routes) {
      for (const s of r.stops) assigned.add(s.orderId);
      km += r.totalDistanceKm;
      min += r.totalDurationMin;
    }
    return {
      routes: plan.routes.length,
      assigned: assigned.size,
      total: assigned.size + plan.unassigned.length,
      km,
      min,
    };
  }, [plan]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Planificación de rutas"
        subtitle="Pico y placa, capacidad, ventanas horarias y autonomía EV — aplicados por el optimizador."
        actions={
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2 shadow-soft">
            {depots.length > 0 && (
              <>
                <label className="sr-only" htmlFor="plan-depot">
                  Depósito
                </label>
                <select
                  id="plan-depot"
                  value={selectedDepotId}
                  onChange={(e) => setSelectedDepotId(e.target.value)}
                  title="Depósito de salida y regreso de las rutas"
                  className={ghostSelect}
                >
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.isMain ? " (principal)" : ""}
                    </option>
                  ))}
                </select>
                {depots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void pickNearestDepot()}
                    disabled={selectedOrders.size === 0}
                    title="Elegir el depósito más cercano a los pedidos seleccionados"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-navy transition duration-200 ease-brand hover:bg-niebla focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Locate aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                    Más cercano
                  </button>
                )}
              </>
            )}
            <label className="sr-only" htmlFor="plan-objective">
              Estrategia de optimización
            </label>
            <select
              id="plan-objective"
              value={objective}
              onChange={(e) => setObjective(e.target.value as OptimizationObjective)}
              title="Estrategia de optimización (aplica solo a rutas nuevas)"
              className={ghostSelect}
            >
              {OPTIMIZATION_OBJECTIVES.map((o) => (
                <option key={o} value={o}>
                  {OPTIMIZATION_OBJECTIVE_LABELS[o]}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="plan-date">
              Fecha del plan
            </label>
            <input
              id="plan-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={ghostSelect}
            />
            <Button
              variant="cta"
              icon={<Zap strokeWidth={2} />}
              onClick={onPlan}
              disabled={busy || selectedOrders.size === 0}
            >
              {busy
                ? "Optimizando…"
                : `Optimizar ${selectedOrders.size} pedido${selectedOrders.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        }
      />

      {/* Barra del Copiloto: el LLM dispara y explica; el solver hace la
          matemática. optimize_routes muta (confirmar antes de crear rutas);
          optimize_load y pick_vehicle son asesores (solo recomiendan). */}
      {aiAvailable && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 shadow-soft">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-navy">
            <Sparkles
              aria-hidden="true"
              className="h-[15px] w-[15px] text-lime-ink"
              strokeWidth={2}
            />
            Copiloto
          </span>
          <AiOptimizeButton
            variant="chip"
            actionId="optimize_routes"
            context={{
              orderIds: [...selectedOrders],
              vehicleIds: [...selectedVehicles],
              date,
              params: { depot: activeDepot, depotId: selectedDepotId || undefined },
            }}
            disabled={selectedOrders.size === 0 || selectedVehicles.size === 0}
            onApplied={() => {
              void (async () => {
                setOrderArchive((prev) => {
                  const next = new Map(prev);
                  for (const o of orders) next.set(o.id, o);
                  return next;
                });
                const fresh = await api<Order[]>("GET", "/orders?status=GEOCODED");
                setOrders(fresh);
                setSelectedOrders(new Set(fresh.map((x) => x.id)));
                setPlan(null);
              })();
            }}
          />
          <AiOptimizeButton
            variant="chip"
            actionId="optimize_load"
            context={{
              orderIds: [...selectedOrders],
              vehicleIds: [...selectedVehicles],
            }}
            disabled={selectedOrders.size === 0 || selectedVehicles.size === 0}
          />
          <AiOptimizeButton
            variant="chip"
            actionId="pick_vehicle"
            context={{ orderIds: [...selectedOrders] }}
            disabled={selectedOrders.size === 0}
          />
          <AiOptimizeButton
            variant="chip"
            actionId="optimize_schedule"
            context={{ date }}
          />
          <span className="order-1 ml-auto text-xs text-text-tertiary">
            El copiloto propone; tú confirmas antes de aplicar.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[440px_1fr]">
        <div className="flex flex-col gap-4">
          <Card
            title="Paso 1 · Pedidos"
            actions={
              <span className="rounded-full bg-lima/45 px-2.5 py-0.5 text-xs font-semibold text-lime-ink">
                {selectedOrders.size} de {orders.length}
              </span>
            }
          >
            <div className="relative mb-2">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
                strokeWidth={2}
              />
              <input
                type="search"
                value={orderFilter}
                onChange={(e) => setOrderFilter(e.target.value)}
                placeholder="Filtrar por destinatario o dirección…"
                aria-label="Filtrar pedidos"
                className="w-full rounded-md border border-border-strong bg-surface py-1.5 pl-8 pr-3 text-[13px] text-navy placeholder:text-text-tertiary focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/25"
              />
            </div>
            <div className="mb-1 flex items-center justify-between text-xs text-text-tertiary">
              <span>{filteredOrders.length} visibles</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="rounded px-1.5 py-0.5 font-semibold text-navy transition duration-200 ease-brand hover:bg-niebla"
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={clearFiltered}
                  className="rounded px-1.5 py-0.5 font-semibold text-navy transition duration-200 ease-brand hover:bg-niebla"
                >
                  Ninguno
                </button>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {filteredOrders.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-center gap-2 border-b border-border/70 py-[5px] text-[13px] text-navy last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={selectedOrders.has(o.id)}
                    onChange={() => setSelectedOrders((s) => toggle(s, o.id))}
                    className="h-3.5 w-3.5 shrink-0 accent-navy"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{o.customerName}</span>{" "}
                    <span className="text-text-tertiary">· {o.addressRaw}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-niebla px-2 py-px text-[11px] text-text-secondary">
                    {o.weightKg} kg
                  </span>
                </label>
              ))}
              {orders.length === 0 && (
                <p className="text-sm text-text-tertiary">
                  No hay pedidos geocodificados pendientes.
                </p>
              )}
              {orders.length > 0 && filteredOrders.length === 0 && (
                <p className="text-sm text-text-tertiary">
                  Ningún pedido coincide con el filtro.
                </p>
              )}
            </div>
          </Card>

          <Card
            title="Paso 2 · Vehículos"
            actions={
              <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-info">
                {selectedVehicles.size} de {vehicles.length}
              </span>
            }
          >
            <div className="max-h-72 overflow-y-auto">
              {vehicles.map((v) => {
                const lowSoc =
                  v.isElectric && v.socPercent != null && v.socPercent < 30;
                const rangeKm = lowSoc ? usableRangeKm(v) : null;
                return (
                  <div
                    key={v.id}
                    className="flex flex-col border-b border-border/70 py-[9px] last:border-b-0"
                  >
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={selectedVehicles.has(v.id)}
                        onChange={() => setSelectedVehicles((s) => toggle(s, v.id))}
                        className="h-3.5 w-3.5 shrink-0 accent-navy"
                      />
                      <span className="text-[13px] font-semibold text-navy">
                        {v.plate}
                      </span>
                      <span className="rounded-full bg-sky-50 px-2 py-px text-[11px] font-semibold text-info">
                        {v.type}
                      </span>
                      <span className="text-xs text-text-secondary">
                        {v.capacityKg} kg
                      </span>
                      {v.isElectric && (
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          <Zap
                            aria-hidden="true"
                            className={`h-3 w-3 ${lowSoc ? "fill-warning text-warning" : "fill-lime-ink text-lime-ink"}`}
                            strokeWidth={2}
                          />
                          {v.socPercent != null ? (
                            <>
                              <span className="h-1.5 w-[110px] overflow-hidden rounded-full bg-niebla">
                                <span
                                  className={`block h-full ${lowSoc ? "bg-warning" : "bg-lima"}`}
                                  style={{
                                    width: `${Math.max(0, Math.min(100, v.socPercent))}%`,
                                  }}
                                />
                              </span>
                              <span
                                className={`w-8 text-right text-xs font-semibold ${lowSoc ? "text-warning" : "text-navy"}`}
                              >
                                {Math.round(v.socPercent)}%
                              </span>
                            </>
                          ) : (
                            <span className="text-xs font-semibold text-lime-ink">
                              EV
                            </span>
                          )}
                        </span>
                      )}
                    </label>
                    {lowSoc && rangeKm != null && (
                      <p className="ml-6 mt-1 text-[11px] text-warning">
                        Autonomía útil {rangeKm} km — el optimizador limitará su ruta
                      </p>
                    )}
                  </div>
                );
              })}
              {vehicles.length === 0 && (
                <p className="text-sm text-text-tertiary">
                  No hay vehículos registrados. Créelos en la sección Vehículos.
                </p>
              )}
            </div>
          </Card>
        </div>

        <div className="flex min-h-[560px] flex-col rounded-xl border border-border bg-surface p-4 shadow-soft">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-navy">
              Paso 3 · Mapa de la operación
            </h2>
            <span className="flex items-center gap-3.5 text-xs text-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 border-2 border-white bg-navy ring-1 ring-navy/25"
                />
                Depósito
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full bg-navy"
                />
                Pedido
              </span>
            </span>
          </div>
          <div className="relative z-0 min-h-[520px] flex-1 overflow-hidden rounded-lg">
            <MapContainer
              key={`${activeDepot.lat},${activeDepot.lng}`}
              center={[activeDepot.lat, activeDepot.lng]}
              zoom={12}
              style={{ height: "100%", minHeight: 520 }}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Marker position={[activeDepot.lat, activeDepot.lng]} icon={markerIcon}>
                <Popup>
                  {depots.find((d) => d.id === selectedDepotId)?.name ?? "Depósito"}
                </Popup>
              </Marker>
              {orders
                .filter((o) => o.lat !== null && o.lng !== null)
                .map((o) => (
                  <Marker key={o.id} position={[o.lat!, o.lng!]} icon={markerIcon}>
                    <Popup>
                      {o.customerName}
                      <br />
                      {o.addressRaw}
                    </Popup>
                  </Marker>
                ))}
            </MapContainer>
          </div>
        </div>
      </div>

      {plan && planStats && (
        <div className="space-y-3">
          <h2 className="mt-2 text-base font-semibold tracking-[-0.01em] text-navy">
            Paso 4 · Revisa y despacha
          </h2>

          {/* Franja de resumen: rutas / asignados / km+tiempo / excluidos. Las
              exclusiones (p. ej. pico y placa de un no-EV) van como chip de
              advertencia — los EV de MoveOS están exentos por Ley 1964/2019. */}
          <div className="flex flex-wrap items-center gap-y-3 rounded-xl border border-border bg-surface px-5 py-3.5 shadow-soft">
            <div className="border-r border-border pr-6">
              <div className="text-[23px] font-semibold leading-tight text-navy">
                {planStats.routes}
              </div>
              <div className="text-xs text-text-secondary">
                {planStats.routes === 1 ? "ruta generada" : "rutas generadas"}
              </div>
            </div>
            <div className="border-r border-border px-6">
              <div className="text-[23px] font-semibold leading-tight text-lime-ink">
                {planStats.assigned}/{planStats.total}
              </div>
              <div className="text-xs text-text-secondary">pedidos asignados</div>
            </div>
            <div
              className={`px-6 ${plan.excludedVehicles.length > 0 ? "border-r border-border" : ""}`}
            >
              <div className="text-[23px] font-semibold leading-tight text-navy">
                {planStats.km.toFixed(1)} km
              </div>
              <div className="text-xs text-text-secondary">
                {formatDuration(planStats.min)} en total
              </div>
            </div>
            {plan.excludedVehicles.length > 0 && (
              <>
                <div className="px-6">
                  <div className="text-[23px] font-semibold leading-tight text-warning">
                    {plan.excludedVehicles.length}
                  </div>
                  <div className="text-xs text-text-secondary">
                    {plan.excludedVehicles.length === 1
                      ? "vehículo excluido"
                      : "vehículos excluidos"}
                  </div>
                </div>
                <div className="ml-auto flex flex-col gap-1.5">
                  {plan.excludedVehicles.map((e) => (
                    <span
                      key={e.vehicleId}
                      className="inline-flex items-center gap-2 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning"
                    >
                      <TriangleAlert
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0"
                        strokeWidth={2}
                      />
                      <span>
                        <strong className="font-semibold">
                          {vehiclesById.get(e.vehicleId)?.plate ?? e.vehicleId} excluido:
                        </strong>{" "}
                        {e.reason}
                      </span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {plan.unassigned.length > 0 && (
            <div className="rounded-xl border border-danger/30 bg-danger-bg px-4 py-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-danger">
                <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                Pedidos sin asignar ({plan.unassigned.length})
              </p>
              <ul className="space-y-0.5 text-sm text-danger">
                {plan.unassigned.map((u) => (
                  <li key={u.orderId}>
                    {ordersById.get(u.orderId)?.customerName ?? u.orderId}: {u.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plan.routes.map((r) => {
              const v = vehiclesById.get(r.vehicleId);
              const lowSoc =
                !!v?.isElectric && v.socPercent != null && v.socPercent < 30;
              const baseSeq = routeOrderIds(r);
              const current = seqEdits[r.id] ?? baseSeq;
              const dirty = current.join("|") !== baseSeq.join("|");
              const canReorder = current.length > 1 && savingRoute !== r.id;
              const etaByOrder = new Map(
                r.stops
                  .filter((s) => s.kind === "DELIVERY")
                  .map((s) => [s.orderId, s.etaMin] as const),
              );
              const withPickup = new Set(
                r.stops.filter((s) => s.kind === "PICKUP").map((s) => s.orderId),
              );
              return (
                <Card key={r.id}>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-navy">
                      {v?.plate ?? r.vehicleId}
                    </span>
                    {v && (
                      <span className="rounded-full bg-sky-50 px-2 py-px text-[11px] font-semibold text-info">
                        {v.type}
                      </span>
                    )}
                    {v?.isElectric && v.socPercent != null && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] font-semibold ${
                          lowSoc ? "bg-warning-bg text-warning" : "bg-lima/45 text-lime-ink"
                        }`}
                      >
                        <Zap
                          aria-hidden="true"
                          className="h-2.5 w-2.5 fill-current"
                          strokeWidth={2}
                        />
                        {Math.round(v.socPercent)}%
                      </span>
                    )}
                    <span className="ml-auto text-xs text-text-secondary">
                      {r.totalDistanceKm} km · {formatDuration(r.totalDurationMin)}
                    </span>
                  </div>

                  {r.warnings.map((w) => (
                    <div
                      key={w}
                      className="mb-3 flex items-start gap-2 rounded-md bg-warning-bg px-2.5 py-2 text-xs leading-relaxed text-warning"
                    >
                      <BatteryWarning
                        aria-hidden="true"
                        className="mt-px h-3.5 w-3.5 shrink-0"
                        strokeWidth={2}
                      />
                      <span>{w}</span>
                    </div>
                  ))}

                  {/* Línea de tiempo de paradas: arrastra con el asa (o flechas
                      del teclado sobre ella); las ETAs se recalculan al guardar. */}
                  <div className="flex flex-col">
                    {current.map((orderId, idx) => {
                      const order = ordersById.get(orderId);
                      const isLast = idx === current.length - 1;
                      return (
                        <div
                          key={orderId}
                          draggable={canReorder}
                          onDragStart={() => setDragStop({ routeId: r.id, index: idx })}
                          onDragOver={(e) => {
                            e.preventDefault();
                            dragOverStop(r.id, current, idx);
                          }}
                          onDragEnd={() => setDragStop(null)}
                          className={`flex gap-2.5 ${
                            dragStop?.routeId === r.id && dragStop.index === idx
                              ? "opacity-60"
                              : ""
                          }`}
                        >
                          <div className="flex flex-col items-center">
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                                withPickup.has(orderId) ? "bg-info" : "bg-navy"
                              }`}
                            >
                              {idx + 1}
                            </span>
                            {!isLast && (
                              <span
                                aria-hidden="true"
                                className="my-0.5 w-0.5 flex-1 bg-border"
                              />
                            )}
                          </div>
                          <div
                            className={`flex min-w-0 flex-1 items-start gap-2 ${isLast ? "" : "pb-3"}`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-medium text-navy">
                                {order?.customerName ?? orderId}
                                {withPickup.has(orderId) && (
                                  <span className="ml-1.5 rounded bg-sky-50 px-1 py-px align-middle text-[10px] font-bold text-info">
                                    REC+ENT
                                  </span>
                                )}
                              </span>
                              {order?.addressRaw && (
                                <span className="block truncate text-[11px] text-text-tertiary">
                                  {order.addressRaw}
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 shrink-0 font-mono text-[11px] text-text-secondary">
                              {dirty ? "—" : formatEta(etaByOrder.get(orderId) ?? 0)}
                            </span>
                            {/* El drag HTML5 no dispara en táctiles: en pantallas
                                de puntero grueso se muestran flechas de toque. */}
                            {current.length > 1 && (
                              <span className="mt-0.5 hidden shrink-0 flex-col pointer-coarse:flex">
                                <button
                                  type="button"
                                  aria-label={`Subir la parada ${idx + 1}`}
                                  disabled={savingRoute === r.id || idx === 0}
                                  onClick={() => moveOrder(r.id, current, idx, -1)}
                                  className="text-border-strong transition hover:text-text-secondary disabled:opacity-30"
                                >
                                  <ChevronUp aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Bajar la parada ${idx + 1}`}
                                  disabled={savingRoute === r.id || isLast}
                                  onClick={() => moveOrder(r.id, current, idx, 1)}
                                  className="text-border-strong transition hover:text-text-secondary disabled:opacity-30"
                                >
                                  <ChevronDown aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                                </button>
                              </span>
                            )}
                            {current.length > 1 && (
                              <button
                                type="button"
                                aria-label={`Reordenar la parada ${idx + 1} (flechas arriba/abajo)`}
                                disabled={savingRoute === r.id}
                                onKeyDown={(e) => {
                                  if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    moveOrder(r.id, current, idx, -1);
                                  }
                                  if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    moveOrder(r.id, current, idx, 1);
                                  }
                                }}
                                className="mt-0.5 hidden shrink-0 cursor-grab text-border-strong transition duration-200 ease-brand hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-40 pointer-fine:block"
                              >
                                <GripVertical
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5"
                                  strokeWidth={2}
                                />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {dirty && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        onClick={() => void saveSeq(r, current)}
                        disabled={savingRoute === r.id}
                      >
                        {savingRoute === r.id ? "Guardando…" : "Guardar orden"}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => resetSeq(r.id)}
                        disabled={savingRoute === r.id}
                      >
                        Restablecer
                      </Button>
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
                    <span className="text-[11px] text-text-tertiary">
                      {current.length > 1
                        ? "Arrastra para reordenar · las ETAs se recalculan al guardar"
                        : "1 parada"}
                    </span>
                    <Link
                      to="/rutas"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-navy/25 bg-surface px-2.5 py-1 text-xs font-medium text-navy transition duration-200 ease-brand hover:bg-lima/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                    >
                      Despachar en Rutas
                      <ArrowRight aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
