import { prisma } from "../lib/prisma.js";

/**
 * Caché TTL de la versión de token de cada usuario (revocación de JWT). El JWT
 * lleva `tv`; en cada request autenticado se compara contra la versión vigente.
 * Igual que el estado del tenant, se cachea para no consultar la BD en cada
 * petición; logout / reset / cambio de rol llaman a `invalidateUserToken`, así
 * que en un solo proceso la revocación es inmediata y entre instancias, a lo
 * sumo, TTL-stale (≤60 s). Los tokens viven ≤12 h, así que la ventana es acotada.
 */

const TTL_MS = 60_000;
const cache = new Map<string, { version: number; expiresAt: number }>();

/** Versión de token vigente del usuario; `null` si el usuario ya no existe. */
export async function getUserTokenVersion(userId: string): Promise<number | null> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.version;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true },
  });
  if (!user) {
    cache.delete(userId);
    return null;
  }
  cache.set(userId, { version: user.tokenVersion, expiresAt: Date.now() + TTL_MS });
  return user.tokenVersion;
}

export function invalidateUserToken(userId: string): void {
  cache.delete(userId);
}
