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

// Catálogo MoveOS: 6 configuraciones EV en dos líneas de producto (Rap Move,
// IONAx). Fuente de verdad de capacidades/autonomía/reefer en
// `vehicleTypeProfiles.ts`. Toda la flota es eléctrica → pico y placa exenta
// nacionalmente (Ley 1964/2019). `VehicleType` es alias de `VehicleConfig`.
export const VEHICLE_TYPES = [
  "RAP_MOVE_LIGHT",
  "RAP_MOVE_XL",
  "RAP_MOVE_COLD_BOX",
  "IONAX",
  "IONAX_COLD_BOX",
  "IONAX_PICKUP",
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

// Perfil térmico del pedido (cadena de frío). AMBIENT = seco (cualquier
// vehículo); CHILLED/FROZEN exigen una Cold Box compatible (ver
// `configSupportsTempProfile`). FROZEN → solo RAP_MOVE_COLD_BOX (-25°C);
// CHILLED → cualquiera de las dos Cold Box.
export const TEMP_PROFILES = ["AMBIENT", "CHILLED", "FROZEN"] as const;
export type TempProfile = (typeof TEMP_PROFILES)[number];

/**
 * Estrategias de optimización de rutas (selector tipo Spoke). Define la política
 * de asignación del VRP. `BALANCE` es el valor por defecto.
 *  - ASSIGN_TO_SELECTED: usa todos los vehículos seleccionados (los abre primero), luego optimiza.
 *  - EQUALIZE_WORKLOAD:   ~igual número de paradas por conductor.
 *  - BALANCE:             ~igual tiempo de ruta por conductor (por defecto).
 *  - MAXIMIZE_EFFICIENCY: minimiza el tiempo total; las rutas pueden quedar desparejas.
 *  - FEWEST_DRIVERS:      usa la menor cantidad de vehículos posible.
 */
export const OPTIMIZATION_OBJECTIVES = [
  "ASSIGN_TO_SELECTED",
  "EQUALIZE_WORKLOAD",
  "BALANCE",
  "MAXIMIZE_EFFICIENCY",
  "FEWEST_DRIVERS",
] as const;
export type OptimizationObjective = (typeof OPTIMIZATION_OBJECTIVES)[number];

/** Etiquetas en español para el selector de estrategia. */
export const OPTIMIZATION_OBJECTIVE_LABELS: Record<OptimizationObjective, string> = {
  ASSIGN_TO_SELECTED: "Usar todos los seleccionados",
  EQUALIZE_WORKLOAD: "Igualar carga (paradas)",
  BALANCE: "Equilibrar tiempo de ruta",
  MAXIMIZE_EFFICIENCY: "Máxima eficiencia",
  FEWEST_DRIVERS: "Menos conductores",
};

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

// Disponibilidad del conductor (ACTIVE puede recibir rutas; INACTIVE no).
export const DRIVER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

// Disponibilidad operativa del vehículo (solo ACTIVE es despachable).
export const VEHICLE_STATUSES = ["ACTIVE", "MAINTENANCE", "CHARGING"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const STOP_KINDS = ["PICKUP", "DELIVERY"] as const;
export type StopKind = (typeof STOP_KINDS)[number];

// CLIENT = usuario del portal de clientes: pertenece a un negocio cliente
// (Client) del tenant y solo ve/crea pedidos de ese negocio.
export const USER_ROLES = ["ADMIN", "DISPATCHER", "DRIVER", "CLIENT"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TENANT_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_PLANS = ["FREE", "PRO", "ENTERPRISE"] as const;
export type TenantPlan = (typeof TENANT_PLANS)[number];

export const TENANT_OPERATOR_TYPES = [
  "SELF_SERVE",
  "SUB_OPERATOR",
  "PLATFORM_FLEET",
] as const;
export type TenantOperatorType = (typeof TENANT_OPERATOR_TYPES)[number];

// Oferta comercial del tenant. Ortogonal a operatorType (propiedad de
// activos / aprovisionamiento): un contrato 3PL puede ser un SUB_OPERATOR con
// vehículos de MOVE. Etiqueta + preset de módulos, nunca lógica de cobro.
export const TENANT_BUSINESS_MODELS = [
  "SAAS",
  "FAAS",
  "LOGISTICS_3PL",
] as const;
export type TenantBusinessModel = (typeof TENANT_BUSINESS_MODELS)[number];

export const SAFETY_ALERT_TYPES = [
  "ROUTE_DEVIATION",
  "PANIC",
  "LONG_STOP",
  "GEOFENCE_EXIT",
] as const;
export type SafetyAlertType = (typeof SAFETY_ALERT_TYPES)[number];

export const POD_TYPES = ["PHOTO", "SIGNATURE", "OTP", "GEOFENCE"] as const;
export type PodType = (typeof POD_TYPES)[number];

/**
 * Pruebas de entrega que el comercio cliente puede EXIGIR por configuración
 * (política POD configurable por cliente). Es el vocabulario de la política,
 * distinto de POD_TYPES (el registro de evidencia). Se limita a lo que la app
 * del conductor realmente captura hoy: foto y nombre de quien recibe.
 */
export const POD_REQUIREMENTS = ["PHOTO", "RECEIVER_NAME"] as const;
export type PodRequirement = (typeof POD_REQUIREMENTS)[number];

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
