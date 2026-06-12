import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
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
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
    try {
      await api("PATCH", `/modules/${key}`, { enabled });
      await load();
      await refresh(); // el menú lateral se actualiza
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

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
      {error && (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {loading && <Loading label="Cargando módulos…" />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {modules.map((m) => (
          <Card key={m.key}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">{m.nombre}</h3>
                <p className="mt-1 text-sm text-navy/60">{m.descripcion}</p>
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
        ))}
      </div>
    </div>
  );
}
