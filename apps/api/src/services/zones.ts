import { pointInPolygon, type LatLng } from "@moveos/shared";
import { prisma } from "../lib/prisma.js";

/**
 * Cobertura por zona (D5): determina qué zonas del tenant contienen un punto.
 * El cálculo geométrico es determinista (`pointInPolygon` en @moveos/shared).
 * Base de la verificación de cobertura al crear un pedido (no bloquea — B2B,
 * solo se avisa/registra) y del aviso de cobertura en el portal.
 */

interface ZoneCover {
  id: string;
  name: string;
}

export interface Serviceability {
  /** El tenant tiene al menos una zona definida. */
  hasZones: boolean;
  /** Zonas que contienen el punto (vacío = fuera de cobertura). */
  covering: ZoneCover[];
}

export async function checkServiceability(
  tenantId: string,
  point: LatLng,
): Promise<Serviceability> {
  const zones = await prisma.zone.findMany({
    where: { tenantId },
    select: { id: true, name: true, geometry: true },
  });
  const covering = zones
    .filter((z) => {
      const pts = (z.geometry as { points?: LatLng[] } | null)?.points ?? [];
      return pointInPolygon(point, pts);
    })
    .map((z) => ({ id: z.id, name: z.name }));
  return { hasZones: zones.length > 0, covering };
}

/**
 * Conductores asignados a las zonas que cubren cualquiera de los puntos dados
 * (D5: la asignación prefiere los conductores de la zona). Determinista
 * (`pointInPolygon`). Devuelve ids únicos; vacío si ninguna zona con conductores
 * cubre los puntos. Tenant-scoped por el `tenantId`.
 */
export async function zoneDriverIdsForPoints(
  tenantId: string,
  points: LatLng[],
): Promise<string[]> {
  if (points.length === 0) return [];
  const zones = await prisma.zone.findMany({
    where: { tenantId },
    select: { driverIds: true, geometry: true },
  });
  const ids = new Set<string>();
  for (const z of zones) {
    if (z.driverIds.length === 0) continue;
    const pts = (z.geometry as { points?: LatLng[] } | null)?.points ?? [];
    if (points.some((p) => pointInPolygon(p, pts))) {
      for (const d of z.driverIds) ids.add(d);
    }
  }
  return [...ids];
}
