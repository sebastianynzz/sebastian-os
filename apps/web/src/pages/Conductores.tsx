import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { Button, Card, Field, inputClass } from "../components/ui";

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
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setDrivers(await api<Driver[]>("GET", "/drivers"));
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Conductores</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancelar" : "Nuevo conductor"}
        </Button>
      </div>

      {showForm && (
        <Card title="Nuevo conductor (onboarding ligero para mensajeros)">
          <form onSubmit={onCreate} className="grid grid-cols-2 gap-4">
            <Field label="Nombre completo">
              <input name="name" className={inputClass} required />
            </Field>
            <Field label="Celular">
              <input name="phone" className={inputClass} required placeholder="+57..." />
            </Field>
            <Field label="Cédula">
              <input name="documentId" className={inputClass} required />
            </Field>
            <div />
            <Field label="Correo (acceso app conductor, opcional)">
              <input name="email" type="email" className={inputClass} />
            </Field>
            <Field label="Contraseña (opcional)">
              <input name="password" type="password" className={inputClass} minLength={8} />
            </Field>
            {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
            <div className="col-span-2">
              <Button type="submit">Crear conductor</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <th className="py-2">Nombre</th>
              <th>Celular</th>
              <th>Cédula</th>
              <th>App conductor</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => (
              <tr key={d.id} className="border-b border-slate-100">
                <td className="py-2 font-medium">{d.name}</td>
                <td>{d.phone}</td>
                <td>{d.documentId}</td>
                <td className="text-xs text-slate-500">{d.user?.email ?? "Sin cuenta"}</td>
                <td>{d.status === "ACTIVE" ? "Activo" : d.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
