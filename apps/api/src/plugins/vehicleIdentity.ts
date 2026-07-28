import { prisma } from "../lib/prisma.js";

/**
 * Caché TTL de la IDENTIDAD de un vehículo por placa (mismo patrón que
 * plugins/tenantStatus.ts). La ingesta telemática resolvía la placa contra la
 * base en cada ping; con una flota reportando cada pocos segundos eso era una
 * consulta constante para leer datos que casi nunca cambian.
 *
 * La clave lleva SIEMPRE tenantId: `@@unique([tenantId, plate])` significa que
 * la placa solo es única DENTRO del tenant, así que una clave por placa sola
 * resolvería la placa de un tenant al vehículo de otro — sería una violación
 * de la restricción dura 3, no una simple lectura vieja.
 *
 * Se cachea SOLO la identidad ({ id, plate, ownerTenantId }). Nunca el estado
 * telemático (lastSpeedKmh, socPercent, lastLat/lastLng, lastSeenAt, engineOn):
 * el handler lo reescribe en cada ping, y `lastSpeedKmh` es la única entrada
 * del interlock que impide apagar el motor de un vehículo en movimiento.
 *
 * Los fallos NO se cachean: un vehículo recién dado de alta respondería 404
 * durante todo el TTL. Por eso el alta tampoco necesita invalidación.
 */

const TTL_MS = 60_000;

export interface VehicleIdentity {
  id: string;
  plate: string;
  ownerTenantId: string | null;
}

const cache = new Map<string, { vehicle: VehicleIdentity; expiresAt: number }>();

const keyOf = (tenantId: string, plate: string) => `${tenantId}:${plate}`;

/** Resuelve la identidad por placa ya normalizada. `null` si no existe. */
export async function findVehicleByPlate(
  tenantId: string,
  plate: string,
): Promise<VehicleIdentity | null> {
  const key = keyOf(tenantId, plate);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.vehicle;

  const vehicle = await prisma.vehicle.findFirst({
    where: { tenantId, plate },
    select: { id: true, plate: true, ownerTenantId: true },
  });
  if (!vehicle) return null; // sin caché negativa: ver comentario de arriba.

  cache.set(key, { vehicle, expiresAt: Date.now() + TTL_MS });
  return vehicle;
}

/**
 * Invalida una placa. La placa es mutable (PATCH /vehicles/:id), así que hay
 * que invalidar la ANTERIOR y la nueva.
 */
export function invalidateVehiclePlate(tenantId: string, plate: string): void {
  cache.delete(keyOf(tenantId, plate));
}

/** Solo para pruebas. */
export function resetVehicleIdentityCache(): void {
  cache.clear();
}
