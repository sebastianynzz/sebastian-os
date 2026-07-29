export const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/**
 * El ACCESS token del operador de plataforma vive SOLO en memoria (MO-16) — es
 * el token de MÁS valor (acceso cross-tenant), así que jamás en localStorage. La
 * sesión se renueva con el REFRESH token de una cookie httpOnly vía
 * /platform/auth/refresh (invisible para JS).
 */
let accessToken: string | null = null;

export function getToken(): string | null {
  return accessToken;
}
export function setToken(token: string | null) {
  accessToken = token;
}

let refreshing: Promise<boolean> | null = null;

export function refreshAccess(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/platform/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      accessToken = ((await res.json()) as { token: string }).token;
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
    fetch(`${BASE_URL}/platform${path}`, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res = await doFetch();
  if (res.status === 401 && !NO_REFRESH.has(path)) {
    if (await refreshAccess()) res = await doFetch();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? "Error de red", data.code);
  }
  return data as T;
}
