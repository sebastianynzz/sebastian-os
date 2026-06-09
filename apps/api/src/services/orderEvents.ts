import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";

/**
 * Bitácora de pedidos: cada transición del ciclo de vida queda registrada
 * para trazabilidad auditable de principio a fin.
 */

export type OrderEventType =
  | "CREATED"
  | "GEOCODED"
  | "ASSIGNED"
  | "DISPATCHED"
  | "IN_TRANSIT"
  | "ARRIVED"
  | "DELIVERED"
  | "FAILED"
  | "NOTIFIED";

export async function logOrderEvent(
  orderId: string,
  type: OrderEventType,
  details?: string,
): Promise<void> {
  await prisma.orderEvent.create({ data: { orderId, type, details } });
}

export async function logOrderEvents(
  events: { orderId: string; type: OrderEventType; details?: string }[],
): Promise<void> {
  if (events.length === 0) return;
  await prisma.orderEvent.createMany({ data: events });
}

/** Número de guía legible: MV-XXXXXXXX (base32 sin caracteres ambiguos). */
export function generateTrackingNumber(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return `MV-${out}`;
}
