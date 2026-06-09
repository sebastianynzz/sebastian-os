import { prisma } from "../lib/prisma.js";

/**
 * Servicio de notificaciones al cliente final.
 *
 * En Colombia el canal dominante es WhatsApp: la interfaz está diseñada para
 * conectar WhatsApp Business API en producción. En desarrollo se usa el
 * adaptador de consola y todo evento queda registrado en NotificationLog
 * (visible en el dashboard).
 */

export type NotificationChannel = "WHATSAPP" | "SMS" | "EMAIL" | "CONSOLE";

export interface NotificationMessage {
  tenantId: string;
  orderId?: string;
  recipient: string; // teléfono o email
  template: string; // p. ej. "pedido_asignado", "pedido_en_camino"
  payload: Record<string, unknown>;
}

export interface NotificationAdapter {
  channel: NotificationChannel;
  send(message: NotificationMessage): Promise<void>;
}

class ConsoleAdapter implements NotificationAdapter {
  channel: NotificationChannel = "CONSOLE";
  async send(message: NotificationMessage): Promise<void> {
    console.log(
      `[notificación → ${message.recipient}] ${message.template}`,
      JSON.stringify(message.payload),
    );
  }
}

/**
 * Esqueleto del adaptador WhatsApp Business API (Cloud API de Meta).
 * Requiere WHATSAPP_BUSINESS_TOKEN y WHATSAPP_PHONE_NUMBER_ID.
 */
class WhatsAppAdapter implements NotificationAdapter {
  channel: NotificationChannel = "WHATSAPP";
  async send(message: NotificationMessage): Promise<void> {
    const token = process.env.WHATSAPP_BUSINESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      throw new Error("WhatsApp Business API no configurada");
    }
    await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: message.recipient,
        type: "template",
        template: {
          name: message.template,
          language: { code: "es_CO" },
        },
      }),
    });
  }
}

function pickAdapter(): NotificationAdapter {
  if (process.env.WHATSAPP_BUSINESS_TOKEN) return new WhatsAppAdapter();
  return new ConsoleAdapter();
}

export async function notify(message: NotificationMessage): Promise<void> {
  const adapter = pickAdapter();
  try {
    await adapter.send(message);
  } catch (err) {
    console.error("Error enviando notificación:", err);
  }
  await prisma.notificationLog.create({
    data: {
      tenantId: message.tenantId,
      orderId: message.orderId,
      channel: adapter.channel,
      recipient: message.recipient,
      template: message.template,
      payload: message.payload as object,
    },
  });
}
