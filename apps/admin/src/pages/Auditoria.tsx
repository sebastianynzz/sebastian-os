import { useEffect, useState } from "react";
import { formatStampBogota } from "@moveos/shared";
import { api } from "../api";
import { Button, Card, inputClass } from "../components/ui";

/**
 * Bitácora del plano de plataforma: quién cambió qué y sobre qué tenant.
 * Todas las mutaciones del panel quedan registradas en PlatformAuditLog.
 */

interface AuditEntry {
  id: string;
  adminEmail: string;
  action: string;
  targetTenantId: string | null;
  targetUserId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

interface TenantOption {
  id: string;
  name: string;
}

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

export default function Auditoria() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [tenantId, setTenantId] = useState<string>("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  async function load(cursor?: string) {
    const params = new URLSearchParams({ take: "50" });
    if (tenantId) params.set("tenantId", tenantId);
    if (cursor) params.set("cursor", cursor);
    const res = await api<{ entries: AuditEntry[]; nextCursor: string | null }>(
      "GET",
      `/audit?${params.toString()}`,
    );
    setEntries((prev) => (cursor ? [...prev, ...res.entries] : res.entries));
    setNextCursor(res.nextCursor);
  }

  useEffect(() => {
    void api<TenantOption[]>("GET", "/tenants").then((list) =>
      setTenants(list.map((t) => ({ id: t.id, name: t.name }))),
    );
  }, []);
  useEffect(() => {
    void load();
  }, [tenantId]);

  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Auditoría</h1>
        <select
          className={`${inputClass} max-w-xs`}
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          aria-label="Filtrar por tenant"
        >
          <option value="">Todos los tenants</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase text-cielo/60">
              <th className="py-2">Fecha</th>
              <th>Acción</th>
              <th>Operador</th>
              <th>Tenant</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((a) => (
              <tr key={a.id} className="border-b border-white/5 align-top">
                <td className="whitespace-nowrap py-2 font-mono text-xs text-white/40">
                  {formatStampBogota(a.createdAt)}
                </td>
                <td className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</td>
                <td className="text-cielo">{a.adminEmail}</td>
                <td className="text-cielo">
                  {a.targetTenantId
                    ? (tenantName.get(a.targetTenantId) ?? a.targetTenantId)
                    : "—"}
                </td>
                <td className="max-w-md break-all font-mono text-[11px] text-white/40">
                  {JSON.stringify(a.details)}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-white/30">
                  Sin actividad registrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {nextCursor && (
          <div className="mt-3 flex justify-center">
            <Button variant="secondary" onClick={() => void load(nextCursor)}>
              Cargar más
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
