import { z } from "zod";
import {
  API_KEY_SCOPES,
  DELIVERY_TYPES,
  DRIVER_STATUSES,
  FAIL_REASONS,
  INVOICE_STATUSES,
  NAV_APPS,
  OPTIMIZATION_OBJECTIVES,
  PICKUP_TYPES,
  POD_REQ,
  POD_REQUIREMENTS,
  POD_TYPES,
  SERVICE_STOP_TYPES,
  WEEKDAYS,
  type DeliveryType,
  type PickupType,
  type PodReq,
  NOTIFICATION_EVENTS,
  TELEMETRY_SOURCES,
  TEMP_PROFILES,
  TRACKING_TIERS,
  TENANT_BUSINESS_MODELS,
  TENANT_OPERATOR_TYPES,
  TENANT_PLANS,
  TENANT_STATUSES,
  VEHICLE_COMMAND_TYPES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
} from "./enums.js";

/** Esquemas de validación compartidos entre API, dashboard y app de conductor. */

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const registerTenantSchema = z.object({
  tenantName: z.string().min(2),
  nit: z.string().min(5).optional(),
  city: z.string().default("Bogotá"),
  adminName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

export const NOTIFY_CHANNELS = [
  "IN_APP",
  "EMAIL",
  "WHATSAPP",
  "WEBHOOK",
] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

/** Negocio cliente del tenant (origina los envíos; recibe las confirmaciones). */
export const clientFields = z.object({
  name: z.string().min(2),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  notifyChannel: z.enum(NOTIFY_CHANNELS).default("IN_APP"),
  webhookUrl: z.string().url().optional().or(z.literal("")),
  // Dirección de recogida registrada: origen por defecto de los pedidos que
  // el negocio crea desde su portal (recogida en su bodega/tienda).
  pickupAddressRaw: z.string().min(3).optional().or(z.literal("")),
  pickupNotes: z.string().optional(),
  pickupLat: z.number().min(-90).max(90).optional(),
  pickupLng: z.number().min(-180).max(180).optional(),
  // Política POD configurable: pruebas que ESTE comercio exige para aceptar
  // una entrega (el servidor la hace cumplir en /complete). Vacío = sin
  // exigencia extra (se conserva el comportamiento actual).
  podRequired: z.array(z.enum(POD_REQUIREMENTS)).default([]),
});

const requireWebhookUrl = (c: { notifyChannel?: string; webhookUrl?: string }) =>
  c.notifyChannel !== "WEBHOOK" || !!c.webhookUrl;
const webhookMsg = {
  message: "El canal WEBHOOK requiere webhookUrl",
  path: ["webhookUrl"],
};

export const createClientSchema = clientFields.refine(requireWebhookUrl, webhookMsg);
export const updateClientSchema = clientFields.partial().refine(requireWebhookUrl, webhookMsg);

export const createOrderSchema = z.object({
  clientId: z.string().optional(),
  /** Servicio (promesa SLA + precio por parada) aplicado a este pedido. */
  serviceId: z.string().optional(),
  externalRef: z.string().optional(),
  customerName: z.string().min(2),
  customerPhone: z.string().min(7),
  addressRaw: z.string().min(3),
  addressNotes: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  timeWindowStart: z.string().datetime().optional(),
  timeWindowEnd: z.string().datetime().optional(),
  weightKg: z.number().positive().optional(),
  volumeM3: z.number().positive().optional(),
  // Perfil de cadena de frío del pedido. AMBIENT (seco) por defecto; CHILLED/
  // FROZEN obligan a una Cold Box compatible en la asignación (optimizador).
  tempProfile: z.enum(TEMP_PROFILES).default("AMBIENT"),
  priority: z.number().int().min(0).max(10).default(0),
  // Recogida en origen (opcional). Si se da pickupAddressRaw sin coordenadas,
  // se geocodifica. Habilita el flujo pickup→delivery.
  pickupAddressRaw: z.string().min(3).optional(),
  pickupNotes: z.string().optional(),
  pickupLat: z.number().min(-90).max(90).optional(),
  pickupLng: z.number().min(-180).max(180).optional(),
  /**
   * Valores de las propiedades personalizadas del tenant (Tier 2 §9), indexados
   * por id de CustomProperty. Las claves que no correspondan a una propiedad del
   * tenant se ignoran al crear (resiliencia de import/API).
   */
  customFields: z.record(z.string(), z.string().max(500)).optional(),
});

/**
 * Pedido creado por el negocio cliente desde SU portal. Versión restringida de
 * createOrderSchema: el cliente queda fijado por el token, sin coordenadas
 * manuales ni prioridad. La recogida sale de su dirección registrada
 * (REGISTERED), de una dirección puntual (CUSTOM) o del depósito del operador
 * (NONE).
 */
export const portalCreateOrderSchema = z
  .object({
    customerName: z.string().min(2),
    customerPhone: z.string().min(7),
    addressRaw: z.string().min(3),
    addressNotes: z.string().optional(),
    externalRef: z.string().optional(),
    /** Servicio (promesa SLA) elegido por el negocio para este envío. */
    serviceId: z.string().optional(),
    weightKg: z.number().positive().optional(),
    tempProfile: z.enum(TEMP_PROFILES).default("AMBIENT"),
    pickupMode: z.enum(["REGISTERED", "CUSTOM", "NONE"]).default("REGISTERED"),
    pickupAddressRaw: z.string().min(3).optional(),
    pickupNotes: z.string().optional(),
    /** Valores de propiedades personalizadas del operador (Tier 2 §9), por id. */
    customFields: z.record(z.string(), z.string().max(500)).optional(),
  })
  .refine((o) => o.pickupMode !== "CUSTOM" || !!o.pickupAddressRaw, {
    message: "La recogida puntual requiere pickupAddressRaw",
    path: ["pickupAddressRaw"],
  });

/** Acceso de un negocio cliente al portal (lo crea el ADMIN del tenant). */
export const createPortalAccessSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).optional(),
});

export const createDriverSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(7),
  documentId: z.string().min(5),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  licenseExpiresAt: z.string().datetime().optional(),
  /** Depósito base del conductor (multi-depot, D4). Validado tenant-scoped. */
  depotId: z.string().nullish(),
});

/** Actualización de conductor: disponibilidad, vencimiento de licencia, depósito. */
export const updateDriverSchema = z
  .object({
    status: z.enum(DRIVER_STATUSES).optional(),
    // null limpia la fecha; ausente la deja igual.
    licenseExpiresAt: z.string().datetime().nullable().optional(),
    // null desasigna el depósito; ausente lo deja igual.
    depotId: z.string().nullable().optional(),
  })
  .refine(
    (d) =>
      d.status !== undefined ||
      d.licenseExpiresAt !== undefined ||
      d.depotId !== undefined,
    { message: "Nada que actualizar" },
  );

/** Vista guardada del panel: filtros (mapa string→string) con nombre por página. */
export const createSavedViewSchema = z.object({
  page: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  filters: z.record(z.string(), z.string()),
});
export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;

export const createVehicleSchema = z.object({
  plate: z.string().min(5).max(8),
  type: z.enum(VEHICLE_TYPES),
  capacityKg: z.number().positive(),
  capacityM3: z.number().positive().optional(),
  // EV-only (restricción dura 1): toda la flota MoveOS es eléctrica. Por
  // defecto eléctrico y se rechaza explícitamente un vehículo de combustión —
  // el API es la fuente de verdad, no solo la UI.
  isElectric: z
    .boolean()
    .default(true)
    .refine((v) => v === true, {
      message:
        "La flota MoveOS es 100% eléctrica: no se permiten vehículos de combustión (ICE).",
    }),
  batteryKwh: z.number().positive().optional(),
  nominalRangeKm: z.number().positive().optional(),
  soatExpiresAt: z.string().datetime().optional(),
  tecnoExpiresAt: z.string().datetime().optional(),
  status: z.enum(VEHICLE_STATUSES).optional(),
  /** Depósito base del vehículo (multi-depot, D4). Validado tenant-scoped. */
  homeDepotId: z.string().nullish(),
});

export const planRoutesSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  depot: z.object({ lat: z.number(), lng: z.number() }),
  /** Depósito (multi-depot, D4): si se indica, sus coordenadas mandan y la
   *  ruta queda enlazada a él. Sin depotId se usa `depot` tal cual (compat). */
  depotId: z.string().optional(),
  orderIds: z.array(z.string()).min(1),
  vehicleIds: z.array(z.string()).min(1),
  /** SoC inicial por vehículo eléctrico (0-100), opcional. */
  socByVehicleId: z.record(z.number().min(0).max(100)).optional(),
  /** Estrategia de asignación del VRP. Por defecto BALANCE. */
  objective: z.enum(OPTIMIZATION_OBJECTIVES).optional(),
});

// === Servicios / SLA (D3) ===

/** Crea/edita un Service (promesa de entrega con precio + plazo SLA). Sin COD. */
export const serviceSchema = z.object({
  name: z.string().min(1).max(80),
  identifier: z.string().min(1).max(40),
  pricePerStopCop: z.number().int().nonnegative(),
  /** Plazo de cumplimiento (minutos desde la creación del pedido). */
  completionDeadlineMin: z.number().int().positive(),
  /** Hora de corte (America/Bogotá) "HH:MM" — pedidos posteriores van al día siguiente. */
  cutoffTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  serviceDays: z.array(z.enum(WEEKDAYS)).default([...WEEKDAYS]),
  stopType: z.enum(SERVICE_STOP_TYPES).default("DELIVERY"),
  active: z.boolean().default(true),
});
export type ServiceInput = z.infer<typeof serviceSchema>;

// === Plataforma de desarrolladores (Tier 2 §8) ===

/** Crea una API key del tenant (nombre + permisos). La key en claro se ve una vez. */
export const apiKeySchema = z.object({
  name: z.string().min(1).max(60),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
});
export type ApiKeyInput = z.infer<typeof apiKeySchema>;


/** Suscripción de webhook del tenant a eventos del ciclo de vida (NOTIFICATION_EVENTS). */
export const webhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(NOTIFICATION_EVENTS)).min(1),
  enabled: z.boolean().default(true),
});
export type WebhookInput = z.infer<typeof webhookSchema>;
export const webhookUpdateSchema = webhookSchema.partial();

// === Propiedades personalizadas de parada (Tier 2 §9) ===

/**
 * Crea/edita una propiedad personalizada: campo extra por pedido (p. ej.
 * "Piso", "# factura") con visibilidad por campo para el CONDUCTOR (app) y/o el
 * DESTINATARIO (página pública de rastreo, B2B). El valor por pedido vive en
 * Order.customFields, indexado por id de la propiedad.
 */
export const customPropertySchema = z.object({
  name: z.string().min(1).max(60),
  visibleToDriver: z.boolean().default(false),
  visibleToRecipient: z.boolean().default(false),
});
export type CustomPropertyInput = z.infer<typeof customPropertySchema>;

// === Permisos de la app del conductor (Tier 2 §10) ===

/**
 * Política de permisos de la app del conductor: app de navegación preferida +
 * qué puede hacer el conductor con las rutas. Singleton por tenant; la app del
 * conductor la LEE y solo ADMIN la edita. `granular` deja espacio a banderas
 * finas a futuro.
 */
export const driverPermissionPolicySchema = z.object({
  navApp: z.enum(NAV_APPS).default("INTERNAL_GMAPS"),
  allowEditDispatcherRoutes: z.boolean().default(false),
  allowCreateRoutes: z.boolean().default(false),
  allowEditStartedRoutes: z.boolean().default(false),
  granular: z.record(z.string(), z.boolean()).optional(),
});
export type DriverPermissionPolicyInput = z.infer<
  typeof driverPermissionPolicySchema
>;

/** Política por defecto (app del conductor "bloqueada": solo ejecuta su ruta). */
export function defaultDriverPermissionPolicy(): DriverPermissionPolicyInput {
  return {
    navApp: "INTERNAL_GMAPS",
    allowEditDispatcherRoutes: false,
    allowCreateRoutes: false,
    allowEditStartedRoutes: false,
  };
}

// === Facturación de la suscripción SaaS (Tier 3 §13) ===

/** Datos fiscales/facturación del tenant. El tenant los mantiene; sin pagos. */
export const billingProfileSchema = z.object({
  legalName: z.string().max(160).nullish(),
  nit: z.string().max(40).nullish(),
  billingEmail: z.string().email().nullish(),
  billingAddress: z.string().max(200).nullish(),
});
export type BillingProfileInput = z.infer<typeof billingProfileSchema>;

/** Emisión de una factura por el operador de plataforma (no procesa pagos). */
export const issueInvoiceSchema = z.object({
  number: z.string().min(1).max(40),
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
  amountCop: z.number().int().nonnegative(),
  status: z.enum(INVOICE_STATUSES).default("ISSUED"),
  dueAt: z.string().datetime().nullish(),
  notes: z.string().max(300).nullish(),
});
export type IssueInvoiceInput = z.infer<typeof issueInvoiceSchema>;

// === Motor de notificaciones B2B (Tier 2) ===

/** Plantilla de notificación por evento: ¿notifica? y con qué cuerpo. */
export const messageTemplateSchema = z.object({
  event: z.enum(NOTIFICATION_EVENTS),
  enabled: z.boolean(),
  body: z.string().min(1).max(500),
});
export type MessageTemplateInput = z.infer<typeof messageTemplateSchema>;

// === Seguimiento público / privacidad (Tier 2) ===

/** Nivel de privacidad de la página pública de rastreo del tenant. */
export const trackingTierSchema = z.object({
  trackingTier: z.enum(TRACKING_TIERS),
});
export type TrackingTierInput = z.infer<typeof trackingTierSchema>;

// === Configuración de costos (D6) ===

/** Costo del conductor por hora (COP) si el tenant no lo configuró. */
export const DEFAULT_DRIVER_COST_PER_HOUR_COP = 12000;
/** Tarifa de energía (COP por kWh) por defecto (referencia comercial Colombia). */
export const DEFAULT_ENERGY_TARIFF_COP = 800;

/** Parámetros de costo energético del tenant (costo/hora conductor + COP/kWh). */
export const costConfigSchema = z.object({
  driverCostPerHourCop: z.number().int().nonnegative(),
  energyTariffCop: z.number().nonnegative(),
});
export type CostConfigInput = z.infer<typeof costConfigSchema>;

// === Zonas de entrega (D5) ===

const zonePointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** Crea/edita una Zone (polígono geográfico + conductores asignados). */
export const zoneSchema = z.object({
  name: z.string().min(1).max(80),
  // Color del polígono en el mapa (dato de la zona, no token de UI).
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#233955"),
  geometry: z.object({ points: z.array(zonePointSchema).min(3) }),
  driverIds: z.array(z.string()).default([]),
});
export type ZoneInput = z.infer<typeof zoneSchema>;

// === Depósitos / multi-depot (D4) ===

/** Crea/edita un Depot (centro de salida y regreso de rutas). Tenant-scoped. */
export const depotSchema = z.object({
  name: z.string().min(1).max(80),
  address: z.string().max(200).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Marca el depósito principal del tenant (uno por tenant). */
  isMain: z.boolean().default(false),
});
export type DepotInput = z.infer<typeof depotSchema>;

/**
 * Hora límite del SLA: creación + plazo del servicio. Determinista (UTC); la
 * presentación en America/Bogotá la hace el formateador compartido.
 */
export function slaDueAt(
  createdAt: Date | string,
  completionDeadlineMin: number,
): Date {
  const base = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  return new Date(base.getTime() + completionDeadlineMin * 60_000);
}

/** ¿El pedido incumplió (o incumplirá) su SLA a la hora `now`? */
export function isSlaBreached(
  createdAt: Date | string,
  completionDeadlineMin: number,
  now: Date = new Date(),
): boolean {
  return now.getTime() > slaDueAt(createdAt, completionDeadlineMin).getTime();
}

// === Política de prueba de entrega (POD) configurable por tipo (D2) ===

const podEvidenceReqSchema = z.object({
  signature: z.enum(POD_REQ),
  photo: z.enum(POD_REQ),
});
export type PodEvidenceReq = z.infer<typeof podEvidenceReqSchema>;

/** Config completa: por cada tipo de entrega/recogida, exigencia de firma/foto. */
export const podPolicyConfigSchema = z.object({
  delivery: z.record(z.enum(DELIVERY_TYPES), podEvidenceReqSchema),
  pickup: z.record(z.enum(PICKUP_TYPES), podEvidenceReqSchema),
});
export type PodPolicyConfig = {
  delivery: Partial<Record<DeliveryType, PodEvidenceReq>>;
  pickup: Partial<Record<PickupType, PodEvidenceReq>>;
};

/** Política por defecto sensata (sin pagos: solo entrega y recogida). */
export function defaultPodPolicyConfig(): PodPolicyConfig {
  return {
    delivery: {
      RECIPIENT: { signature: "OPTIONAL", photo: "OPTIONAL" },
      THIRD_PARTY: { signature: "OPTIONAL", photo: "MANDATORY" },
      PICKUP_POINT: { signature: "OPTIONAL", photo: "OPTIONAL" },
      SAFE_PLACE: { signature: "DISABLED", photo: "MANDATORY" },
      MAILBOX: { signature: "DISABLED", photo: "OPTIONAL" },
      OTHER: { signature: "OPTIONAL", photo: "OPTIONAL" },
    },
    pickup: {
      FROM_CUSTOMER: { signature: "OPTIONAL", photo: "OPTIONAL" },
      UNMANNED: { signature: "DISABLED", photo: "MANDATORY" },
      FROM_LOCKER: { signature: "DISABLED", photo: "OPTIONAL" },
      OTHER: { signature: "OPTIONAL", photo: "OPTIONAL" },
    },
  };
}

/** Exigencia de firma/foto para una parada según el tipo elegido (con respaldo). */
export function resolvePodReq(
  config: PodPolicyConfig | null | undefined,
  kind: "DELIVERY" | "PICKUP",
  type: DeliveryType | PickupType | null | undefined,
): PodEvidenceReq {
  const fallback: PodEvidenceReq = { signature: "OPTIONAL", photo: "OPTIONAL" };
  const cfg = config ?? defaultPodPolicyConfig();
  const map = (kind === "PICKUP" ? cfg.pickup : cfg.delivery) as Record<
    string,
    PodEvidenceReq | undefined
  >;
  if (!type) return fallback;
  return map[type] ?? fallback;
}

export const trackingPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKmh: z.number().nonnegative().optional(),
  heading: z.number().min(0).max(360).optional(),
  batterySoc: z.number().min(0).max(100).optional(),
  recordedAt: z.string().datetime().optional(),
  routeId: z.string().optional(),
});

/**
 * Referencia de evidencia POD: la CLAVE del objeto privado
 * (`pod/<tenant>/<hex>.<ext>`), una ruta servida por la API (`/evidence?...`,
 * `/files/...`) o una URL http(s) (datos legados). Más estricta que un `.url()`
 * genérico: excluye esquemas peligrosos como `javascript:` que se renderizan
 * como href (XSS) y que `.url()` sí aceptaría.
 */
export const podEvidenceRef = z
  .string()
  .max(2048)
  .refine(
    (v) =>
      /^https?:\/\//i.test(v) ||
      v.startsWith("/") ||
      /^pod\/[A-Za-z0-9_-]+\/[a-f0-9]{16,}\.(jpg|png|webp)$/.test(v),
    { message: "Referencia de evidencia inválida" },
  );

export const submitPodSchema = z
  .object({
    types: z.array(z.enum(POD_TYPES)).min(1),
    /** Tipo de entrega/recogida elegido por el conductor (política POD por tipo). */
    deliveryType: z.enum(DELIVERY_TYPES).optional(),
    pickupType: z.enum(PICKUP_TYPES).optional(),
    photoUrl: podEvidenceRef.optional(),
    signatureUrl: podEvidenceRef.optional(),
    otpCode: z.string().optional(),
    receivedBy: z.string().optional(),
    notes: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
  })
  // Integridad del POD (fuente de verdad = servidor): una prueba declarada debe
  // venir con su evidencia. Evita registrar una entrega como "con foto/firma/
  // OTP/geocerca" sin la evidencia correspondiente (también desde la cola offline).
  .superRefine((p, ctx) => {
    if (p.types.includes("PHOTO") && !p.photoUrl)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "La prueba PHOTO requiere photoUrl", path: ["photoUrl"] });
    if (p.types.includes("SIGNATURE") && !p.signatureUrl)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "La prueba SIGNATURE requiere signatureUrl", path: ["signatureUrl"] });
    if (p.types.includes("OTP") && !p.otpCode)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "La prueba OTP requiere otpCode", path: ["otpCode"] });
    if (p.types.includes("GEOFENCE") && (p.lat === undefined || p.lng === undefined))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "La prueba GEOFENCE requiere lat y lng", path: ["lat"] });
  });

/**
 * Ping de telemetría desde un dispositivo, el smartphone del conductor o el
 * simulador. Incluye datos CAN (moto / camión liviano) cuando el dispositivo
 * los expone. Identifica el vehículo por placa para ser agnóstico del backend.
 */
export const telemetryIngestSchema = z.object({
  plate: z.string().min(4),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKmh: z.number().nonnegative().optional(),
  heading: z.number().min(0).max(360).optional(),
  batterySoc: z.number().min(0).max(100).optional(),
  rpm: z.number().nonnegative().optional(),
  odometerKm: z.number().nonnegative().optional(),
  fuelLevelPct: z.number().min(0).max(100).optional(),
  coolantTempC: z.number().optional(),
  engineOn: z.boolean().optional(),
  source: z.enum(TELEMETRY_SOURCES).default("DEVICE"),
  routeId: z.string().optional(),
  recordedAt: z.string().datetime().optional(),
});

export const vehicleCommandSchema = z.object({
  type: z.enum(VEHICLE_COMMAND_TYPES),
  reason: z.string().max(280).optional(),
});

/**
 * Motivos de fallo "disputables": el comercio puede objetarlos, así que exigen
 * foto de evidencia. La validación es la FUENTE DE VERDAD (servidor): un fallo
 * sin foto no se acepta, ni siquiera reproducido desde la cola offline —
 * "verificar que offline no pueda saltarse la evidencia".
 */
export const DISPUTABLE_FAIL_REASONS = [
  "CLIENTE_AUSENTE",
  "RECHAZO_PRODUCTO",
] as const;

export const failStopSchema = z
  .object({
    reason: z.enum(FAIL_REASONS),
    notes: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    // Foto de evidencia del fallo (defensa ante disputas del comercio).
    photoUrl: podEvidenceRef.optional(),
  })
  .refine(
    (f) =>
      !(DISPUTABLE_FAIL_REASONS as readonly string[]).includes(f.reason) ||
      !!f.photoUrl,
    { message: "Este motivo requiere foto de evidencia", path: ["photoUrl"] },
  );

export type PortalCreateOrderInput = z.infer<typeof portalCreateOrderSchema>;
export type CreatePortalAccessInput = z.infer<typeof createPortalAccessSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type CreateDriverInput = z.infer<typeof createDriverSchema>;
export type UpdateDriverInput = z.infer<typeof updateDriverSchema>;
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type PlanRoutesInput = z.infer<typeof planRoutesSchema>;
export type TrackingPingInput = z.infer<typeof trackingPingSchema>;
export type SubmitPodInput = z.infer<typeof submitPodSchema>;
export type FailStopInput = z.infer<typeof failStopSchema>;
export type TelemetryIngestInput = z.infer<typeof telemetryIngestSchema>;
export type VehicleCommandInput = z.infer<typeof vehicleCommandSchema>;

/** Panel del operador de plataforma: actualización de un tenant. */
export const updateTenantSchema = z
  .object({
    status: z.enum(TENANT_STATUSES).optional(),
    plan: z.enum(TENANT_PLANS).optional(),
    name: z.string().min(2).optional(),
    nit: z.string().min(5).optional().or(z.literal("")),
    city: z.string().min(2).optional(),
    operatorType: z.enum(TENANT_OPERATOR_TYPES).optional(),
    businessModel: z.enum(TENANT_BUSINESS_MODELS).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: "Indique al menos un campo a actualizar",
  });

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

/** Plataforma crea un usuario del equipo de un tenant (staff, no conductores). */
export const platformCreateUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(["ADMIN", "DISPATCHER"]),
  password: z.string().min(8),
});
export type PlatformCreateUserInput = z.infer<typeof platformCreateUserSchema>;

/** Plataforma actualiza un usuario del equipo (rol/nombre y/o reset de clave). */
export const platformUpdateUserSchema = z
  .object({
    name: z.string().min(2).optional(),
    role: z.enum(["ADMIN", "DISPATCHER"]).optional(),
    newPassword: z.string().min(8).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: "Indique al menos un campo a actualizar",
  });
export type PlatformUpdateUserInput = z.infer<typeof platformUpdateUserSchema>;
