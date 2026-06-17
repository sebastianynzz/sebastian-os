import { prisma } from "../lib/prisma.js";

/**
 * Propiedades personalizadas de parada (Tier 2 §9): el tenant define campos
 * extra con visibilidad por campo; el valor por pedido vive en
 * Order.customFields, indexado por id de la propiedad. Estas funciones resuelven
 * qué campos se exponen a cada audiencia (conductor o destinatario) — un campo
 * no visible para la audiencia NUNCA debe salir del API.
 */

export interface CustomPropertyDef {
  id: string;
  name: string;
  visibleToDriver: boolean;
  visibleToRecipient: boolean;
}

export interface VisibleField {
  id: string;
  name: string;
  value: string;
}

type Audience = "driver" | "recipient";

/**
 * Cruza los valores guardados (Order.customFields, por id de propiedad) con las
 * definiciones del tenant y devuelve, ya etiquetados, los campos visibles para
 * la audiencia pedida. Ignora valores vacíos y claves sin definición vigente
 * (p. ej. una propiedad eliminada deja su valor huérfano, que no se muestra).
 */
export function selectVisibleFields(
  customFields: unknown,
  properties: CustomPropertyDef[],
  audience: Audience,
): VisibleField[] {
  if (!customFields || typeof customFields !== "object") return [];
  const values = customFields as Record<string, unknown>;
  const out: VisibleField[] = [];
  for (const p of properties) {
    const visible =
      audience === "driver" ? p.visibleToDriver : p.visibleToRecipient;
    if (!visible) continue;
    const raw = values[p.id];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value === "") continue;
    out.push({ id: p.id, name: p.name, value });
  }
  return out;
}

/** Definiciones de campos del tenant visibles para una audiencia (orden estable). */
export async function loadVisibleProperties(
  tenantId: string,
  audience: Audience,
): Promise<CustomPropertyDef[]> {
  return prisma.customProperty.findMany({
    where: {
      tenantId,
      ...(audience === "driver"
        ? { visibleToDriver: true }
        : { visibleToRecipient: true }),
    },
    select: {
      id: true,
      name: true,
      visibleToDriver: true,
      visibleToRecipient: true,
    },
    orderBy: { createdAt: "asc" },
  });
}
