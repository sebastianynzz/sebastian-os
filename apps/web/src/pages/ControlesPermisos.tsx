import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import {
  NAV_APPS,
  NAV_APP_LABELS,
  driverPermissionPolicySchema,
  type DriverPermissionPolicyInput,
  type NavApp,
} from "@moveos/shared";
import { api } from "../api";
import { useToast } from "../toast";
import {
  Banner,
  Button,
  Card,
  Field,
  Loading,
  PageHeader,
  inputClass,
} from "../components/ui";

/**
 * Controles › Permisos de conductor (Tier 2 §10): app de navegación preferida
 * para los deeplinks y qué puede hacer el conductor con las rutas (editar las
 * del despachador, crear rutas ad-hoc, editar rutas ya iniciadas). La app del
 * conductor lee esta política. Solo ADMIN (el API lo exige).
 */

type FormState = DriverPermissionPolicyInput;

const EMPTY: FormState = {
  navApp: "INTERNAL_GMAPS",
  allowEditDispatcherRoutes: false,
  allowCreateRoutes: false,
  allowEditStartedRoutes: false,
};

export default function ControlesPermisos() {
  const toast = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      const policy = await api<FormState>("GET", "/controls/driver-permissions");
      setForm({
        navApp: policy.navApp,
        allowEditDispatcherRoutes: policy.allowEditDispatcherRoutes,
        allowCreateRoutes: policy.allowCreateRoutes,
        allowEditStartedRoutes: policy.allowEditStartedRoutes,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los permisos.");
      setForm(EMPTY);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!form) return;
    const parsed = driverPermissionPolicySchema.safeParse(form);
    if (!parsed.success) {
      toast.error(new Error(parsed.error.issues[0]?.message ?? "Datos inválidos"));
      return;
    }
    setSaving(true);
    try {
      await api("PATCH", "/controls/driver-permissions", parsed.data);
      toast.success("Permisos de conductor actualizados.");
    } catch (err) {
      toast.error(err, { retry: () => void save() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Permisos de conductor"
        subtitle="Define la app de navegación que usa la app del conductor y qué puede hacer con las rutas. Por defecto la app está bloqueada: el conductor solo ejecuta la ruta que le asigna el despachador."
      />

      {error && (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      )}

      {form === null ? (
        <Card>
          <Loading label="Cargando permisos…" />
        </Card>
      ) : (
        <Card title="Configuración">
          <div className="grid grid-cols-1 gap-5">
            <Field label="App de navegación (deeplinks de la app del conductor)">
              <select
                className={inputClass}
                value={form.navApp}
                onChange={(e) =>
                  setForm((f) => f && { ...f, navApp: e.target.value as NavApp })
                }
              >
                {NAV_APPS.map((n) => (
                  <option key={n} value={n}>
                    {NAV_APP_LABELS[n]}
                  </option>
                ))}
              </select>
            </Field>

            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                Qué puede hacer el conductor con las rutas
              </div>
              <label className="flex items-start gap-2 text-sm text-asfalto/80">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-asfalto"
                  checked={form.allowEditDispatcherRoutes}
                  onChange={(e) =>
                    setForm((f) => f && { ...f, allowEditDispatcherRoutes: e.target.checked })
                  }
                />
                <span>
                  Editar rutas del despachador
                  <span className="block text-xs text-text-tertiary">
                    Permite ajustar la ruta que le asignó el despachador.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-asfalto/80">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-asfalto"
                  checked={form.allowCreateRoutes}
                  onChange={(e) =>
                    setForm((f) => f && { ...f, allowCreateRoutes: e.target.checked })
                  }
                />
                <span>
                  Crear rutas ad-hoc
                  <span className="block text-xs text-text-tertiary">
                    Desbloquea que el conductor arme su propia ruta para trabajo no planificado.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-asfalto/80">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-asfalto"
                  checked={form.allowEditStartedRoutes}
                  onChange={(e) =>
                    setForm((f) => f && { ...f, allowEditStartedRoutes: e.target.checked })
                  }
                />
                <span>
                  Editar rutas ya iniciadas
                  <span className="block text-xs text-text-tertiary">
                    Permite cambios después de que la ruta arrancó.
                  </span>
                </span>
              </label>
            </div>

            <div>
              <Button
                variant="cta"
                icon={<Save strokeWidth={2} />}
                onClick={save}
                disabled={saving}
              >
                {saving ? "Guardando…" : "Guardar permisos"}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
