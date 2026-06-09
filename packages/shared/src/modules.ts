/**
 * Catálogo de módulos activables por tenant (núcleo del modelo "core + módulos").
 * El núcleo (pedidos, despacho, app conductor, tracking, POD básico, notificaciones)
 * siempre está disponible; estos módulos se activan/desactivan por contrato.
 */
export const MODULE_KEYS = [
  "ROUTE_OPTIMIZATION",
  "COD",
  "TELEMATICS",
  "EV_MANAGEMENT",
  "SAFETY",
  "COMPLIANCE_RNDC",
  "CUSTOMER_EXPERIENCE_PRO",
  "ANALYTICS_PRO",
  "AI_ADDONS",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleDescriptor {
  key: ModuleKey;
  nombre: string;
  descripcion: string;
  /** Incluido por defecto al crear un tenant nuevo (plan de entrada). */
  defaultEnabled: boolean;
}

export const MODULE_CATALOG: ModuleDescriptor[] = [
  {
    key: "ROUTE_OPTIMIZATION",
    nombre: "Optimización de rutas",
    descripcion:
      "VRP multi-parada con ventanas horarias, capacidad, pico y placa y perfiles por tipo de vehículo (moto/carro/van/EV).",
    defaultEnabled: true,
  },
  {
    key: "COD",
    nombre: "Contra-entrega (COD)",
    descripcion:
      "Recaudo en efectivo/QR/datáfono, conciliación automática, liquidación a comercios y analítica de rechazos.",
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
      "Estado de carga (SoC), estimación dinámica de autonomía (carga, terreno, clima) y rutas conscientes de batería.",
    defaultEnabled: false,
  },
  {
    key: "SAFETY",
    nombre: "Seguridad de carga",
    descripcion:
      "Geocercas, alertas de desviación de ruta, botón de pánico y paradas seguras (piratería terrestre).",
    defaultEnabled: false,
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
      "Tableros de puntualidad, costo por parada, productividad de conductores, conciliación COD y CO₂.",
    defaultEnabled: false,
  },
  {
    key: "AI_ADDONS",
    nombre: "IA avanzada",
    descripcion:
      "ETAs predictivos, predicción de rechazo COD, detección de anomalías/robo, resolución de direcciones informales.",
    defaultEnabled: false,
  },
];
