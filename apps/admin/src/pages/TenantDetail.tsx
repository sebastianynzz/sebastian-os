import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { Button, Card, PlanBadge, StatusBadge, Toggle, inputClass } from "../components/ui";

interface TenantDetailData {
  id: string;
  name: string;
  city: string;
  nit: string | null;
  status: string;
  plan: string;
  counts: { users: number; drivers: number; vehicles: number; orders: number; routes: number; clients: number };
  modules: { key: string; nombre: string; enabled: boolean }[];
}

export default function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<TenantDetailData | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setT(await api<TenantDetailData>("GET", `/tenants/${id}`));
  }
  useEffect(() => {
    void load();
  }, [id]);

  async function setStatus(status: "ACTIVE" | "SUSPENDED") {
    if (status === "SUSPENDED" && !confirm("¿Suspender esta empresa? No podrá ingresar ni operar.")) {
      return;
    }
    setBusy(true);
    await api("PATCH", `/tenants/${id}`, { status });
    await load();
    setBusy(false);
  }

  async function setPlan(plan: string) {
    await api("PATCH", `/tenants/${id}`, { plan });
    await load();
  }

  async function toggleModule(key: string, enabled: boolean) {
    await api("PATCH", `/tenants/${id}/modules/${key}`, { enabled });
    await load();
  }

  if (!t) return <p className="text-cielo">Cargando…</p>;

  return (
    <div className="space-y-4">
      <Link to="/tenants" className="text-sm text-cielo hover:underline">
        ← Tenants
      </Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{t.name}</h1>
          <p className="text-sm text-cielo">
            {t.city} {t.nit && `· NIT ${t.nit}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={t.status} />
          {t.status === "ACTIVE" ? (
            <Button variant="danger" disabled={busy} onClick={() => setStatus("SUSPENDED")}>
              Suspender
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => setStatus("ACTIVE")}>
              Reactivar
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Uso">
          <dl className="space-y-1 text-sm">
            <Row label="Usuarios" value={t.counts.users} />
            <Row label="Conductores" value={t.counts.drivers} />
            <Row label="Vehículos" value={t.counts.vehicles} />
            <Row label="Negocios cliente" value={t.counts.clients} />
            <Row label="Pedidos" value={t.counts.orders} />
            <Row label="Rutas" value={t.counts.routes} />
          </dl>
        </Card>

        <Card title="Plan comercial">
          <div className="flex items-center gap-2">
            <PlanBadge plan={t.plan} />
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs text-cielo">Cambiar plan</label>
            <select
              className={inputClass}
              value={t.plan}
              onChange={(e) => setPlan(e.target.value)}
            >
              <option value="FREE">FREE</option>
              <option value="PRO">PRO</option>
              <option value="ENTERPRISE">ENTERPRISE</option>
            </select>
            <p className="mt-2 text-xs text-white/30">
              El plan es una etiqueta comercial; los módulos se controlan abajo.
            </p>
          </div>
        </Card>

        <Card title="Estado">
          <p className="text-sm text-cielo">
            {t.status === "ACTIVE"
              ? "La empresa opera con normalidad."
              : "Suspendida: el acceso está bloqueado de inmediato."}
          </p>
        </Card>
      </div>

      <Card title="Módulos activos (override de plataforma)">
        <div className="grid grid-cols-2 gap-3">
          {t.modules.map((m) => (
            <div
              key={m.key}
              className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2"
            >
              <span className="text-sm">{m.nombre}</span>
              <Toggle on={m.enabled} onClick={() => toggleModule(m.key, !m.enabled)} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-cielo/70">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
