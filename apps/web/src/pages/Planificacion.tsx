import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import {
  OPTIMIZATION_OBJECTIVES,
  OPTIMIZATION_OBJECTIVE_LABELS,
  type OptimizationObjective,
} from "@moveos/shared";
import { api } from "../api";
import { useToast } from "../toast";
import { Button, Card, PageHeader, formatEta } from "../components/ui";
import { AiOptimizeButton } from "../components/AiOptimizeButton";

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
  const toast = useToast();

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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Planificación de rutas"
        subtitle="El optimizador aplica pico y placa según ciudad y fecha, capacidad,
          ventanas horarias y autonomía de vehículos eléctricos."
        actions={
          <>
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
                  className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-navy focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/25"
                >
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.isMain ? " (principal)" : ""}
                    </option>
                  ))}
                </select>
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
              className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-navy focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/25"
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
              className="rounded-lg border border-cielo bg-white px-3 py-1.5 text-sm text-navy focus:border-navy focus:outline-none focus:ring-2 focus:ring-cielo/50"
            />
            <Button onClick={onPlan} disabled={busy || selectedOrders.size === 0}>
              {busy ? "Optimizando…" : `Optimizar ${selectedOrders.size} pedidos`}
            </Button>
          </>
        }
      />

      <p className="text-xs text-text-tertiary">
        La estrategia de optimización aplica solo a las rutas nuevas que generes
        ahora; no reorganiza rutas ya creadas.
      </p>

      {/* Optimización con IA: el LLM dispara y explica; el solver hace la
          matemática. optimize_routes muta (confirmar antes de crear rutas);
          optimize_load y pick_vehicle son asesores (solo recomiendan). */}
      <div className="flex flex-wrap items-start gap-3">
        <AiOptimizeButton
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
          actionId="optimize_load"
          context={{
            orderIds: [...selectedOrders],
            vehicleIds: [...selectedVehicles],
          }}
          disabled={selectedOrders.size === 0 || selectedVehicles.size === 0}
        />
        <AiOptimizeButton
          actionId="pick_vehicle"
          context={{ orderIds: [...selectedOrders] }}
          disabled={selectedOrders.size === 0}
        />
        <AiOptimizeButton actionId="optimize_schedule" context={{ date }} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title={`Paso 1 · Selecciona pedidos (${selectedOrders.size}/${orders.length})`}>
          <div className="mb-2 space-y-2">
            <input
              type="search"
              value={orderFilter}
              onChange={(e) => setOrderFilter(e.target.value)}
              placeholder="Filtrar por destinatario o dirección…"
              aria-label="Filtrar pedidos"
              className="w-full rounded-lg border border-cielo px-2 py-1 text-sm focus:border-navy focus:outline-none"
            />
            <div className="flex items-center justify-between text-xs text-navy/60">
              <span>{filteredOrders.length} visibles</span>
              <div className="flex gap-2">
                <button onClick={selectAllFiltered} className="font-semibold text-navy underline">
                  Todos
                </button>
                <button onClick={clearFiltered} className="font-semibold text-navy underline">
                  Ninguno
                </button>
              </div>
            </div>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {filteredOrders.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedOrders.has(o.id)}
                  onChange={() => setSelectedOrders((s) => toggle(s, o.id))}
                />
                <span className="truncate">
                  {o.customerName} — {o.addressRaw}
                </span>
              </label>
            ))}
            {orders.length === 0 && (
              <p className="text-sm text-navy/50">No hay pedidos geocodificados pendientes.</p>
            )}
            {orders.length > 0 && filteredOrders.length === 0 && (
              <p className="text-sm text-navy/50">Ningún pedido coincide con el filtro.</p>
            )}
          </div>
        </Card>

        <Card title={`Paso 2 · Selecciona vehículos (${vehicles.length})`}>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {vehicles.map((v) => (
              <label key={v.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedVehicles.has(v.id)}
                  onChange={() => setSelectedVehicles((s) => toggle(s, v.id))}
                />
                <span>
                  {v.plate} · {v.type} · {v.capacityKg} kg
                  {v.isElectric && (
                    <span className="ml-1 text-xs font-medium text-success">
                      ⚡ {v.socPercent != null ? `${v.socPercent}%` : "EV"}
                    </span>
                  )}
                </span>
              </label>
            ))}
            {vehicles.length === 0 && (
              <p className="text-sm text-navy/50">
                No hay vehículos registrados. Créelos en la sección Vehículos.
              </p>
            )}
          </div>
        </Card>

        <Card title="Paso 3 · Optimiza (mapa de la operación)">
          <MapContainer
            key={`${activeDepot.lat},${activeDepot.lng}`}
            center={[activeDepot.lat, activeDepot.lng]}
            zoom={12}
            style={{ height: 280 }}
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
        </Card>
      </div>

      {plan && (
        <div className="space-y-4">
          <h2 className="text-base font-bold">Paso 4 · Revisa y despacha</h2>
          {plan.excludedVehicles.length > 0 && (
            <Card title="Vehículos excluidos">
              {plan.excludedVehicles.map((e) => (
                <p key={e.vehicleId} className="text-sm text-warning">
                  {vehiclesById.get(e.vehicleId)?.plate ?? e.vehicleId}: {e.reason}
                </p>
              ))}
            </Card>
          )}
          {plan.unassigned.length > 0 && (
            <Card title="Pedidos sin asignar">
              {plan.unassigned.map((u) => (
                <p key={u.orderId} className="text-sm text-danger">
                  {ordersById.get(u.orderId)?.customerName ?? u.orderId}: {u.reason}
                </p>
              ))}
            </Card>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {plan.routes.map((r) => {
              const baseSeq = routeOrderIds(r);
              const current = seqEdits[r.id] ?? baseSeq;
              const dirty = current.join("|") !== baseSeq.join("|");
              const etaByOrder = new Map(
                r.stops
                  .filter((s) => s.kind === "DELIVERY")
                  .map((s) => [s.orderId, s.etaMin] as const),
              );
              const withPickup = new Set(
                r.stops.filter((s) => s.kind === "PICKUP").map((s) => s.orderId),
              );
              return (
                <Card
                  key={r.id}
                  title={`Ruta ${vehiclesById.get(r.vehicleId)?.plate ?? r.vehicleId} — ${r.totalDistanceKm} km · ${Math.round(r.totalDurationMin / 60)}h ${r.totalDurationMin % 60}m`}
                >
                  {r.warnings.map((w) => (
                    <p key={w} className="mb-1 text-xs text-warning">⚠ {w}</p>
                  ))}
                  {/* Orden de visita ajustable con ▲▼ antes de despachar; las ETAs
                      se recalculan en el servidor al guardar. */}
                  <ol className="space-y-1 text-sm">
                    {current.map((orderId, idx) => (
                      <li
                        key={orderId}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="min-w-0 truncate">
                          {idx + 1}.{" "}
                          {withPickup.has(orderId) && (
                            <span className="mr-1 rounded bg-cielo/40 px-1 text-[10px] font-bold">
                              REC+ENT
                            </span>
                          )}
                          {ordersById.get(orderId)?.customerName ?? orderId}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-mono text-xs text-navy/50">
                            {dirty ? "ETA —" : `ETA ${formatEta(etaByOrder.get(orderId) ?? 0)}`}
                          </span>
                          <span className="flex flex-col leading-none">
                            <button
                              aria-label="Subir parada"
                              disabled={idx === 0 || savingRoute === r.id}
                              onClick={() => moveOrder(r.id, current, idx, -1)}
                              className="px-1 text-navy disabled:opacity-30"
                            >
                              ▲
                            </button>
                            <button
                              aria-label="Bajar parada"
                              disabled={idx === current.length - 1 || savingRoute === r.id}
                              onClick={() => moveOrder(r.id, current, idx, 1)}
                              className="px-1 text-navy disabled:opacity-30"
                            >
                              ▼
                            </button>
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                  {dirty ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        onClick={() => void saveSeq(r, current)}
                        disabled={savingRoute === r.id}
                      >
                        {savingRoute === r.id ? "Guardando…" : "Guardar orden"}
                      </Button>
                      <button
                        onClick={() => resetSeq(r.id)}
                        disabled={savingRoute === r.id}
                        className="text-xs font-semibold text-navy underline disabled:opacity-50"
                      >
                        Restablecer
                      </button>
                      <span className="text-xs text-navy/50">
                        Las ETAs se recalculan al guardar.
                      </span>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-navy/50">
                      Reordena las paradas con ▲▼, o despáchala desde la pestaña Rutas.
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
