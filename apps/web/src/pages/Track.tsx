import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BASE_URL } from "../api";
import { formatDateTimeBogota } from "../format";

/**
 * Página pública de rastreo (sin login). El negocio cliente abre el enlace
 * /t/:token y ve el estado de su envío con una línea de tiempo. Marca Move.
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
          <div className="rounded-xl bg-white p-6 text-center text-navy/60 shadow-sm">
            {error}. Verifica el enlace con tu operador logístico.
          </div>
        )}

        {!error && !data && (
          <div className="rounded-xl bg-white p-6 text-center text-navy/50 shadow-sm">
            Cargando…
          </div>
        )}

        {data && (
          <div className="space-y-4">
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="font-mono text-sm font-semibold text-navy">
                  {data.trackingNumber}
                </div>
                <span className="rounded-full bg-lima/50 px-3 py-1 text-xs font-bold text-navy">
                  {STATUS_LABEL[data.status] ?? data.status}
                </span>
              </div>
              <div className="mt-3 text-sm">
                <div className="text-navy/50">Destinatario</div>
                <div className="font-semibold">{data.recipient}</div>
                <div className="text-navy/70">{data.address}</div>
              </div>
              {data.status === "IN_TRANSIT" && data.etaMin !== null && (
                <div className="mt-3 rounded-lg bg-cielo/30 px-3 py-2 text-sm font-medium text-navy">
                  🛵 En camino · ETA aprox. {formatEta(data.etaMin)}
                </div>
              )}
              {/* Posición en cola (ETA_POSITION / FULL): cuántas paradas faltan. */}
              {data.queuePosition && (
                <div className="mt-3 rounded-lg bg-niebla px-3 py-2 text-sm font-medium text-navy">
                  📍 Tu envío es la parada N.° {data.queuePosition.position} de{" "}
                  {data.queuePosition.totalPending} pendientes en la ruta.
                </div>
              )}
              {/* Ubicación en vivo (solo FULL): enlace a mapa externo, sin
                  incrustar dependencias en la página pública. */}
              {data.driverPosition && (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${data.driverPosition.lat}&mlon=${data.driverPosition.lng}#map=16/${data.driverPosition.lat}/${data.driverPosition.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 block rounded-lg bg-lima/30 px-3 py-2 text-sm font-medium text-navy underline-offset-2 hover:underline"
                >
                  🛰️ Ubicación del conductor en vivo · ver en el mapa (actualizado{" "}
                  {formatDateTimeBogota(data.driverPosition.at)})
                </a>
              )}
              {data.deliveredAt && (
                <div className="mt-3 rounded-lg bg-lima/30 px-3 py-2 text-sm font-medium text-navy">
                  ✅ Entregado el{" "}
                  {formatDateTimeBogota(data.deliveredAt)}
                </div>
              )}
            </div>

            <div className="rounded-xl bg-white p-5 shadow-sm">
              <div className="mb-3 text-sm font-semibold text-navy">
                Historial del envío
              </div>
              <ol className="space-y-3">
                {data.timeline.map((e, i) => {
                  const last = i === data.timeline.length - 1;
                  return (
                    <li key={`${e.type}-${e.at}`} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={`mt-1 h-3 w-3 rounded-full ${last ? "bg-lima" : "bg-cielo"}`}
                        />
                        {!last && <span className="w-px flex-1 bg-cielo/50" />}
                      </div>
                      <div className="pb-1">
                        <div className="text-sm font-medium text-navy">{e.label}</div>
                        <div className="text-xs text-navy/50">
                          {formatDateTimeBogota(e.at)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="px-2 text-center text-xs text-navy/40">
              Operado por {data.operator}
              {data.sender ? ` · Envío de ${data.sender}` : ""} · con flota
              eléctrica 🌱
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
