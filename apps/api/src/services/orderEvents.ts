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
  | "PICKED_UP"
  | "DELIVERED"
  | "FAILED"
  | "NOTIFIED"
  | "ADDRESS_CONFIRMED"
  | "OUT_OF_ZONE"
  | "RECOVERY_FLAGGED"
  | "RECOVERY_RESCHEDULED"
  | "SCANNED"
  | "SCAN_MISMATCH"
  | "LOADED";

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

/** Token opaco para la página pública de rastreo (no adivinable). */
export function generateTrackingToken(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * Número de guía legible: DG-XXXXXXXX (base32 sin caracteres ambiguos).
 *
 * Las guías emitidas antes del rebrand siguen siendo MV-…: se conservan tal
 * cual, no hay backfill. La búsqueda es por coincidencia exacta del string, así
 * que ambos prefijos conviven sin lógica adicional — cualquier etiqueta ya
 * impresa o guardada en el sistema de un comercio sigue resolviendo.
 */
export function generateTrackingNumber(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return `DG-${out}`;
}
