import Anthropic from "@anthropic-ai/sdk";
import type { OptimizationActionId, ProposalImpact } from "@moveos/shared";

/**
 * Narración en español de una propuesta. El LLM (Haiku por defecto) SOLO
 * explica: recibe el impacto ya calculado por el solver determinista y lo
 * redacta de forma operativa, sin inventar cifras (CLAUDE.md: "el LLM solo
 * dispara y explica; los solvers hacen la matemática"). Si no hay
 * ANTHROPIC_API_KEY, se devuelve la plantilla determinista — todo funciona
 * sin proveedor de IA.
 */

const MODEL =
  process.env.AI_ACTIONS_MODEL ?? process.env.COPILOT_MODEL ?? "claude-haiku-4-5";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM = `Eres el asistente de optimización de daleGo (última milla, Colombia).
Te paso el RESULTADO ya calculado por un solver determinista (JSON). Tu única
tarea es redactarlo en español colombiano claro y operativo para un despachador,
en 1-2 frases. Reglas estrictas:
- Usa SOLO las cifras del JSON. Nunca inventes números, guías ni placas.
- No prometas que "ya se ejecutó": es una propuesta que el usuario debe confirmar.
- Si hay pedidos sin asignar o vehículos excluidos, menciónalo con su razón.
- Sé breve. Sin saludos ni despedidas.`;

export async function explainProposal(
  actionId: OptimizationActionId,
  fallbackSummary: string,
  impact: ProposalImpact,
): Promise<string> {
  const c = getClient();
  if (!c) return fallbackSummary;
  try {
    const resp = await c.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Acción: ${actionId}\nResultado: ${JSON.stringify(impact)}`,
        },
      ],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || fallbackSummary;
  } catch {
    // El proveedor falló: la plantilla determinista es suficiente.
    return fallbackSummary;
  }
}
