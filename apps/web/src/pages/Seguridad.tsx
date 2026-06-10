import { useState } from "react";
import { api, ApiError } from "../api";
import { useRealtimeReload } from "../realtime";
import {
  Button,
  Card,
  EmptyState,
  Loading,
  ModuleDisabled,
  PageHeader,
  StatusBadge,
} from "../components/ui";

interface Alert {
  id: string;
  type: string;
  details: string | null;
  status: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  PANIC: "🚨 Pánico",
  ROUTE_DEVIATION: "↪ Desviación de ruta",
  LONG_STOP: "⏱ Parada prolongada",
  GEOFENCE_EXIT: "⛔ Salida de geocerca",
};

export default function Seguridad() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleOff, setModuleOff] = useState(false);

  async function load() {
    try {
      setAlerts(await api<Alert[]>("GET", "/safety/alerts"));
    } catch (err) {
      if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
        setModuleOff(true);
      }
    } finally {
      setLoading(false);
    }
  }
  // Tiempo real: pánico y desviaciones llegan por SSE al instante (antes:
  // sondeo cada 15 s). Queda un respaldo lento por si el stream se cae.
  useRealtimeReload(["safety"], () => void load());

  async function setStatus(id: string, status: string) {
    await api("PATCH", `/safety/alerts/${id}`, { status });
    await load();
  }

  if (moduleOff) {
    return <ModuleDisabled title="Seguridad de carga" moduleName="de seguridad" />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Seguridad de carga"
        subtitle="Alertas de pánico y desviaciones de ruta (detección automática sobre la
          telemetría). En producción se integra con central de monitoreo y PONAL."
      />

      <Card>
        {loading && <Loading label="Cargando alertas…" />}
        {!loading && alerts.length === 0 && (
          <EmptyState>Sin alertas. Operación tranquila ✓</EmptyState>
        )}
        <div className="space-y-2">
          {alerts.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-niebla p-3"
            >
              <div>
                <div className="font-medium">{TYPE_LABELS[a.type] ?? a.type}</div>
                <div className="text-xs text-navy/50">
                  {a.details}
                  {a.lat !== null && ` · (${a.lat.toFixed(4)}, ${a.lng?.toFixed(4)})`}
                  {" · "}
                  {new Date(a.createdAt).toLocaleString("es-CO")}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={a.status} />
                {a.status === "OPEN" && (
                  <>
                    <Button variant="secondary" onClick={() => setStatus(a.id, "ACKNOWLEDGED")}>
                      Atender
                    </Button>
                    <Button variant="secondary" onClick={() => setStatus(a.id, "RESOLVED")}>
                      Resolver
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
