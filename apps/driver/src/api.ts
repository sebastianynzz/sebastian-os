const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const QUEUE_KEY = "moveos_driver_queue";

export function getToken(): string | null {
  return localStorage.getItem("moveos_driver_token");
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem("moveos_driver_token", token);
  else localStorage.removeItem("moveos_driver_token");
}

export async function api<T = unknown>(
  method: "GET" | "POST",
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
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data as T;
}

interface QueuedAction {
  method: "POST";
  path: string;
  body?: unknown;
  queuedAt: string;
}

function readQueue(): QueuedAction[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function writeQueue(queue: QueuedAction[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Modo offline-first para zonas sin señal: si la petición falla por red,
 * se encola en localStorage y se reintenta al recuperar conectividad.
 */
export async function apiOrQueue(
  path: string,
  body?: unknown,
): Promise<{ queued: boolean }> {
  try {
    await api("POST", path, body);
    return { queued: false };
  } catch (err) {
    // Solo encolar errores de red, no errores de negocio (4xx).
    if (err instanceof TypeError) {
      const queue = readQueue();
      queue.push({ method: "POST", path, body, queuedAt: new Date().toISOString() });
      writeQueue(queue);
      return { queued: true };
    }
    throw err;
  }
}

export async function flushQueue(): Promise<number> {
  const queue = readQueue();
  if (queue.length === 0) return 0;
  const remaining: QueuedAction[] = [];
  let flushed = 0;
  for (const action of queue) {
    try {
      await api(action.method, action.path, action.body);
      flushed++;
    } catch (err) {
      if (err instanceof TypeError) {
        remaining.push(action); // sigue sin red
      } else {
        flushed++; // error de negocio: descartar para no bloquear la cola
      }
    }
  }
  writeQueue(remaining);
  return flushed;
}

export function queueSize(): number {
  return readQueue().length;
}
