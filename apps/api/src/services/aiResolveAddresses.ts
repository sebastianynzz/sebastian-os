import { prisma } from "../lib/prisma.js";
import {
  geocodeAddress,
  learnAddressPin,
  LOW_CONFIDENCE_THRESHOLD,
} from "./geocoding.js";
import { logOrderEvent } from "./orderEvents.js";
import { emitOrderUpdate } from "./realtime.js";

/**
 * Resolución de direcciones ambiguas para la acción de IA `resolve_addresses`.
 * Reusa la cascada existente (grafo aprendido → proveedores) vía
 * `geocodeAddress`; el LLM no geocodifica. Al aplicar (tras confirmación del
 * despachador) persiste el pin y lo enseña al grafo (`learnAddressPin`).
 */

export interface ResolvedAddress {
  orderId: string;
  trackingNumber: string | null;
  addressRaw: string;
  lat: number;
  lng: number;
  source: string;
  confidence: number;
  /** Confianza ≥ umbral → auto-aplicable; si no, queda para corrección manual. */
  resolvable: boolean;
}

export interface ResolveAddressesResult {
  change: ResolvedAddress[];
  impact: {
    total: number;
    resolvable: number;
    needsManual: number;
    avgConfidence: number;
  };
}

async function ambiguousOrders(tenantId: string, orderIds?: string[]) {
  return prisma.order.findMany({
    where: {
      tenantId,
      ...(orderIds && orderIds.length ? { id: { in: orderIds } } : {}),
      status: { in: ["PENDING", "GEOCODED", "ASSIGNED"] },
      addressVerifiedAt: null,
      OR: [
        { geoConfidence: { lt: LOW_CONFIDENCE_THRESHOLD } },
        { geoConfidence: null },
        { geocodeSource: "MOCK" },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: { tenant: { select: { city: true } } },
  });
}

/** Ejecución en seco: re-resuelve las direcciones ambiguas y propone pines. */
export async function resolveAddresses(
  tenantId: string,
  orderIds?: string[],
): Promise<ResolveAddressesResult> {
  const orders = await ambiguousOrders(tenantId, orderIds);
  const change: ResolvedAddress[] = [];

  for (const o of orders) {
    try {
      const geo = await geocodeAddress(tenantId, o.addressRaw, o.tenant.city);
      change.push({
        orderId: o.id,
        trackingNumber: o.trackingNumber,
        addressRaw: o.addressRaw,
        lat: geo.lat,
        lng: geo.lng,
        source: geo.source,
        confidence: geo.confidence,
        resolvable: geo.confidence >= LOW_CONFIDENCE_THRESHOLD,
      });
    } catch {
      change.push({
        orderId: o.id,
        trackingNumber: o.trackingNumber,
        addressRaw: o.addressRaw,
        lat: o.lat ?? 0,
        lng: o.lng ?? 0,
        source: "UNRESOLVED",
        confidence: 0,
        resolvable: false,
      });
    }
  }

  const resolvable = change.filter((c) => c.resolvable);
  const avgConfidence = resolvable.length
    ? resolvable.reduce((a, c) => a + c.confidence, 0) / resolvable.length
    : 0;

  return {
    change,
    impact: {
      total: change.length,
      resolvable: resolvable.length,
      needsManual: change.length - resolvable.length,
      avgConfidence,
    },
  };
}

/**
 * Aplica los pines resueltos con confianza suficiente (confirmados por el
 * despachador al pulsar Aplicar): actualiza el pedido, lo marca verificado y
 * enseña el pin al grafo. Los de baja confianza se dejan para triage manual.
 */
export async function applyResolvedAddresses(
  tenantId: string,
  change: ResolvedAddress[],
): Promise<{ applied: number; skipped: number }> {
  let applied = 0;
  let skipped = 0;

  for (const c of change) {
    if (!c.resolvable) {
      skipped++;
      continue;
    }
    const order = await prisma.order.findFirst({
      where: { id: c.orderId, tenantId },
      include: { tenant: { select: { city: true } } },
    });
    if (!order || ["DELIVERED", "CANCELLED"].includes(order.status)) {
      skipped++;
      continue;
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        lat: c.lat,
        lng: c.lng,
        geocodeSource: c.source,
        geoConfidence: c.confidence,
        addressVerifiedAt: new Date(),
      },
    });
    await learnAddressPin(
      tenantId,
      order.addressRaw,
      c.lat,
      c.lng,
      order.addressNotes ?? undefined,
      { source: "AI_RESOLVED", city: order.tenant.city },
    );
    await logOrderEvent(
      order.id,
      "ADDRESS_CONFIRMED",
      "Dirección resuelta y confirmada (IA, triage)",
    );
    emitOrderUpdate(tenantId, updated);
    applied++;
  }

  return { applied, skipped };
}
