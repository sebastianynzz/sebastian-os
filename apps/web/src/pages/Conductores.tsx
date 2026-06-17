import { useEffect, useMemo, useState, type FormEvent } from "react";
import { formatDateBogota } from "@moveos/shared";
import { api } from "../api";
import { useToast } from "../toast";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  PageHeader,
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

function licenseState(iso: string | null): LicenseState {
  if (!iso) return "none";
  const days = (new Date(iso).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "expired";
  if (days <= LICENSE_WARN_DAYS) return "soon";
  return "ok";
}

const LICENSE_BADGE: Record<Exclude<LicenseState, "none">, { label: string; cls: string }> = {
  expired: { label: "Vencida", cls: "bg-danger-bg text-danger" },
  soon: { label: "Por vencer", cls: "bg-warning-bg text-warning" },
  ok: { label: "Vigente", cls: "bg-success-bg text-success" },
};

type Filter = "ALL" | "ACTIVE" | "INACTIVE";

export default function Conductores() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
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

  const shown = useMemo(
    () => drivers.filter((d) => filter === "ALL" || d.status === filter),
    [drivers, filter],
  );
  // Recordatorio de cumplimiento: licencias vencidas o por vencer.
  const flagged = useMemo(
    () => drivers.filter((d) => ["expired", "soon"].includes(licenseState(d.licenseExpiresAt))),
    [drivers],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Conductores"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancelar" : "Nuevo conductor"}
          </Button>
        }
      />

      {flagged.length > 0 && (
        <Banner kind="error">
          {flagged.length} conductor(es) con licencia vencida o por vencer (≤
          {LICENSE_WARN_DAYS} días). Renueva antes de asignarles rutas.
        </Banner>
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
            <div className="sm:col-span-2">
              <Button type="submit">Crear conductor</Button>
            </div>
          </form>
        </Card>
      )}

      <Card
        actions={
          <div className="flex gap-1 text-xs">
            {(["ALL", "ACTIVE", "INACTIVE"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 ${
                  filter === f ? "bg-navy text-white" : "border border-cielo text-navy/70"
                }`}
              >
                {f === "ALL" ? "Todos" : f === "ACTIVE" ? "Activos" : "Inactivos"}
              </button>
            ))}
          </div>
        }
      >
        {loading ? (
          <Loading label="Cargando conductores…" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={theadRowClass}>
                  <th className="py-2">Nombre</th>
                  <th>Celular</th>
                  <th>Cédula</th>
                  <th>Licencia</th>
                  <th>App conductor</th>
                  <th>Disponibilidad</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => {
                  const ls = licenseState(d.licenseExpiresAt);
                  const badge = ls === "none" ? null : LICENSE_BADGE[ls];
                  return (
                    <tr key={d.id} className={tableRowClass}>
                      <td className="py-2 font-medium">{d.name}</td>
                      <td>{d.phone}</td>
                      <td>{d.documentId}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            aria-label={`Vencimiento de licencia de ${d.name}`}
                            className="rounded border border-cielo bg-white px-1.5 py-0.5 text-xs text-navy"
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
                          {badge && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.cls}`}
                              title={d.licenseExpiresAt ? formatDateBogota(d.licenseExpiresAt) : ""}
                            >
                              {badge.label}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-xs text-navy/50">{d.user?.email ?? "Sin cuenta"}</td>
                      <td>
                        <button
                          onClick={() =>
                            void patchDriver(d.id, {
                              status: d.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                            })
                          }
                          disabled={busyId === d.id}
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium disabled:opacity-50 ${
                            d.status === "ACTIVE"
                              ? "bg-success-bg text-success hover:bg-success-bg"
                              : "bg-niebla text-navy/60 hover:bg-cielo/30"
                          }`}
                          title="Cambiar disponibilidad"
                        >
                          {d.status === "ACTIVE" ? "● Activo" : "○ Inactivo"}
                        </button>
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
