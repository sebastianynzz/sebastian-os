import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { getTenantStatus } from "../plugins/tenantStatus.js";

/**
 * API keys del tenant (plataforma de desarrolladores, Tier 2 §8). Solo se guarda
 * el hash SHA-256 de la key; la key en claro se entrega UNA vez al crearla. La
 * verificación resuelve el tenant + scopes y bloquea tenants suspendidos.
 */

const PREFIX = "mk_live_";

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function generateApiKey(): {
  plaintext: string;
  prefix: string;
  hashedKey: string;
} {
  const plaintext = PREFIX + randomBytes(24).toString("hex");
  return { plaintext, prefix: plaintext.slice(0, 14), hashedKey: hashApiKey(plaintext) };
}

export interface ApiKeyAuth {
  tenantId: string;
  scopes: string[];
}

/** Resuelve la key en claro a { tenantId, scopes }, o null si inválida/suspendida. */
export async function verifyApiKey(plaintext: string): Promise<ApiKeyAuth | null> {
  if (!plaintext.startsWith(PREFIX)) return null;
  const key = await prisma.apiKey.findUnique({
    where: { hashedKey: hashApiKey(plaintext) },
    select: { id: true, tenantId: true, scopes: true },
  });
  if (!key) return null;
  if ((await getTenantStatus(key.tenantId)) === "SUSPENDED") return null;
  await prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { tenantId: key.tenantId, scopes: key.scopes };
}
