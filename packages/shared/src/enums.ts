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
/**
 * Servicios / SLA (D3): un Service es una promesa de entrega con nombre, precio
 * por parada y plazo (SLA). `stopType` define si aplica a entregas, recogidas o
 * ambas. Sin pagos → el Service NO maneja COD (a diferencia de Spoke).
 */
export const SERVICE_STOP_TYPES = ["DELIVERY", "PICKUP", "BOTH"] as const;
export type ServiceStopType = (typeof SERVICE_STOP_TYPES)[number];
export const SERVICE_STOP_TYPE_LABELS: Record<ServiceStopType, string> = {
  DELIVERY: "Entrega",
  PICKUP: "Recogida",
  BOTH: "Entrega y recogida",
};

export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MON: "Lun",
  TUE: "Mar",
  WED: "Mié",
  THU: "Jue",
  FRI: "Vie",
  SAT: "Sáb",
  SUN: "Dom",
};

/**
 * Permisos (scopes) de una API key del tenant (plataforma de desarrolladores,
 * Tier 2 §8). Acotan qué puede hacer una integración externa con la key.
 */
export const API_KEY_SCOPES = ["orders:write", "orders:read", "tracking:read"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  "orders:write": "Crear pedidos",
  "orders:read": "Leer pedidos",
  "tracking:read": "Leer rastreo",
};

/**
 * Catálogo de eventos del ciclo de vida que pueden notificar al NEGOCIO cliente
 * (Tier 2, motor de notificaciones B2B). Nunca se mensajea al consumidor final.
 * El operador decide, por evento, si notifica y con qué texto (MessageTemplate).
 */
export const NOTIFICATION_EVENTS = [
  "STOP_ALLOCATED",
  "OUT_FOR_DELIVERY",
  "NEXT_IN_ROUTE",
  "DEPARTED",
  "ATTEMPTED",
  "DELIVERED",
  "FAILED",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  STOP_ALLOCATED: "Asignado a ruta",
  OUT_FOR_DELIVERY: "Salió a reparto",
  NEXT_IN_ROUTE: "Próxima parada",
  DEPARTED: "Salió del depósito",
  ATTEMPTED: "Intento de entrega",
  DELIVERED: "Entregado",
  FAILED: "Entrega fallida",
};
/**
 * Cuerpo por defecto de cada evento (placeholders {{guia}}, {{destinatario}},
 * {{motivo}}, {{rastreo}}). Dirigido al negocio, en español. El operador puede
 * personalizarlo por tenant.
 */
export const DEFAULT_NOTIFICATION_BODIES: Record<NotificationEvent, string> = {
  STOP_ALLOCATED: "Tu envío {{guia}} fue asignado a una ruta.",
  OUT_FOR_DELIVERY: "Tu envío {{guia}} salió a reparto. Seguimiento: {{rastreo}}",
  NEXT_IN_ROUTE: "Tu envío {{guia}} es la próxima parada del conductor.",
  DEPARTED: "El conductor salió del depósito con tu envío {{guia}}.",
  ATTEMPTED: "Se intentó entregar tu envío {{guia}} sin éxito.",
  DELIVERED: "Tu envío {{guia}} fue entregado a {{destinatario}}.",
  FAILED: "La entrega de tu envío {{guia}} no se pudo completar: {{motivo}}.",
};

/**
 * Nivel de privacidad de la página pública de rastreo (Tier 2, B2B). Controla
 * cuánto se expone del envío al abrir el enlace público:
 *  - ETA_ONLY:     estado + ETA + historial (sin ubicación del conductor).
 *  - ETA_POSITION: lo anterior + posición en la cola de la ruta.
 *  - FULL:         lo anterior + ubicación del conductor en vivo (mapa).
 * Sigue siendo B2B: el enlace lo comparte el negocio; nunca se mensajea al
 * consumidor final.
 */
export const TRACKING_TIERS = ["ETA_ONLY", "ETA_POSITION", "FULL"] as const;
export type TrackingTier = (typeof TRACKING_TIERS)[number];
export const TRACKING_TIER_LABELS: Record<TrackingTier, string> = {
  ETA_ONLY: "Solo ETA",
  ETA_POSITION: "ETA + posición en cola",
  FULL: "Completo (ubicación en vivo)",
};

/**
 * Motivos estandarizados de entrega fallida. Base del análisis de fallos (D6)
 * y de la recuperación B2B. DIRECCION_ERRADA alimenta el relato del grafo de
 * direcciones (moat). `OTRO` recoge lo no clasificado (incl. sin motivo).
 */
export const FAIL_REASONS = [
  "CLIENTE_AUSENTE",
  "DIRECCION_ERRADA",
  "RECHAZO_PRODUCTO",
  "ZONA_INSEGURA",
  "OTRO",
] as const;
export type FailReason = (typeof FAIL_REASONS)[number];
export const FAIL_REASON_LABELS: Record<FailReason, string> = {
  CLIENTE_AUSENTE: "Cliente ausente",
  DIRECCION_ERRADA: "Dirección errada",
  RECHAZO_PRODUCTO: "Rechazo del producto",
  ZONA_INSEGURA: "Zona insegura",
  OTRO: "Otro",
};

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

/**
 * Tope de propiedades personalizadas de parada por plan (Tier 2 §9). Al llegar
 * al tope, la creación devuelve 409 con un mensaje de upsell — el gancho de
 * "mejora tu plan" del que vive la medición de uso (Tier 3). Núcleo B2B
 * configurable; sin pagos.
 */
export const CUSTOM_PROPERTY_CAPS: Record<TenantPlan, number> = {
  FREE: 3,
  PRO: 10,
  ENTERPRISE: 50,
};
/** Tope de campos personalizados para un plan (fallback al de FREE si no existe). */
export function customPropertyCap(plan: string): number {
  return CUSTOM_PROPERTY_CAPS[plan as TenantPlan] ?? CUSTOM_PROPERTY_CAPS.FREE;
}

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
 * App de navegación preferida para los deeplinks de la app del conductor
 * (Tier 2 §10). INTERNAL_GMAPS = el destino por defecto de la app (enlace a
 * Google Maps); WAZE / GOOGLE eligen explícitamente una app externa. Integramos
 * deeplinks, nunca construimos navegación propia.
 */
export const NAV_APPS = ["INTERNAL_GMAPS", "WAZE", "GOOGLE"] as const;
export type NavApp = (typeof NAV_APPS)[number];
export const NAV_APP_LABELS: Record<NavApp, string> = {
  INTERNAL_GMAPS: "Google Maps (por defecto)",
  WAZE: "Waze",
  GOOGLE: "Google Maps",
};

/**
 * Tipo de escaneo de paquete (Tier 2 §11): LOAD (verificación del manifiesto al
 * cargar el vehículo en el depósito), PICKUP (recogida en origen) o DELIVER
 * (confirmación en la entrega). Cadena de custodia depósito → puerta.
 */
export const SCAN_TYPES = ["LOAD", "PICKUP", "DELIVER"] as const;
export type ScanType = (typeof SCAN_TYPES)[number];
export const SCAN_TYPE_LABELS: Record<ScanType, string> = {
  LOAD: "Carga",
  PICKUP: "Recogida",
  DELIVER: "Entrega",
};

/**
 * Pruebas de entrega que el comercio cliente puede EXIGIR por configuración
 * (política POD configurable por cliente). Es el vocabulario de la política,
 * distinto de POD_TYPES (el registro de evidencia). Se limita a lo que la app
 * del conductor realmente captura hoy: foto y nombre de quien recibe.
 */
export const POD_REQUIREMENTS = ["PHOTO", "RECEIVER_NAME"] as const;
export type PodRequirement = (typeof POD_REQUIREMENTS)[number];

/**
 * Política de prueba de entrega CONFIGURABLE POR TIPO (paridad con Spoke, D2).
 * El despachador define, por tipo de entrega/recogida, si la firma y la foto son
 * obligatorias, opcionales o deshabilitadas; el conductor elige el tipo y la app
 * BLOQUEA la finalización si falta una evidencia obligatoria (servidor = fuente
 * de verdad). NOTA: MoveOS no procesa pagos → NO existe pestaña/credenciales COD
 * (a diferencia de Spoke); la política cubre solo entrega y recogida.
 */
export const DELIVERY_TYPES = [
  "RECIPIENT",
  "THIRD_PARTY",
  "PICKUP_POINT",
  "SAFE_PLACE",
  "MAILBOX",
  "OTHER",
] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export const PICKUP_TYPES = [
  "FROM_CUSTOMER",
  "UNMANNED",
  "FROM_LOCKER",
  "OTHER",
] as const;
export type PickupType = (typeof PICKUP_TYPES)[number];

/** Nivel de exigencia de una evidencia (firma/foto) por tipo de parada. */
export const POD_REQ = ["MANDATORY", "OPTIONAL", "DISABLED"] as const;
export type PodReq = (typeof POD_REQ)[number];

export const DELIVERY_TYPE_LABELS: Record<DeliveryType, string> = {
  RECIPIENT: "Destinatario",
  THIRD_PARTY: "Tercero",
  PICKUP_POINT: "Punto de recogida",
  SAFE_PLACE: "Lugar seguro",
  MAILBOX: "Buzón",
  OTHER: "Otro",
};
export const PICKUP_TYPE_LABELS: Record<PickupType, string> = {
  FROM_CUSTOMER: "En el cliente",
  UNMANNED: "Sin personal",
  FROM_LOCKER: "Casillero",
  OTHER: "Otro",
};

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
