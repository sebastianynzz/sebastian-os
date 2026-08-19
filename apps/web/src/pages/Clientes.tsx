import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Check,
  CircleCheck,
  CircleX,
  Link2,
  Mail,
  Monitor,
  Phone,
  Plus,
  Search,
  X,
} from "lucide-react";
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
  // Política POD del negocio (el API la incluye en el listado).
  podRequired?: string[];
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

/** Ícono Lucide del canal de aviso (chip del revamp). */
function ChannelIcon({ channel }: { channel: string }) {
  const cls = "h-3 w-3";
  const props = { "aria-hidden": true, className: cls, strokeWidth: 2 } as const;
  switch (channel) {
    case "EMAIL":
      return <Mail {...props} />;
    case "WHATSAPP":
      return <Phone {...props} />;
    case "WEBHOOK":
      return <Link2 {...props} />;
    default:
      return <Monitor {...props} />;
  }
}

const POD_LABELS: Record<string, string> = {
  PHOTO: "foto",
  RECEIVER_NAME: "nombre",
};

// Tamaño de página del feed de avisos (paginación por ventana).
const FEED_PAGE = 20;

const TEMPLATE_LABELS: Record<string, string> = {
  envio_en_reparto: "Envío en reparto",
  envio_entregado: "Envío entregado",
  envio_fallido: "Envío fallido",
};

/** Iniciales para el avatar cuadrado (máx. 2 letras). */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

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
  // Prueba del canal de avisos de un cliente ya guardado (Phase E).
  const [notifTest, setNotifTest] = useState<
    Record<string, { testing?: boolean; ok?: boolean; channel?: string } | undefined>
  >({});
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

  async function testNotification(id: string) {
    setNotifTest((t) => ({ ...t, [id]: { testing: true } }));
    try {
      const res = await api<{ ok: boolean; channel: string }>(
        "POST",
        `/clients/${id}/test-notification`,
      );
      setNotifTest((t) => ({ ...t, [id]: { ok: res.ok, channel: res.channel } }));
      if (res.ok) toast.success(`Aviso de prueba enviado por ${res.channel}.`);
    } catch (err) {
      setNotifTest((t) => ({ ...t, [id]: { ok: false } }));
      toast.error(err);
    }
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
        subtitle="Quienes originan los envíos · reciben confirmación por su canal"
        actions={
          <Button
            onClick={() => setShowForm((v) => !v)}
            icon={showForm ? undefined : <Plus strokeWidth={2} />}
          >
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
                    className={`mt-1 flex items-center gap-1.5 text-sm ${webhookTest.ok ? "text-success" : "text-danger"}`}
                  >
                    {webhookTest.ok ? (
                      <>
                        <CircleCheck aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2} />
                        Respondió correctamente (HTTP {webhookTest.status})
                      </>
                    ) : (
                      <>
                        <CircleX aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2} />
                        {webhookTest.error ?? `Respuesta HTTP ${webhookTest.status}`}
                      </>
                    )}
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

      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
          strokeWidth={2}
        />
        <input
          type="search"
          className={`${inputClass} pl-8`}
          placeholder="Buscar negocio, contacto o correo…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar negocios cliente"
        />
      </div>

      {loading ? (
        <Loading label="Cargando negocios cliente…" />
      ) : clients.length === 0 ? (
        <Card>
          <EmptyState
            phrase="Entregas rápidas, operaciones inteligentes."
            action={<Button onClick={() => setShowForm(true)}>Nuevo cliente</Button>}
          >
            Sin negocios cliente aún. Cree el primero.
          </EmptyState>
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-text-tertiary">
            Ningún negocio coincide con «{query}».
          </p>
        </Card>
      ) : (
        shown.map((c) => {
          const test = notifTest[c.id];
          const pod = c.podRequired ?? [];
          const contact = [c.contactName, c.email ?? c.phone].filter(Boolean).join(" · ");
          return (
            <Card key={c.id}>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-asfalto text-[13px] font-bold text-verde"
                  >
                    {initials(c.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-asfalto">
                      {c.name}
                    </span>
                    <span className="block truncate text-[11.5px] text-text-tertiary">
                      {contact || "Sin contacto registrado"}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-text-secondary">
                    <strong className="text-[15px] font-semibold text-asfalto">
                      {c._count.orders}
                    </strong>{" "}
                    envíos
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-info-bg px-2.5 py-0.5 text-[11.5px] font-semibold text-info">
                    <ChannelIcon channel={c.notifyChannel} />
                    {CHANNEL_LABELS[c.notifyChannel] ?? c.notifyChannel}
                  </span>
                  <span
                    className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
                      pod.length > 0
                        ? "bg-info-bg text-info"
                        : "bg-canvas text-text-secondary"
                    }`}
                  >
                    POD:{" "}
                    {pod.length > 0
                      ? pod.map((p) => POD_LABELS[p] ?? p.toLowerCase()).join(" + ")
                      : "no exigida"}
                  </span>
                  {c._count.portalUsers > 0 ? (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-verde/45 px-2.5 py-0.5 text-[11.5px] font-semibold text-asfalto">
                      <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
                      Portal · {c._count.portalUsers} usuario
                      {c._count.portalUsers > 1 ? "s" : ""}
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        setPortalMsg(null);
                        setPortalFor(portalFor === c.id ? null : c.id);
                      }}
                      aria-expanded={portalFor === c.id}
                      className="inline-flex items-center whitespace-nowrap rounded-full border border-dashed border-border-strong bg-surface px-2.5 py-0.5 text-[11.5px] font-medium text-text-tertiary transition duration-200 ease-brand hover:border-asfalto/40 hover:text-asfalto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asfalto"
                    >
                      Sin portal — dar acceso
                    </button>
                  )}
                  <span className="ml-auto inline-flex items-center gap-2">
                    {test && !test.testing && (
                      <span
                        role="status"
                        className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                          test.ok ? "text-asfalto" : "text-danger"
                        }`}
                      >
                        {test.ok ? (
                          <>
                            <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
                            {CHANNEL_LABELS[test.channel ?? ""] ?? test.channel}
                          </>
                        ) : (
                          <>
                            <X aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
                            falló
                          </>
                        )}
                      </span>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() => void testNotification(c.id)}
                      disabled={test?.testing}
                    >
                      {test?.testing ? "Enviando…" : "Probar aviso"}
                    </Button>
                    {/* Botón nativo (estilo fantasma) para poder exponer aria-expanded. */}
                    <button
                      onClick={() => void toggleFeed(c.id)}
                      aria-expanded={openClient === c.id}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-asfalto/25 bg-surface px-3 py-1.5 text-sm font-medium text-asfalto transition duration-200 ease-brand hover:bg-verde/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asfalto"
                    >
                      {openClient === c.id ? "Ocultar avisos" : "Ver avisos"}
                    </button>
                  </span>
                </div>

                {portalFor === c.id && (
                  <div className="border-t border-border pt-3">
                    <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary">
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
                    <p className="mt-2 text-xs text-text-tertiary">
                      El negocio entra con estas credenciales en esta misma
                      página de login y solo ve sus propios envíos.
                    </p>
                  </div>
                )}

                {openClient === c.id && (
                  <div className="border-t border-border pt-2">
                    <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary">
                      Confirmaciones enviadas
                    </div>
                    {(feed[c.id]?.length ?? 0) === 0 ? (
                      <p className="text-sm text-text-tertiary">
                        Aún no se ha enviado ningún aviso.
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-1 text-xs text-asfalto">
                        {feed[c.id]!.map((n) => (
                          <li key={n.id} className="flex items-baseline gap-2">
                            <span className="font-mono text-[11px] text-text-tertiary">
                              {new Date(n.createdAt).toLocaleString("es-CO", {
                                timeZone: "America/Bogota",
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            <span
                              aria-hidden="true"
                              className={`h-[7px] w-[7px] shrink-0 self-center rounded-full ${
                                n.template === "envio_fallido" ? "bg-danger" : "bg-verde"
                              }`}
                            />
                            <span className="font-medium">
                              {TEMPLATE_LABELS[n.template] ?? n.template}
                            </span>
                            <span className="text-[11px] text-text-tertiary">
                              {n.channel} · {n.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(feed[c.id]?.length ?? 0) > 0 && !feedExhausted.has(c.id) && (
                      <button
                        onClick={() => void loadMoreFeed(c.id)}
                        className="mt-2 text-xs font-semibold text-asfalto underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asfalto"
                      >
                        Ver más avisos
                      </button>
                    )}
                  </div>
                )}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
