/**
 * Catálogo de módulos activables por tenant (núcleo del modelo "core + módulos").
 * El núcleo (pedidos, despacho, app conductor, tracking, POD básico, notificaciones)
 * siempre está disponible; estos módulos se activan/desactivan por contrato.
 */
export const MODULE_KEYS = [
  "ROUTE_OPTIMIZATION",
  "TELEMATICS",
  "EV_MANAGEMENT",
  "SAFETY",
  "COMPLIANCE_RNDC",
  "CUSTOMER_EXPERIENCE_PRO",
  "ANALYTICS_PRO",
  "AI_ADDONS",
  "COLD_CHAIN",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleDescriptor {
  key: ModuleKey;
  nombre: string;
  descripcion: string;
  /** Incluido por defecto al crear un tenant nuevo (plan de entrada). */
  defaultEnabled: boolean;
  /**
   * Parte del núcleo obligatorio: siempre activo para todo tenant y no
   * desactivable. MoveOS es EV-only — autonomía y carga son núcleo, no un
   * módulo de pago (restricción dura 1.3 de CLAUDE.md).
   */
  core?: boolean;
  /**
   * Otros módulos que este requiere. Habilitarlo arrastra sus dependencias
   * (cascada); no se puede desactivar un módulo del que dependa otro
   * habilitado. El núcleo nunca se lista aquí (ya está siempre activo).
   */
  requires?: ModuleKey[];
}

import type { TenantBusinessModel } from "./enums.js";

/**
 * Preset de módulos por modelo de negocio: valores INICIALES al aprovisionar
 * un tenant desde la plataforma. Cada módulo sigue siendo togglable por
 * tenant después. FAAS incluye lo que MOVE necesita para operar su flota en
 * sitio; LOGISTICS_3PL lo que un contrato de operación logística espera.
 */
export const MODULE_PRESETS_BY_BUSINESS_MODEL: Record<
  TenantBusinessModel,
  ModuleKey[]
> = {
  SAAS: [], // solo los defaultEnabled del catálogo
  FAAS: ["TELEMATICS", "EV_MANAGEMENT", "SAFETY", "ANALYTICS_PRO"],
  LOGISTICS_3PL: ["ANALYTICS_PRO", "CUSTOMER_EXPERIENCE_PRO"],
};

export const MODULE_CATALOG: ModuleDescriptor[] = [
  {
    key: "ROUTE_OPTIMIZATION",
    nombre: "Optimización de rutas",
    descripcion:
      "VRP multi-parada con ventanas horarias, capacidad, pico y placa y perfiles por tipo de vehículo (moto/carro/van/EV).",
    defaultEnabled: true,
  },
  {
    key: "TELEMATICS",
    nombre: "Telemática y GPS",
    descripcion:
      "Ingesta agnóstica de hardware (BYO device) y telemetría por smartphone: posición, velocidad, eventos de conducción.",
    defaultEnabled: false,
  },
  {
    key: "EV_MANAGEMENT",
    nombre: "Gestión de flota eléctrica",
    descripcion:
      "Estado de carga (SoC), estimación dinámica de autonomía (carga, terreno, clima), rutas conscientes de batería y directorio de carga. Parte del núcleo: una flota 100% eléctrica no opera sin esto.",
    defaultEnabled: true,
    core: true,
  },
  {
    key: "SAFETY",
    nombre: "Seguridad de carga",
    descripcion:
      "Geocercas, alertas de desviación de ruta, botón de pánico y paradas seguras (piratería terrestre).",
    defaultEnabled: false,
    requires: ["TELEMATICS"], // inmovilización y desvíos dependen de la posición
  },
  {
    key: "COMPLIANCE_RNDC",
    nombre: "Cumplimiento RNDC",
    descripcion:
      "Generación de manifiesto electrónico (MEC), reporte de tiempos logísticos georreferenciados al RNDC.",
    defaultEnabled: false,
  },
  {
    key: "CUSTOMER_EXPERIENCE_PRO",
    nombre: "Experiencia de cliente Pro",
    descripcion:
      "Notificaciones WhatsApp de marca, página de rastreo en vivo, reagendamiento self-service.",
    defaultEnabled: false,
  },
  {
    key: "ANALYTICS_PRO",
    nombre: "Analítica Pro",
    descripcion:
      "Tableros de puntualidad, costo por parada, productividad de conductores (SPR/SPH) y CO₂.",
    defaultEnabled: false,
  },
  {
    key: "AI_ADDONS",
    nombre: "IA avanzada",
    descripcion:
      "ETAs predictivos, predicción de entregas fallidas, detección de anomalías/robo, resolución de direcciones informales.",
    defaultEnabled: false,
    requires: ["ROUTE_OPTIMIZATION"], // las acciones de optimización envuelven el ruteo
  },
  {
    key: "COLD_CHAIN",
    nombre: "Cadena de frío",
    descripcion:
      "Monitoreo de temperatura por zona (reefer), secuenciación de paradas para minimizar tiempo fuera de banda y alertas de excursión para vehículos Cold Box.",
    defaultEnabled: false,
    requires: ["TELEMATICS"], // la temperatura llega por la ingesta de telemetría
  },
];

/**
 * Claves de los módulos de núcleo: siempre activos, jamás togglables.
 * Derivado del catálogo — una sola fuente de verdad (`core: true`).
 */
export const CORE_MODULE_KEYS: ReadonlySet<ModuleKey> = new Set(
  MODULE_CATALOG.filter((m) => m.core === true).map((m) => m.key),
);

/**
 * Módulos iniciales al aprovisionar un tenant para un modelo de negocio:
 * defaults del catálogo ∪ preset comercial ∪ núcleo. La ÚNICA fórmula —
 * la usan el asistente de onboarding (admin) y el aprovisionamiento (API)
 * para que nunca diverjan.
 */
export function initialModulesForBusinessModel(
  businessModel: TenantBusinessModel,
): Set<ModuleKey> {
  const keys = new Set<ModuleKey>(
    MODULE_CATALOG.filter((m) => m.defaultEnabled || m.core === true).map(
      (m) => m.key,
    ),
  );
  for (const key of MODULE_PRESETS_BY_BUSINESS_MODEL[businessModel]) {
    keys.add(key);
  }
  return keys;
}

/** Dependencias directas declaradas de un módulo. */
export function moduleDeps(key: ModuleKey): ModuleKey[] {
  return MODULE_CATALOG.find((m) => m.key === key)?.requires ?? [];
}

/**
 * Cierre transitivo de dependencias que deben quedar habilitadas junto con
 * `key` (incluye `key`; excluye el núcleo, que ya está siempre activo).
 * Habilitar un módulo arrastra sus dependencias en cascada.
 */
export function modulesToEnableWith(key: ModuleKey): ModuleKey[] {
  const out = new Set<ModuleKey>();
  const visit = (k: ModuleKey) => {
    if (out.has(k)) return;
    out.add(k);
    for (const dep of moduleDeps(k)) visit(dep);
  };
  visit(key);
  return [...out].filter((k) => !CORE_MODULE_KEYS.has(k));
}

/**
 * De los módulos habilitados, cuáles dependen (transitivamente) de `key` y por
 * tanto impiden desactivarlo. Vacío = se puede desactivar.
 */
export function modulesBlockingDisable(
  key: ModuleKey,
  enabledKeys: Iterable<ModuleKey>,
): ModuleKey[] {
  const blockers: ModuleKey[] = [];
  for (const k of new Set(enabledKeys)) {
    if (k === key) continue;
    if (modulesToEnableWith(k).includes(key)) blockers.push(k);
  }
  return blockers;
}

/** Nombre legible de un módulo (para mensajes al usuario). */
export function moduleName(key: ModuleKey): string {
  return MODULE_CATALOG.find((m) => m.key === key)?.nombre ?? key;
}
