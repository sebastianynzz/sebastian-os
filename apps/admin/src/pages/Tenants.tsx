import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  MODULE_CATALOG,
  MODULE_PRESETS_BY_BUSINESS_MODEL,
  type ModuleKey,
  type TenantBusinessModel,
} from "@moveos/shared";
import { api } from "../api";
import { Card, PlanBadge, StatusBadge } from "../components/ui";

interface TenantRow {
  id: string;
  name: string;
  city: string;
  status: string;
  plan: string;
  operatorType: string;
  businessModel: string;
  counts: { users: number; drivers: number; vehicles: number; orders: number; clients: number };
  ordersLast30d: number;
}

const OPERATOR_LABEL: Record<string, string> = {
  SELF_SERVE: "Autoservicio",
  SUB_OPERATOR: "Cliente FaaS",
  PLATFORM_FLEET: "Flota MOVE",
};

const BUSINESS_MODEL_LABEL: Record<string, string> = {
  SAAS: "SaaS",
  FAAS: "FaaS",
  LOGISTICS_3PL: "3PL",
};

const inputClass =
  "w-full rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-niebla placeholder:text-white/30 focus:border-lima focus:outline-none";

/** Módulos iniciales para un modelo de negocio: defaults + preset comercial. */
function presetModules(model: TenantBusinessModel): Set<ModuleKey> {
  const keys = new Set<ModuleKey>(
    MODULE_CATALOG.filter((m) => m.defaultEnabled).map((m) => m.key),
  );
  for (const key of MODULE_PRESETS_BY_BUSINESS_MODEL[model]) keys.add(key);
  return keys;
}

interface WizardData {
  name: string;
  nit: string;
  city: string;
  plan: string;
  businessModel: TenantBusinessModel;
  modules: Set<ModuleKey>;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

const WIZARD_STEPS = ["Empresa", "Módulos", "Acceso y resumen"] as const;

/**
 * Asistente de onboarding (A3): aprovisionar un tenant deja de ser un
 * formulario ad-hoc — empresa y oferta → preset de módulos ajustable →
 * usuario administrador con resumen. Repetible para cada logo nuevo.
 */
function OnboardingWizard({
  onDone,
  onCancel,
}: {
  onDone: (adminEmail: string) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<WizardData>({
    name: "",
    nit: "",
    city: "Bogotá",
    plan: "PRO",
    businessModel: "FAAS",
    modules: presetModules("FAAS"),
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  });

  function set<K extends keyof WizardData>(key: K, value: WizardData[K]) {
    setData((d) => ({ ...d, [key]: value }));
  }

  const step1Valid = data.name.trim().length >= 2;
  const step3Valid =
    data.adminName.trim().length >= 2 &&
    /.+@.+\..+/.test(data.adminEmail) &&
    data.adminPassword.length >= 8;

  async function provision() {
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ admin: { email: string } }>("POST", "/tenants", {
        name: data.name.trim(),
        nit: data.nit.trim() || undefined,
        city: data.city.trim() || "Bogotá",
        plan: data.plan,
        operatorType: "SUB_OPERATOR",
        businessModel: data.businessModel,
        modules: [...data.modules],
        adminName: data.adminName.trim(),
        adminEmail: data.adminEmail.trim(),
        adminPassword: data.adminPassword,
      });
      onDone(res.admin.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Asistente de onboarding — nuevo tenant">
      {/* Indicador de pasos */}
      <div className="mb-4 flex items-center gap-2">
        {WIZARD_STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                i === step
                  ? "bg-lima text-navy"
                  : i < step
                    ? "bg-lima/40 text-navy"
                    : "bg-white/10 text-cielo"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span className={`text-xs ${i === step ? "text-niebla" : "text-cielo/60"}`}>
              {label}
            </span>
            {i < WIZARD_STEPS.length - 1 && <span className="text-white/20">—</span>}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-cielo">Empresa</span>
            <input
              className={inputClass}
              value={data.name}
              onChange={(e) => set("name", e.target.value)}
              autoFocus
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-cielo">NIT (opcional)</span>
            <input
              className={inputClass}
              value={data.nit}
              onChange={(e) => set("nit", e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-cielo">Ciudad</span>
            <input
              className={inputClass}
              value={data.city}
              onChange={(e) => set("city", e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-cielo">Plan</span>
            <select
              className={inputClass}
              value={data.plan}
              onChange={(e) => set("plan", e.target.value)}
            >
              <option value="FREE">FREE</option>
              <option value="PRO">PRO</option>
              <option value="ENTERPRISE">ENTERPRISE</option>
            </select>
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-cielo">Modelo de negocio</span>
            <select
              className={inputClass}
              value={data.businessModel}
              onChange={(e) => {
                const model = e.target.value as TenantBusinessModel;
                // Cambiar la oferta re-inicializa el preset del paso 2.
                setData((d) => ({
                  ...d,
                  businessModel: model,
                  modules: presetModules(model),
                }));
              }}
            >
              <option value="FAAS">FaaS (flota de MOVE en sitio)</option>
              <option value="LOGISTICS_3PL">Logística 3PL</option>
              <option value="SAAS">SaaS autoservicio</option>
            </select>
            <span className="mt-1 block text-xs text-white/30">
              Define el preset de módulos del siguiente paso; allí se ajusta.
            </span>
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MODULE_CATALOG.map((m) => {
            const checked = m.core === true || data.modules.has(m.key);
            return (
              <label
                key={m.key}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                  m.core
                    ? "border-lima/40 bg-lima/5"
                    : "cursor-pointer border-white/10 hover:bg-white/5"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  disabled={m.core === true}
                  onChange={(e) => {
                    const next = new Set(data.modules);
                    if (e.target.checked) next.add(m.key);
                    else next.delete(m.key);
                    set("modules", next);
                  }}
                />
                <span>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {m.nombre}
                    {m.core && (
                      <span className="rounded-full bg-lima/30 px-2 py-0.5 text-[10px] font-bold">
                        Núcleo
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-cielo/70">
                    {m.descripcion}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Nombre del administrador</span>
              <input
                className={inputClass}
                value={data.adminName}
                onChange={(e) => set("adminName", e.target.value)}
                autoFocus
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Correo</span>
              <input
                type="email"
                className={inputClass}
                value={data.adminEmail}
                onChange={(e) => set("adminEmail", e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Contraseña inicial</span>
              <input
                type="password"
                className={inputClass}
                value={data.adminPassword}
                onChange={(e) => set("adminPassword", e.target.value)}
              />
              <span className="mt-1 block text-xs text-white/30">Mínimo 8 caracteres</span>
            </label>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
            <div className="mb-1 font-semibold">Resumen</div>
            <div className="text-cielo">
              {data.name} · {data.city} · {BUSINESS_MODEL_LABEL[data.businessModel]} ·{" "}
              plan {data.plan}
            </div>
            <div className="mt-1 text-xs text-cielo/70">
              Módulos:{" "}
              {MODULE_CATALOG.filter(
                (m) => m.core === true || data.modules.has(m.key),
              )
                .map((m) => m.nombre)
                .join(", ")}
            </div>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <button onClick={onCancel} className="text-sm text-cielo hover:underline">
          Cancelar
        </button>
        <div className="flex gap-2">
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="rounded-lg border border-white/20 px-4 py-1.5 text-sm font-semibold text-niebla"
            >
              ← Atrás
            </button>
          )}
          {step < 2 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 0 && !step1Valid}
              className="rounded-lg bg-lima px-4 py-1.5 text-sm font-semibold text-navy hover:brightness-95 disabled:opacity-50"
            >
              Siguiente →
            </button>
          ) : (
            <button
              onClick={() => void provision()}
              disabled={!step3Valid || busy}
              className="rounded-lg bg-lima px-4 py-1.5 text-sm font-semibold text-navy hover:brightness-95 disabled:opacity-50"
            >
              {busy ? "Creando…" : "Crear tenant"}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function Tenants() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setTenants(await api<TenantRow[]>("GET", "/tenants"));
  }
  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Tenants</h1>
        <button
          onClick={() => setShowWizard((v) => !v)}
          className="rounded-lg bg-lima px-3 py-1.5 text-sm font-semibold text-navy hover:brightness-95"
        >
          {showWizard ? "Cancelar" : "Nuevo tenant"}
        </button>
      </div>
      {notice && <p className="text-sm font-medium text-lima">✓ {notice}</p>}

      {showWizard && (
        <OnboardingWizard
          onCancel={() => setShowWizard(false)}
          onDone={(adminEmail) => {
            setNotice(`Tenant aprovisionado. Acceso: ${adminEmail}`);
            setShowWizard(false);
            void load();
          }}
        />
      )}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase text-cielo/60">
              <th className="py-2">Empresa</th>
              <th>Tipo</th>
              <th>Modelo</th>
              <th>Ciudad</th>
              <th>Plan</th>
              <th>Estado</th>
              <th>Usuarios</th>
              <th>Conductores</th>
              <th>Pedidos (30d)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b border-white/5">
                <td className="py-2 font-medium">{t.name}</td>
                <td>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      t.operatorType === "SUB_OPERATOR"
                        ? "bg-lima/30 text-lima"
                        : "bg-cielo/20 text-cielo"
                    }`}
                  >
                    {OPERATOR_LABEL[t.operatorType] ?? t.operatorType}
                  </span>
                </td>
                <td>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-cielo">
                    {BUSINESS_MODEL_LABEL[t.businessModel] ?? t.businessModel}
                  </span>
                </td>
                <td className="text-cielo">{t.city}</td>
                <td><PlanBadge plan={t.plan} /></td>
                <td><StatusBadge status={t.status} /></td>
                <td>{t.counts.users}</td>
                <td>{t.counts.drivers}</td>
                <td>{t.ordersLast30d}</td>
                <td className="text-right">
                  <Link to={`/tenants/${t.id}`} className="text-lima hover:underline">
                    Gestionar →
                  </Link>
                </td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-white/30">
                  Sin tenants.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
