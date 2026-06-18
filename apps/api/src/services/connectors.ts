/**
 * Conectores de ingesta (Tier 2 §8): normalizan el pedido de una plataforma
 * externa (Shopify, VTEX, Mercado Libre, o un mapeo genérico tipo Zapier) al
 * formato de createOrder. Son adaptadores puros y defensivos: extraen lo que
 * existe y dejan que createOrderSchema valide el resultado (400 si falta lo
 * mínimo). El desbloqueo de escala: pedidos entran desde donde vende el cliente.
 */

export const CONNECTOR_SOURCES = [
  "shopify",
  "vtex",
  "mercadolibre",
  "zapier",
] as const;
export type ConnectorSource = (typeof CONNECTOR_SOURCES)[number];

export const CONNECTOR_LABELS: Record<ConnectorSource, string> = {
  shopify: "Shopify",
  vtex: "VTEX",
  mercadolibre: "Mercado Libre",
  zapier: "Zapier / genérico",
};

type Json = Record<string, unknown>;

function asObj(v: unknown): Json {
  return v && typeof v === "object" ? (v as Json) : {};
}
function str(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  return undefined;
}
function join(parts: (string | undefined)[]): string | undefined {
  const out = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return out.length > 0 ? out.join(", ") : undefined;
}
/** Une partes de un NOMBRE con espacio (no coma). */
function name(parts: (string | undefined)[]): string | undefined {
  const out = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return out.length > 0 ? out.join(" ") : undefined;
}

/** Shopify: webhook orders/create — shipping_address + customer + order_number. */
function fromShopify(p: Json): Json {
  const ship = asObj(p.shipping_address);
  const customer = asObj(p.customer);
  const customerName =
    str(ship.name) ??
    name([str(ship.first_name), str(ship.last_name)]) ??
    name([str(customer.first_name), str(customer.last_name)]);
  return {
    customerName,
    customerPhone: str(ship.phone) ?? str(customer.phone) ?? str(p.phone),
    addressRaw: join([
      str(ship.address1),
      str(ship.address2),
      str(ship.city),
      str(ship.province),
    ]),
    addressNotes: str(p.note),
    externalRef: str(p.order_number) ?? str(p.name) ?? str(p.id),
  };
}

/** VTEX: orden — clientProfileData + shippingData.address. */
function fromVtex(p: Json): Json {
  const client = asObj(p.clientProfileData);
  const addr = asObj(asObj(p.shippingData).address);
  return {
    customerName: name([str(client.firstName), str(client.lastName)]),
    customerPhone: str(client.phone),
    addressRaw: join([
      str(addr.street),
      str(addr.number),
      str(addr.neighborhood),
      str(addr.city),
    ]),
    addressNotes: str(addr.complement) ?? str(addr.reference),
    externalRef: str(p.orderId) ?? str(p.sequence),
  };
}

/** Mercado Libre: orden — buyer + shipping.receiver_address. */
function fromMercadoLibre(p: Json): Json {
  const buyer = asObj(p.buyer);
  const phone = asObj(buyer.phone);
  const recv = asObj(asObj(p.shipping).receiver_address);
  const city = asObj(recv.city);
  return {
    customerName:
      name([str(buyer.first_name), str(buyer.last_name)]) ?? str(buyer.nickname),
    customerPhone: str(phone.number) ?? str(recv.receiver_phone),
    addressRaw:
      str(recv.address_line) ??
      join([str(recv.street_name), str(recv.street_number), str(city.name)]),
    addressNotes: str(recv.comment),
    externalRef: str(p.id),
  };
}

/** Zapier / genérico: ya viene casi en nuestro formato (passthrough acotado). */
function fromZapier(p: Json): Json {
  return {
    customerName: str(p.customerName) ?? str(p.name),
    customerPhone: str(p.customerPhone) ?? str(p.phone),
    addressRaw: str(p.addressRaw) ?? str(p.address),
    addressNotes: str(p.addressNotes) ?? str(p.notes),
    externalRef: str(p.externalRef) ?? str(p.reference) ?? str(p.id),
    weightKg: typeof p.weightKg === "number" ? p.weightKg : undefined,
  };
}

/** Normaliza el payload de una plataforma al formato de createOrder. */
export function normalizeOrder(source: ConnectorSource, payload: unknown): Json {
  const p = asObj(payload);
  const mapped =
    source === "shopify"
      ? fromShopify(p)
      : source === "vtex"
        ? fromVtex(p)
        : source === "mercadolibre"
          ? fromMercadoLibre(p)
          : fromZapier(p);
  // Quitar claves undefined para que los `.optional()` del schema apliquen.
  return Object.fromEntries(
    Object.entries(mapped).filter(([, v]) => v !== undefined),
  );
}
