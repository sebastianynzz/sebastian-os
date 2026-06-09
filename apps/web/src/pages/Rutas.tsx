import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
  Banner,
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
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [r, d] = await Promise.all([
        api<RouteData[]>("GET", "/routes"),
        api<Driver[]>("GET", "/drivers"),
      ]);
      setRoutes(r);
      setDrivers(d);
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
      <PageHeader title="Rutas" />
      {error && (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {loading && (
        <Card>
          <Loading label="Cargando rutas…" />
        </Card>
      )}
      {!loading && routes.length === 0 && (
        <Card>
          <EmptyState
            action={
              <Link
                to="/planificacion"
                className="rounded-lg bg-lima px-4 py-2 text-sm font-semibold text-navy hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
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
          title={`${r.date} · ${r.vehicle.plate} (${r.vehicle.type}${r.vehicle.isElectric ? " ⚡" : ""}) · ${r.totalDistanceKm} km`}
          actions={
            <div className="flex items-center gap-2">
              {r.driver ? (
                <span className="text-sm text-navy/70">
                  Conductor: <strong>{r.driver.name}</strong>
                </span>
              ) : (
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
          </div>
        </Card>
      ))}
    </div>
  );
}
