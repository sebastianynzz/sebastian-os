import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CircleCheck, Leaf, MapPin, Satellite, Truck } from "lucide-react";
import { BASE_URL } from "../api";
import { formatDateTimeBogota } from "../format";

/**
 * Página pública de rastreo (sin login). El negocio cliente abre el enlace
 * /t/:token y ve el estado de su envío con una línea de tiempo. Marca Move.
 * Sin shell autenticado: layout propio, restilizado con los tokens del revamp.
 */

interface TimelineEntry {
  type: string;
  label: string;
  at: string;
}
interface Tracking {
  trackingNumber: string | null;
  recipient: string;
  address: string;
  operator: string;
  sender: string | null;
  status: string;
  deliveredAt: string | null;
  etaMin: number | null;
  trackingTier: string;
  queuePosition: { position: number; totalPending: number } | null;
  customProperties: { id: string; name: string; value: string }[];
  timeline: TimelineEntry[];
  driverPosition: { lat: number; lng: number; at: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Registrado",
  GEOCODED: "Registrado",
  ASSIGNED: "Programado",
  IN_TRANSIT: "En camino",
  DELIVERED: "Entregado",
  FAILED: "No entregado",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado",
};

/* Chip de estado: pares semánticos fondo suave + texto de la misma familia. */
const STATUS_CHIP: Record<string, string> = {
  PENDING: "bg-niebla text-text-secondary",
  GEOCODED: "bg-niebla text-text-secondary",
  ASSIGNED: "bg-sky-50 text-info",
  IN_TRANSIT: "bg-warning-bg text-warning",
  DELIVERED: "bg-lima/45 text-lime-ink",
  FAILED: "bg-danger-bg text-danger",
  REJECTED: "bg-danger-bg text-danger",
  CANCELLED: "bg-niebla text-text-tertiary",
};

function formatEta(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function Track() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Tracking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch(`${BASE_URL}/track/${token}`);
        if (!res.ok) throw new Error("Envío no encontrado");
        const body = (await res.json()) as Tracking;
        if (active) setData(body);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Error");
      }
    }
    void load();
    // Tiempo real: el servidor empuja un "update" por SSE cuando el envío
    // cambia de estado o el conductor reporta posición (antes: sondeo cada
    // 20 s). Queda un respaldo lento por si el stream se cae.
    let es: EventSource | null = null;
    if (typeof EventSource !== "undefined") {
      es = new EventSource(`${BASE_URL}/track/${token}/stream`);
      es.addEventListener("update", () => void load());
    }
    const interval = setInterval(load, 60000);
    return () => {
      active = false;
      es?.close();
      clearInterval(interval);
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-niebla">
      <header className="bg-navy px-4 py-4 text-white">
        <div className="mx-auto max-w-lg">
          <div className="text-xl font-bold">
            move<span className="text-lima">.</span>
          </div>
          <div className="text-xs text-cielo">Rastreo de envío</div>
        </div>
      </header>

      <main className="mx-auto max-w-lg p-4">
        {error && (
          <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-text-secondary shadow-soft">
            {error}. Verifica el enlace con tu operador logístico.
          </div>
        )}

        {!error && !data && (
          <div
            role="status"
            className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface p-6 text-sm text-text-tertiary shadow-soft"
          >
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-sky border-t-navy"
            />
            Cargando…
          </div>
        )}

        {data && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
              <div className="flex items-center justify-between gap-3">
                <div className="font-mono text-sm font-semibold text-navy">
                  {data.trackingNumber}
                </div>
                <span
                  className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    STATUS_CHIP[data.status] ?? "bg-niebla text-text-secondary"
                  }`}
                >
                  {STATUS_LABEL[data.status] ?? data.status}
                </span>
              </div>
              <div className="mt-3 text-sm">
                <div className="text-text-tertiary">Destinatario</div>
                <div className="font-semibold text-navy">{data.recipient}</div>
                <div className="text-text-secondary">{data.address}</div>
              </div>
              {/* Datos del envío que el negocio decidió mostrar (Tier 2 §9). */}
              {data.customProperties && data.customProperties.length > 0 && (
                <dl className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                  {data.customProperties.map((cp) => (
                    <div key={cp.id} className="flex justify-between gap-3">
                      <dt className="text-text-tertiary">{cp.name}</dt>
                      <dd className="font-medium text-navy">{cp.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {data.status === "IN_TRANSIT" && data.etaMin !== null && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm font-medium text-navy">
                  <Truck aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span>
                    En camino · ETA aprox.{" "}
                    <span className="font-mono">{formatEta(data.etaMin)}</span>
                  </span>
                </div>
              )}
              {/* Posición en cola (ETA_POSITION / FULL): cuántas paradas faltan. */}
              {data.queuePosition && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-niebla px-3 py-2 text-sm font-medium text-navy">
                  <MapPin aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span>
                    Tu envío es la parada N.° {data.queuePosition.position} de{" "}
                    {data.queuePosition.totalPending} pendientes en la ruta.
                  </span>
                </div>
              )}
              {/* Ubicación en vivo (solo FULL): enlace a mapa externo, sin
                  incrustar dependencias en la página pública. */}
              {data.driverPosition && (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${data.driverPosition.lat}&mlon=${data.driverPosition.lng}#map=16/${data.driverPosition.lat}/${data.driverPosition.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 flex items-center gap-2 rounded-lg border border-navy/25 bg-surface px-3 py-2 text-sm font-medium text-navy transition duration-200 ease-brand hover:bg-lima/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                >
                  <Satellite aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span>
                    Ubicación del conductor en vivo · ver en el mapa (actualizado{" "}
                    <span className="font-mono">
                      {formatDateTimeBogota(data.driverPosition.at)}
                    </span>
                    )
                  </span>
                </a>
              )}
              {data.deliveredAt && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-lima/25 px-3 py-2 text-sm font-medium text-lime-ink">
                  <CircleCheck aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2} />
                  <span>
                    Entregado el{" "}
                    <span className="font-mono">
                      {formatDateTimeBogota(data.deliveredAt)}
                    </span>
                  </span>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
              <div className="mb-3 text-sm font-semibold text-navy">
                Historial del envío
              </div>
              <ol className="space-y-3">
                {data.timeline.map((e, i) => {
                  // El último evento es el paso actual: punto navy con halo limón.
                  const current = i === data.timeline.length - 1;
                  return (
                    <li key={`${e.type}-${e.at}`} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          aria-hidden="true"
                          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                            current ? "bg-navy ring-[3px] ring-lima/60" : "bg-lima"
                          }`}
                        />
                        {!current && <span className="w-px flex-1 bg-border" />}
                      </div>
                      <div className="pb-1">
                        <div className="text-sm font-medium text-navy">{e.label}</div>
                        <div className="font-mono text-[11px] text-text-tertiary">
                          {formatDateTimeBogota(e.at)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="flex items-center justify-center gap-1.5 px-2 text-center text-xs text-text-tertiary">
              <span>
                Operado por {data.operator}
                {data.sender ? ` · Envío de ${data.sender}` : ""} · con flota
                eléctrica
              </span>
              <Leaf aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-olive" strokeWidth={1.75} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
