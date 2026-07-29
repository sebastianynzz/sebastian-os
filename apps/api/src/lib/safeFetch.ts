import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Guarda anti-SSRF para peticiones salientes cuya URL la controla el tenant:
 * webhooks de desarrollador (`/developer/webhooks`), webhook de notificación del
 * cliente (`Client.webhookUrl`) y la prueba de webhook (`/clients/test-webhook`).
 *
 * Sin esta guarda, un tenant podría apuntar un webhook a `169.254.169.254`
 * (metadatos del cloud), a `localhost` o a una IP interna y convertir la API en
 * un proxy/escáner de la red privada (SSRF — OWASP A01). Resolvemos el host y
 * rechazamos cualquier destino que caiga en loopback / link-local / rangos
 * privados / CGNAT / multicast.
 *
 * Limitación honesta: esto cierra los vectores con IP o host literal interno.
 * El rebinding de DNS (resolver público y reapuntar a privado entre la
 * validación y la conexión) no se cierra del todo sin fijar la IP en el socket;
 * el riesgo residual se acota con `redirect:"error"` y un timeout corto.
 */

export class BlockedUrlError extends Error {
  constructor(message = "Destino de red no permitido") {
    super(message);
    this.name = "BlockedUrlError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** ¿La IP (v4/v6) NO es enrutable públicamente (privada/interna/reservada)? */
export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // no parseable → bloquear por seguridad
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 privado
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (metadatos)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 privado
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 privado
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240/4 reservado
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const a = ip.toLowerCase();
  if (a === "::" || a === "::1") return true; // unspecified / loopback
  if (a.startsWith("fe80")) return true; // link-local
  if (a.startsWith("fc") || a.startsWith("fd")) return true; // fc00::/7 unique-local
  const mapped = a.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapeado
  if (mapped) return isBlockedIpv4(mapped[1] as string);
  return false;
}

/**
 * Valida que `rawUrl` apunte a un destino http(s) público. Lanza
 * `BlockedUrlError` si el esquema no es http(s) o si el host resuelve a una IP
 * interna. Devuelve la URL parseada. Útil también para validar en el momento de
 * guardar la URL (no solo al hacer fetch).
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError("URL inválida");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BlockedUrlError("Solo se permiten URLs http(s)");
  }
  // En la suite e2e los webhooks se entregan a servidores mock en loopback
  // (127.0.0.1). Se omite SOLO el bloqueo de IPs internas, atado estrictamente a
  // NODE_ENV==="test" (nunca activo en dev/prod). El bloqueo en sí se cubre con
  // pruebas unitarias de `isBlockedIp`.
  if (process.env.NODE_ENV === "test") return url;
  const host = url.hostname.replace(/^\[|\]$/g, ""); // sin corchetes IPv6

  if (isIP(host)) {
    if (isBlockedIp(host)) throw new BlockedUrlError();
    return url;
  }

  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError("No se pudo resolver el host");
  }
  if (addrs.length === 0 || addrs.some((entry) => isBlockedIp(entry.address))) {
    throw new BlockedUrlError();
  }
  return url;
}

export interface SafeFetchOptions extends RequestInit {
  /** Timeout en ms (por defecto 5000). Ignorado si se pasa `signal`. */
  timeoutMs?: number;
}

/**
 * `fetch` con guarda anti-SSRF + timeout + sin seguir redirecciones (un redirect
 * hacia un host interno evadiría la validación previa). Lanza `BlockedUrlError`
 * para destinos no permitidos; el llamador decide cómo reportarlo.
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<Response> {
  await assertPublicUrl(rawUrl);
  const { timeoutMs = 5000, signal, ...init } = opts;
  return fetch(rawUrl, {
    ...init,
    redirect: "error",
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });
}
