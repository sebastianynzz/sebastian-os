export const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

const IMPERSONATION_KEY = "moveos_impersonation_token";

/**
 * El token de impersonación (consola de soporte) vive en sessionStorage:
 * aislado POR PESTAÑA y no persistente — jamás pisa la sesión normal de
 * otras pestañas abiertas ni sobrevive al cierre.
 */
export function setImpersonationToken(token: string): void {
  sessionStorage.setItem(IMPERSONATION_KEY, token);
}

/** ¿La sesión activa es de impersonación (consola de soporte)? */
export function isImpersonating(): boolean {
  return Boolean(sessionStorage.getItem(IMPERSONATION_KEY));
}

/**
 * El ACCESS token vive SOLO en memoria (MO-16), no en localStorage: un XSS no
 * puede robar una sesión durable ni leer un token que sobreviva al cierre de la
 * pestaña. La sesión se renueva al recargar y al expirar vía /auth/refresh, que
 * usa el REFRESH token de una cookie httpOnly (invisible para JS).
 */
let accessToken: string | null = null;

export function getToken(): string | null {
  return sessionStorage.getItem(IMPERSONATION_KEY) ?? accessToken;
}

export function setToken(token: string | null) {
  accessToken = token;
  // Cualquier login/logout explícito termina la sesión de soporte de la pestaña.
  sessionStorage.removeItem(IMPERSONATION_KEY);
}

// Renovación con un solo vuelo: varias peticiones que reciben 401 a la vez
// comparten la misma llamada a /auth/refresh en lugar de dispararla N veces.
let refreshing: Promise<boolean> | null = null;

export function refreshAccess(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include", // envía la cookie httpOnly de refresh
      });
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      const data = (await res.json()) as { token: string };
      accessToken = data.token;
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

const NO_REFRESH = new Set(["/auth/login", "/auth/refresh", "/auth/logout"]);

export async function api<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const doFetch = () =>
    fetch(`${BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res = await doFetch();
  // Access token ausente/expirado: renovar una vez con la cookie y reintentar.
  // No durante impersonación (su token es de sessionStorage, sin refresh).
  if (res.status === 401 && !isImpersonating() && !NO_REFRESH.has(path)) {
    if (await refreshAccess()) res = await doFetch();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? "Error de red", data.code);
  }
  return data as T;
}
