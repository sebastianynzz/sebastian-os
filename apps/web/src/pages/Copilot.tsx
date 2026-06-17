import { useRef, useState, type FormEvent } from "react";
import { api, BASE_URL, getToken } from "../api";
import { useAuth } from "../auth";
import {
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
        note = `✅ ${res.resultEs ?? "Propuesta aplicada."}`;
      } else if (action.kind === "PLAN_ROUTES") {
        const res = await api<{ routes: unknown[]; unassigned: unknown[] }>(
          "POST",
          "/optimization/plans",
          { ...action.params, depot: DEPOT },
        );
        note = `✅ Plan ejecutado: ${res.routes.length} ruta(s) creada(s), ${res.unassigned.length} pedido(s) sin asignar. Revísalo en Rutas.`;
      } else if (action.kind === "INSERT_ORDER") {
        await api("POST", `/optimization/routes/${String(action.params.routeId)}/insert`, {
          orderId: action.params.orderId,
        });
        note = "✅ Pedido insertado en la ruta.";
      } else if (action.kind === "DISPATCH_ROUTE") {
        await api("POST", `/routes/${String(action.params.routeId)}/dispatch`, {
          driverId: action.params.driverId,
        });
        note = "✅ Ruta despachada: el conductor ya la ve en su app.";
      } else {
        await api("POST", `/orders/${String(action.params.orderId)}/recovery/flag`);
        note = "✅ Comercio notificado para reprogramar.";
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Copiloto IA"
        subtitle="Pídele planear, explicar fallos o vigilar la operación. Toda acción requiere tu confirmación."
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
              <div className="space-y-2 py-8 text-center text-sm text-navy/50">
                <p>¿En qué te ayudo hoy?</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void send(s)}
                      className="rounded-full border border-cielo px-3 py-1.5 text-xs text-navy/70 hover:bg-cielo/20"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {transcript.map((entry, i) => (
              <div key={i}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                    entry.role === "user"
                      ? "ml-auto bg-navy text-white"
                      : "bg-niebla text-navy"
                  }`}
                >
                  {entry.content}
                </div>
                {entry.actions?.map((action, j) => {
                  const key = `${i}-${j}`;
                  const done = executed.has(key);
                  return (
                    <div
                      key={key}
                      className="mt-2 flex max-w-[85%] flex-wrap items-center justify-between gap-2 rounded-xl border border-lima bg-lima/10 px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-navy">
                        {done ? "✅ " : "⚡ "}
                        {action.summary}
                      </span>
                      {!done && (
                        <Button onClick={() => void confirm(action, key)} disabled={busy}>
                          Confirmar y ejecutar
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {busy && <div className="text-sm text-navy/40">El Copiloto está pensando…</div>}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={onSubmit} className="mt-3 flex gap-2 border-t border-niebla pt-3">
            <input
              className={inputClass}
              placeholder='Ej: "Planea los pedidos de hoy en las 2 motos" o "¿qué pasó con MV-…?"'
              aria-label="Mensaje para el Copiloto"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
            />
            {busy ? (
              <Button type="button" variant="secondary" onClick={stop}>
                Detener
              </Button>
            ) : (
              <Button type="submit" disabled={!input.trim()}>
                Enviar
              </Button>
            )}
          </form>
        </div>
      </Card>
    </div>
  );
}
