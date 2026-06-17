/**
 * Formateo i18n centralizado y compartido por todas las apps (dashboard,
 * portal, rastreo público, admin). Fechas SIEMPRE en hora de Bogotá
 * (CLAUDE.md restricción dura 4) y moneda en pesos colombianos. Antes cada
 * vista llamaba toLocaleString sin timeZone → las fechas salían en la zona del
 * navegador, no la de la operación. Única fuente de verdad para no repetir el
 * error.
 */

const TZ = "America/Bogota";
const LOCALE = "es-CO";

/**
 * Renderiza una plantilla de notificación: reemplaza {{clave}} por `vars[clave]`
 * (vacío si falta). Determinista y sin ejecución de código — solo interpolación
 * de texto para los cuerpos B2B (motor de notificaciones, Tier 2).
 */
export function renderTemplate(
  body: string,
  vars: Record<string, unknown>,
): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** Pesos colombianos sin decimales: "$ 12.345". */
export function formatCop(amount: number): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Número con separadores de miles colombianos. */
export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(LOCALE, opts).format(n);
}

/** Fecha (sin hora) en zona Bogotá. */
export function formatDateBogota(value: string | number | Date): string {
  return new Date(value).toLocaleDateString(LOCALE, { timeZone: TZ });
}

/** Fecha y hora completas en zona Bogotá. */
export function formatDateTimeBogota(value: string | number | Date): string {
  return new Date(value).toLocaleString(LOCALE, { timeZone: TZ });
}

/** Compacto para bitácoras/listas: dd/mm + hh:mm, en hora de Bogotá. */
export function formatShortBogota(value: string | number | Date): string {
  return new Date(value).toLocaleString(LOCALE, {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Marca de auditoría con año: aa/mm/dd hh:mm, en hora de Bogotá. */
export function formatStampBogota(value: string | number | Date): string {
  return new Date(value).toLocaleString(LOCALE, {
    timeZone: TZ,
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
