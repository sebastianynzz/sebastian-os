import { z } from "zod";
import { POD_TYPES, VEHICLE_TYPES } from "./enums.js";

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

export const createOrderSchema = z.object({
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

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateDriverInput = z.infer<typeof createDriverSchema>;
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type PlanRoutesInput = z.infer<typeof planRoutesSchema>;
export type TrackingPingInput = z.infer<typeof trackingPingSchema>;
export type SubmitPodInput = z.infer<typeof submitPodSchema>;
export type FailStopInput = z.infer<typeof failStopSchema>;
