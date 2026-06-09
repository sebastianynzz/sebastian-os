import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button, Card, StatusBadge } from "../components/ui";

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
  const [moduleOff, setModuleOff] = useState(false);

  async function load() {
    try {
      setAlerts(await api<Alert[]>("GET", "/safety/alerts"));
    } catch (err) {
      if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
        setModuleOff(true);
      }
    }
  }
  useEffect(() => {
    void load();
    const interval = setInterval(load, 15000); // refresco de central de monitoreo
    return () => clearInterval(interval);
  }, []);

  async function setStatus(id: string, status: string) {
    await api("PATCH", `/safety/alerts/${id}`, { status });
    await load();
  }

  if (moduleOff) {
    return (
      <Card title="Seguridad">
        <p className="text-sm text-slate-500">
          El módulo de seguridad no está activo. Actívelo en Módulos.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Seguridad de carga</h1>
      <p className="text-sm text-slate-500">
        Alertas de pánico y desviaciones de ruta (detección automática sobre la
        telemetría). En producción se integra con central de monitoreo y PONAL.
      </p>

      <Card>
        {alerts.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-400">
            Sin alertas. Operación tranquila ✓
          </p>
        )}
        <div className="space-y-2">
          {alerts.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-lg border border-slate-100 p-3"
            >
              <div>
                <div className="font-medium">{TYPE_LABELS[a.type] ?? a.type}</div>
                <div className="text-xs text-slate-500">
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
