import { useEffect, useMemo, useState, type FormEvent } from "react";
import { formatDateBogota } from "@moveos/shared";
import { Mail, Plus, Search, TriangleAlert } from "lucide-react";
import { api } from "../api";
import { useToast } from "../toast";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FilterPill,
  KpiCard,
  Loading,
  PageHeader,
  PillToggle,
  inputClass,
  tableRowClass,
  theadRowClass,
} from "../components/ui";

interface Driver {
  id: string;
  name: string;
  phone: string;
  documentId: string;
  status: string;
  licenseExpiresAt: string | null;
  user: { email: string } | null;
}

type LicenseState = "none" | "expired" | "soon" | "ok";

// Días bajo los cuales una licencia se considera "por vencer".
const LICENSE_WARN_DAYS = 30;

/** Días (enteros) hasta el vencimiento; negativo = ya vencida. */
function licenseDays(iso: string): number {
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function licenseState(iso: string | null): LicenseState {
  if (!iso) return "none";
  const days = (new Date(iso).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "expired";
  if (days <= LICENSE_WARN_DAYS) return "soon";
  return "ok";
}

/** Etiqueta semaforizada de la licencia, con los días visibles. */
function licenseBadge(iso: string): { label: string; tone: "success" | "warning" | "danger" } {
  const days = licenseDays(iso);
  if (days < 0) return { label: "Vencida", tone: "danger" };
  if (days === 0) return { label: "Vence hoy", tone: "warning" };
  if (days <= LICENSE_WARN_DAYS)
    return { label: `Vence en ${days} día${days === 1 ? "" : "s"}`, tone: "warning" };
  return { label: "Vigente", tone: "success" };
}

/** Detalle en español para el banner de cumplimiento. */
function riskDetail(iso: string): string {
  const days = licenseDays(iso);
  if (days < 0) return `vencida hace ${-days} día${days === -1 ? "" : "s"}`;
  if (days === 0) return "vence hoy";
  return `vence en ${days} día${days === 1 ? "" : "s"}`;
}

/** Iniciales para el avatar circular (máx. 2 letras). */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

type Filter = "ALL" | "ACTIVE" | "INACTIVE" | "RISK";

export default function Conductores() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Depósito base del conductor (multi-depot, D4 fast-follow).
  const [depots, setDepots] = useState<{ id: string; name: string }[]>([]);
  const toast = useToast();

  async function load() {
    try {
      setDrivers(await api<Driver[]>("GET", "/drivers"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    void api<{ id: string; name: string }[]>("GET", "/depots")
      .then(setDepots)
      .catch(() => {});
  }, []);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const license = String(data.get("licenseExpiresAt") ?? "");
    try {
      await api("POST", "/drivers", {
        name: data.get("name"),
        phone: data.get("phone"),
        documentId: data.get("documentId"),
        email: data.get("email") || undefined,
        password: data.get("password") || undefined,
        licenseExpiresAt: license ? new Date(license).toISOString() : undefined,
        depotId: data.get("depotId") || undefined,
      });
      setShowForm(false);
      await load();
    } catch (err) {
      toast.error(err);
    }
  }

  async function patchDriver(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      await api("PATCH", `/drivers/${id}`, body);
      await load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusyId(null);
    }
  }

  // Recordatorio de cumplimiento: licencias vencidas o por vencer.
  const flagged = useMemo(
    () => drivers.filter((d) => ["expired", "soon"].includes(licenseState(d.licenseExpiresAt))),
    [drivers],
  );

  const counts = useMemo(
    () => ({
      total: drivers.length,
      active: drivers.filter((d) => d.status === "ACTIVE").length,
      inactive: drivers.filter((d) => d.status === "INACTIVE").length,
      withApp: drivers.filter((d) => d.user != null).length,
    }),
    [drivers],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return drivers.filter((d) => {
      if (filter === "RISK") {
        if (!["expired", "soon"].includes(licenseState(d.licenseExpiresAt))) return false;
      } else if (filter !== "ALL" && d.status !== filter) {
        return false;
      }
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        d.documentId.toLowerCase().includes(q) ||
        d.phone.toLowerCase().includes(q)
      );
    });
  }, [drivers, filter, query]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Conductores"
        actions={
          <Button
            onClick={() => setShowForm((v) => !v)}
            icon={showForm ? undefined : <Plus strokeWidth={2} />}
          >
            {showForm ? "Cancelar" : "Nuevo conductor"}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Registrados" value={counts.total} />
        <KpiCard label="Disponibles hoy" value={counts.active} accent />
        <KpiCard
          label="Acceso app conductor"
          value={counts.withApp}
          hint={
            counts.total - counts.withApp > 0
              ? `${counts.total - counts.withApp} invitación(es) pendiente(s)`
              : "Todos con cuenta"
          }
        />
        <KpiCard
          label="Licencias en riesgo"
          value={
            <span className={filter === "RISK" ? undefined : "text-danger"}>
              {flagged.length}
            </span>
          }
          active={filter === "RISK"}
          onClick={() => setFilter(filter === "RISK" ? "ALL" : "RISK")}
        />
      </div>

      {flagged.length > 0 && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-lg border border-danger/30 bg-danger-bg px-3.5 py-2 text-[12.5px] text-danger"
        >
          <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span>
            {flagged.map((d, i) => (
              <span key={d.id}>
                {i > 0 && (i === flagged.length - 1 ? " y " : ", ")}
                <strong>{d.name}</strong>{" "}
                {d.licenseExpiresAt ? `(${riskDetail(d.licenseExpiresAt)})` : ""}
              </span>
            ))}
            : renueva la licencia antes de asignarles rutas.
          </span>
          <button
            onClick={() => setFilter("RISK")}
            className="ml-auto whitespace-nowrap text-xs font-semibold text-danger underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
          >
            Filtrar en riesgo →
          </button>
        </div>
      )}

      {showForm && (
        <Card title="Nuevo conductor (onboarding ligero para mensajeros)">
          <form onSubmit={onCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nombre completo">
              <input name="name" className={inputClass} required />
            </Field>
            <Field label="Celular">
              <input name="phone" className={inputClass} required placeholder="+57..." />
            </Field>
            <Field label="Cédula">
              <input name="documentId" className={inputClass} required />
            </Field>
            <Field label="Vencimiento de licencia (opcional)">
              <input name="licenseExpiresAt" type="date" className={inputClass} />
            </Field>
            <Field label="Correo (acceso app conductor, opcional)">
              <input name="email" type="email" className={inputClass} />
            </Field>
            <Field label="Contraseña (opcional)">
              <input name="password" type="password" className={inputClass} minLength={8} />
            </Field>
            {depots.length > 0 && (
              <Field label="Depósito base (opcional)">
                <select name="depotId" className={inputClass} defaultValue="">
                  <option value="">— Sin depósito —</option>
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="sm:col-span-2">
              <Button type="submit">Crear conductor</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <FilterPill
              active={filter === "ALL"}
              onClick={() => setFilter("ALL")}
              count={counts.total}
            >
              Todos
            </FilterPill>
            <FilterPill
              active={filter === "ACTIVE"}
              onClick={() => setFilter("ACTIVE")}
              count={counts.active}
            >
              Activos
            </FilterPill>
            <FilterPill
              active={filter === "INACTIVE"}
              onClick={() => setFilter("INACTIVE")}
              count={counts.inactive}
            >
              Inactivos
            </FilterPill>
            {flagged.length > 0 && (
              <FilterPill
                active={filter === "RISK"}
                onClick={() => setFilter("RISK")}
                count={flagged.length}
              >
                En riesgo
              </FilterPill>
            )}
          </div>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
              strokeWidth={2}
            />
            <input
              type="search"
              className={`${inputClass} pl-8 sm:w-64`}
              placeholder="Nombre, cédula o celular…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Buscar conductores"
            />
          </div>
        </div>

        {loading ? (
          <Loading label="Cargando conductores…" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={theadRowClass}>
                  <th className="py-2">Conductor</th>
                  <th>Contacto</th>
                  <th>Licencia</th>
                  <th>App conductor</th>
                  <th>Estado</th>
                  <th>Disponibilidad</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => {
                  const ls = licenseState(d.licenseExpiresAt);
                  const badge = d.licenseExpiresAt ? licenseBadge(d.licenseExpiresAt) : null;
                  const expired = ls === "expired";
                  const active = d.status === "ACTIVE";
                  return (
                    <tr
                      key={d.id}
                      className={`${tableRowClass} ${expired ? "bg-danger-bg/40" : ""}`}
                    >
                      <td
                        className={`py-2 ${expired ? "border-l-[3px] border-l-danger pl-1" : ""}`}
                      >
                        <span className={`flex items-center gap-2.5 ${active ? "" : "opacity-55"}`}>
                          <span
                            aria-hidden="true"
                            className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                              expired ? "bg-danger" : active ? "bg-navy" : "bg-cielo"
                            }`}
                          >
                            {initials(d.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block font-semibold text-navy">{d.name}</span>
                            <span className="block text-[11px] text-text-tertiary">
                              CC <span className="font-mono">{d.documentId}</span>
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="text-[12.5px] text-text-secondary">{d.phone}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            aria-label={`Vencimiento de licencia de ${d.name}`}
                            className={`rounded-md border bg-surface px-2 py-0.5 font-mono text-[11.5px] disabled:opacity-50 ${
                              expired
                                ? "border-danger/50 text-danger"
                                : "border-border-strong text-navy"
                            }`}
                            value={d.licenseExpiresAt ? d.licenseExpiresAt.slice(0, 10) : ""}
                            disabled={busyId === d.id}
                            onChange={(e) =>
                              void patchDriver(d.id, {
                                licenseExpiresAt: e.target.value
                                  ? new Date(e.target.value).toISOString()
                                  : null,
                              })
                            }
                          />
                          {badge ? (
                            <span
                              title={d.licenseExpiresAt ? formatDateBogota(d.licenseExpiresAt) : ""}
                            >
                              <Badge tone={badge.tone}>{badge.label}</Badge>
                            </span>
                          ) : (
                            <span className="rounded-md border border-dashed border-border-strong px-2 py-0.5 text-[11.5px] text-text-tertiary">
                              Sin registrar
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        {d.user ? (
                          <span className="text-xs text-text-secondary">{d.user.email}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                            <Mail aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
                            Invitación pendiente
                          </span>
                        )}
                      </td>
                      <td>
                        {active ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-lime-ink">
                            <span
                              aria-hidden="true"
                              className="h-2 w-2 rounded-full bg-olive"
                            />
                            Disponible
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-text-tertiary">
                            <span
                              aria-hidden="true"
                              className="h-2 w-2 rounded-full bg-border-strong"
                            />
                            Fuera de servicio
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-2">
                          <PillToggle
                            checked={active}
                            disabled={busyId === d.id}
                            label={`Disponibilidad de ${d.name}`}
                            onChange={(next) =>
                              void patchDriver(d.id, {
                                status: next ? "ACTIVE" : "INACTIVE",
                              })
                            }
                          />
                          <span
                            className={`text-xs font-medium ${
                              active ? "text-lime-ink" : "text-text-tertiary"
                            }`}
                          >
                            {active ? "Activo" : "Inactivo"}
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState
                        action={
                          drivers.length === 0 ? (
                            <Button onClick={() => setShowForm(true)}>Nuevo conductor</Button>
                          ) : undefined
                        }
                      >
                        {drivers.length === 0
                          ? "Aún no hay conductores registrados."
                          : "Ningún conductor coincide con el filtro."}
                      </EmptyState>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
