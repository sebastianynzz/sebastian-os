import { useEffect, useState } from "react";
import {
  discardAction,
  flushQueue,
  getQueue,
  retryAction,
  type QueuedAction,
} from "../api";

/**
 * Panel de la cola offline (Part 1 — integridad offline). Muestra el estado por
 * acción (en cola / reintentando con backoff / error del servidor), drena la
 * cola periódicamente y al volver la señal, y permite reintentar o descartar
 * manualmente las acciones que el servidor rechazó (4xx/conflicto). Se oculta
 * cuando no hay nada pendiente.
 */
/** Etiqueta legible: usa la del encolado o la deduce de la ruta. */
function displayLabel(a: QueuedAction): string {
  if (a.label && a.label !== a.path) return a.label;
  if (a.path.endsWith("/complete")) return "Entrega";
  if (a.path.endsWith("/fail")) return "Falla de entrega";
  if (a.path.endsWith("/arrive")) return "Llegada a la parada";
  if (a.path.endsWith("/scan")) return "Escaneo de paquete";
  if (a.path.endsWith("/driver-fix")) return "Corrección de ubicación";
  if (a.path.endsWith("/panic")) return "Botón de pánico (SOS)";
  return a.path;
}

export function OfflineQueue() {
  const [items, setItems] = useState<QueuedAction[]>([]);
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  const refresh = () => setItems(getQueue());

  useEffect(() => {
    refresh();
    const tick = async () => {
      if (navigator.onLine) await flushQueue();
      refresh();
    };
    const setOn = () => setOnline(navigator.onLine);
    const onOnline = () => {
      setOn();
      void tick();
    };
    const id = window.setInterval(tick, 15_000); // empuja los backoff
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", setOn);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", setOn);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  if (items.length === 0) return null;

  const errors = items.filter((i) => i.status === "ERROR").length;
  const pending = items.length - errors;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 m-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-white shadow-lg ${
          errors > 0 ? "bg-danger" : "bg-navy"
        }`}
      >
        {errors > 0 ? `⚠️ ${errors} acción(es) con error` : `↻ ${pending} acción(es) en cola`}
        {!online && " · sin conexión"}
        <span className="float-right opacity-70">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <ul className="mt-1 max-h-64 space-y-1 overflow-y-auto rounded-xl bg-white p-2 shadow-lg">
          {items.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-2 py-1.5 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium text-text-secondary">{displayLabel(i)}</div>
                <div className={i.status === "ERROR" ? "text-danger" : "text-text-tertiary"}>
                  {i.status === "ERROR"
                    ? `Error: ${i.lastError ?? "rechazada por el servidor"}`
                    : i.attempts > 0
                      ? `Reintentando (intento ${i.attempts})`
                      : "En cola"}
                </div>
              </div>
              {i.status === "ERROR" && (
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => {
                      retryAction(i.id);
                      void flushQueue().then(refresh);
                    }}
                    className="rounded-md bg-navy-900 px-2 py-1 font-semibold text-white"
                  >
                    Reintentar
                  </button>
                  <button
                    onClick={() => {
                      discardAction(i.id);
                      refresh();
                    }}
                    className="rounded-md border border-border px-2 py-1 font-semibold text-text-secondary"
                  >
                    Descartar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
