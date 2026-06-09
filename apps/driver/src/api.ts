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

/**
 * Sube la foto del POD (multipart). Devuelve la URL pública o null si no hay
 * red: la entrega continúa sin foto en lugar de bloquear al conductor.
 */
export async function uploadPodPhoto(blob: Blob): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("file", blob, "pod.jpg");
    const res = await fetch(`${BASE_URL}/uploads/pod`, {
      method: "POST",
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      body: form,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url: string };
    return data.url;
  } catch {
    return null; // sin señal: se entrega sin foto
  }
}

/** Comprime la foto en el dispositivo (máx 1280 px, JPEG) antes de subirla. */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const MAX = 1280;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo comprimir"))),
      "image/jpeg",
      0.72,
    );
  });
}
