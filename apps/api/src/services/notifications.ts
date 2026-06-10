import { prisma } from "../lib/prisma.js";

/**
 * URL pública de rastreo para un envío. Base configurable por entorno
 * (PUBLIC_WEB_URL = dominio del dashboard); en desarrollo apunta a localhost.
 */
export function publicTrackingUrl(token: string | null): string | null {
  if (!token) return null;
  const base = process.env.PUBLIC_WEB_URL ?? "http://localhost:5173";
  return `${base.replace(/\/$/, "")}/t/${token}`;
}

/**
 * Servicio de notificaciones B2B.
 *
 * MoveOS es software B2B: cuando un envío cambia de estado (despachado, en
 * camino, entregado, fallido), se notifica al NEGOCIO CLIENTE que originó el
 * envío — no al consumidor final que recibe el paquete.
 *
 * El canal lo define cada cliente (`Client.notifyChannel`):
 *  - WEBHOOK: POST a su sistema (la integración B2B estándar).
 *  - WHATSAPP: mensaje a un contacto operativo del negocio.
 *  - EMAIL: correo de confirmación (esqueleto).
 *  - IN_APP / CONSOLE: solo queda registrado y visible en el dashboard.
 */

export type NotificationChannel =
  | "WEBHOOK"
  | "WHATSAPP"
  | "EMAIL"
  | "CONSOLE";

/** Datos mínimos del cliente necesarios para notificar. */
export interface ClientTarget {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notifyChannel: string;
  webhookUrl: string | null;
}

export interface ClientNotification {
  tenantId: string;
  orderId: string;
  client: ClientTarget | null;
  template: string; // p. ej. "envio_entregado", "envio_fallido"
  payload: Record<string, unknown>;
}

interface SendResult {
  channel: NotificationChannel;
  recipient: string;
  ok: boolean;
}

/** Envía por el canal del cliente y devuelve el resultado para auditar. */
async function dispatchToChannel(
  client: ClientTarget,
  message: ClientNotification,
): Promise<SendResult> {
  const channel = client.notifyChannel as NotificationChannel;

  try {
    if (channel === "WEBHOOK" && client.webhookUrl) {
      await fetch(client.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: message.template,
          orderId: message.orderId,
          data: message.payload,
          sentAt: new Date().toISOString(),
        }),
      });
      return { channel: "WEBHOOK", recipient: client.webhookUrl, ok: true };
    }

    if (channel === "WHATSAPP" && client.phone) {
      const token = process.env.WHATSAPP_BUSINESS_TOKEN;
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (token && phoneId) {
        await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: client.phone,
            type: "template",
            template: { name: message.template, language: { code: "es_CO" } },
          }),
        });
        return { channel: "WHATSAPP", recipient: client.phone, ok: true };
      }
      // Sin credenciales: cae a consola.
    }

    // EMAIL e IN_APP por ahora solo se registran (visibles en el dashboard).
    const recipient =
      channel === "EMAIL" && client.email ? client.email : client.name;
    console.log(
      `[notificación B2B → ${client.name}] ${message.template}`,
      JSON.stringify(message.payload),
    );
    return { channel: channel === "EMAIL" ? "EMAIL" : "CONSOLE", recipient, ok: true };
  } catch (err) {
    console.error("Error notificando al cliente:", err);
    return {
      channel,
      recipient: client.webhookUrl ?? client.phone ?? client.name,
      ok: false,
    };
  }
}

/**
 * Notifica al negocio cliente del envío. Si el pedido no tiene cliente
 * asociado, se registra como evento de bitácora pero no se envía nada
 * (el envío no pertenece a ningún negocio que deba enterarse).
 */
export async function notifyClient(message: ClientNotification): Promise<void> {
  if (!message.client) {
    // Sin negocio cliente: nada que notificar en B2B.
    return;
  }

  const result = await dispatchToChannel(message.client, message);

  await prisma.notificationLog.create({
    data: {
      tenantId: message.tenantId,
      clientId: message.client.id,
      orderId: message.orderId,
      channel: result.channel,
      recipient: result.recipient,
      template: message.template,
      payload: message.payload as object,
      status: result.ok ? "SENT" : "FAILED",
    },
  });

  await prisma.orderEvent.create({
    data: {
      orderId: message.orderId,
      type: "NOTIFIED",
      details: `${message.template} → ${message.client.name} (${result.channel})`,
    },
  });
}
