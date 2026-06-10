import { useEffect } from "react";
import { BASE_URL, getToken } from "./api";

/**
 * Tiempo real por SSE: sustituye el sondeo de las páginas (mapa cada 3 s,
 * alertas cada 15 s, pedidos manual) por push del servidor.
 *
 * EventSource no permite encabezados, por eso el JWT va por query string.
 * El navegador reconecta solo si el stream se cae; aun así cada página
 * conserva un sondeo lento de respaldo (token vencido, proxies, etc.).
 */
export function subscribeStream(
  events: string[],
  onEvent: (event: string, data: unknown) => void,
): () => void {
  const token = getToken();
  if (!token || typeof EventSource === "undefined") return () => {};
  const es = new EventSource(
    `${BASE_URL}/realtime/stream?token=${encodeURIComponent(token)}`,
  );
  for (const name of events) {
    es.addEventListener(name, (msg) => {
      let data: unknown = null;
      try {
        data = JSON.parse((msg as MessageEvent).data as string);
      } catch {
        // evento sin datos: igual notifica
      }
      onEvent(name, data);
    });
  }
  return () => es.close();
}

/**
 * Hook estándar de las páginas en vivo: carga al montar, recarga al recibir
 * un evento (con regulación para ráfagas de telemetría) y mantiene un sondeo
 * lento de respaldo.
 */
export function useRealtimeReload(
  events: string[],
  reload: () => void,
  { fallbackMs = 60_000, throttleMs = 1_000 } = {},
) {
  useEffect(() => {
    let last = 0;
    let timer: number | undefined;
    const run = () => {
      last = Date.now();
      reload();
    };
    const onEvent = () => {
      const wait = last + throttleMs - Date.now();
      if (wait <= 0) {
        run();
      } else if (timer === undefined) {
        timer = window.setTimeout(() => {
          timer = undefined;
          run();
        }, wait);
      }
    };

    run();
    const close = subscribeStream(events, onEvent);
    const interval = setInterval(run, fallbackMs);
    return () => {
      close();
      clearInterval(interval);
      if (timer !== undefined) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
