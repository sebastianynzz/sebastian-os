import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/**
 * ¿El error es una violación de restricción única (P2002)? Se usa para resolver
 * carreras de forma idempotente (doble alta de pedido, doble confirmación de
 * POD) apoyándose en los índices únicos de la BD en vez de un check TOCTOU.
 * `target` permite distinguir CUÁL restricción se violó.
 */
export function isUniqueViolation(err: unknown, target?: string): boolean {
  if (
    typeof err !== "object" ||
    err === null ||
    (err as { code?: unknown }).code !== "P2002"
  ) {
    return false;
  }
  if (!target) return true;
  const meta = (err as { meta?: { target?: unknown } }).meta;
  const t = meta?.target;
  if (Array.isArray(t)) return t.includes(target);
  if (typeof t === "string") return t.includes(target);
  return false;
}
