import { useEffect, useState } from "react";
import { moduleDependencyHints, type ModuleKey } from "@moveos/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Banner, Card, Loading, PageHeader } from "../components/ui";

interface ModuleInfo {
  key: string;
  nombre: string;
  descripcion: string;
  enabled: boolean;
  /** Módulo de núcleo (p. ej. flota eléctrica): siempre activo, no togglable. */
  core?: boolean;
}

/**
 * La pantalla insignia del producto: módulos que se activan y desactivan
 * como interruptores. El menú lateral y las APIs reaccionan al instante.
 */
export default function Modulos() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const { refresh, session } = useAuth();
  const isAdmin = session?.user.role === "ADMIN";

  async function load() {
    try {
      setModules(await api<ModuleInfo[]>("GET", "/modules"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function toggle(key: string, enabled: boolean) {
    try {
      await api("PATCH", `/modules/${key}`, { enabled });
      await load();
      await refresh(); // el menú lateral se actualiza
    } catch (err) {
      // El fallo típico es el bloqueo por dependencia (409): el toast lo
      // explica. No reintentamos — reactivar el switch es trivial.
      toast.error(err);
    }
  }

  // Conjunto habilitado para las pistas de dependencia: igual que el backend,
  // incluye el núcleo (siempre activo) para que "Necesario para" sea fiel al 409.
  const enabledKeys = modules
    .filter((m) => m.enabled)
    .map((m) => m.key as ModuleKey);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Módulos de la plataforma"
        subtitle="Active solo lo que su operación necesita. Cada módulo se factura por
          separado; el núcleo (pedidos, despacho, app conductor, tracking, POD y
          notificaciones) siempre está incluido."
      />
      {!isAdmin && (
        <Banner kind="info">Solo el rol ADMIN puede cambiar módulos.</Banner>
      )}
      {loading && <Loading label="Cargando módulos…" />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {modules.map((m) => {
          const hints = moduleDependencyHints(m.key as ModuleKey, enabledKeys);
          return (
          <Card key={m.key}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">{m.nombre}</h3>
                <p className="mt-1 text-sm text-navy/60">{m.descripcion}</p>
                {(hints.requires.length > 0 || hints.requiredBy.length > 0) && (
                  <div className="mt-2 space-y-0.5 text-xs text-navy/50">
                    {hints.requires.length > 0 && (
                      <p>
                        Requiere:{" "}
                        <span className="font-medium text-navy/70">
                          {hints.requires.join(", ")}
                        </span>
                      </p>
                    )}
                    {hints.requiredBy.length > 0 && (
                      <p>
                        Necesario para:{" "}
                        <span className="font-medium text-navy/70">
                          {hints.requiredBy.join(", ")}
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </div>
              {m.core ? (
                <span className="shrink-0 rounded-full bg-lima/30 px-3 py-1 text-xs font-bold text-navy">
                  Núcleo
                </span>
              ) : (
                <button
                  role="switch"
                  aria-checked={m.enabled}
                  aria-label={`${m.enabled ? "Desactivar" : "Activar"} ${m.nombre}`}
                  disabled={!isAdmin}
                  onClick={() => toggle(m.key, !m.enabled)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-40 ${
                    m.enabled ? "bg-lima" : "bg-cielo/60"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                      m.enabled ? "left-5.5" : "left-0.5"
                    }`}
                  />
                </button>
              )}
            </div>
          </Card>
          );
        })}
      </div>
    </div>
  );
}
