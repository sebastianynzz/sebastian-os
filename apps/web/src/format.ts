/**
 * Formateo i18n centralizado (Part 4): pesos colombianos y fechas SIEMPRE en
 * hora de Bogotá (CLAUDE.md restricción dura 4). Antes cada vista llamaba
 * toLocaleString sin timeZone → las fechas se mostraban en la zona del
 * navegador, no la de la operación. Reusar estos helpers en todo el dashboard.
 */

const TZ = "America/Bogota";
const LOCALE = "es-CO";

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
