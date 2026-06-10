import { z } from "zod";
import {
  POD_TYPES,
  TELEMETRY_SOURCES,
  TENANT_PLANS,
  TENANT_STATUSES,
  VEHICLE_COMMAND_TYPES,
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
  priority: z.number().int().min(0).max(10).default(0),
  // Recogida en origen (opcional). Si se da pickupAddressRaw sin coordenadas,
  // se geocodifica. Habilita el flujo pickup→delivery.
  pickupAddressRaw: z.string().min(3).optional(),
  pickupNotes: z.string().optional(),
  pickupLat: z.number().min(-90).max(90).optional(),
  pickupLng: z.number().min(-180).max(180).optional(),
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
    weightKg: z.number().positive().optional(),
    pickupMode: z.enum(["REGISTERED", "CUSTOM", "NONE"]).default("REGISTERED"),
    pickupAddressRaw: z.string().min(3).optional(),
    pickupNotes: z.string().optional(),
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
});

export const createVehicleSchema = z.object({
  plate: z.string().min(5).max(8),
  type: z.enum(VEHICLE_TYPES),
  capacityKg: z.number().positive(),
  capacityM3: z.number().positive().optional(),
  isElectric: z.boolean().default(false),
  batteryKwh: z.number().positive().optional(),
  nominalRangeKm: z.number().positive().optional(),
  soatExpiresAt: z.string().datetime().optional(),
  tecnoExpiresAt: z.string().datetime().optional(),
});

export const planRoutesSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  depot: z.object({ lat: z.number(), lng: z.number() }),
  orderIds: z.array(z.string()).min(1),
  vehicleIds: z.array(z.string()).min(1),
  /** SoC inicial por vehículo eléctrico (0-100), opcional. */
  socByVehicleId: z.record(z.number().min(0).max(100)).optional(),
});

export const trackingPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKmh: z.number().nonnegative().optional(),
  heading: z.number().min(0).max(360).optional(),
  batterySoc: z.number().min(0).max(100).optional(),
  recordedAt: z.string().datetime().optional(),
  routeId: z.string().optional(),
});

export const submitPodSchema = z.object({
  types: z.array(z.enum(POD_TYPES)).min(1),
  photoUrl: z.string().url().optional(),
  signatureUrl: z.string().url().optional(),
  otpCode: z.string().optional(),
  receivedBy: z.string().optional(),
  notes: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
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

export const failStopSchema = z.object({
  reason: z.enum([
    "CLIENTE_AUSENTE",
    "DIRECCION_ERRADA",
    "RECHAZO_PRODUCTO",
    "ZONA_INSEGURA",
    "OTRO",
  ]),
  notes: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export type PortalCreateOrderInput = z.infer<typeof portalCreateOrderSchema>;
export type CreatePortalAccessInput = z.infer<typeof createPortalAccessSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type CreateDriverInput = z.infer<typeof createDriverSchema>;
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
  })
  .refine((b) => b.status !== undefined || b.plan !== undefined, {
    message: "Indique status y/o plan",
  });

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
