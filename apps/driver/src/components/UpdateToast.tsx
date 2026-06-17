import { useEffect, useState } from "react";
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
      className="fixed inset-x-0 bottom-0 z-50 m-3 flex items-center justify-between gap-3 rounded-xl bg-navy-900 px-4 py-3 text-sm text-white shadow-lg"
    >
      <span>Nueva versión disponible.</span>
      <button
        onClick={() => applyUpdate()}
        className="shrink-0 rounded-lg bg-success px-3 py-1.5 font-semibold text-white"
      >
        Recargar
      </button>
    </div>
  );
}
