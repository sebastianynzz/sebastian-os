import { useCallback, useEffect, useState } from "react";
import { formatStampBogota } from "@moveos/shared";
import { api, BASE_URL, getToken } from "../api";
import { Button, Card, inputClass } from "../components/ui";

/**
 * Bitácora del plano de plataforma: quién cambió qué y sobre qué tenant.
 * Todas las mutaciones del panel quedan en PlatformAuditLog. Filtrable por
 * acción / operador (búsqueda) / tenant / rango de fechas (Bogotá), con
 * exportación CSV de lo filtrado y paginación por cursor.
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

function todayBogota(): string {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

export default function Auditoria() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [tenantId, setTenantId] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");

  // Búsqueda con debounce: no dispara una consulta por tecla.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 400);
    return () => clearTimeout(t);
  }, [qInput]);

  const params = useCallback(() => {
    const p = new URLSearchParams();
    if (tenantId) p.set("tenantId", tenantId);
    if (action) p.set("action", action);
    if (q) p.set("q", q);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p;
  }, [tenantId, action, q, from, to]);

  const load = useCallback(
    async (cursor?: string) => {
      if (!cursor) setLoading(true);
      setError(false);
      const p = params();
      p.set("take", "50");
      if (cursor) p.set("cursor", cursor);
      try {
        const res = await api<{ entries: AuditEntry[]; nextCursor: string | null }>(
          "GET",
          `/audit?${p.toString()}`,
        );
        setEntries((prev) => (cursor ? [...prev, ...res.entries] : res.entries));
        setNextCursor(res.nextCursor);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [params],
  );

  useEffect(() => {
    void api<TenantOption[]>("GET", "/tenants").then((list) =>
      setTenants(list.map((t) => ({ id: t.id, name: t.name }))),
    );
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    setExporting(true);
    setError(false);
    try {
      const res = await fetch(`${BASE_URL}/platform/audit/export?${params().toString()}`, {
        headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      });
      if (!res.ok) throw new Error("export");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `auditoria-${todayBogota()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(true);
    } finally {
      setExporting(false);
    }
  }

  function clearFilters() {
    setTenantId("");
    setAction("");
    setFrom("");
    setTo("");
    setQInput("");
    setQ("");
  }

  const hasFilters = !!(tenantId || action || from || to || q);
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Auditoría</h1>
        <Button
          variant="secondary"
          onClick={() => void exportCsv()}
          disabled={exporting || entries.length === 0}
        >
          {exporting ? "Exportando…" : "⬇ Exportar CSV"}
        </Button>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Buscar operador, acción o id…"
            className={`${inputClass} w-60`}
            aria-label="Buscar"
          />
          <select
            className={`${inputClass} w-auto`}
            value={action}
            onChange={(e) => setAction(e.target.value)}
            aria-label="Filtrar por acción"
          >
            <option value="">Todas las acciones</option>
            {Object.entries(ACTION_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            className={`${inputClass} w-auto`}
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
          <input
            type="date"
            value={from}
            max={to || todayBogota()}
            onChange={(e) => setFrom(e.target.value)}
            className={`${inputClass} w-auto [color-scheme:dark]`}
            aria-label="Desde"
          />
          <input
            type="date"
            value={to}
            min={from}
            max={todayBogota()}
            onChange={(e) => setTo(e.target.value)}
            className={`${inputClass} w-auto [color-scheme:dark]`}
            aria-label="Hasta"
          />
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs font-medium text-gris-senal underline">
              Limpiar filtros
            </button>
          )}
        </div>
      </Card>

      {error && (
        <Card>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-red-300">No se pudo cargar la bitácora.</span>
            <button
              onClick={() => void load()}
              className="rounded-lg bg-verde px-3 py-1.5 font-semibold text-asfalto"
            >
              Reintentar
            </button>
          </div>
        </Card>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase text-gris-senal/60">
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
                <td className="text-gris-senal">{a.adminEmail}</td>
                <td className="text-gris-senal">
                  {a.targetTenantId
                    ? (tenantName.get(a.targetTenantId) ?? a.targetTenantId)
                    : "—"}
                </td>
                <td className="max-w-md break-all font-mono text-[11px] text-white/40">
                  {JSON.stringify(a.details)}
                </td>
              </tr>
            ))}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-white/30">
                  {hasFilters
                    ? "Sin resultados para estos filtros."
                    : "Sin actividad registrada."}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-gris-senal">
                  Cargando…
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
