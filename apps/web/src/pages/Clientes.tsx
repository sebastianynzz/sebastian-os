import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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

interface Client {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  notifyChannel: string;
  webhookUrl: string | null;
  pickupAddressRaw: string | null;
  _count: { orders: number; portalUsers: number };
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

// Tamaño de página del feed de avisos (paginación por ventana).
const FEED_PAGE = 20;

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
  const webhookRef = useRef<HTMLInputElement>(null);
  const [webhookTest, setWebhookTest] = useState<
    { testing?: boolean; ok?: boolean; status?: number; error?: string } | null
  >(null);
  const toast = useToast();
  const [openClient, setOpenClient] = useState<string | null>(null);
  const [feed, setFeed] = useState<Record<string, Notification[]>>({});
  const [portalFor, setPortalFor] = useState<string | null>(null);
  const [portalMsg, setPortalMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [feedExhausted, setFeedExhausted] = useState<Set<string>>(new Set());

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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.contactName ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q),
    );
  }, [clients, query]);

  function markExhausted(id: string) {
    setFeedExhausted((s) => new Set(s).add(id));
  }

  async function toggleFeed(id: string) {
    if (openClient === id) {
      setOpenClient(null);
      return;
    }
    setOpenClient(id);
    if (feed[id]) return; // ya cargado: conservar la página ya vista
    const n = await api<Notification[]>(
      "GET",
      `/clients/${id}/notifications?skip=0&take=${FEED_PAGE}`,
    );
    setFeed((f) => ({ ...f, [id]: n }));
    if (n.length < FEED_PAGE) markExhausted(id);
  }

  async function loadMoreFeed(id: string) {
    const current = feed[id] ?? [];
    const more = await api<Notification[]>(
      "GET",
      `/clients/${id}/notifications?skip=${current.length}&take=${FEED_PAGE}`,
    );
    setFeed((f) => ({ ...f, [id]: [...(f[id] ?? []), ...more] }));
    if (more.length < FEED_PAGE) markExhausted(id);
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    try {
      await api("POST", "/clients", {
        name: data.get("name"),
        contactName: data.get("contactName") || undefined,
        email: data.get("email") || undefined,
        phone: data.get("phone") || undefined,
        notifyChannel: channel,
        webhookUrl: data.get("webhookUrl") || undefined,
        pickupAddressRaw: data.get("pickupAddressRaw") || undefined,
        pickupNotes: data.get("pickupNotes") || undefined,
        // Política POD configurable: pruebas que este comercio exige por entrega.
        podRequired: data.getAll("podRequired"),
      });
      setShowForm(false);
      await load();
    } catch (err) {
      toast.error(err);
    }
  }

  /** Prueba la URL del webhook antes de guardar, para no descubrir que está
   *  rota cuando ya dependa de ella un pedido real. */
  async function testWebhook() {
    const url = webhookRef.current?.value.trim();
    if (!url) {
      setWebhookTest({ ok: false, error: "Ingresa la URL primero" });
      return;
    }
    setWebhookTest({ testing: true });
    try {
      const res = await api<{ ok: boolean; status?: number; error?: string }>(
        "POST",
        "/clients/test-webhook",
        { webhookUrl: url },
      );
      setWebhookTest(res);
    } catch (err) {
      setWebhookTest({
        ok: false,
        error: err instanceof Error ? err.message : "Error",
      });
    }
  }

  /** Entrega credenciales del portal de clientes a un negocio (solo ADMIN). */
  async function onCreatePortalAccess(e: FormEvent<HTMLFormElement>, clientId: string) {
    e.preventDefault();
    setPortalMsg(null);
    const data = new FormData(e.currentTarget);
    try {
      const user = await api<{ email: string }>(
        "POST",
        `/clients/${clientId}/portal-access`,
        { email: data.get("email"), password: data.get("password") },
      );
      setPortalMsg(`Acceso creado: ${user.email}. Comparta las credenciales con el negocio.`);
      setPortalFor(null);
      await load();
    } catch (err) {
      setPortalMsg(err instanceof Error ? err.message : "Error");
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
                  <div className="flex gap-2">
                    <input
                      ref={webhookRef}
                      name="webhookUrl"
                      type="url"
                      className={inputClass}
                      placeholder="https://..."
                      onChange={() => setWebhookTest(null)}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={testWebhook}
                      disabled={webhookTest?.testing}
                    >
                      {webhookTest?.testing ? "Probando…" : "Probar"}
                    </Button>
                  </div>
                </Field>
                {webhookTest && !webhookTest.testing && (
                  <p
                    role="status"
                    className={`mt-1 text-sm ${webhookTest.ok ? "text-success" : "text-danger"}`}
                  >
                    {webhookTest.ok
                      ? `✅ Respondió correctamente (HTTP ${webhookTest.status})`
                      : `❌ ${webhookTest.error ?? `Respuesta HTTP ${webhookTest.status}`}`}
                  </p>
                )}
              </div>
            )}
            <Field label="Dirección de recogida (origen de sus envíos del portal)">
              <input
                name="pickupAddressRaw"
                className={inputClass}
                placeholder="Cra 9 # 60-15, Chapinero"
              />
            </Field>
            <Field label="Indicaciones de recogida">
              <input name="pickupNotes" className={inputClass} placeholder="Local 2, bodega…" />
            </Field>
            <Field label="Prueba de entrega exigida (política POD)">
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="podRequired" value="PHOTO" />
                  Foto de evidencia
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="podRequired" value="RECEIVER_NAME" />
                  Nombre de quien recibe
                </label>
              </div>
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">Crear cliente</Button>
            </div>
          </form>
        </Card>
      )}

      {portalMsg && (
        <Banner kind="info" onDismiss={() => setPortalMsg(null)}>
          {portalMsg}
        </Banner>
      )}

      <Card
        actions={
          <input
            type="search"
            className={`${inputClass} sm:w-64`}
            placeholder="Buscar negocio, contacto o correo…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar negocios cliente"
          />
        }
      >
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
              <th>Portal</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
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
                  <td>
                    {c._count.portalUsers > 0 ? (
                      <span className="rounded-full bg-lima/40 px-2 py-0.5 text-xs">
                        {c._count.portalUsers} usuario{c._count.portalUsers > 1 ? "s" : ""}
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setPortalMsg(null);
                          setPortalFor(portalFor === c.id ? null : c.id);
                        }}
                        aria-expanded={portalFor === c.id}
                        className="text-xs text-navy/60 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                      >
                        Dar acceso
                      </button>
                    )}
                  </td>
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
                {portalFor === c.id && (
                  <tr className={`bg-niebla/40 ${tableRowClass}`}>
                    <td colSpan={6} className="px-4 py-3">
                      <div className="mb-2 text-xs font-semibold uppercase text-navy/50">
                        Acceso al portal de clientes para {c.name}
                      </div>
                      <form
                        onSubmit={(e) => void onCreatePortalAccess(e, c.id)}
                        className="flex flex-wrap items-end gap-3"
                      >
                        <Field label="Correo del negocio">
                          <input name="email" type="email" className={inputClass} required />
                        </Field>
                        <Field label="Contraseña inicial (mín. 8)">
                          <input
                            name="password"
                            type="text"
                            className={inputClass}
                            required
                            minLength={8}
                          />
                        </Field>
                        <Button type="submit">Crear acceso</Button>
                      </form>
                      <p className="mt-2 text-xs text-navy/40">
                        El negocio entra con estas credenciales en esta misma
                        página de login y solo ve sus propios envíos.
                      </p>
                    </td>
                  </tr>
                )}
                {openClient === c.id && (
                  <tr className={`bg-niebla/40 ${tableRowClass}`}>
                    <td colSpan={6} className="px-4 py-3">
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
                                  timeZone: "America/Bogota",
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
                      {(feed[c.id]?.length ?? 0) > 0 && !feedExhausted.has(c.id) && (
                        <button
                          onClick={() => void loadMoreFeed(c.id)}
                          className="mt-2 text-xs font-medium text-navy underline hover:text-navy/70"
                        >
                          Ver más avisos
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    phrase="Entregas rápidas, operaciones inteligentes."
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
            {clients.length > 0 && shown.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-navy/40">
                  Ningún negocio coincide con «{query}».
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
