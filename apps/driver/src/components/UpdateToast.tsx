import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { applyUpdate, onUpdateAvailable } from "../sw";

/**
 * Aviso de actualización del PWA (Part 1 — shell "se ve igual"). Cuando hay un
 * release nuevo en espera, muestra "nueva versión disponible — recargar". Al
 * confirmar, activa el service worker en espera y la app se recarga una sola
 * vez: el conductor decide cuándo, sin que un deploy lo interrumpa a mitad de
 * entrega.
 */
export function UpdateToast() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    onUpdateAvailable(() => setShow(true));
  }, []);

  if (!show) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-sky/18 bg-navy-900 px-4 py-2.5 text-sm text-niebla shadow-lg"
    >
      <span className="flex items-center gap-2">
        <Download size={15} strokeWidth={2} aria-hidden className="shrink-0 text-lima" />
        Nueva versión disponible.
      </span>
      <button
        onClick={() => applyUpdate()}
        className="min-h-11 shrink-0 rounded-lg bg-lima px-3.5 font-bold text-navy-900"
      >
        Recargar
      </button>
    </div>
  );
}
