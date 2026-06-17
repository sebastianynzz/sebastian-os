import type { CreateOrderInput } from "@moveos/shared";
import { prisma } from "../lib/prisma.js";
import { geocodeAddress } from "./geocoding.js";
import {
  generateTrackingNumber,
  generateTrackingToken,
  logOrderEvents,
} from "./orderEvents.js";
import { emitOrderUpdate } from "./realtime.js";

/**
 * Alta de un pedido (compartida por el dashboard del tenant y el portal de
 * clientes): geocodifica destino y recogida si faltan coordenadas, valida el
 * negocio cliente, genera guía + token de rastreo y registra la bitácora.
 */
export async function createOrder(tenantId: string, input: CreateOrderInput) {
  // Idempotencia para integraciones y cargas masivas: si el pedido trae
  // externalRef y ya existe uno con ese ref en el tenant, devolvemos el
  // existente en vez de duplicar — un reintento de API o un re-import del
  // mismo CSV no crea pedidos repetidos. (Los pedidos manuales no traen
  // externalRef, así que no se ven afectados.)
  if (input.externalRef) {
    const existing = await prisma.order.findFirst({
      where: { tenantId, externalRef: input.externalRef },
    });
    if (existing) return existing;
  }

  let lat = input.lat;
  let lng = input.lng;
  const clientProvidedCoords = lat !== undefined && lng !== undefined;
  let geocodeSource = clientProvidedCoords ? "CLIENT" : undefined;
  // Coordenadas dadas por el integrador = máxima confianza, ya verificadas.
  let geoConfidence: number | undefined = clientProvidedCoords ? 1 : undefined;
  let addressVerifiedAt: Date | undefined = clientProvidedCoords ? new Date() : undefined;

  let tenantCity: string | undefined;
  if (lat === undefined || lng === undefined) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    tenantCity = tenant.city;
    const geo = await geocodeAddress(tenantId, input.addressRaw, tenant.city);
    lat = geo.lat;
    lng = geo.lng;
    geocodeSource = geo.source;
    geoConfidence = geo.confidence;
    // Un pin del grafo ya fue confirmado en campo alguna vez.
    if (geo.source === "ADDRESS_PIN") addressVerifiedAt = new Date();
  }

  // Recogida en origen (opcional): geocodificar si se dio dirección sin coords.
  let pickupLat = input.pickupLat;
  let pickupLng = input.pickupLng;
  if (
    (pickupLat === undefined || pickupLng === undefined) &&
    input.pickupAddressRaw
  ) {
    if (!tenantCity) {
      tenantCity = (
        await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      ).city;
    }
    const geo = await geocodeAddress(tenantId, input.pickupAddressRaw, tenantCity);
    pickupLat = geo.lat;
    pickupLng = geo.lng;
  }

  // Validar que el negocio cliente (si se indica) pertenezca al tenant.
  if (input.clientId) {
    const client = await prisma.client.findFirst({
      where: { id: input.clientId, tenantId },
      select: { id: true },
    });
    if (!client) {
      throw Object.assign(new Error("Cliente no encontrado"), { statusCode: 400 });
    }
  }

  // Validar que el servicio (promesa SLA, si se indica) pertenezca al tenant —
  // evita asignar un serviceId de otro tenant (aislamiento) y rompe el FK.
  if (input.serviceId) {
    const service = await prisma.service.findFirst({
      where: { id: input.serviceId, tenantId },
      select: { id: true },
    });
    if (!service) {
      throw Object.assign(new Error("Servicio no encontrado"), { statusCode: 400 });
    }
  }

  const order = await prisma.order.create({
    data: {
      tenantId,
      clientId: input.clientId,
      serviceId: input.serviceId,
      trackingNumber: generateTrackingNumber(),
      trackingToken: generateTrackingToken(),
      externalRef: input.externalRef,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      addressRaw: input.addressRaw,
      addressNotes: input.addressNotes,
      lat,
      lng,
      geocodeSource,
      geoConfidence,
      addressVerifiedAt,
      pickupLat,
      pickupLng,
      pickupAddressRaw: input.pickupAddressRaw,
      pickupNotes: input.pickupNotes,
      status: "GEOCODED",
      weightKg: input.weightKg ?? 1,
      volumeM3: input.volumeM3,
      tempProfile: input.tempProfile,
      timeWindowStart: input.timeWindowStart ? new Date(input.timeWindowStart) : undefined,
      timeWindowEnd: input.timeWindowEnd ? new Date(input.timeWindowEnd) : undefined,
      priority: input.priority,
    },
  });

  await logOrderEvents([
    { orderId: order.id, type: "CREATED", details: `Guía ${order.trackingNumber}` },
    { orderId: order.id, type: "GEOCODED", details: `Fuente: ${geocodeSource}` },
  ]);
  emitOrderUpdate(tenantId, order);
  return order;
}
