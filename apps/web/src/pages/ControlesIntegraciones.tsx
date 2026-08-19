import { useEffect, useState } from "react";
import { KeyRound, Plus, Send, Trash2, Webhook as WebhookIcon } from "lucide-react";
import {
  API_KEY_SCOPES,
  API_KEY_SCOPE_LABELS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_LABELS,
  apiKeySchema,
  webhookSchema,
  type ApiKeyScope,
  type NotificationEvent,
} from "@moveos/shared";
import { api, BASE_URL } from "../api";
import { useToast } from "../toast";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  PageHeader,
  PillToggle,
  inputClass,
} from "../components/ui";

/**
 * Controles › Integraciones (Tier 2 §8, plataforma de desarrolladores):
 * webhooks del tenant (eventos firmados) y API keys (ingesta de pedidos). Solo
 * ADMIN. El secreto del webhook y la API key se muestran para que el integrador
 * los use; la key en claro solo aparece al crearla.
 */

interface Webhook {
  id: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  lastStatus: number | null;
  lastDeliveredAt: string | null;
}
interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
}

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

/* Botón fantasma de peligro (reemplaza el enlace de texto rojo). */
const dangerGhostClass =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-danger transition duration-200 ease-brand hover:bg-danger-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger";

/* Chips multiselección (eventos/permisos): patrón de pastilla del revamp. */
function chipClass(selected: boolean): string {
  return `rounded-full px-3 py-1 text-xs font-medium transition duration-200 ease-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asfalto ${
    selected
      ? "bg-asfalto text-white"
      : "border border-border bg-surface text-asfalto/70 hover:border-border-strong hover:text-asfalto"
  }`;
}

export default function ControlesIntegraciones() {
  const toast = useToast();
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null);
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Alta de webhook.
  const [whUrl, setWhUrl] = useState("");
  const [whEvents, setWhEvents] = useState<Set<NotificationEvent>>(new Set(["DELIVERED"]));
  const [whBusy, setWhBusy] = useState(false);

  // Alta de API key.
  const [keyName, setKeyName] = useState("");
  const [keyScopes, setKeyScopes] = useState<Set<ApiKeyScope>>(new Set(["orders:write"]));
  const [keyBusy, setKeyBusy] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [w, k] = await Promise.all([
        api<Webhook[]>("GET", "/developer/webhooks"),
        api<ApiKeyRow[]>("GET", "/developer/api-keys"),
      ]);
      setWebhooks(w);
      setKeys(k);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las integraciones.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function createWebhook() {
    const parsed = webhookSchema.safeParse({ url: whUrl.trim(), events: [...whEvents] });
    if (!parsed.success) {
      toast.error(new Error(parsed.error.issues[0]?.message ?? "Datos inválidos"));
      return;
    }
    setWhBusy(true);
    try {
      await api("POST", "/developer/webhooks", parsed.data);
      setWhUrl("");
      toast.success("Webhook creado.");
      await load();
    } catch (err) {
      toast.error(err, { retry: () => void createWebhook() });
    } finally {
      setWhBusy(false);
    }
  }
  async function setWebhookEnabled(w: Webhook, enabled: boolean) {
    setWebhooks((ws) => ws?.map((x) => (x.id === w.id ? { ...x, enabled } : x)) ?? ws);
    try {
      await api("PATCH", `/developer/webhooks/${w.id}`, { enabled });
    } catch (err) {
      setWebhooks((ws) => ws?.map((x) => (x.id === w.id ? { ...x, enabled: !enabled } : x)) ?? ws);
      toast.error(err);
    }
  }
  async function testWebhook(w: Webhook) {
    try {
      const res = await api<{ ok: boolean; status: number | null }>(
        "POST",
        `/developer/webhooks/${w.id}/test`,
      );
      if (res.ok) {
        toast.success(`Prueba enviada (HTTP ${res.status}).`);
      } else {
        toast.error(new Error(`El endpoint respondió ${res.status ?? "sin respuesta"}.`));
      }
      await load();
    } catch (err) {
      toast.error(err);
    }
  }
  async function deleteWebhook(w: Webhook) {
    if (!window.confirm("¿Eliminar este webhook?")) return;
    try {
      await api("DELETE", `/developer/webhooks/${w.id}`);
      await load();
    } catch (err) {
      toast.error(err);
    }
  }

  async function createKey() {
    const parsed = apiKeySchema.safeParse({ name: keyName.trim(), scopes: [...keyScopes] });
    if (!parsed.success) {
      toast.error(new Error(parsed.error.issues[0]?.message ?? "Datos inválidos"));
      return;
    }
    setKeyBusy(true);
    try {
      const res = await api<{ key: string }>("POST", "/developer/api-keys", parsed.data);
      setCreatedKey(res.key);
      setKeyName("");
      toast.success("API key creada. Cópiala ahora: no se vuelve a mostrar.");
      await load();
    } catch (err) {
      toast.error(err, { retry: () => void createKey() });
    } finally {
      setKeyBusy(false);
    }
  }
  async function deleteKey(k: ApiKeyRow) {
    if (!window.confirm(`¿Revocar la API key "${k.name}"?`)) return;
    try {
      await api("DELETE", `/developer/api-keys/${k.id}`);
      await load();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Integraciones"
        subtitle="Conecta sistemas externos con daleGo: webhooks firmados por evento y API keys para crear pedidos por API. La firma del webhook viaja en la cabecera x-moveos-signature (HMAC-SHA256 con el secreto)."
      />
      {error && (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      )}

      {createdKey && (
        <Banner kind="success" onDismiss={() => setCreatedKey(null)}>
          Tu nueva API key (cópiala ahora, no se vuelve a mostrar):{" "}
          <code className="break-all font-mono">{createdKey}</code>
        </Banner>
      )}

      <Card title="Webhooks">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="URL del endpoint">
            <input
              className={inputClass}
              value={whUrl}
              onChange={(e) => setWhUrl(e.target.value)}
              placeholder="https://tu-sistema.com/webhooks/moveos"
            />
          </Field>
          <div>
            <span className="mb-1 block text-sm font-medium text-text-secondary">Eventos</span>
            <div className="flex flex-wrap gap-2">
              {NOTIFICATION_EVENTS.map((ev) => (
                <button
                  key={ev}
                  type="button"
                  aria-pressed={whEvents.has(ev)}
                  onClick={() => setWhEvents((s) => toggle(s, ev))}
                  className={chipClass(whEvents.has(ev))}
                >
                  {NOTIFICATION_EVENT_LABELS[ev]}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* Dos acciones de creación equivalentes en la página → navy para ambas
            (máximo un CTA limón por página; aquí ninguna domina). */}
        <div className="mt-3">
          <Button
            variant="primary"
            icon={<Plus strokeWidth={2} />}
            onClick={createWebhook}
            disabled={whBusy}
          >
            {whBusy ? "Creando…" : "Agregar webhook"}
          </Button>
        </div>

        <div className="mt-4">
          {webhooks === null ? (
            <Loading label="Cargando webhooks…" />
          ) : webhooks.length === 0 ? (
            <EmptyState
              icon={<WebhookIcon aria-hidden="true" className="h-8 w-8" strokeWidth={1.75} />}
            >
              Aún no hay webhooks.
            </EmptyState>
          ) : (
            <div className="space-y-2">
              {webhooks.map((w) => (
                <div key={w.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="break-all font-mono text-sm text-asfalto">{w.url}</span>
                    <span className="flex items-center gap-2 text-xs text-text-secondary">
                      {w.enabled ? "Activo" : "Pausado"}
                      <PillToggle
                        checked={w.enabled}
                        onChange={(v) => void setWebhookEnabled(w, v)}
                        label="Activar webhook"
                      />
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {w.events.map((e) => (
                      <Badge key={e} tone="neutral">
                        {NOTIFICATION_EVENT_LABELS[e as NotificationEvent] ?? e}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-2 break-all text-xs text-text-tertiary">
                    Secreto: <code className="font-mono text-asfalto/70">{w.secret}</code>
                  </div>
                  {w.lastStatus !== null && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-text-tertiary">
                      Última entrega:
                      <Badge tone={w.lastStatus >= 200 && w.lastStatus < 300 ? "success" : "danger"}>
                        <span className="font-mono">HTTP {w.lastStatus}</span>
                      </Badge>
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="secondary"
                      icon={<Send strokeWidth={2} />}
                      onClick={() => void testWebhook(w)}
                    >
                      Enviar prueba
                    </Button>
                    <button onClick={() => void deleteWebhook(w)} className={dangerGhostClass}>
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card title="API keys">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nombre (p. ej. Tienda Shopify)">
            <input
              className={inputClass}
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              maxLength={60}
            />
          </Field>
          <div>
            <span className="mb-1 block text-sm font-medium text-text-secondary">Permisos</span>
            <div className="flex flex-wrap gap-2">
              {API_KEY_SCOPES.map((sc) => (
                <button
                  key={sc}
                  type="button"
                  aria-pressed={keyScopes.has(sc)}
                  onClick={() => setKeyScopes((s) => toggle(s, sc))}
                  className={chipClass(keyScopes.has(sc))}
                >
                  {API_KEY_SCOPE_LABELS[sc]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Button
            variant="primary"
            icon={<Plus strokeWidth={2} />}
            onClick={createKey}
            disabled={keyBusy}
          >
            {keyBusy ? "Creando…" : "Crear API key"}
          </Button>
        </div>

        <div className="mt-4">
          {keys === null ? (
            <Loading label="Cargando API keys…" />
          ) : keys.length === 0 ? (
            <EmptyState
              icon={<KeyRound aria-hidden="true" className="h-8 w-8" strokeWidth={1.75} />}
            >
              Aún no hay API keys.
            </EmptyState>
          ) : (
            <div className="space-y-2">
              {keys.map((k) => (
                <div
                  key={k.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                >
                  <div>
                    <div className="font-medium text-asfalto">{k.name}</div>
                    <div className="font-mono text-xs text-text-tertiary">{k.prefix}…</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} tone="neutral">
                          {API_KEY_SCOPE_LABELS[s as ApiKeyScope] ?? s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => void deleteKey(k)} className={dangerGhostClass}>
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                    Revocar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Conectores (Tier 2 §8): order-ingestion desde donde vende el cliente. */}
      <Card title="Conectores de pedidos">
        <p className="text-sm text-text-secondary">
          Conecta tu tienda o marketplace para que sus pedidos entren a daleGo.
          Configura el webhook de la plataforma apuntando a la URL del conector y
          autentícalo con una API key con permiso{" "}
          <code className="font-mono text-asfalto">orders:write</code>.
        </p>
        <div className="mt-3 space-y-2">
          {[
            ["Shopify", "shopify"],
            ["VTEX", "vtex"],
            ["Mercado Libre", "mercadolibre"],
            ["Zapier / genérico", "zapier"],
          ].map(([label, source]) => (
            <div
              key={source}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
            >
              <span className="font-medium text-asfalto">{label}</span>
              <code className="break-all rounded-md bg-canvas px-2 py-1 font-mono text-xs text-asfalto">
                POST {BASE_URL}/ingest/orders/{source}
              </code>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
