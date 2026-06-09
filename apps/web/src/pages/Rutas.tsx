import { useEffect, useState } from "react";
import { api } from "../api";
import { Button, Card, StatusBadge, formatEta } from "../components/ui";

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
  stops: {
    id: string;
    sequence: number;
    etaMin: number;
    status: string;
    order: {
      customerName: string;
      addressRaw: string;
    };
    pod: {
      geofenceOk: boolean | null;
      receivedBy: string | null;
      photoUrl: string | null;
    } | null;
  }[];
}

export default function Rutas() {
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [assigning, setAssigning] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [r, d] = await Promise.all([
      api<RouteData[]>("GET", "/routes"),
      api<Driver[]>("GET", "/drivers"),
    ]);
    setRoutes(r);
    setDrivers(d);
  }
  useEffect(() => {
    void load();
  }, []);

  async function dispatch(routeId: string) {
    const driverId = assigning[routeId];
    if (!driverId) return;
    setError(null);
    try {
      await api("POST", `/routes/${routeId}/dispatch`, { driverId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Rutas</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {routes.length === 0 && (
        <Card>
          <p className="py-4 text-center text-slate-400">
            No hay rutas. Genere un plan en Planificación.
          </p>
        </Card>
      )}
      {routes.map((r) => (
        <Card
          key={r.id}
          title={`${r.date} · ${r.vehicle.plate} (${r.vehicle.type}${r.vehicle.isElectric ? " ⚡" : ""}) · ${r.totalDistanceKm} km`}
          actions={
            <div className="flex items-center gap-2">
              {r.driver ? (
                <span className="text-sm text-slate-600">
                  Conductor: <strong>{r.driver.name}</strong>
                </span>
              ) : (
                <>
                  <select
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    value={assigning[r.id] ?? ""}
                    onChange={(e) =>
                      setAssigning((a) => ({ ...a, [r.id]: e.target.value }))
                    }
                  >
                    <option value="">Asignar conductor…</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <Button onClick={() => dispatch(r.id)} disabled={!assigning[r.id]}>
                    Despachar
                  </Button>
                </>
              )}
              <StatusBadge status={r.status} />
            </div>
          }
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
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
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="py-1.5">{s.sequence}</td>
                  <td>{s.order.customerName}</td>
                  <td className="max-w-xs truncate">{s.order.addressRaw}</td>
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
        </Card>
      ))}
    </div>
  );
}
