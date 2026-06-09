import { haversineKm } from "@moveos/shared";
import { prisma } from "../lib/prisma.js";

/** Umbral de desviación de ruta para alerta de seguridad (km). */
export const DEVIATION_THRESHOLD_KM = 5;

/**
 * Detección de desviación de ruta compartida por el tracking del smartphone y
 * la ingesta telemática de dispositivos. Compara la posición contra las
 * paradas pendientes y el depósito; si todo queda más lejos del umbral, abre
 * una alerta (una sola alerta abierta por ruta para no inundar la central).
 */
export async function checkRouteDeviation(
  tenantId: string,
  driverId: string | null,
  routeId: string,
  lat: number,
  lng: number,
): Promise<void> {
  const route = await prisma.route.findFirst({
    where: { id: routeId, tenantId, status: "IN_PROGRESS" },
    include: { stops: { where: { status: "PENDING" }, include: { order: true } } },
  });
  if (!route) return;

  const candidates = [
    { lat: route.depotLat, lng: route.depotLng },
    ...route.stops
      .filter((s) => s.order.lat !== null && s.order.lng !== null)
      .map((s) => ({ lat: s.order.lat!, lng: s.order.lng! })),
  ];
  if (candidates.length === 0) return;

  const minDistance = Math.min(
    ...candidates.map((c) => haversineKm({ lat, lng }, c)),
  );
  if (minDistance <= DEVIATION_THRESHOLD_KM) return;

  const existing = await prisma.safetyAlert.findFirst({
    where: { tenantId, routeId, type: "ROUTE_DEVIATION", status: "OPEN" },
  });
  if (existing) return;

  await prisma.safetyAlert.create({
    data: {
      tenantId,
      driverId,
      routeId,
      type: "ROUTE_DEVIATION",
      lat,
      lng,
      details: `Posición a ${minDistance.toFixed(1)} km de la ruta planificada`,
    },
  });
}
