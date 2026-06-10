import type { OutgoingHttpHeaders } from "node:http";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Bus de eventos en memoria para los streams SSE (tiempo real).
 *
 * Sustituye el sondeo de los frontends (mapa en vivo cada 3 s, alertas cada
 * 15 s, rastreo cada 20 s) por push del servidor. La API corre en una sola
 * instancia (Render), así que los suscriptores viven en memoria; si se escala
 * horizontalmente, este bus se sustituye por un pub/sub compartido (Redis)
 * manteniendo la misma interfaz de emisión.
 *
 * Canales:
 *  - tenant:   eventos operativos (telemetry | safety | order). El personal
 *              recibe todo; un usuario del portal de clientes solo recibe
 *              eventos `order` de SU negocio.
 *  - platform: flota FaaS para el panel del operador de plataforma.
 *  - order:    rastreo público por pedido (página /t/:token, sin login).
 */

export type TenantEvent = "telemetry" | "safety" | "order";

export interface StreamSubscriber {
  /** Usuario del portal de clientes: limita lo que recibe a su negocio. */
  clientId?: string;
  send: (event: string, data: unknown) => void;
  close: () => void;
}

const tenantSubscribers = new Map<string, Set<StreamSubscriber>>();
const platformSubscribers = new Set<StreamSubscriber>();
const orderSubscribers = new Map<string, Set<StreamSubscriber>>();

function addTo<K>(
  map: Map<K, Set<StreamSubscriber>>,
  key: K,
  sub: StreamSubscriber,
): () => void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(sub);
  return () => {
    set.delete(sub);
    if (set.size === 0) map.delete(key);
  };
}

export function subscribeTenant(tenantId: string, sub: StreamSubscriber) {
  return addTo(tenantSubscribers, tenantId, sub);
}

export function subscribePlatform(sub: StreamSubscriber) {
  platformSubscribers.add(sub);
  return () => platformSubscribers.delete(sub);
}

export function subscribeOrder(orderId: string, sub: StreamSubscriber) {
  return addTo(orderSubscribers, orderId, sub);
}

/** ¿Hay páginas de rastreo público conectadas? (evita consultas inútiles). */
export function hasOrderSubscribers(): boolean {
  return orderSubscribers.size > 0;
}

export function emitTenant(
  tenantId: string,
  event: TenantEvent,
  data: Record<string, unknown>,
) {
  const subs = tenantSubscribers.get(tenantId);
  if (!subs) return;
  for (const sub of subs) {
    // Portal de clientes: solo eventos de pedidos de su propio negocio.
    if (sub.clientId && (event !== "order" || data.clientId !== sub.clientId)) {
      continue;
    }
    sub.send(event, data);
  }
}

export function emitPlatform(event: "fleet", data: Record<string, unknown>) {
  for (const sub of platformSubscribers) sub.send(event, data);
}

/** Empuja un "update" a las páginas de rastreo público de un pedido. */
export function emitOrder(orderId: string, data: Record<string, unknown>) {
  const subs = orderSubscribers.get(orderId);
  if (!subs) return;
  for (const sub of subs) sub.send("update", data);
}

/**
 * Cambio en el ciclo de vida de un pedido: notifica al canal del tenant
 * (dashboard del personal + portal del negocio cliente) y al rastreo público.
 */
export function emitOrderUpdate(
  tenantId: string,
  order: {
    id: string;
    clientId?: string | null;
    status: string;
    trackingNumber?: string | null;
  },
) {
  emitTenant(tenantId, "order", {
    orderId: order.id,
    clientId: order.clientId ?? null,
    status: order.status,
    trackingNumber: order.trackingNumber ?? null,
  });
  emitOrder(order.id, { status: order.status });
}

/** Cierra todas las conexiones (apagado limpio del servidor y tests). */
export function closeAllStreams() {
  const all = [
    ...[...tenantSubscribers.values()].flatMap((s) => [...s]),
    ...platformSubscribers,
    ...[...orderSubscribers.values()].flatMap((s) => [...s]),
  ];
  for (const sub of all) sub.close();
  tenantSubscribers.clear();
  platformSubscribers.clear();
  orderSubscribers.clear();
}

const HEARTBEAT_MS = 25_000;

export interface SseConnection {
  sub: StreamSubscriber;
  /** Registra limpieza a ejecutar cuando el cliente se desconecte. */
  onClose: (fn: () => void) => void;
}

/**
 * Convierte la respuesta en un stream SSE (hijack de Fastify) conservando los
 * encabezados ya puestos (CORS). Maneja heartbeat anti-timeout y limpieza al
 * desconectar. Debe llamarse DESPUÉS de validar autenticación/permisos.
 */
export function openSseStream(
  request: FastifyRequest,
  reply: FastifyReply,
): SseConnection {
  reply.hijack();
  reply.raw.writeHead(200, {
    // Conservar los encabezados ya puestos por los plugins (CORS).
    ...(reply.getHeaders() as OutgoingHttpHeaders),
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    // Desactiva el buffering de proxies (nginx/render) para entrega inmediata.
    "x-accel-buffering": "no",
  });
  reply.raw.write(": conectado\n\n");

  const heartbeat = setInterval(() => {
    reply.raw.write(": ping\n\n");
  }, HEARTBEAT_MS);

  const closeFns: Array<() => void> = [];
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const fn of closeFns) fn();
  };
  request.raw.on("close", cleanup);

  return {
    sub: {
      send: (event, data) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      close: () => {
        cleanup();
        reply.raw.end();
      },
    },
    onClose: (fn) => closeFns.push(fn),
  };
}
