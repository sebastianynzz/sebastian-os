import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Card } from "../components/ui";

interface ModuleInfo {
  key: string;
  nombre: string;
  descripcion: string;
  enabled: boolean;
}

/**
 * La pantalla insignia del producto: módulos que se activan y desactivan
 * como interruptores. El menú lateral y las APIs reaccionan al instante.
 */
export default function Modulos() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { refresh, session } = useAuth();
  const isAdmin = session?.user.role === "ADMIN";

  async function load() {
    setModules(await api<ModuleInfo[]>("GET", "/modules"));
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
      <h1 className="text-xl font-bold">Módulos de la plataforma</h1>
      <p className="text-sm text-slate-500">
        Active solo lo que su operación necesita. Cada módulo se factura por
        separado; el núcleo (pedidos, despacho, app conductor, tracking, POD y
        notificaciones) siempre está incluido.
      </p>
      {!isAdmin && (
        <p className="text-sm text-amber-600">
          Solo el rol ADMIN puede cambiar módulos.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-4">
        {modules.map((m) => (
          <Card key={m.key}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">{m.nombre}</h3>
                <p className="mt-1 text-sm text-slate-500">{m.descripcion}</p>
              </div>
              <button
                role="switch"
                aria-checked={m.enabled}
                disabled={!isAdmin}
                onClick={() => toggle(m.key, !m.enabled)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${
                  m.enabled ? "bg-indigo-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                    m.enabled ? "left-5.5" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
