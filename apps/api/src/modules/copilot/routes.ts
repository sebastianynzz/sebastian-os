import type { FastifyInstance } from "fastify";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";
import { requireModule } from "../../plugins/entitlements.js";
import { computeExceptions } from "../../services/exceptions.js";
import { LOW_CONFIDENCE_THRESHOLD } from "../../services/geocoding.js";
import { addDays, todayBogota } from "../../services/dailyMetrics.js";

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
 * Thinking adaptativo solo en los modelos que lo soportan (Opus/Sonnet 4.6+,
 * Fable). En producción el roadmap fija COPILOT_MODEL=claude-haiku-4-5 por
 * costo (P0.1) y Haiku no acepta el parámetro — se omite y el modelo
 * responde directo, suficiente para narrar herramientas existentes.
 */
const SUPPORTS_ADAPTIVE_THINKING =
  /claude-(opus-4-[6-9]|sonnet-4-[6-9]|fable|mythos)/.test(MODEL);
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

/** Acción propuesta que la UI sabe confirmar y ejecutar. */
export interface CopilotAction {
  kind: "PLAN_ROUTES" | "INSERT_ORDER" | "DISPATCH_ROUTE" | "FLAG_RECOVERY";
  summary: string;
  params: Record<string, unknown>;
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
  tenantId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<{ action?: CopilotAction; result: unknown }> {
  switch (name) {
    case "proponer_plan": {
      const date = String(input.date ?? todayBogota());
      const orderIds = Array.isArray(input.orderIds) ? input.orderIds.map(String) : [];
      const vehicleIds = Array.isArray(input.vehicleIds) ? input.vehicleIds.map(String) : [];
      const [orders, vehicles, tenant] = await Promise.all([
        prisma.order.findMany({
          where: { id: { in: orderIds }, tenantId, status: { in: ["PENDING", "GEOCODED"] } },
          select: { id: true },
        }),
        prisma.vehicle.findMany({
          where: { id: { in: vehicleIds }, tenantId },
          select: { id: true, plate: true },
        }),
        prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { city: true } }),
      ]);
      if (orders.length === 0 || vehicles.length === 0) {
        return {
          result: {
            error:
              "No hay pedidos planificables o vehículos válidos entre los ids dados. Consulta listar_pedidos (status GEOCODED) y listar_vehiculos.",
          },
        };
      }
      const action: CopilotAction = {
        kind: "PLAN_ROUTES",
        summary: `Planificar ${orders.length} pedido(s) en ${vehicles.length} vehículo(s) para el ${date} (${tenant.city})`,
        params: { date, orderIds: orders.map((o) => o.id), vehicleIds: vehicles.map((v) => v.id) },
      };
      return {
        action,
        result: {
          propuesta_registrada: true,
          pedidosValidos: orders.length,
          vehiculosValidos: vehicles.length,
          nota: "Preséntala al usuario: debe confirmarla con el botón antes de ejecutarse.",
        },
      };
    }

    case "proponer_insercion": {
      const routeId = String(input.routeId ?? "");
      const orderId = String(input.orderId ?? "");
      const [route, order] = await Promise.all([
        prisma.route.findFirst({
          where: { id: routeId, tenantId, status: { in: ["PLANNED", "DISPATCHED", "IN_PROGRESS"] } },
          include: { vehicle: { select: { plate: true } } },
        }),
        prisma.order.findFirst({
          where: { id: orderId, tenantId, status: { in: ["PENDING", "GEOCODED"] } },
          select: { id: true, trackingNumber: true, customerName: true },
        }),
      ]);
      if (!route) return { result: { error: "Ruta no válida para inserción" } };
      if (!order) return { result: { error: "Pedido no válido (debe estar PENDING/GEOCODED y sin asignar)" } };
      const action: CopilotAction = {
        kind: "INSERT_ORDER",
        summary: `Insertar ${order.trackingNumber ?? order.id} (${order.customerName}) en la ruta de ${route.vehicle.plate}`,
        params: { routeId: route.id, orderId: order.id },
      };
      return { action, result: { propuesta_registrada: true } };
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
                const { action, result } = await buildProposal(tenantId, tool.name, input);
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
}
