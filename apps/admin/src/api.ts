export const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/**
 * Renombre de marca MoveOS → daleGo: la primera lectura tras el despliegue
 * migra el valor de la clave anterior en vez de descartarlo, así ningún
 * operador de plataforma queda deslogueado por el cambio de nombre.
 */
function readMigrated(key: string, legacyKey: string): string | null {
  const current = localStorage.getItem(key);
  if (current !== null) return current;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy === null) return null;
  localStorage.setItem(key, legacy);
  localStorage.removeItem(legacyKey);
  return legacy;
}

export function getToken(): string | null {
  return readMigrated("dalego_platform_token", "moveos_platform_token");
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem("dalego_platform_token", token);
  else localStorage.removeItem("dalego_platform_token");
  localStorage.removeItem("moveos_platform_token");
}

export async function api<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE_URL}/platform${path}`, {
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
