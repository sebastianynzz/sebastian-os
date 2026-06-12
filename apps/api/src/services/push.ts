import webpush from "web-push";
import { prisma } from "../lib/prisma.js";

/**
 * Web Push (VAPID) para conductor y despachador (roadmap P0.6).
 *
 * Canal gratuito de avisos instantáneos: ruta asignada, parada insertada,
 * pánico. Degradación elegante como el resto de proveedores: sin claves
 * VAPID (o con claves mal formadas) el servicio queda en no-op y la
 * operación continúa (el conductor ve los cambios en el refresco de 45 s).
 *
 * El envío JAMÁS lanza: los llamadores lo disparan con `void` fuera de su
 * ruta crítica (bitácora y notificaciones B2B nunca dependen del push).
 * Las suscripciones muertas (404/410 del push service) se podan solas.
 */

const VAPID_SUBJECT_DEFAULT = "mailto:ops@moveos.co";

// Configuración perezosa: se evalúa en el primer envío, no al importar el
// módulo — así un entrypoint sin dotenv no congela un estado equivocado y
// una clave mal pegada no tumba la API al arrancar.
let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? VAPID_SUBJECT_DEFAULT,
      publicKey,
      privateKey,
    );
    configured = true;
  } catch (err) {
    // Clave VAPID inválida (truncada, con salto de línea…): no-op, no crash.
    console.error("Claves VAPID inválidas: web push deshabilitado.", err);
    configured = false;
  }
  return configured;
}

export function isPushConfigured(): boolean {
  return ensureConfigured();
}

export function getVapidPublicKey(): string | null {
  return ensureConfigured() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null;
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
  if (subs.length === 0) return;
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

/** Notifica a TODOS los dispositivos suscritos de un usuario. Nunca lanza. */
export async function sendPushToUser(
  tenantId: string,
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!ensureConfigured()) return;
  try {
    const subs = await prisma.pushSubscription.findMany({
      where: { tenantId, userId },
    });
    await sendToSubscriptions(subs, payload);
  } catch (err) {
    console.error("Error en push a usuario:", err);
  }
}

/** Notifica al conductor (su cuenta de usuario, vía relación). Nunca lanza. */
export async function sendPushToDriver(
  tenantId: string,
  driverId: string,
  payload: PushPayload,
): Promise<void> {
  if (!ensureConfigured()) return;
  try {
    const subs = await prisma.pushSubscription.findMany({
      where: { tenantId, user: { driverId } },
    });
    await sendToSubscriptions(subs, payload);
  } catch (err) {
    console.error("Error en push a conductor:", err);
  }
}

/**
 * Notifica al personal de despacho del tenant (ADMIN + DISPATCHER), p. ej.
 * un botón de pánico con el dashboard cerrado. Nunca lanza.
 */
export async function sendPushToStaff(
  tenantId: string,
  payload: PushPayload,
): Promise<void> {
  if (!ensureConfigured()) return;
  try {
    const subs = await prisma.pushSubscription.findMany({
      where: {
        tenantId,
        user: { role: { in: ["ADMIN", "DISPATCHER"] } },
      },
    });
    await sendToSubscriptions(subs, payload);
  } catch (err) {
    console.error("Error en push al despacho:", err);
  }
}
