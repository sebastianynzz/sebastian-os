import * as Sentry from "@sentry/node";

/**
 * Observabilidad (P0.7): Sentry para errores de la API. Degradación elegante
 * como el resto de proveedores — sin SENTRY_DSN queda en no-op y los errores
 * solo van al log. Inicializar ANTES de construir la app.
 */
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Errores ante todo; trazas muestreadas bajo para no gastar cuota free.
    tracesSampleRate: 0.05,
  });
}

export function isSentryEnabled(): boolean {
  return Boolean(dsn);
}

/** Reporta una excepción 5xx (las 4xx son flujo de negocio, no errores). */
export function captureError(error: unknown): void {
  if (!dsn) return;
  Sentry.captureException(error);
}
