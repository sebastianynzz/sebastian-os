import webpush from "web-push";
import { prisma } from "../lib/prisma.js";

/**
 * Web Push (VAPID) para conductor y despachador (roadmap P0.6).
 *
 * Canal gratuito de avisos instantáneos: ruta asignada, parada insertada,
 * pánico. Degradación elegante como el resto de proveedores: sin
 * VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY el servicio queda en no-op y la
 * operación continúa (el conductor ve los cambios en el refresco de 45 s).
 *
 * Las suscripciones muertas (endpoint 404/410 del push service) se podan
 * automáticamente para no acumular basura ni reenviar a dispositivos idos.
 */

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:ops@moveos.co";

let configured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
}

export function isPushConfigured(): boolean {
  return configured;
}

export function getVapidPublicKey(): string | null {
  return configured ? VAPID_PUBLIC_KEY : null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Ruta dentro de la app que abre el clic en la notificación. */
  url?: string;
}

async function sendToSubscriptions(
  subs: { id: string; endpoint: string; p256dh: string; auth: string }[],
  payload: PushPayload,
): Promise<void> {
  if (!configured || subs.length === 0) return;
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 3600 },
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Suscripción muerta: el navegador la revocó. Podar.
          await prisma.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => {});
        } else {
          console.error("Error enviando push:", err);
        }
      }
    }),
  );
}

/** Notifica a TODOS los dispositivos suscritos de un usuario. */
export async function sendPushToUser(
  tenantId: string,
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!configured) return;
  const subs = await prisma.pushSubscription.findMany({
    where: { tenantId, userId },
  });
  await sendToSubscriptions(subs, payload);
}

/** Notifica al conductor (busca su cuenta de usuario por driverId). */
export async function sendPushToDriver(
  tenantId: string,
  driverId: string,
  payload: PushPayload,
): Promise<void> {
  if (!configured) return;
  const user = await prisma.user.findFirst({
    where: { tenantId, driverId },
    select: { id: true },
  });
  if (!user) return;
  await sendPushToUser(tenantId, user.id, payload);
}

/**
 * Notifica al personal de despacho del tenant (ADMIN + DISPATCHER), p. ej.
 * un botón de pánico con el dashboard cerrado.
 */
export async function sendPushToStaff(
  tenantId: string,
  payload: PushPayload,
): Promise<void> {
  if (!configured) return;
  const subs = await prisma.pushSubscription.findMany({
    where: {
      tenantId,
      user: { role: { in: ["ADMIN", "DISPATCHER"] } },
    },
  });
  await sendToSubscriptions(subs, payload);
}
