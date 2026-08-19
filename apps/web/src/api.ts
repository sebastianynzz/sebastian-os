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

const TOKEN_KEY = "dalego_token";
const IMPERSONATION_KEY = "dalego_impersonation_token";

/**
 * Renombre de marca MoveOS → daleGo. Las claves de almacenamiento cambiaron de
 * prefijo, así que la primera lectura tras el despliegue migra el valor de la
 * clave anterior en vez de descartarlo: nadie queda deslogueado por el cambio
 * de nombre. Se puede retirar cuando ya no queden sesiones previas vivas.
 */
function readMigrated(
  store: Storage,
  key: string,
  legacyKey: string,
): string | null {
  const current = store.getItem(key);
  if (current !== null) return current;
  const legacy = store.getItem(legacyKey);
  if (legacy === null) return null;
  store.setItem(key, legacy);
  store.removeItem(legacyKey);
  return legacy;
}

/**
 * El token de impersonación (consola de soporte) vive en sessionStorage:
 * aislado POR PESTAÑA y no persistente — jamás pisa la sesión normal de
 * otras pestañas abiertas ni sobrevive al cierre.
 */
export function setImpersonationToken(token: string): void {
  sessionStorage.setItem(IMPERSONATION_KEY, token);
}

export function getToken(): string | null {
  return (
    readMigrated(sessionStorage, IMPERSONATION_KEY, "moveos_impersonation_token") ??
    readMigrated(localStorage, TOKEN_KEY, "moveos_token")
  );
}

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
  localStorage.removeItem("moveos_token");
  // Cualquier login/logout explícito termina la sesión de soporte de la pestaña.
  sessionStorage.removeItem(IMPERSONATION_KEY);
}

export async function api<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? "Error de red", data.code);
  }
  return data as T;
}
