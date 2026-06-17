/**
 * Formateo i18n: ahora vive en @moveos/shared como única fuente de verdad para
 * todas las apps (dashboard, portal, rastreo, admin). Se re-exporta aquí para
 * no tocar los imports existentes del dashboard (`../format`).
 */
export {
  formatCop,
  formatNumber,
  formatDateBogota,
  formatDateTimeBogota,
  formatShortBogota,
  formatStampBogota,
} from "@moveos/shared";
