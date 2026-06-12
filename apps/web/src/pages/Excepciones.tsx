import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useRealtimeReload } from "../realtime";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Loading,
  PageHeader,
} from "../components/ui";

/**
 * Cockpit de excepciones: la pantalla de inicio operativa del día. Una sola
 * cola priorizada (pánico, desvíos, rutas tarde, vehículos mudos, batería
 * baja, entregas fallidas, direcciones sin confirmar) con acción de un clic.
 */

interface ExceptionItem {
  id: string;
  type: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  title: string;
  detail: string;
  action?:
    | { kind: "ACK_ALERT"; alertId: string }
    | { kind: "FLAG_RECOVERY"; orderId: string }
    | { kind: "OPEN_TRIAGE" }
    | { kind: "OPEN_ROUTE"; routeId: string }
    | { kind: "OPEN_MAP"; vehicleId: string };
  createdAt: string;
}

const SEVERITY_STYLES: Record<ExceptionItem["severity"], string> = {
  CRITICAL: "border-l-4 border-red-600 bg-red-50",
  HIGH: "border-l-4 border-amber-500 bg-amber-50",
  MEDIUM: "border-l-4 border-cielo bg-white",
};

const TYPE_ICONS: Record<string, string> = {
  PANIC: "🚨",
  ROUTE_DEVIATION: "🛣️",
  ROUTE_LATE: "⏱️",
  VEHICLE_STALE: "📡",
  LOW_BATTERY: "🔋",
  FAILED_DELIVERY: "📦",
  ADDRESS_UNCONFIRMED: "📍",
};

export default function Excepciones() {
  const [items, setItems] = useState<ExceptionItem[] | null>(null);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: ExceptionItem[] }>("GET", "/exceptions");
      setItems(res.items);
    } catch {
      // el sondeo de respaldo reintenta
    }
  }, []);

  useRealtimeReload(["order", "safety", "telemetry"], load, { fallbackMs: 30_000 });

  async function runAction(item: ExceptionItem) {
    if (!item.action) return;
    setBusyId(item.id);
    setBanner(null);
    try {
      if (item.action.kind === "ACK_ALERT") {
        await api("PATCH", `/safety/alerts/${item.action.alertId}`, {
          status: "ACKNOWLEDGED",
        });
        setBanner({ kind: "success", text: "Alerta marcada como atendida" });
      } else if (item.action.kind === "FLAG_RECOVERY") {
        await api("POST", `/orders/${item.action.orderId}/recovery/flag`);
        setBanner({
          kind: "success",
          text: "Comercio notificado: podrá reprogramar la entrega desde su portal",
        });
      }
      await load();
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBusyId(null);
    }
  }

  if (!items) return <Loading label="Calculando excepciones…" />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Excepciones"
        subtitle="Todo lo que requiere tu acción ahora, en una sola cola priorizada."
      />
      {banner && (
        <Banner kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Banner>
      )}

      {items.length === 0 ? (
        <Card>
          <EmptyState>✅ Operación sana: no hay excepciones abiertas.</EmptyState>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl p-4 shadow-sm ${SEVERITY_STYLES[item.severity]}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-semibold">
                  <span aria-hidden="true">{TYPE_ICONS[item.type] ?? "⚠️"}</span>
                  <span>{item.title}</span>
                </div>
                <div className="mt-0.5 text-sm text-navy/70">{item.detail}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                {item.action?.kind === "ACK_ALERT" && (
                  <Button
                    onClick={() => runAction(item)}
                    disabled={busyId === item.id}
                  >
                    {busyId === item.id ? "…" : "Atender"}
                  </Button>
                )}
                {item.action?.kind === "FLAG_RECOVERY" && (
                  <Button
                    onClick={() => runAction(item)}
                    disabled={busyId === item.id}
                  >
                    {busyId === item.id ? "…" : "Notificar comercio"}
                  </Button>
                )}
                {item.action?.kind === "OPEN_TRIAGE" && (
                  <Link
                    to="/direcciones"
                    className="rounded-lg bg-navy px-3 py-1.5 text-sm font-bold text-white"
                  >
                    Abrir triage
                  </Link>
                )}
                {item.action?.kind === "OPEN_ROUTE" && (
                  <Link
                    to="/rutas"
                    className="rounded-lg bg-navy px-3 py-1.5 text-sm font-bold text-white"
                  >
                    Ver ruta
                  </Link>
                )}
                {item.action?.kind === "OPEN_MAP" && (
                  <Link
                    to="/mapa"
                    className="rounded-lg bg-navy px-3 py-1.5 text-sm font-bold text-white"
                  >
                    Ver en mapa
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
