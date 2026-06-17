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

export interface QueuedAction {
  id: string;
  method: "POST";
  path: string;
  body?: unknown;
  /** Etiqueta legible para el panel de cola (p. ej. "Entrega"). */
  label: string;
  queuedAt: string;
  attempts: number;
  /** PENDING = en cola/reintentando; ERROR = el servidor la rechazó (4xx/409). */
  status: "PENDING" | "ERROR";
  lastError?: string;
  /** Epoch ms; backoff: no reintentar antes de este momento (0 = lista). */
  nextAttemptAt: number;
}

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 5 * 60_000;

// Reentrancy guard: el flush corre desde el evento "online" (App) y desde el
// temporizador del panel de cola; sin esto dos flushes concurrentes podrían
// reenviar la misma acción (doble entrega).
let flushing = false;

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `q_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** Lee y NORMALIZA la cola (tolera entradas viejas tras un deploy). */
function readQueue(): QueuedAction[] {
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as Partial<QueuedAction>[];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((a) => a && typeof a.path === "string")
      .map((a) => ({
        id: a.id ?? newId(),
        method: "POST" as const,
        path: a.path as string,
        body: a.body,
        label: a.label ?? (a.path as string),
        queuedAt: a.queuedAt ?? new Date().toISOString(),
        attempts: a.attempts ?? 0,
        status: a.status === "ERROR" ? "ERROR" : "PENDING",
        lastError: a.lastError,
        nextAttemptAt: a.nextAttemptAt ?? 0,
      }));
  } catch {
    return [];
  }
}
function writeQueue(queue: QueuedAction[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Modo offline-first para zonas sin señal: si la petición falla por RED se
 * encola en localStorage (persiste entre cierres) y se reintenta con backoff.
 * Los errores de negocio (4xx) en vivo se propagan de inmediato. `ephemeral`
 * (p. ej. pings GPS) NO se encola: reproducir posiciones viejas no aporta.
 */
export async function apiOrQueue(
  path: string,
  body?: unknown,
  opts?: { label?: string; ephemeral?: boolean },
): Promise<{ queued: boolean }> {
  try {
    await api("POST", path, body);
    return { queued: false };
  } catch (err) {
    if (err instanceof TypeError) {
      if (opts?.ephemeral) return { queued: false };
      const queue = readQueue();
      queue.push({
        id: newId(),
        method: "POST",
        path,
        body,
        label: opts?.label ?? path,
        queuedAt: new Date().toISOString(),
        attempts: 0,
        status: "PENDING",
        nextAttemptAt: 0,
      });
      writeQueue(queue);
      return { queued: true };
    }
    throw err;
  }
}

/**
 * Procesa la cola en orden. Respeta el backoff por acción. Éxito → se elimina;
 * fallo de RED → backoff exponencial y sigue PENDING; rechazo del SERVIDOR
 * (4xx/conflicto 409) → queda en ERROR (NO se descarta en silencio) para que el
 * conductor lo vea y decida reintentar o descartar. Devuelve cuántas se
 * sincronizaron con éxito.
 */
export async function flushQueue(): Promise<number> {
  if (flushing) return 0;
  const queue = readQueue();
  if (queue.length === 0) return 0;
  flushing = true;
  const now = Date.now();
  const remaining: QueuedAction[] = [];
  let flushed = 0;
  try {
  for (const action of queue) {
    if (action.status === "PENDING" && action.nextAttemptAt > now) {
      remaining.push(action); // aún en backoff: conservar en orden
      continue;
    }
    if (action.status === "ERROR") {
      remaining.push(action); // terminal hasta que el conductor reintente/descarte
      continue;
    }
    try {
      await api(action.method, action.path, action.body);
      flushed++;
    } catch (err) {
      const attempts = action.attempts + 1;
      if (err instanceof TypeError) {
        const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_CAP_MS);
        remaining.push({
          ...action,
          attempts,
          status: "PENDING",
          nextAttemptAt: now + delay,
          lastError: "Sin conexión",
        });
      } else {
        remaining.push({
          ...action,
          attempts,
          status: "ERROR",
          nextAttemptAt: 0,
          lastError: err instanceof Error ? err.message : "Error del servidor",
        });
      }
    }
  }
  writeQueue(remaining);
  return flushed;
  } finally {
    flushing = false;
  }
}

export function getQueue(): QueuedAction[] {
  return readQueue();
}
export function queueSize(): number {
  return readQueue().length;
}
/** Fuerza el reintento de una acción en ERROR (limpia el error y el backoff). */
export function retryAction(id: string): void {
  writeQueue(
    readQueue().map((a) =>
      a.id === id ? { ...a, status: "PENDING", nextAttemptAt: 0, lastError: undefined } : a,
    ),
  );
}
/** Descarta manualmente una acción (p. ej. rechazo definitivo del servidor). */
export function discardAction(id: string): void {
  writeQueue(readQueue().filter((a) => a.id !== id));
}

const UPLOAD_MAX_ATTEMPTS = 3;
const UPLOAD_BACKOFF_MS = 1_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Sube la foto del POD (multipart). Reintenta los fallos transitorios (red caída
 * o 5xx) con backoff antes de rendirse — un parpadeo de señal móvil no debería
 * perder la prueba de entrega. Un rechazo del servidor (4xx, p. ej. 413 muy
 * grande) NO se reintenta: no ayudaría. Devuelve la URL pública o null tras
 * agotar los intentos; en ese caso la entrega continúa sin foto en lugar de
 * bloquear al conductor (el POD solo declara la evidencia que sí tiene).
 */
export async function uploadPodPhoto(blob: Blob): Promise<string | null> {
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      const form = new FormData();
      form.append("file", blob, "pod.jpg");
      const res = await fetch(`${BASE_URL}/uploads/pod`, {
        method: "POST",
        headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
        body: form,
      });
      if (res.ok) {
        const data = (await res.json()) as { url: string };
        return data.url;
      }
      // Rechazo del cliente (4xx): reintentar no cambia el resultado.
      if (res.status >= 400 && res.status < 500) return null;
      // 5xx: error transitorio del servidor → cae al backoff y reintenta.
    } catch {
      // Fallo de red (TypeError) → cae al backoff y reintenta.
    }
    if (attempt < UPLOAD_MAX_ATTEMPTS) await sleep(UPLOAD_BACKOFF_MS * attempt);
  }
  return null; // sin señal tras varios intentos: se entrega sin foto
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
