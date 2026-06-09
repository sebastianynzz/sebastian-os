/**
 * Enumeraciones del dominio. Se modelan como uniones de strings (no enums de
 * Prisma) para mantener portabilidad entre motores de base de datos.
 */

export const ORDER_STATUSES = [
  "PENDING",
  "GEOCODED",
  "ASSIGNED",
  "IN_TRANSIT",
  "DELIVERED",
  "FAILED",
  "REJECTED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const VEHICLE_TYPES = [
  "MOTO",
  "BICICLETA",
  "CARRO",
  "VAN",
  "CAMION",
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const ROUTE_STATUSES = [
  "PLANNED",
  "DISPATCHED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const STOP_STATUSES = [
  "PENDING",
  "ARRIVED",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];

export const USER_ROLES = ["ADMIN", "DISPATCHER", "DRIVER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TENANT_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_PLANS = ["FREE", "PRO", "ENTERPRISE"] as const;
export type TenantPlan = (typeof TENANT_PLANS)[number];

export const SAFETY_ALERT_TYPES = [
  "ROUTE_DEVIATION",
  "PANIC",
  "LONG_STOP",
  "GEOFENCE_EXIT",
] as const;
export type SafetyAlertType = (typeof SAFETY_ALERT_TYPES)[number];

export const POD_TYPES = ["PHOTO", "SIGNATURE", "OTP", "GEOFENCE"] as const;
export type PodType = (typeof POD_TYPES)[number];

export const TELEMETRY_SOURCES = ["PHONE", "DEVICE", "SIMULATOR"] as const;
export type TelemetrySource = (typeof TELEMETRY_SOURCES)[number];

export const VEHICLE_COMMAND_TYPES = ["ENGINE_OFF", "ENGINE_ON"] as const;
export type VehicleCommandType = (typeof VEHICLE_COMMAND_TYPES)[number];

export const VEHICLE_COMMAND_STATUSES = [
  "PENDING",
  "SENT",
  "ACK",
  "REJECTED",
] as const;
export type VehicleCommandStatus = (typeof VEHICLE_COMMAND_STATUSES)[number];
