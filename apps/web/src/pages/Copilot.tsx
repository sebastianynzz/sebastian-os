import { useRef, useState, type FormEvent } from "react";
import { Check, CircleCheck, CircleStop, Lock, Send, Zap } from "lucide-react";
import { api, BASE_URL, getToken } from "../api";
import { useAuth } from "../auth";
import {
  Badge,
  Banner,
  Button,
  Card,
  ModuleDisabled,
  PageHeader,
  inputClass,
} from "../components/ui";

/**
 * Copiloto IA (módulo AI_ADDONS): planificación en lenguaje natural,
 * "¿por qué falló el pedido X?" y vigilancia de la operación.
 *
 * Guardia de confirmación: el Copiloto solo PROPONE mutaciones. Cada
 * propuesta llega como una tarjeta con botón "Confirmar y ejecutar" que llama
 * el endpoint real existente — el modelo nunca ejecuta nada por sí mismo.
 */

const DEPOT = { lat: 4.6486, lng: -74.0628 }; // demo: Chapinero

interface CopilotAction {
  kind: "PLAN_ROUTES" | "INSERT_ORDER" | "DISPATCH_ROUTE" | "FLAG_RECOVERY";
  summary: string;
  params: Record<string, unknown>;
  /** Propuestas de optimización: se confirman por la ruta de aplicación compartida. */
  proposalId?: string;
  feasible?: boolean;
}

interface ChatEntry {
  role: "user" | "assistant";
  content: string;
  actions?: CopilotAction[];
}

const SUGGESTIONS = [
  "¿Qué requiere mi atención ahora?",
  "Planea todos los pedidos geocodificados de hoy con toda la flota",
  "¿Por qué no se entregó el último pedido fallido?",
  "¿Cuántas direcciones nuevas aprendió el grafo esta semana?",
];

/** Qué hace de verdad cada tipo de propuesta al confirmarse (leyenda del CTA). */
const KIND_HINTS: Record<CopilotAction["kind"], string> = {
  PLAN_ROUTES: "llama al optimizador real — revisable en Rutas",
  INSERT_ORDER: "inserta el pedido en la ruta existente",
  DISPATCH_ROUTE: "el conductor la verá en su app",
  FLAG_RECOVERY: "notifica al comercio para reprogramar",
};

/** Parámetros de la propuesta como chips legibles (solo presentación). */
function paramChips(params: Record<string, unknown>): string[] {
  return Object.entries(params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k} · ${v.length}`;
      if (typeof v === "object") return null;
      const s = String(v);
      return `${k}: ${s.length > 32 ? `${s.slice(0, 32)}…` : s}`;
    })
    .filter((c): c is string => c !== null)
    .slice(0, 6);
}

export default function Copilot() {
  const { session } = useAuth();
  const [transcript, setTranscript] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [executed, setExecuted] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  if (session && !session.modules.includes("AI_ADDONS")) {
    return <ModuleDisabled title="Copiloto IA" moduleName="IA Addons" />;
  }

  /**
   * Envía el turno y consume la respuesta en streaming (NDJSON sobre fetch):
   * la narración del Copiloto se va escribiendo token a token. Las propuestas
   * (acciones a confirmar) llegan al final, en el evento `done` — el modelo
   * sigue sin ejecutar nada por sí mismo.
   */
  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setBanner(null);
    setInput("");
    const base: ChatEntry[] = [...transcript, { role: "user", content }];
    setTranscript(base);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    let started = false;
    const ensureBubble = () => {
      if (started) return;
      started = true;
      setTranscript((prev) => [...prev, { role: "assistant", content: "" }]);
    };
    const paintAssistant = (textVal: string, actions?: CopilotAction[]) => {
      setTranscript((prev) => {
        const next = [...prev];
        const last = next.length - 1;
        if (last >= 0 && next[last]?.role === "assistant") {
          next[last] = { role: "assistant", content: textVal, actions };
        }
        return next;
      });
    };

    try {
      const res = await fetch(`${BASE_URL}/copilot/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        },
        body: JSON.stringify({
          messages: base.map(({ role, content: c }) => ({ role, content: c })),
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
        setBanner({
          kind: "error",
          text:
            data.code === "COPILOT_NOT_CONFIGURED"
              ? "El Copiloto no está configurado en este entorno (falta la clave del proveedor de IA)."
              : data.error ?? "El Copiloto no pudo responder.",
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const evt = JSON.parse(line) as {
            type: string;
            text?: string;
            actions?: CopilotAction[];
            message?: string;
          };
          if (evt.type === "delta") {
            ensureBubble();
            acc += evt.text ?? "";
            paintAssistant(acc);
          } else if (evt.type === "done") {
            ensureBubble();
            paintAssistant(acc || "Listo.", evt.actions ?? []);
          } else if (evt.type === "error") {
            setBanner({ kind: "error", text: evt.message ?? "El Copiloto no pudo responder." });
          }
        }
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } catch (err) {
      // Aborto del usuario (botón Detener): conservamos lo recibido sin error.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error" });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  /** Ejecuta una propuesta confirmada. Las de optimización van por la ruta de
   *  aplicación compartida (mismo ejecutor que los botones); despacho y
   *  recuperación, contra su endpoint operativo existente. */
  async function confirm(action: CopilotAction, key: string) {
    setBusy(true);
    setBanner(null);
    try {
      let note: string;
      if (action.proposalId) {
        const res = await api<{ resultEs?: string }>(
          "POST",
          "/copilot/actions/confirm",
          { proposalId: action.proposalId },
        );
        note = res.resultEs ?? "Propuesta aplicada.";
      } else if (action.kind === "PLAN_ROUTES") {
        const res = await api<{ routes: unknown[]; unassigned: unknown[] }>(
          "POST",
          "/optimization/plans",
          { ...action.params, depot: DEPOT },
        );
        note = `Plan ejecutado: ${res.routes.length} ruta(s) creada(s), ${res.unassigned.length} pedido(s) sin asignar. Revísalo en Rutas.`;
      } else if (action.kind === "INSERT_ORDER") {
        await api("POST", `/optimization/routes/${String(action.params.routeId)}/insert`, {
          orderId: action.params.orderId,
        });
        note = "Pedido insertado en la ruta.";
      } else if (action.kind === "DISPATCH_ROUTE") {
        await api("POST", `/routes/${String(action.params.routeId)}/dispatch`, {
          driverId: action.params.driverId,
        });
        note = "Ruta despachada: el conductor ya la ve en su app.";
      } else {
        await api("POST", `/orders/${String(action.params.orderId)}/recovery/flag`);
        note = "Comercio notificado para reprogramar.";
      }
      setExecuted((prev) => new Set(prev).add(key));
      setTranscript((prev) => [...prev, { role: "assistant", content: note }]);
      setBanner({ kind: "success", text: "Acción ejecutada" });
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  const lastEntry = transcript[transcript.length - 1];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Copiloto IA"
        subtitle="Planifica, explica fallos y vigila la operación en lenguaje natural"
        actions={
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-navy px-3 py-1.5 text-[11.5px] text-cielo">
            <Lock aria-hidden="true" className="h-3 w-3 shrink-0 text-lima" strokeWidth={2} />
            El modelo nunca ejecuta solo: propone y tú confirmas
          </span>
        }
      />
      {banner && (
        <Banner kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Banner>
      )}

      <Card>
        <div className="flex h-[60vh] flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {transcript.length === 0 && (
              <div className="space-y-3 py-8 text-center">
                <p className="text-sm text-text-secondary">¿En qué te ayudo hoy?</p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void send(s)}
                      className="rounded-full border border-border-strong bg-surface px-3 py-1.5 text-xs text-text-secondary transition duration-200 ease-brand hover:border-navy/25 hover:bg-lima/10 hover:text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {transcript.map((entry, i) => {
              const streaming =
                busy && i === transcript.length - 1 && entry.role === "assistant" && !entry.actions;
              return (
                <div key={i}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed ${
                      entry.role === "user"
                        ? "ml-auto rounded-br-[4px] bg-navy text-white"
                        : "rounded-bl-[4px] bg-niebla text-navy"
                    }`}
                  >
                    {entry.content}
                    {streaming && (
                      <span
                        aria-hidden="true"
                        className="ml-0.5 inline-block h-3.5 w-[7px] animate-livepulse bg-navy align-text-bottom"
                      />
                    )}
                  </div>
                  {entry.actions?.map((action, j) => {
                    const key = `${i}-${j}`;
                    const done = executed.has(key);
                    if (done) {
                      return (
                        <div
                          key={key}
                          className="mt-2 flex max-w-[85%] flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm opacity-85"
                        >
                          <CircleCheck
                            aria-hidden="true"
                            className="h-4 w-4 flex-none text-success"
                            strokeWidth={2}
                          />
                          <span className="font-medium text-navy">{action.summary}</span>
                          <span className="ml-auto">
                            <Badge tone="success">Aplicada</Badge>
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={key}
                        className="mt-2 max-w-[85%] space-y-2 rounded-xl border border-lima bg-lima/20 px-3.5 py-3"
                      >
                        <div className="flex items-center gap-2">
                          <Zap
                            aria-hidden="true"
                            className="h-[15px] w-[15px] flex-none text-lime-ink"
                            strokeWidth={2}
                          />
                          <span className="min-w-0 text-[13px] font-semibold text-navy">
                            {action.summary}
                          </span>
                          <span className="ml-auto shrink-0 font-mono text-[11px] text-text-tertiary">
                            {action.kind}
                          </span>
                        </div>
                        {paramChips(action.params).length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {paramChips(action.params).map((c) => (
                              <span
                                key={c}
                                className="rounded-full border border-lima/70 bg-surface px-2.5 py-0.5 font-mono text-[11px] text-lime-ink"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="cta"
                            icon={<Check />}
                            onClick={() => void confirm(action, key)}
                            disabled={busy}
                          >
                            Confirmar y ejecutar
                          </Button>
                          <span className="text-[11.5px] text-text-tertiary">
                            {KIND_HINTS[action.kind]}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {busy && lastEntry?.role === "user" && (
              <div className="text-sm text-text-tertiary">El Copiloto está pensando…</div>
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={onSubmit} className="mt-3 flex gap-2 border-t border-border pt-3">
            <input
              className={inputClass}
              placeholder='Ej: "Planea los pedidos de hoy en las 2 motos" o "¿qué pasó con MV-…?"'
              aria-label="Mensaje para el Copiloto"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
            />
            {busy ? (
              <Button type="button" variant="secondary" icon={<CircleStop />} onClick={stop}>
                Detener
              </Button>
            ) : (
              <Button type="submit" icon={<Send />} disabled={!input.trim()}>
                Enviar
              </Button>
            )}
          </form>
        </div>
      </Card>
    </div>
  );
}
