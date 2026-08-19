import { createHmac, randomBytes } from "node:crypto";
import type { NotificationEvent } from "@moveos/shared";
import { prisma } from "../lib/prisma.js";

/**
 * Entrega de webhooks de la plataforma de desarrolladores (Tier 2 §8). En cada
 * evento del ciclo de vida se hace POST firmado (HMAC-SHA256 con el `secret` del
 * webhook, cabecera `x-dalego-signature`) a los webhooks habilitados del tenant
 * suscritos a ese evento. Tenant-scoped; no bloquea el flujo si alguno falla.
 *
 * Cabeceras heredadas (`x-moveos-event` / `x-moveos-signature`): el renombre de
 * marca no puede romper a un comercio que ya validaba la firma con el nombre
 * anterior, así que se envían AMBOS pares con el mismo valor. Las `x-moveos-*`
 * quedan obsoletas y se retiran cuando ningún integrador las use.
 */

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

/** Firma HMAC-SHA256 del cuerpo con el secreto del webhook (hex). */
export function signWebhook(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export interface WebhookDeliverResult {
  ok: boolean;
  status: number | null;
}

export async function deliverWebhook(
  webhook: { id: string; url: string; secret: string },
  event: NotificationEvent,
  payload: Record<string, unknown>,
): Promise<WebhookDeliverResult> {
  const body = JSON.stringify({
    event,
    data: payload,
    sentAt: new Date().toISOString(),
  });
  const signature = signWebhook(webhook.secret, body);
  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-dalego-event": event,
        "x-dalego-signature": signature,
        // Obsoletas: mismo valor, para no romper integraciones existentes.
        "x-moveos-event": event,
        "x-moveos-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    await prisma.webhook
      .update({ where: { id: webhook.id }, data: { lastStatus: res.status, lastDeliveredAt: new Date() } })
      .catch(() => {});
    return { ok: res.ok, status: res.status };
  } catch {
    await prisma.webhook
      .update({ where: { id: webhook.id }, data: { lastStatus: 0, lastDeliveredAt: new Date() } })
      .catch(() => {});
    return { ok: false, status: null };
  }
}

/** Entrega un evento a todos los webhooks habilitados del tenant suscritos a él. */
export async function emitWebhookEvent(
  tenantId: string,
  event: NotificationEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const hooks = await prisma.webhook.findMany({
    where: { tenantId, enabled: true, events: { has: event } },
    select: { id: true, url: true, secret: true },
  });
  if (hooks.length === 0) return;
  await Promise.allSettled(hooks.map((h) => deliverWebhook(h, event, payload)));
}
