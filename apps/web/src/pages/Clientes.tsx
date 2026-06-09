import { Fragment, useEffect, useState, type FormEvent } from "react";
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

interface Client {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  notifyChannel: string;
  webhookUrl: string | null;
  _count: { orders: number };
}

interface Notification {
  id: string;
  template: string;
  channel: string;
  status: string;
  createdAt: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  IN_APP: "En la plataforma",
  EMAIL: "Correo",
  WHATSAPP: "WhatsApp",
  WEBHOOK: "Webhook (API)",
};

const TEMPLATE_LABELS: Record<string, string> = {
  envio_en_reparto: "Envío en reparto",
  envio_entregado: "Envío entregado",
  envio_fallido: "Envío fallido",
};

export default function Clientes() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [channel, setChannel] = useState("IN_APP");
  const [error, setError] = useState<string | null>(null);
  const [openClient, setOpenClient] = useState<string | null>(null);
  const [feed, setFeed] = useState<Record<string, Notification[]>>({});

  async function load() {
    try {
      setClients(await api<Client[]>("GET", "/clients"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function toggleFeed(id: string) {
    if (openClient === id) {
      setOpenClient(null);
      return;
    }
    setFeed((f) => ({ ...f, [id]: f[id] ?? [] }));
    const n = await api<Notification[]>("GET", `/clients/${id}/notifications`);
    setFeed((f) => ({ ...f, [id]: n }));
    setOpenClient(id);
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    try {
      await api("POST", "/clients", {
        name: data.get("name"),
        contactName: data.get("contactName") || undefined,
        email: data.get("email") || undefined,
        phone: data.get("phone") || undefined,
        notifyChannel: channel,
        webhookUrl: data.get("webhookUrl") || undefined,
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
        title="Negocios cliente"
        subtitle="Las empresas que originan los envíos. Reciben la confirmación de
          entrega por el canal que definas."
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancelar" : "Nuevo cliente"}
          </Button>
        }
      />

      {showForm && (
        <Card title="Nuevo negocio cliente">
          <form onSubmit={onCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nombre del negocio">
              <input name="name" className={inputClass} required />
            </Field>
            <Field label="Contacto">
              <input name="contactName" className={inputClass} />
            </Field>
            <Field label="Canal de notificación">
              <select
                name="notifyChannel"
                className={inputClass}
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="IN_APP">En la plataforma</option>
                <option value="EMAIL">Correo</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="WEBHOOK">Webhook (API)</option>
              </select>
            </Field>
            {channel === "EMAIL" && (
              <Field label="Correo">
                <input name="email" type="email" className={inputClass} />
              </Field>
            )}
            {channel === "WHATSAPP" && (
              <Field label="WhatsApp del negocio">
                <input name="phone" className={inputClass} placeholder="+57..." />
              </Field>
            )}
            {channel === "WEBHOOK" && (
              <div className="sm:col-span-2">
                <Field label="URL del webhook (recibe los eventos de entrega)">
                  <input name="webhookUrl" type="url" className={inputClass} placeholder="https://..." />
                </Field>
              </div>
            )}
            {error && (
              <div className="sm:col-span-2">
                <Banner kind="error" onDismiss={() => setError(null)}>
                  {error}
                </Banner>
              </div>
            )}
            <div className="sm:col-span-2">
              <Button type="submit">Crear cliente</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {loading ? (
          <Loading label="Cargando negocios cliente…" />
        ) : (
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={theadRowClass}>
              <th className="py-2">Negocio</th>
              <th>Contacto</th>
              <th>Canal de aviso</th>
              <th>Envíos</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <Fragment key={c.id}>
                <tr className={tableRowClass}>
                  <td className="py-2 font-medium">{c.name}</td>
                  <td>{c.contactName ?? "—"}</td>
                  <td>
                    <span className="rounded-full bg-cielo/40 px-2 py-0.5 text-xs">
                      {CHANNEL_LABELS[c.notifyChannel] ?? c.notifyChannel}
                    </span>
                  </td>
                  <td>{c._count.orders}</td>
                  <td className="text-right">
                    <button
                      onClick={() => toggleFeed(c.id)}
                      aria-expanded={openClient === c.id}
                      className="text-xs text-navy/60 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                    >
                      {openClient === c.id ? "Ocultar avisos" : "Ver avisos"}
                    </button>
                  </td>
                </tr>
                {openClient === c.id && (
                  <tr className={`bg-niebla/40 ${tableRowClass}`}>
                    <td colSpan={5} className="px-4 py-3">
                      <div className="text-xs font-semibold uppercase text-navy/50">
                        Confirmaciones enviadas a {c.name}
                      </div>
                      {(feed[c.id]?.length ?? 0) === 0 ? (
                        <p className="mt-1 text-sm text-navy/40">
                          Aún no se ha enviado ningún aviso.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-1 text-sm">
                          {feed[c.id]!.map((n) => (
                            <li key={n.id} className="flex items-baseline gap-3">
                              <span className="font-mono text-xs text-navy/50">
                                {new Date(n.createdAt).toLocaleString("es-CO", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              <span className="h-2 w-2 shrink-0 rounded-full bg-lima" />
                              <span className="font-medium">
                                {TEMPLATE_LABELS[n.template] ?? n.template}
                              </span>
                              <span className="text-xs text-navy/50">
                                {n.channel} · {n.status}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    action={
                      <Button onClick={() => setShowForm(true)}>
                        Nuevo cliente
                      </Button>
                    }
                  >
                    Sin negocios cliente aún. Cree el primero.
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
