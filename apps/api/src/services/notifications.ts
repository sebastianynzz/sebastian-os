import {
  DEFAULT_NOTIFICATION_BODIES,
  renderTemplate,
  type NotificationEvent,
} from "@moveos/shared";
import { prisma } from "../lib/prisma.js";
import { safeFetch } from "../lib/safeFetch.js";

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
  /** Evento del catálogo (Tier 2): si está, se gatea/renderiza por plantilla. */
  event?: NotificationEvent;
  payload: Record<string, unknown>;
  /** Cuerpo ya renderizado desde la plantilla (lo calcula notifyClient). */
  renderedBody?: string;
}

/** Variables disponibles para el cuerpo de la plantilla, desde el payload. */
function notificationVars(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    guia: payload.trackingNumber ?? payload.guia ?? "",
    destinatario: payload.customerName ?? payload.recibidoPor ?? "",
    motivo: payload.failureReason ?? payload.motivo ?? "",
    rastreo: payload.trackingUrl ?? payload.rastreo ?? "",
    conductor: payload.conductor ?? payload.driver ?? "",
    ...payload,
  };
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
      // safeFetch bloquea destinos internos (anti-SSRF) y añade timeout.
      await safeFetch(client.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 5000,
        body: JSON.stringify({
          // `event` conserva el nombre de plantilla por compatibilidad; los
          // integradores nuevos deben usar `standardEvent` (catálogo
          // NOTIFICATION_EVENTS), alineado con los webhooks de /developer.
          event: message.template,
          standardEvent: message.event ?? null,
          orderId: message.orderId,
          message: message.renderedBody,
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

    if (channel === "EMAIL" && client.email) {
      const sendgridKey = process.env.SENDGRID_API_KEY;
      const from = process.env.EMAIL_FROM;
      if (sendgridKey && from) {
        const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sendgridKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: client.email }] }],
            from: { email: from, name: "MoveOS" },
            subject: `MoveOS — ${message.template.replace(/_/g, " ")}`,
            content: [
              {
                type: "text/plain",
                value:
                  message.renderedBody ??
                  Object.entries(message.payload)
                    .filter(([, v]) => v !== null && v !== undefined)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join("\n"),
              },
            ],
          }),
        });
        return { channel: "EMAIL", recipient: client.email, ok: res.ok };
      }
      // Sin credenciales SendGrid: cae a consola.
    }

    // IN_APP (y canales sin credenciales) solo se registran (feed del dashboard).
    const recipient =
      channel === "EMAIL" && client.email ? client.email : client.name;
    console.log(
      `[notificación B2B → ${client.name}] ${message.template}`,
      message.renderedBody ?? JSON.stringify(message.payload),
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
 * Envía una notificación de PRUEBA al canal configurado del negocio cliente
 * (webhook/WhatsApp/email/in-app), sin pedido ni bitácora — solo para que el
 * operador confirme que el canal funciona antes de depender de él. B2B: va al
 * NEGOCIO, nunca al consumidor final.
 */
export async function sendTestNotification(
  client: ClientTarget,
): Promise<SendResult> {
  const renderedBody =
    "Notificación de prueba de MoveOS — tu canal de avisos está bien configurado.";
  return dispatchToChannel(client, {
    tenantId: "",
    orderId: "test",
    client,
    template: "prueba",
    payload: { mensaje: renderedBody },
    renderedBody,
  });
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

  // Motor de notificaciones (Tier 2): si el evento trae plantilla, el operador
  // pudo desactivarlo (no se notifica) o personalizar el cuerpo. Sin fila → se
  // usa el cuerpo por defecto del evento. Eventos sin `event` (p. ej. la
  // reprogramación por recuperación) siempre notifican.
  let renderedBody: string | undefined;
  if (message.event) {
    const tpl = await prisma.messageTemplate.findUnique({
      where: { tenantId_event: { tenantId: message.tenantId, event: message.event } },
    });
    if (tpl && !tpl.enabled) return; // el operador apagó este evento
    const body = tpl?.body ?? DEFAULT_NOTIFICATION_BODIES[message.event];
    renderedBody = renderTemplate(body, notificationVars(message.payload));
  }

  const result = await dispatchToChannel(message.client, { ...message, renderedBody });

  await prisma.notificationLog.create({
    data: {
      tenantId: message.tenantId,
      clientId: message.client.id,
      orderId: message.orderId,
      channel: result.channel,
      recipient: result.recipient,
      template: message.template,
      payload: { ...message.payload, ...(renderedBody ? { message: renderedBody } : {}) } as object,
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
