import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import {
  NOTIFICATION_EVENT_LABELS,
  messageTemplateSchema,
  type NotificationEvent,
} from "@moveos/shared";
import { api } from "../api";
import { useToast } from "../toast";
import { Badge, Banner, Button, Card, Loading, PageHeader, PillToggle, inputClass } from "../components/ui";

/* Chip monoespaciado para las variables de plantilla del subtítulo. */
function Var({ children }: { children: string }) {
  return (
    <code className="rounded bg-canvas px-1 py-0.5 font-mono text-[11px] text-asfalto">
      {children}
    </code>
  );
}

/**
 * Controles › Notificaciones (Tier 2, B2B): por evento del ciclo de vida, el
 * operador decide si notifica al NEGOCIO cliente y con qué texto. MoveOS nunca
 * mensajea al consumidor final. El canal lo define cada cliente. Solo ADMIN.
 */

interface TemplateRow {
  event: NotificationEvent;
  enabled: boolean;
  body: string;
  isDefault: boolean;
}

export default function ControlesNotificaciones() {
  const toast = useToast();
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingEvent, setSavingEvent] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setRows(await api<TemplateRow[]>("GET", "/controls/notifications"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las plantillas.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function update(event: string, patch: Partial<TemplateRow>) {
    setRows((rs) => rs?.map((r) => (r.event === event ? { ...r, ...patch } : r)) ?? rs);
  }

  async function save(row: TemplateRow) {
    const parsed = messageTemplateSchema.safeParse({
      event: row.event,
      enabled: row.enabled,
      body: row.body.trim(),
    });
    if (!parsed.success) {
      toast.error(new Error(parsed.error.issues[0]?.message ?? "Plantilla inválida"));
      return;
    }
    setSavingEvent(row.event);
    try {
      const saved = await api<TemplateRow>("PATCH", "/controls/notifications", parsed.data);
      update(row.event, { ...saved });
      toast.success("Plantilla guardada.");
    } catch (err) {
      toast.error(err, { retry: () => void save(row) });
    } finally {
      setSavingEvent(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notificaciones"
        subtitle={
          <>
            Por cada evento del envío, decide si avisar al negocio cliente y con qué
            texto. Usa <Var>{"{{guia}}"}</Var>, <Var>{"{{destinatario}}"}</Var>,{" "}
            <Var>{"{{motivo}}"}</Var> y <Var>{"{{rastreo}}"}</Var>. daleGo notifica al
            negocio, nunca al consumidor final.
          </>
        }
      />
      {error && (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      )}
      {rows === null ? (
        <Loading label="Cargando plantillas…" />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.event}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 font-semibold text-asfalto">
                  {NOTIFICATION_EVENT_LABELS[row.event]}
                  {row.isDefault && <Badge tone="neutral">Por defecto</Badge>}
                </div>
                <span className="flex items-center gap-2 text-sm text-text-secondary">
                  {row.enabled ? "Notifica" : "Silenciado"}
                  <PillToggle
                    checked={row.enabled}
                    onChange={(v) => update(row.event, { enabled: v })}
                    label="Activar notificación de este evento"
                  />
                </span>
              </div>
              <textarea
                className={`${inputClass} mt-3 h-20 resize-y`}
                value={row.body}
                maxLength={500}
                onChange={(e) => update(row.event, { body: e.target.value })}
              />
              {/* Navy (no CTA limón): hay un guardado por tarjeta y el límite es
                  un solo CTA limón por página. */}
              <div className="mt-2 flex justify-end">
                <Button
                  variant="primary"
                  icon={<Save strokeWidth={2} />}
                  onClick={() => void save(row)}
                  disabled={savingEvent === row.event}
                >
                  {savingEvent === row.event ? "Guardando…" : "Guardar"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
