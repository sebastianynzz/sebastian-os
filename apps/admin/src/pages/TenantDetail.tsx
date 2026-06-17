import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  VEHICLE_TYPES,
  VEHICLE_TYPE_PROFILES,
  formatShortBogota,
  type VehicleType,
} from "@moveos/shared";
import { api } from "../api";
import { TrendChart } from "../components/charts";
import { Button, Card, PlanBadge, StatusBadge, Toggle, inputClass } from "../components/ui";

interface TenantDetailData {
  id: string;
  name: string;
  city: string;
  nit: string | null;
  status: string;
  plan: string;
  operatorType: string;
  businessModel: string;
  counts: { users: number; drivers: number; vehicles: number; orders: number; routes: number; clients: number };
  modules: { key: string; nombre: string; enabled: boolean; core?: boolean }[];
}

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  manageable: boolean;
}

interface AuditEntry {
  id: string;
  adminEmail: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

interface DayPoint {
  date: string;
  ordersCreated: number;
  ordersDelivered: number;
}

const BUSINESS_MODEL_LABEL: Record<string, string> = {
  SAAS: "SaaS autoservicio",
  FAAS: "FaaS (flota de MOVE)",
  LOGISTICS_3PL: "Logística 3PL",
};

const ACTION_LABEL: Record<string, string> = {
  TENANT_PROVISION: "Tenant aprovisionado",
  TENANT_UPDATE: "Tenant actualizado",
  MODULE_TOGGLE: "Módulo cambiado",
  VEHICLE_ASSIGN: "Vehículo asignado",
  USER_CREATE: "Usuario creado",
  USER_UPDATE: "Usuario actualizado",
  USER_RESET_PASSWORD: "Contraseña reseteada",
  USER_DELETE: "Usuario eliminado",
};

export default function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<TenantDetailData | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [serie, setSerie] = useState<DayPoint[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const [tenant, staff, ts, log] = await Promise.all([
      api<TenantDetailData>("GET", `/tenants/${id}`),
      api<TenantUser[]>("GET", `/tenants/${id}/users`),
      api<{ days: DayPoint[] }>("GET", `/metrics/timeseries?tenantId=${id}`),
      api<{ entries: AuditEntry[] }>("GET", `/audit?tenantId=${id}&take=10`),
    ]);
    setT(tenant);
    setUsers(staff);
    setSerie(ts.days);
    setAudit(log.entries);
  }
  useEffect(() => {
    void load().catch((err) =>
      setNotice(err instanceof Error ? err.message : "Error"),
    );
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

  /**
   * Consola de soporte (A4): token de tenant de 30 min, auditado en
   * PlatformAuditLog. Abre el dashboard del tenant en otra pestaña.
   */
  async function impersonate() {
    setNotice(null);
    try {
      const res = await api<{ token: string; webUrl: string | null; user: { email: string } }>(
        "POST",
        `/tenants/${id}/impersonate`,
        {},
      );
      // Fragmento (#), no query: el token jamás viaja al servidor estático
      // ni queda en logs de acceso/proxies.
      const base = res.webUrl ?? "http://localhost:5173";
      window.open(
        `${base.replace(/\/$/, "")}/#impersonar=${encodeURIComponent(res.token)}`,
        "_blank",
        "noopener",
      );
      setNotice(`Sesión de soporte abierta como ${res.user.email} (30 min, auditada).`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error");
    }
  }

  /** Editar los datos de la empresa (todo editable desde el panel). */
  async function saveCompany(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice(null);
    const data = new FormData(e.currentTarget);
    try {
      await api("PATCH", `/tenants/${id}`, {
        name: data.get("name"),
        nit: data.get("nit") || "",
        city: data.get("city"),
        operatorType: data.get("operatorType"),
        businessModel: data.get("businessModel"),
      });
      setNotice("Empresa actualizada.");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error");
    }
  }

  async function createUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice(null);
    const data = new FormData(e.currentTarget);
    try {
      await api("POST", `/tenants/${id}/users`, {
        name: data.get("userName"),
        email: data.get("userEmail"),
        role: data.get("userRole"),
        password: data.get("userPassword"),
      });
      setNotice("Usuario creado.");
      (e.target as HTMLFormElement).reset?.();
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error");
    }
  }

  async function setUserRole(userId: string, role: string) {
    setNotice(null);
    try {
      await api("PATCH", `/tenants/${id}/users/${userId}`, { role });
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error");
    }
  }

  async function resetPassword(user: TenantUser) {
    const newPassword = prompt(`Nueva contraseña para ${user.email} (mín. 8):`);
    if (!newPassword) return;
    setNotice(null);
    try {
      await api("PATCH", `/tenants/${id}/users/${user.id}`, { newPassword });
      setNotice(`Contraseña de ${user.email} actualizada.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error");
    }
  }

  async function deleteUser(user: TenantUser) {
    if (!confirm(`¿Eliminar a ${user.email}? Perderá el acceso.`)) return;
    setNotice(null);
    try {
      await api("DELETE", `/tenants/${id}/users/${user.id}`);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error");
    }
  }

  const [vehicleNotice, setVehicleNotice] = useState<string | null>(null);
  // Asignación FaaS dirigida por el catálogo de 6 configuraciones EV: la
  // configuración define payload, batería y autonomía; toda la flota MOVE es
  // eléctrica (restricción dura 1), así que no hay opción de no-eléctrico.
  const [vType, setVType] = useState<VehicleType>(VEHICLE_TYPES[0]);
  const [vBatteryKwh, setVBatteryKwh] = useState<number>(
    () => VEHICLE_TYPE_PROFILES[VEHICLE_TYPES[0]].batteryOptions[0]!.batteryKwh,
  );
  const vProfile = VEHICLE_TYPE_PROFILES[vType];
  const vBattery =
    vProfile.batteryOptions.find((o) => o.batteryKwh === vBatteryKwh) ??
    vProfile.batteryOptions[0]!;
  function onVTypeChange(next: VehicleType) {
    setVType(next);
    setVBatteryKwh(VEHICLE_TYPE_PROFILES[next].batteryOptions[0]!.batteryKwh);
  }

  /** Asignar un vehículo de MOVE al tenant (fleet-as-a-service). */
  async function assignVehicle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setVehicleNotice(null);
    const data = new FormData(e.currentTarget);
    try {
      const v = await api<{ plate: string }>("POST", `/tenants/${id}/vehicles`, {
        plate: data.get("plate"),
        type: vType,
        capacityKg: vProfile.payloadKg,
        isElectric: true, // EV-only (restricción dura 1): nunca ICE
        batteryKwh: vBattery.batteryKwh,
        nominalRangeKm: vBattery.rangeKm,
        ownerTenantId: data.get("ownerTenantId") || undefined,
      });
      setVehicleNotice(`Vehículo ${v.plate} asignado.`);
      (e.target as HTMLFormElement).reset?.();
      onVTypeChange(VEHICLE_TYPES[0]);
      await load();
    } catch (err) {
      setVehicleNotice(err instanceof Error ? err.message : "Error");
    }
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
            {t.city} {t.nit && `· NIT ${t.nit}`} ·{" "}
            {BUSINESS_MODEL_LABEL[t.businessModel] ?? t.businessModel}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={t.status} />
          {t.status === "ACTIVE" && (
            <Button disabled={busy} onClick={() => void impersonate()}>
              Entrar como tenant
            </Button>
          )}
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

      {notice && <p className="text-sm font-medium text-lima">{notice}</p>}

      <div className="grid grid-cols-3 gap-4">
        <Card title="Editar empresa">
          <form onSubmit={saveCompany} className="space-y-2">
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Nombre</span>
              <input name="name" className={inputClass} defaultValue={t.name} required minLength={2} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">NIT</span>
              <input name="nit" className={inputClass} defaultValue={t.nit ?? ""} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Ciudad</span>
              <input name="city" className={inputClass} defaultValue={t.city} required minLength={2} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Tipo de operador</span>
              <select name="operatorType" className={inputClass} defaultValue={t.operatorType}>
                <option value="SELF_SERVE">Autoservicio</option>
                <option value="SUB_OPERATOR">Sub-operador (FaaS)</option>
                <option value="PLATFORM_FLEET">Flota MOVE</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Modelo de negocio</span>
              <select name="businessModel" className={inputClass} defaultValue={t.businessModel}>
                <option value="SAAS">SaaS autoservicio</option>
                <option value="FAAS">FaaS (flota de MOVE)</option>
                <option value="LOGISTICS_3PL">Logística 3PL</option>
              </select>
            </label>
            <Button type="submit">Guardar</Button>
          </form>
        </Card>

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
      </div>

      <Card title="Actividad (30 días)">
        {serie === null ? (
          <p className="text-sm text-white/30">Cargando…</p>
        ) : (
          <TrendChart
            days={serie.map((d) => d.date)}
            series={[
              { label: "Entregados", values: serie.map((d) => d.ordersDelivered) },
              { label: "Creados", values: serie.map((d) => d.ordersCreated) },
            ]}
          />
        )}
      </Card>

      <Card title="Usuarios del equipo">
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase text-cielo/60">
              <th className="py-2">Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-white/5">
                <td className="py-2">{u.name}</td>
                <td className="text-cielo">{u.email}</td>
                <td>
                  {u.manageable ? (
                    <select
                      className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs"
                      value={u.role}
                      onChange={(e) => void setUserRole(u.id, e.target.value)}
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="DISPATCHER">DISPATCHER</option>
                    </select>
                  ) : (
                    <span className="text-xs text-white/40">{u.role}</span>
                  )}
                </td>
                <td className="space-x-3 whitespace-nowrap text-right text-xs">
                  {u.manageable && (
                    <>
                      <button
                        onClick={() => void resetPassword(u)}
                        className="text-cielo hover:underline"
                      >
                        Resetear clave
                      </button>
                      <button
                        onClick={() => void deleteUser(u)}
                        className="text-red-400 hover:underline"
                      >
                        Eliminar
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-white/30">
                  Sin usuarios.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mb-2 text-xs text-white/30">
          Aquí se gestiona el staff (ADMIN/DISPATCHER). Conductores y usuarios
          del portal se gestionan desde el dashboard del tenant.
        </p>
        <form onSubmit={createUser} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <input name="userName" className={inputClass} placeholder="Nombre" required minLength={2} />
          <input name="userEmail" type="email" className={inputClass} placeholder="Correo" required />
          <select name="userRole" className={inputClass} defaultValue="DISPATCHER">
            <option value="ADMIN">ADMIN</option>
            <option value="DISPATCHER">DISPATCHER</option>
          </select>
          <input
            name="userPassword"
            type="password"
            className={inputClass}
            placeholder="Contraseña inicial"
            required
            minLength={8}
          />
          <Button type="submit">Crear usuario</Button>
        </form>
      </Card>

      <Card title="Módulos activos (override de plataforma)">
        <div className="grid grid-cols-2 gap-3">
          {t.modules.map((m) => (
            <div
              key={m.key}
              className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2"
            >
              <span className="text-sm">{m.nombre}</span>
              {m.core ? (
                <span className="rounded-full bg-lima/30 px-2 py-0.5 text-xs font-bold">
                  Núcleo
                </span>
              ) : (
                <Toggle on={m.enabled} onClick={() => toggleModule(m.key, !m.enabled)} />
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Asignar vehículo de MOVE (fleet-as-a-service)">
        <p className="mb-3 text-xs text-cielo">
          El vehículo queda operado por esta empresa; la propiedad del activo
          (ownerTenantId) se conserva para la vista de Flota en sitio.
        </p>
        {vehicleNotice && <p className="mb-2 text-sm text-lima">{vehicleNotice}</p>}
        <form onSubmit={assignVehicle} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block text-cielo">Placa</span>
            <input name="plate" className={inputClass} required placeholder="ABC12D" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-cielo">Configuración</span>
            <select
              className={inputClass}
              value={vType}
              onChange={(e) => onVTypeChange(e.target.value as VehicleType)}
            >
              {VEHICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {VEHICLE_TYPE_PROFILES[t].labelEs}
                </option>
              ))}
            </select>
          </label>
          {vProfile.batteryOptions.length > 1 ? (
            <label className="block text-sm">
              <span className="mb-1 block text-cielo">Batería</span>
              <select
                className={inputClass}
                value={vBatteryKwh}
                onChange={(e) => setVBatteryKwh(Number(e.target.value))}
              >
                {vProfile.batteryOptions.map((o) => (
                  <option key={o.batteryKwh} value={o.batteryKwh}>
                    {o.batteryKwh} kWh · {o.rangeKm} km
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="block text-sm">
              <span className="mb-1 block text-cielo">Batería</span>
              <p className="py-2 text-white">{vBattery.batteryKwh} kWh</p>
            </div>
          )}
          <label className="block text-sm">
            <span className="mb-1 block text-cielo">Dueño (tenant id, opc.)</span>
            <input name="ownerTenantId" className={inputClass} placeholder="id del tenant MOVE" />
          </label>
          {/* Specs derivadas del catálogo (no editables): el perfil es la verdad. */}
          <p className="col-span-2 self-end text-xs text-cielo sm:col-span-3">
            ⚡ Eléctrico · {vProfile.payloadKg} kg de carga · {vBattery.batteryKwh} kWh ·
            autonomía {vBattery.rangeKm} km
          </p>
          <div className="flex items-end">
            <Button type="submit">Asignar</Button>
          </div>
        </form>
      </Card>

      <Card title="Actividad reciente del panel (auditoría)">
        {audit.length === 0 ? (
          <p className="text-sm text-white/30">Sin actividad registrada.</p>
        ) : (
          <ol className="space-y-1 text-xs">
            {audit.map((a) => (
              <li key={a.id} className="flex items-baseline gap-2">
                <span className="font-mono text-white/30">
                  {formatShortBogota(a.createdAt)}
                </span>
                <span className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</span>
                <span className="text-cielo">{a.adminEmail}</span>
              </li>
            ))}
          </ol>
        )}
        <Link to="/auditoria" className="mt-2 inline-block text-xs text-lima hover:underline">
          Ver toda la auditoría →
        </Link>
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
