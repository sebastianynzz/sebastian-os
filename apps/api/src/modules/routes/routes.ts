import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  failStopSchema,
  submitPodSchema,
  haversineKm,
  resolvePodReq,
  type PodPolicyConfig,
} from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";
import { learnAddressPin } from "../../services/geocoding.js";
import { notifyClient, publicTrackingUrl } from "../../services/notifications.js";
import { logOrderEvent, logOrderEvents } from "../../services/orderEvents.js";
import { sendPushToDriver } from "../../services/push.js";
import { emitOrderUpdate } from "../../services/realtime.js";

/** Selección de campos del cliente necesarios para notificar (B2B). */
const clientSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  notifyChannel: true,
  webhookUrl: true,
  podRequired: true,
} as const;

const GEOFENCE_RADIUS_KM = 0.3; // 300 m para validar POD georreferenciado

export default async function routesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const query = z.object({ date: z.string().optional() }).parse(request.query);
    return prisma.route.findMany({
      where: {
        tenantId: request.user.tenantId,
        ...(query.date ? { date: query.date } : {}),
      },
      include: {
        vehicle: true,
        driver: true,
        stops: {
          orderBy: { sequence: "asc" },
          include: { order: true, pod: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const route = await prisma.route.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: {
        vehicle: true,
        driver: true,
        stops: { orderBy: { sequence: "asc" }, include: { order: true, pod: true } },
      },
    });
    if (!route) return reply.code(404).send({ error: "Ruta no encontrada" });
    return route;
  });

  /** Despacho: asigna conductor y notifica a los clientes. */
  app.post(
    "/:id/dispatch",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z.object({ driverId: z.string() }).parse(request.body);

      const route = await prisma.route.findFirst({
        where: { id, tenantId: request.user.tenantId },
        include: {
          stops: { include: { order: { include: { client: { select: clientSelect } } } } },
        },
      });
      if (!route) return reply.code(404).send({ error: "Ruta no encontrada" });
      // Conflicto de transición (no "no encontrada"): otra persona ya la
      // despachó o ya está en curso. 409 para que el front lo distinga y
      // refresque la vista en vez de mostrar un error genérico.
      if (route.status !== "PLANNED") {
        return reply
          .code(409)
          .send({ error: "La ruta ya fue despachada o está en curso." });
      }

      const driver = await prisma.driver.findFirst({
        where: { id: body.driverId, tenantId: request.user.tenantId },
      });
      if (!driver) return reply.code(404).send({ error: "Conductor no encontrado" });

      const updated = await prisma.route.update({
        where: { id },
        data: { driverId: driver.id, status: "DISPATCHED" },
      });

      // Aviso instantáneo al conductor (roadmap D5): fire-and-forget — la
      // bitácora y las notificaciones B2B nunca esperan ni dependen del push
      // (si falla o no está configurado, el refresco de 45 s lo cubre).
      void sendPushToDriver(request.user.tenantId, driver.id, {
        title: "Nueva ruta asignada",
        body: `${route.stops.length} paradas te esperan — ábrela en la app`,
        url: "/",
      });

      // Un pedido con recogida tiene 2 paradas; deduplicar por pedido para no
      // registrar/notificar dos veces. La parada de entrega lleva la ETA final.
      const deliveryStops = route.stops.filter((s) => s.kind === "DELIVERY");
      const stopsByOrder = new Map(
        deliveryStops.length > 0
          ? deliveryStops.map((s) => [s.orderId, s])
          : route.stops.map((s) => [s.orderId, s]),
      );

      await logOrderEvents(
        [...stopsByOrder.keys()].map((orderId) => ({
          orderId,
          type: "DISPATCHED" as const,
          details: `Conductor: ${driver.name}`,
        })),
      );

      // B2B: avisar al negocio cliente que su envío salió a reparto.
      for (const stop of stopsByOrder.values()) {
        emitOrderUpdate(request.user.tenantId, stop.order);
        await notifyClient({
          tenantId: request.user.tenantId,
          orderId: stop.orderId,
          client: stop.order.client,
          template: "envio_en_reparto",
          payload: {
            guia: stop.order.trackingNumber,
            destinatario: stop.order.customerName,
            etaMin: stop.etaMin,
            conductor: driver.name,
            rastreo: publicTrackingUrl(stop.order.trackingToken),
          },
        });
      }
      return updated;
    },
  );

  /** El conductor inicia la ruta. */
  app.post("/:id/start", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const route = await prisma.route.findFirst({
      where: { id, tenantId: request.user.tenantId, status: "DISPATCHED" },
      include: { stops: true },
    });
    if (!route) return reply.code(404).send({ error: "Ruta no encontrada o no despachada" });
    if (request.user.role === "DRIVER" && route.driverId !== request.user.driverId) {
      return reply.code(403).send({ error: "Ruta de otro conductor" });
    }

    const orderIds = [...new Set(route.stops.map((s) => s.orderId))];
    await prisma.route.update({ where: { id }, data: { status: "IN_PROGRESS" } });
    await prisma.order.updateMany({
      where: { id: { in: orderIds } },
      data: { status: "IN_TRANSIT" },
    });
    await logOrderEvents(
      orderIds.map((orderId) => ({
        orderId,
        type: "IN_TRANSIT" as const,
        details: "El conductor inició la ruta",
      })),
    );
    // Tiempo real: dashboard, portal del cliente y rastreo público.
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, clientId: true, status: true, trackingNumber: true },
    });
    for (const order of orders) emitOrderUpdate(request.user.tenantId, order);
    // En B2B no se notifica "en camino" por cada parada (sería ruido): el
    // negocio ya fue avisado al despachar y se le confirma al entregar.
    return { ok: true };
  });

  /** Ruta del día para el conductor autenticado (app conductor). */
  app.get("/driver/today", async (request, reply) => {
    if (!request.user.driverId) {
      return reply.code(403).send({ error: "El usuario no es conductor" });
    }
    const route = await prisma.route.findFirst({
      where: {
        tenantId: request.user.tenantId,
        driverId: request.user.driverId,
        status: { in: ["DISPATCHED", "IN_PROGRESS"] },
      },
      include: {
        vehicle: true,
        stops: {
          orderBy: { sequence: "asc" },
          include: {
            order: { include: { client: { select: { podRequired: true } } } },
            pod: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return route ?? null;
  });

  /**
   * Escaneo del paquete (D3): vincula el bulto a la parada y deja registro
   * de cadena de custodia en la bitácora. La app valida localmente (sirve
   * offline); el servidor re-verifica y registra el resultado real.
   */
  app.post("/stops/:stopId/scan", async (request, reply) => {
    const { stopId } = z.object({ stopId: z.string() }).parse(request.params);
    const input = z
      .object({ code: z.string().trim().min(3).max(64) })
      .parse(request.body);
    const stop = await findStopForUser(request, stopId);
    if (!stop) return reply.code(404).send({ error: "Parada no encontrada" });

    const expected = stop.order.trackingNumber?.toUpperCase() ?? null;
    const scanned = input.code.toUpperCase();
    const match = expected !== null && scanned === expected;
    await logOrderEvent(
      stop.orderId,
      match ? "SCANNED" : "SCAN_MISMATCH",
      match
        ? `Paquete escaneado en ${stop.kind === "PICKUP" ? "recogida" : "entrega"}`
        : `Escaneo no coincide con la guía: ${scanned}`,
    );
    return { match };
  });

  app.post("/stops/:stopId/arrive", async (request, reply) => {
    const { stopId } = z.object({ stopId: z.string() }).parse(request.params);
    const stop = await findStopForUser(request, stopId);
    if (!stop) return reply.code(404).send({ error: "Parada no encontrada" });

    const isPickup = stop.kind === "PICKUP";
    const updated = await prisma.routeStop.update({
      where: { id: stopId },
      data: { status: "ARRIVED", arrivedAt: new Date() },
    });
    await logOrderEvent(
      stop.orderId,
      "ARRIVED",
      isPickup ? "Conductor en el punto de recogida" : "Conductor en el punto de entrega",
    );
    emitOrderUpdate(request.user.tenantId, stop.order);
    return updated;
  });

  /**
   * Completar parada. Una parada PICKUP marca el pedido como recogido (sin
   * entregarlo); una parada DELIVERY registra POD, valida geocerca, aprende el
   * pin GPS y notifica al negocio cliente.
   */
  app.post("/stops/:stopId/complete", async (request, reply) => {
    const { stopId } = z.object({ stopId: z.string() }).parse(request.params);
    const input = submitPodSchema.parse(request.body);
    const stop = await findStopForUser(request, stopId);
    if (!stop) return reply.code(404).send({ error: "Parada no encontrada" });
    if (stop.status === "COMPLETED") {
      return reply.code(409).send({ error: "Parada ya completada" });
    }

    const tenantId = request.user.tenantId;
    const order = stop.order;
    const isPickup = stop.kind === "PICKUP";
    const now = new Date();

    // Política POD (FUENTE DE VERDAD = servidor; no se puede saltar, ni siquiera
    // reproducida desde la cola offline). Dos capas que se combinan:
    //  1) Política por TIPO de parada (D2): el despachador define, por tipo de
    //     entrega/recogida, si la firma y la foto son obligatorias.
    //  2) Política por CLIENTE (existente): el comercio puede exigir foto y/o
    //     nombre de quien recibe (solo entregas).
    const policyRow = await prisma.podPolicy.findUnique({
      where: { tenantId_scope: { tenantId, scope: "TEAM_DEFAULT" } },
    });
    const podReq = resolvePodReq(
      (policyRow?.config as PodPolicyConfig | null) ?? null,
      isPickup ? "PICKUP" : "DELIVERY",
      isPickup ? input.pickupType : input.deliveryType,
    );
    const hasPhoto = input.types.includes("PHOTO") || Boolean(input.photoUrl);
    const hasSignature =
      input.types.includes("SIGNATURE") || Boolean(input.signatureUrl);

    const missing: string[] = [];
    if (podReq.photo === "MANDATORY" && !hasPhoto) {
      missing.push("una foto de evidencia");
    }
    if (podReq.signature === "MANDATORY" && !hasSignature) {
      missing.push("la firma de quien recibe");
    }
    if (!isPickup) {
      const required = order.client?.podRequired ?? [];
      if (
        required.includes("PHOTO") &&
        !hasPhoto &&
        !missing.includes("una foto de evidencia")
      ) {
        missing.push("una foto de evidencia");
      }
      if (required.includes("RECEIVER_NAME") && !input.receivedBy?.trim()) {
        missing.push("el nombre de quien recibe");
      }
    }
    if (missing.length > 0) {
      return reply.code(422).send({
        error: `Se requiere ${missing.join(" y ")} para confirmar esta parada.`,
      });
    }

    // Geocerca: validar contra el punto correcto (recogida vs entrega).
    const refLat = isPickup ? order.pickupLat : order.lat;
    const refLng = isPickup ? order.pickupLng : order.lng;
    let geofenceOk: boolean | null = null;
    if (input.lat !== undefined && input.lng !== undefined && refLat !== null && refLng !== null) {
      geofenceOk =
        haversineKm({ lat: input.lat, lng: input.lng }, { lat: refLat, lng: refLng }) <=
        GEOFENCE_RADIUS_KM;
    }

    await prisma.$transaction(async (tx) => {
      await tx.routeStop.update({
        where: { id: stopId },
        data: {
          status: "COMPLETED",
          completedAt: now,
          pod: {
            create: {
              types: input.types,
              deliveryType: isPickup ? input.pickupType : input.deliveryType,
              photoUrl: input.photoUrl,
              signatureUrl: input.signatureUrl,
              receivedBy: input.receivedBy,
              notes: input.notes,
              lat: input.lat,
              lng: input.lng,
              geofenceOk,
            },
          },
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: isPickup
          ? { pickedUpAt: now }
          : { status: "DELIVERED", deliveredAt: now },
      });
    });

    if (isPickup) {
      await logOrderEvent(order.id, "PICKED_UP", "Paquete recogido en origen");
      emitOrderUpdate(tenantId, order);
      await maybeCompleteRoute(stop.route.id);
      return { ok: true, geofenceOk, kind: "PICKUP" };
    }

    await logOrderEvent(
      order.id,
      "DELIVERED",
      input.receivedBy ? `Recibió: ${input.receivedBy}` : undefined,
    );
    emitOrderUpdate(tenantId, { ...order, status: "DELIVERED" });

    // Aprender el pin GPS confirmado (mejora geocodificación futura).
    if (input.lat !== undefined && input.lng !== undefined) {
      await learnAddressPin(
        tenantId,
        order.addressRaw,
        input.lat,
        input.lng,
        order.addressNotes ?? undefined,
      );
    }

    // B2B: confirmar la entrega AL NEGOCIO CLIENTE (no al consumidor final).
    await notifyClient({
      tenantId,
      orderId: order.id,
      client: order.client,
      template: "envio_entregado",
      payload: {
        guia: order.trackingNumber,
        destinatario: order.customerName,
        recibidoPor: input.receivedBy ?? null,
        geocercaOk: geofenceOk,
        rastreo: publicTrackingUrl(order.trackingToken),
      },
    });

    await maybeCompleteRoute(stop.route.id);
    return { ok: true, geofenceOk, kind: "DELIVERY" };
  });

  app.post("/stops/:stopId/fail", async (request, reply) => {
    const { stopId } = z.object({ stopId: z.string() }).parse(request.params);
    const input = failStopSchema.parse(request.body);
    const stop = await findStopForUser(request, stopId);
    if (!stop) return reply.code(404).send({ error: "Parada no encontrada" });

    const isRejection = input.reason.startsWith("RECHAZO");
    await prisma.$transaction([
      prisma.routeStop.update({
        where: { id: stopId },
        data: { status: "FAILED", completedAt: new Date() },
      }),
      prisma.order.update({
        where: { id: stop.orderId },
        data: {
          status: isRejection ? "REJECTED" : "FAILED",
          failureReason: input.reason,
        },
      }),
      // Evidencia del fallo (foto + GPS): defensa ante disputas del comercio.
      ...(input.photoUrl
        ? [
            prisma.proofOfDelivery.upsert({
              where: { stopId },
              create: {
                stopId,
                types: ["PHOTO"],
                photoUrl: input.photoUrl,
                notes: `Evidencia de fallo: ${input.reason}${input.notes ? ` — ${input.notes}` : ""}`,
                lat: input.lat,
                lng: input.lng,
              },
              update: { photoUrl: input.photoUrl, lat: input.lat, lng: input.lng },
            }),
          ]
        : []),
    ]);
    await logOrderEvent(
      stop.orderId,
      "FAILED",
      `Motivo: ${input.reason}${input.photoUrl ? " (con foto de evidencia)" : ""}`,
    );
    emitOrderUpdate(request.user.tenantId, {
      ...stop.order,
      status: isRejection ? "REJECTED" : "FAILED",
    });

    // B2B: avisar al negocio cliente que su envío no se pudo entregar.
    await notifyClient({
      tenantId: request.user.tenantId,
      orderId: stop.orderId,
      client: stop.order.client,
      template: "envio_fallido",
      payload: {
        guia: stop.order.trackingNumber,
        destinatario: stop.order.customerName,
        motivo: input.reason,
      },
    });

    await maybeCompleteRoute(stop.route.id);
    return { ok: true };
  });
}

async function findStopForUser(
  request: { user: { tenantId: string; role: string; driverId?: string } },
  stopId: string,
) {
  const stop = await prisma.routeStop.findFirst({
    where: { id: stopId, route: { tenantId: request.user.tenantId } },
    include: {
      order: { include: { client: { select: clientSelect } } },
      route: true,
    },
  });
  if (!stop) return null;
  if (
    request.user.role === "DRIVER" &&
    stop.route.driverId !== request.user.driverId
  ) {
    return null;
  }
  return stop;
}

/** Si todas las paradas terminaron, cierra la ruta. */
async function maybeCompleteRoute(routeId: string) {
  const open = await prisma.routeStop.count({
    where: { routeId, status: { in: ["PENDING", "ARRIVED"] } },
  });
  if (open === 0) {
    await prisma.route.update({
      where: { id: routeId },
      data: { status: "COMPLETED" },
    });
  }
}
