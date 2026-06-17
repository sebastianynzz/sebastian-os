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

export function getToken(): string | null {
  return (
    sessionStorage.getItem(IMPERSONATION_KEY) ??
    localStorage.getItem("moveos_token")
  );
}

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem("moveos_token", token);
  } else {
    localStorage.removeItem("moveos_token");
  }
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
