import { api } from "./api";

/**
 * Web Push del despacho (P0.6): el personal se suscribe para recibir el
 * botón de pánico y avisos críticos con el dashboard cerrado. Es el lado
 * productor de sendPushToStaff en la API — sin esto, el push de pánico no
 * tendría a quién llegar. Solo en build de producción (en dev no hay SW).
 */

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function canOfferStaffPush(): boolean {
  return (
    import.meta.env.PROD &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    Notification.permission === "default"
  );
}

/** Pide permiso (requiere gesto), registra el SW y guarda la suscripción. */
export async function enableStaffPush(): Promise<boolean> {
  if (
    !import.meta.env.PROD ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return false;
  }
  try {
    const { publicKey } = await api<{ publicKey: string | null }>(
      "GET",
      "/push/vapid-key",
    );
    if (!publicKey) return false;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
    const json = sub.toJSON();
    if (!json.keys?.p256dh || !json.keys.auth) return false;
    await api("POST", "/push/subscriptions", {
      endpoint: sub.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent,
    });
    return true;
  } catch {
    return false;
  }
}
