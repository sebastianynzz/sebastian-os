import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import { Banner, Button, Card, PageHeader, formatEta } from "../components/ui";

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
interface PlanResponse {
  routes: {
    id: string;
    vehicleId: string;
    totalDistanceKm: number;
    totalDurationMin: number;
    warnings: string[];
    stops: { orderId: string; kind: "PICKUP" | "DELIVERY"; sequence: number; etaMin: number }[];
  }[];
  unassigned: { orderId: string; reason: string }[];
  excludedVehicles: { vehicleId: string; reason: string }[];
}

const DEPOT = { lat: 4.6486, lng: -74.0628 }; // demo: Chapinero

export default function Planificacion() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [selectedVehicles, setSelectedVehicles] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [o, v] = await Promise.all([
        api<Order[]>("GET", "/orders?status=GEOCODED"),
        api<Vehicle[]>("GET", "/vehicles"),
      ]);
      setOrders(o);
      setVehicles(v);
      setSelectedOrders(new Set(o.map((x) => x.id)));
      setSelectedVehicles(new Set(v.map((x) => x.id)));
    })();
  }, []);

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

  async function onPlan() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<PlanResponse>("POST", "/optimization/plans", {
        date,
        depot: DEPOT,
        orderIds: [...selectedOrders],
        vehicleIds: [...selectedVehicles],
      });
      setOrderArchive((prev) => {
        const next = new Map(prev);
        for (const o of orders) next.set(o.id, o);
        return next;
      });
      setPlan(res);
      setOrders(await api<Order[]>("GET", "/orders?status=GEOCODED"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Planificación de rutas"
        subtitle="El optimizador aplica pico y placa según ciudad y fecha, capacidad,
          ventanas horarias y autonomía de vehículos eléctricos."
        actions={
          <>
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
      {error && (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title={`Paso 1 · Selecciona pedidos (${orders.length})`}>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {orders.map((o) => (
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
                    <span className="ml-1 text-xs font-medium text-emerald-600">
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
            center={[DEPOT.lat, DEPOT.lng]}
            zoom={12}
            style={{ height: 280 }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={[DEPOT.lat, DEPOT.lng]} icon={markerIcon}>
              <Popup>Depósito</Popup>
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
                <p key={e.vehicleId} className="text-sm text-amber-700">
                  {vehiclesById.get(e.vehicleId)?.plate ?? e.vehicleId}: {e.reason}
                </p>
              ))}
            </Card>
          )}
          {plan.unassigned.length > 0 && (
            <Card title="Pedidos sin asignar">
              {plan.unassigned.map((u) => (
                <p key={u.orderId} className="text-sm text-red-700">
                  {ordersById.get(u.orderId)?.customerName ?? u.orderId}: {u.reason}
                </p>
              ))}
            </Card>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {plan.routes.map((r) => (
              <Card
                key={r.id}
                title={`Ruta ${vehiclesById.get(r.vehicleId)?.plate ?? r.vehicleId} — ${r.totalDistanceKm} km · ${Math.round(r.totalDurationMin / 60)}h ${r.totalDurationMin % 60}m`}
              >
                {r.warnings.map((w) => (
                  <p key={w} className="mb-1 text-xs text-amber-600">⚠ {w}</p>
                ))}
                <ol className="space-y-1 text-sm">
                  {r.stops.map((s) => (
                    <li key={`${s.orderId}-${s.kind}`} className="flex justify-between">
                      <span>
                        {s.sequence}.{" "}
                        <span
                          className={`mr-1 rounded px-1 text-[10px] font-bold ${
                            s.kind === "PICKUP" ? "bg-cielo/40" : "bg-lima/50"
                          }`}
                        >
                          {s.kind === "PICKUP" ? "REC" : "ENT"}
                        </span>
                        {ordersById.get(s.orderId)?.customerName ?? s.orderId}
                      </span>
                      <span className="font-mono text-xs text-navy/50">
                        ETA {formatEta(s.etaMin)}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-xs text-navy/50">
                  Despache esta ruta desde la pestaña Rutas.
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
