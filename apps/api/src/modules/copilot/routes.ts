import type { FastifyInstance } from "fastify";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import type { ActionContext, ActionRole } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";
import { requireModule } from "../../plugins/entitlements.js";
import { computeExceptions } from "../../services/exceptions.js";
import { LOW_CONFIDENCE_THRESHOLD } from "../../services/geocoding.js";
import { addDays, todayBogota } from "../../services/dailyMetrics.js";
import { AiActionError, applyProposal, runAction } from "../ai/executor.js";

/**
 * Copiloto MoveOS — la cara visible del nivel de IA (módulo AI_ADDONS).
 *
 * Es una capa delgada de LLM sobre sistemas que ya existen: lee la bitácora,
 * el optimizador (que ya emite razones legibles), el cockpit de excepciones y
 * el grafo de direcciones, y NARRA en español. No necesita inteligencia nueva
 * para sentirse inteligente el día uno.
 *
 * Guardia de confirmación: las herramientas `proponer_*` NUNCA mutan datos.
 * Devuelven una propuesta estructurada que la UI muestra con botón de
 * confirmación; al confirmar, el frontend llama el endpoint real existente
 * (/optimization/plans, /routes/:id/dispatch, etc.). El modelo no ejecuta.
 */

const MODEL = process.env.COPILOT_MODEL ?? "claude-opus-4-8";
const MAX_LOOP = 8;

/**
 * Thinking adaptativo en todos los modelos salvo Haiku, que no acepta el
 * parámetro (en producción el roadmap fija COPILOT_MODEL=claude-haiku-4-5
 * por costo, P0.1 — sin thinking responde directo, suficiente para narrar
 * herramientas existentes). Regla por exclusión y no por lista de
 * versiones: un modelo futuro no degrada en silencio.
 */
const SUPPORTS_ADAPTIVE_THINKING = !MODEL.includes("haiku");
const THINKING_PARAMS = SUPPORTS_ADAPTIVE_THINKING
  ? ({ thinking: { type: "adaptive" } } as const)
  : {};

/**
 * Prompt caching (P0.1): bloque de system con breakpoint — junto al de la
 * última herramienta, cachea tools+system por tenant (el system cambia por
 * día, por la fecha de Bogotá; el esquema de tools sobrevive igual porque
 * se renderiza antes).
 */
function systemBlocks(tenant: {
  name: string;
  city: string;
}): Anthropic.TextBlockParam[] {
  return [
    {
      type: "text",
      text: systemPrompt(tenant),
      cache_control: { type: "ephemeral" },
    },
  ];
}

let anthropic: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
}

/**
 * Acción propuesta que la UI sabe confirmar y ejecutar.
 *
 * Unificación con la capa de IA: las propuestas de OPTIMIZACIÓN (planear rutas,
 * inserción exprés) se generan vía el registro (`runAction`), persisten un
 * `AiProposal` y se confirman por la MISMA ruta de aplicación que los botones
 * (`/copilot/actions/confirm` → `applyProposal`). Llevan `proposalId`. Las
 * acciones puramente operativas (despacho, recuperación B2B) conservan su
 * confirmación contra el endpoint existente (no son acciones de optimización).
 */
export interface CopilotAction {
  kind: "PLAN_ROUTES" | "INSERT_ORDER" | "DISPATCH_ROUTE" | "FLAG_RECOVERY";
  summary: string;
  params: Record<string, unknown>;
  /** Si está presente, se confirma por la ruta de aplicación compartida. */
  proposalId?: string;
  feasible?: boolean;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "listar_excepciones",
    description:
      "Devuelve el cockpit de excepciones del tenant: rutas tarde, vehículos sin señal, desvíos, pánico, EVs con batería baja, entregas fallidas por recuperar y direcciones sin confirmar. Llámala cuando pregunten qué está pasando, qué requiere atención o por el estado de la operación.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "consultar_pedido",
    description:
      "Busca un pedido por número de guía (MV-XXXXXXXX) o id y devuelve su bitácora completa de eventos, prueba de entrega (POD: foto, geofence, receptor), paradas y estado de recuperación. Llámala para responder '¿qué pasó con el pedido X?' o '¿por qué falló?'.",
    input_schema: {
      type: "object",
      properties: {
        guia: { type: "string", description: "Número de guía MV-… o id del pedido" },
      },
      required: ["guia"],
      additionalProperties: false,
    },
  },
  {
    name: "listar_pedidos",
    description:
      "Lista pedidos del tenant filtrando por estado (PENDING, GEOCODED, ASSIGNED, IN_TRANSIT, DELIVERED, FAILED, REJECTED). Úsala para saber cuántos pedidos hay por planificar, fallidos, etc.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Estado a filtrar (opcional)" },
        limit: { type: "number", description: "Máximo de filas (por defecto 50)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "listar_vehiculos",
    description:
      "Lista la flota: placa, tipo (MOTO/CARRO/VAN/...), capacidad, si es eléctrico, estado de carga (SoC) y vencimientos de SOAT/tecnomecánica. Úsala antes de proponer un plan de rutas.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "listar_rutas",
    description:
      "Lista las rutas de una fecha (YYYY-MM-DD, por defecto hoy) con vehículo, conductor, estado y paradas pendientes/completadas.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "Fecha YYYY-MM-DD" } },
      additionalProperties: false,
    },
  },
  {
    name: "direcciones_baja_confianza",
    description:
      "Devuelve los pedidos por despachar cuya dirección tiene baja confianza de geocodificación (cola de triage). Úsala para el triage de direcciones antes de planificar.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "estadisticas_grafo_direcciones",
    description:
      "Métricas del grafo de direcciones aprendidas del tenant: pines totales, pines nuevos (7/30 días) y graph hit rate (porcentaje de geocodificaciones resueltas por el grafo sin pagar proveedor). Úsala para preguntas sobre el aprendizaje de direcciones o el flywheel.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "proponer_plan",
    description:
      "PROPONE (no ejecuta) un plan de optimización de rutas para una fecha con pedidos y vehículos específicos. El usuario debe confirmar en la UI antes de ejecutarse. Antes de llamarla, consulta pedidos GEOCODED y la flota disponibles. Si el usuario pide 'planear todo', usa todos los pedidos GEOCODED y todos los vehículos.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Fecha del plan YYYY-MM-DD" },
        orderIds: { type: "array", items: { type: "string" } },
        vehicleIds: { type: "array", items: { type: "string" } },
      },
      required: ["date", "orderIds", "vehicleIds"],
      additionalProperties: false,
    },
  },
  {
    name: "proponer_insercion",
    description:
      "PROPONE (no ejecuta) insertar un pedido pendiente en una ruta ya planificada o en curso (inserción exprés). El usuario confirma en la UI.",
    input_schema: {
      type: "object",
      properties: {
        routeId: { type: "string" },
        orderId: { type: "string" },
      },
      required: ["routeId", "orderId"],
      additionalProperties: false,
    },
  },
  {
    name: "proponer_despacho",
    description:
      "PROPONE (no ejecuta) despachar una ruta PLANNED asignándole un conductor. El usuario confirma en la UI.",
    input_schema: {
      type: "object",
      properties: {
        routeId: { type: "string" },
        driverId: { type: "string" },
      },
      required: ["routeId", "driverId"],
      additionalProperties: false,
    },
  },
  {
    name: "proponer_recuperacion",
    description:
      "PROPONE (no ejecuta) marcar un pedido fallido para recuperación B2B: se notifica al comercio para que reprograme desde su portal. El usuario confirma en la UI.",
    input_schema: {
      type: "object",
      properties: { orderId: { type: "string" } },
      required: ["orderId"],
      additionalProperties: false,
    },
    // Prompt caching (P0.1): el breakpoint en la ÚLTIMA herramienta cachea
    // todo el esquema de tools — estable entre tenants, días y peticiones.
    cache_control: { type: "ephemeral" },
  },
];

function systemPrompt(tenant: { name: string; city: string }): string {
  return `Eres el Copiloto de MoveOS, la plataforma de última milla del operador "${tenant.name}" (${tenant.city}, Colombia). Hoy es ${todayBogota()} (hora de Bogotá).

Tu trabajo: ayudar al despachador a operar el día — planear rutas, vigilar excepciones, explicar por qué pasó algo (bitácora, POD, geofence) y cuidar la calidad de direcciones.

Reglas:
- Responde SIEMPRE en español colombiano claro y operativo. Sé breve: el despachador está trabajando.
- Usa las herramientas para leer datos reales antes de afirmar algo. Nunca inventes guías, placas ni cifras.
- Las herramientas proponer_* NO ejecutan nada: registran una propuesta que el usuario confirma con un botón. Cuando propongas, di claramente qué quedó propuesto y que requiere su confirmación. Nunca digas que algo ya se ejecutó.
- Al narrar resultados del optimizador o exclusiones (pico y placa, capacidad, autonomía EV), cita las razones tal cual vienen del sistema.
- MoveOS es B2B: las recuperaciones de entregas fallidas se gestionan a través del comercio, nunca contactando al consumidor final.
- Si te piden algo fuera de la operación logística del tenant, declina con cortesía.`;
}

/** Ejecuta una herramienta de lectura y devuelve su resultado serializable. */
async function runReadTool(
  tenantId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "listar_excepciones":
      return computeExceptions(tenantId);

    case "consultar_pedido": {
      const guia = String(input.guia ?? "").trim();
      const order = await prisma.order.findFirst({
        where: {
          tenantId,
          OR: [{ trackingNumber: guia.toUpperCase() }, { id: guia }],
        },
        include: {
          client: { select: { name: true, notifyChannel: true } },
          events: { orderBy: { createdAt: "asc" } },
          stops: {
            orderBy: { sequence: "asc" },
            include: {
              pod: true,
              route: { select: { id: true, date: true, status: true } },
            },
          },
        },
      });
      if (!order) return { error: `No existe el pedido ${guia} en este tenant` };
      return order;
    }

    case "listar_pedidos": {
      const status = typeof input.status === "string" ? input.status : undefined;
      const limit = Math.min(Number(input.limit) || 50, 100);
      const orders = await prisma.order.findMany({
        where: { tenantId, ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          trackingNumber: true,
          customerName: true,
          addressRaw: true,
          status: true,
          weightKg: true,
          priority: true,
          geoConfidence: true,
          recoveryStatus: true,
          failureReason: true,
          client: { select: { name: true } },
        },
      });
      return { count: orders.length, orders };
    }

    case "listar_vehiculos":
      return prisma.vehicle.findMany({
        where: { tenantId },
        select: {
          id: true,
          plate: true,
          type: true,
          capacityKg: true,
          isElectric: true,
          socPercent: true,
          nominalRangeKm: true,
          soatExpiresAt: true,
          tecnoExpiresAt: true,
          lastSeenAt: true,
          engineOn: true,
          immobilized: true,
        },
      });

    case "listar_rutas": {
      const date =
        typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date)
          ? input.date
          : todayBogota();
      const routes = await prisma.route.findMany({
        where: { tenantId, date },
        include: {
          vehicle: { select: { plate: true, type: true, isElectric: true } },
          driver: { select: { id: true, name: true } },
          stops: { select: { status: true, kind: true } },
        },
      });
      return routes.map((r) => ({
        id: r.id,
        date: r.date,
        status: r.status,
        vehicle: r.vehicle,
        driver: r.driver,
        totalDistanceKm: r.totalDistanceKm,
        warnings: r.warnings,
        stopsTotal: r.stops.length,
        stopsPending: r.stops.filter((s) => ["PENDING", "ARRIVED"].includes(s.status)).length,
      }));
    }

    case "direcciones_baja_confianza": {
      const orders = await prisma.order.findMany({
        where: {
          tenantId,
          status: { in: ["PENDING", "GEOCODED", "ASSIGNED"] },
          addressVerifiedAt: null,
          OR: [
            { geoConfidence: { lt: LOW_CONFIDENCE_THRESHOLD } },
            { geoConfidence: null },
            { geocodeSource: "MOCK" },
          ],
        },
        take: 50,
        select: {
          id: true,
          trackingNumber: true,
          customerName: true,
          addressRaw: true,
          geocodeSource: true,
          geoConfidence: true,
        },
      });
      return { threshold: LOW_CONFIDENCE_THRESHOLD, count: orders.length, orders };
    }

    case "estadisticas_grafo_direcciones": {
      const to = todayBogota();
      const from = addDays(to, -29);
      const [totalPins, pins7d, pins30d, stats] = await Promise.all([
        prisma.addressPin.count({ where: { tenantId } }),
        prisma.addressPin.count({
          where: { tenantId, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } },
        }),
        prisma.addressPin.count({
          where: { tenantId, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
        }),
        prisma.geocodeDailyStat.findMany({ where: { tenantId, date: { gte: from, lte: to } } }),
      ]);
      const total = stats.reduce((a, s) => a + s.count, 0);
      const hits = stats.filter((s) => s.source === "ADDRESS_PIN").reduce((a, s) => a + s.count, 0);
      return {
        totalPins,
        newPins7d: pins7d,
        newPins30d: pins30d,
        geocodes30d: total,
        graphHits30d: hits,
        hitRate30d: total === 0 ? null : hits / total,
      };
    }

    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

/**
 * Valida una propuesta de mutación contra la base (sin ejecutarla) y la
 * convierte en una CopilotAction que la UI puede confirmar.
 */
async function buildProposal(
  ctx: ActionContext,
  name: string,
  input: Record<string, unknown>,
): Promise<{ action?: CopilotAction; result: unknown }> {
  const tenantId = ctx.tenantId;
  switch (name) {
    case "proponer_plan": {
      const date = String(input.date ?? todayBogota());
      const orderIds = Array.isArray(input.orderIds) ? input.orderIds.map(String) : [];
      const vehicleIds = Array.isArray(input.vehicleIds) ? input.vehicleIds.map(String) : [];
      // Mismo registro y misma ruta de aplicación que los botones: genera un
      // AiProposal real (el solver hace la matemática; persiste para auditar).
      const proposal = await runAction("optimize_routes", {
        ...ctx,
        orderIds,
        vehicleIds,
        date,
      });
      const action: CopilotAction = {
        kind: "PLAN_ROUTES",
        summary: proposal.summaryEs,
        params: { date, orderIds, vehicleIds },
        proposalId: proposal.proposalId,
        feasible: proposal.feasible,
      };
      return {
        action,
        result: {
          propuesta_registrada: true,
          proposalId: proposal.proposalId,
          feasible: proposal.feasible,
          resumen: proposal.summaryEs,
          impacto: proposal.impact,
          nota: "Preséntala al usuario: debe confirmarla con el botón antes de ejecutarse.",
        },
      };
    }

    case "proponer_insercion": {
      const routeId = String(input.routeId ?? "");
      const orderId = String(input.orderId ?? "");
      const proposal = await runAction("reoptimize_route", {
        ...ctx,
        routeId,
        params: { orderId },
      });
      if (!proposal.feasible) {
        return {
          result: {
            error:
              "No fue posible insertar el pedido (ruta/pedido inválidos o no cabe). " +
              (proposal.impact.notesEs?.join(" ") ?? ""),
          },
        };
      }
      const action: CopilotAction = {
        kind: "INSERT_ORDER",
        summary: proposal.summaryEs,
        params: { routeId, orderId },
        proposalId: proposal.proposalId,
        feasible: proposal.feasible,
      };
      return { action, result: { propuesta_registrada: true, proposalId: proposal.proposalId } };
    }

    case "proponer_despacho": {
      const routeId = String(input.routeId ?? "");
      const driverId = String(input.driverId ?? "");
      const [route, driver] = await Promise.all([
        prisma.route.findFirst({
          where: { id: routeId, tenantId, status: "PLANNED" },
          include: { vehicle: { select: { plate: true } } },
        }),
        prisma.driver.findFirst({ where: { id: driverId, tenantId }, select: { id: true, name: true } }),
      ]);
      if (!route) return { result: { error: "La ruta no existe o no está PLANNED" } };
      if (!driver) return { result: { error: "Conductor no encontrado" } };
      const action: CopilotAction = {
        kind: "DISPATCH_ROUTE",
        summary: `Despachar la ruta de ${route.vehicle.plate} con ${driver.name}`,
        params: { routeId: route.id, driverId: driver.id },
      };
      return { action, result: { propuesta_registrada: true } };
    }

    case "proponer_recuperacion": {
      const orderId = String(input.orderId ?? "");
      const order = await prisma.order.findFirst({
        where: { id: orderId, tenantId, status: { in: ["FAILED", "REJECTED"] }, recoveryStatus: "NONE" },
        select: { id: true, trackingNumber: true, customerName: true, client: { select: { name: true } } },
      });
      if (!order) {
        return { result: { error: "El pedido no es recuperable (debe estar FAILED/REJECTED y sin recuperación iniciada)" } };
      }
      const action: CopilotAction = {
        kind: "FLAG_RECOVERY",
        summary: `Notificar a ${order.client?.name ?? "el comercio"} para reprogramar ${order.trackingNumber ?? order.id}`,
        params: { orderId: order.id },
      };
      return { action, result: { propuesta_registrada: true } };
    }

    default:
      return { result: { error: `Propuesta desconocida: ${name}` } };
  }
}

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
});

export default async function copilotRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", requireModule("AI_ADDONS"));

  app.post(
    "/chat",
    {
      preHandler: [requireRole("ADMIN", "DISPATCHER")],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const client = getClient();
      if (!client) {
        return reply.code(503).send({
          error: "El Copiloto no está configurado (falta ANTHROPIC_API_KEY)",
          code: "COPILOT_NOT_CONFIGURED",
        });
      }

      const { messages } = chatSchema.parse(request.body);
      const tenantId = request.user.tenantId;
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { name: true, city: true },
      });

      const history: Anthropic.MessageParam[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const actions: CopilotAction[] = [];

      try {
        let response = await client.messages.create({
          model: MODEL,
          max_tokens: 4096,
          ...THINKING_PARAMS,
          system: systemBlocks(tenant),
          tools: TOOLS,
          messages: history,
        });

        for (let i = 0; i < MAX_LOOP && response.stop_reason === "tool_use"; i++) {
          const toolUses = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          history.push({ role: "assistant", content: response.content });

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tool of toolUses) {
            const input = (tool.input ?? {}) as Record<string, unknown>;
            let payload: unknown;
            try {
              if (tool.name.startsWith("proponer_")) {
                const actionCtx: ActionContext = {
                  tenantId,
                  userId: request.user.sub,
                  role: request.user.role as ActionRole,
                };
                const { action, result } = await buildProposal(actionCtx, tool.name, input);
                if (action) actions.push(action);
                payload = result;
              } else {
                payload = await runReadTool(tenantId, tool.name, input);
              }
            } catch (err) {
              payload = { error: err instanceof Error ? err.message : "Error ejecutando la herramienta" };
            }
            results.push({
              type: "tool_result",
              tool_use_id: tool.id,
              content: JSON.stringify(payload),
            });
          }
          history.push({ role: "user", content: results });

          response = await client.messages.create({
            model: MODEL,
            max_tokens: 4096,
            ...THINKING_PARAMS,
            system: systemBlocks(tenant),
            tools: TOOLS,
            messages: history,
          });
        }

        if (response.stop_reason === "refusal") {
          return {
            reply:
              "No puedo ayudar con esa solicitud. ¿Hay algo más de la operación en lo que te apoye?",
            actions: [],
          };
        }

        const reply_ = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return { reply: reply_ || "Listo.", actions };
      } catch (err) {
        if (err instanceof Anthropic.APIError) {
          request.log.error({ status: err.status, message: err.message }, "Copilot API error");
          return reply.code(502).send({
            error: "El Copiloto no pudo responder (error del proveedor de IA)",
            code: "COPILOT_UPSTREAM_ERROR",
          });
        }
        throw err;
      }
    },
  );

  /**
   * Igual que /chat pero con respuesta en STREAMING (NDJSON sobre fetch): el
   * Copiloto escribe la narración token a token mientras el bucle de
   * herramientas corre en el servidor. Mismas invariantes: las mutaciones solo
   * se PROPONEN (las acciones llegan en el evento `done`, jamás se ejecutan),
   * todo acotado por tenant y en español.
   *
   * Una línea JSON por evento:
   *   {type:"delta", text}     fragmento de texto del asistente
   *   {type:"tools"}           el modelo está usando herramientas (estado)
   *   {type:"done", actions}   fin: propuestas por confirmar
   *   {type:"error", code, message}
   */
  app.post(
    "/chat/stream",
    {
      preHandler: [requireRole("ADMIN", "DISPATCHER")],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const client = getClient();
      if (!client) {
        return reply.code(503).send({
          error: "El Copiloto no está configurado (falta ANTHROPIC_API_KEY)",
          code: "COPILOT_NOT_CONFIGURED",
        });
      }

      const { messages } = chatSchema.parse(request.body);
      const tenantId = request.user.tenantId;
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { name: true, city: true },
      });

      const history: Anthropic.MessageParam[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const actions: CopilotAction[] = [];

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // Desconexión del cliente: sin listener de 'error', un RST del socket
      // sería una excepción no capturada (misma clase de bug que el SSE de
      // realtime). Además aborta el stream de Anthropic en curso para no
      // seguir quemando tokens y herramientas hablando con nadie.
      let clientGone = false;
      let activeStream: { abort: () => void } | null = null;
      const onDisconnect = () => {
        clientGone = true;
        activeStream?.abort();
      };
      request.raw.on("close", onDisconnect);
      request.raw.on("error", onDisconnect);
      reply.raw.on("error", onDisconnect);

      const writeLine = (obj: unknown) => {
        if (clientGone || reply.raw.writableEnded) return;
        try {
          reply.raw.write(JSON.stringify(obj) + "\n");
        } catch {
          clientGone = true;
        }
      };
      const endStream = () => {
        try {
          if (!reply.raw.writableEnded) reply.raw.end();
        } catch {
          // Socket ya destruido: nada que cerrar.
        }
      };

      // Cada turno del modelo se transmite; el texto sale por deltas y al final
      // recuperamos el mensaje completo para seguir el bucle de herramientas.
      const streamTurn = async (): Promise<Anthropic.Message> => {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 4096,
          ...THINKING_PARAMS,
          system: systemBlocks(tenant),
          tools: TOOLS,
          messages: history,
        });
        activeStream = stream;
        stream.on("text", (delta: string) => writeLine({ type: "delta", text: delta }));
        try {
          return await stream.finalMessage();
        } finally {
          activeStream = null;
        }
      };

      try {
        let response = await streamTurn();

        for (
          let i = 0;
          i < MAX_LOOP && !clientGone && response.stop_reason === "tool_use";
          i++
        ) {
          const toolUses = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          history.push({ role: "assistant", content: response.content });
          writeLine({ type: "tools" });

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tool of toolUses) {
            const input = (tool.input ?? {}) as Record<string, unknown>;
            let payload: unknown;
            try {
              if (tool.name.startsWith("proponer_")) {
                const actionCtx: ActionContext = {
                  tenantId,
                  userId: request.user.sub,
                  role: request.user.role as ActionRole,
                };
                const { action, result } = await buildProposal(actionCtx, tool.name, input);
                if (action) actions.push(action);
                payload = result;
              } else {
                payload = await runReadTool(tenantId, tool.name, input);
              }
            } catch (err) {
              payload = {
                error: err instanceof Error ? err.message : "Error ejecutando la herramienta",
              };
            }
            results.push({
              type: "tool_result",
              tool_use_id: tool.id,
              content: JSON.stringify(payload),
            });
          }
          history.push({ role: "user", content: results });

          response = await streamTurn();
        }

        if (response.stop_reason === "refusal") {
          writeLine({
            type: "delta",
            text: "No puedo ayudar con esa solicitud. ¿Hay algo más de la operación en lo que te apoye?",
          });
          writeLine({ type: "done", actions: [] });
          endStream();
          return;
        }

        writeLine({ type: "done", actions });
        endStream();
      } catch (err) {
        if (clientGone) {
          // El abort por desconexión hace rechazar finalMessage(): no es un
          // error del proveedor, solo un cliente que cerró la pestaña.
          endStream();
          return;
        }
        if (err instanceof Anthropic.APIError) {
          request.log.error({ status: err.status, message: err.message }, "Copilot stream API error");
          writeLine({
            type: "error",
            code: "COPILOT_UPSTREAM_ERROR",
            message: "El Copiloto no pudo responder (error del proveedor de IA)",
          });
        } else {
          request.log.error(err, "Copilot stream error");
          writeLine({
            type: "error",
            code: "COPILOT_ERROR",
            message: "Error interno del Copiloto",
          });
        }
        endStream();
      }
    },
  );

  /**
   * Confirmación de una propuesta de optimización generada por el chat. Llama
   * EXACTAMENTE el mismo ejecutor que `/ai/actions/:id/apply` — una sola ruta
   * de aplicación, una sola bitácora de auditoría. Solo aplica propuestas de
   * optimización (las acciones operativas despacho/recuperación se confirman
   * contra su endpoint existente desde la UI).
   */
  app.post(
    "/actions/confirm",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const { proposalId } = z
        .object({ proposalId: z.string().min(1) })
        .parse(request.body);
      try {
        const result = await applyProposal(proposalId, {
          tenantId: request.user.tenantId,
          userId: request.user.sub,
          role: request.user.role as ActionRole,
        });
        return reply.send(result);
      } catch (err) {
        if (err instanceof AiActionError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );
}
