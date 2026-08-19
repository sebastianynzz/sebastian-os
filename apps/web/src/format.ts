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

import { VEHICLE_TYPE_PROFILES, type VehicleType } from "@moveos/shared";

/**
 * Nombre comercial de la configuración de vehículo ("Rap Move Light", "IONAx
 * Cold Box"). El catálogo de `@moveos/shared` es la fuente de verdad; sin esta
 * traducción varias pantallas mostraban el enum crudo (`RAP_MOVE_LIGHT`) donde
 * Vehículos y Flota eléctrica ya mostraban el nombre comercial.
 */
export function configLabel(type: string): string {
  return VEHICLE_TYPE_PROFILES[type as VehicleType]?.labelEs ?? type;
}
