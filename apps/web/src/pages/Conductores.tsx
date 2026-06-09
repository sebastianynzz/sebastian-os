import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
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
  user: { email: string } | null;
}

export default function Conductores() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    const data = new FormData(e.currentTarget);
    try {
      await api("POST", "/drivers", {
        name: data.get("name"),
        phone: data.get("phone"),
        documentId: data.get("documentId"),
        email: data.get("email") || undefined,
        password: data.get("password") || undefined,
      });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

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
            <div className="hidden sm:block" />
            <Field label="Correo (acceso app conductor, opcional)">
              <input name="email" type="email" className={inputClass} />
            </Field>
            <Field label="Contraseña (opcional)">
              <input name="password" type="password" className={inputClass} minLength={8} />
            </Field>
            {error && (
              <div className="sm:col-span-2">
                <Banner kind="error" onDismiss={() => setError(null)}>
                  {error}
                </Banner>
              </div>
            )}
            <div className="sm:col-span-2">
              <Button type="submit">Crear conductor</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
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
              <th>App conductor</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => (
              <tr key={d.id} className={tableRowClass}>
                <td className="py-2 font-medium">{d.name}</td>
                <td>{d.phone}</td>
                <td>{d.documentId}</td>
                <td className="text-xs text-navy/50">{d.user?.email ?? "Sin cuenta"}</td>
                <td>{d.status === "ACTIVE" ? "Activo" : d.status}</td>
              </tr>
            ))}
            {drivers.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    action={
                      <Button onClick={() => setShowForm(true)}>
                        Nuevo conductor
                      </Button>
                    }
                  >
                    Aún no hay conductores registrados.
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
