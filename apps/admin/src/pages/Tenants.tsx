import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Card, PlanBadge, StatusBadge } from "../components/ui";

interface TenantRow {
  id: string;
  name: string;
  city: string;
  status: string;
  plan: string;
  operatorType: string;
  counts: { users: number; drivers: number; vehicles: number; orders: number; clients: number };
  ordersLast30d: number;
}

const OPERATOR_LABEL: Record<string, string> = {
  SELF_SERVE: "Autoservicio",
  SUB_OPERATOR: "Cliente FaaS",
  PLATFORM_FLEET: "Flota MOVE",
};

const inputClass =
  "w-full rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-niebla placeholder:text-white/30 focus:border-lima focus:outline-none";

export default function Tenants() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setTenants(await api<TenantRow[]>("GET", "/tenants"));
  }
  useEffect(() => {
    void load();
  }, []);

  /** Aprovisionar un cliente FaaS: tenant SUB_OPERATOR + su administrador. */
  async function onProvision(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const data = new FormData(e.currentTarget);
    try {
      const res = await api<{ admin: { email: string } }>("POST", "/tenants", {
        name: data.get("name"),
        nit: data.get("nit") || undefined,
        city: data.get("city") || "Bogotá",
        plan: data.get("plan"),
        operatorType: "SUB_OPERATOR",
        adminName: data.get("adminName"),
        adminEmail: data.get("adminEmail"),
        adminPassword: data.get("adminPassword"),
      });
      setNotice(`Cliente aprovisionado. Acceso: ${res.admin.email}`);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Tenants</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-lima px-3 py-1.5 text-sm font-semibold text-navy hover:brightness-95"
        >
          {showForm ? "Cancelar" : "Aprovisionar cliente FaaS"}
        </button>
      </div>
      {notice && <p className="text-sm font-medium text-lima">✓ {notice}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {showForm && (
        <Card title="Nuevo cliente con vehículos en sitio (sub-operador)">
          <form onSubmit={onProvision} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Empresa</span>
              <input name="name" className={inputClass} required />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">NIT (opcional)</span>
              <input name="nit" className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Ciudad</span>
              <input name="city" className={inputClass} defaultValue="Bogotá" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Plan</span>
              <select name="plan" className={inputClass} defaultValue="PRO">
                <option value="FREE">FREE</option>
                <option value="PRO">PRO</option>
                <option value="ENTERPRISE">ENTERPRISE</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Nombre del administrador</span>
              <input name="adminName" className={inputClass} required />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Correo del administrador</span>
              <input name="adminEmail" type="email" className={inputClass} required />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Contraseña inicial</span>
              <input name="adminPassword" type="password" minLength={8} className={inputClass} required />
            </label>
            <div className="flex items-end">
              <button className="rounded-lg bg-lima px-4 py-2 text-sm font-semibold text-navy hover:brightness-95">
                Crear tenant
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase text-cielo/60">
              <th className="py-2">Empresa</th>
              <th>Tipo</th>
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
                <td colSpan={9} className="py-8 text-center text-white/30">
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
