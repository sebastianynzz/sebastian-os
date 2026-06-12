import { prisma } from "../lib/prisma.js";
import { todayBogota } from "./dailyMetrics.js";

/**
 * Servicio de geocodificación con estrategia en cascada, diseñado para la
 * informalidad de direcciones colombianas:
 *
 *  1. AddressPin: grafo propio de direcciones aprendidas (pines GPS capturados
 *     en entregas exitosas). Es la fuente más confiable y un moat acumulativo.
 *  2. Lupap (proveedor colombiano) si LUPAP_API_KEY está configurada.
 *  3. Google Geocoding si GOOGLE_MAPS_API_KEY está configurada.
 *  4. MockGeocoder determinístico para desarrollo y pruebas.
 *
 * Cada resolución registra su fuente en GeocodeDailyStat: el "graph hit rate"
 * (aciertos del grafo / total) es la métrica de unit economics del moat —
 * cada acierto del grafo es una llamada a Google que no se pagó.
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  source: "ADDRESS_PIN" | "MOCK" | "GOOGLE" | "LUPAP";
  /** Confianza 0–1: pines aprendidos > proveedor externo > mock. */
  confidence: number;
}

export interface GeocodeProvider {
  geocode(address: string, city: string): Promise<GeocodeResult | null>;
}

const PROVIDER_TIMEOUT_MS = 6000;

/** Umbral bajo el cual una dirección entra a la cola de triage. */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** Normaliza una dirección para usarla como clave de búsqueda. */
export function normalizeAddress(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // sin tildes
    .replace(/[#°.,-]/g, " ")
    .replace(/\b(calle|cl)\b/g, "cl")
    .replace(/\b(carrera|kra|cra|kr)\b/g, "kr")
    .replace(/\b(avenida|av)\b/g, "av")
    .replace(/\b(transversal|tv|trans)\b/g, "tv")
    .replace(/\b(diagonal|dg|diag)\b/g, "dg")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cajas urbanas aproximadas para el geocodificador mock. */
const CITY_BBOX: Record<string, { latMin: number; latMax: number; lngMin: number; lngMax: number }> = {
  bogota: { latMin: 4.52, latMax: 4.78, lngMin: -74.18, lngMax: -74.02 },
  medellin: { latMin: 6.18, latMax: 6.32, lngMin: -75.62, lngMax: -75.52 },
  cali: { latMin: 3.36, latMax: 3.5, lngMin: -76.56, lngMax: -76.46 },
};

/**
 * Geocodificador determinístico (hash → punto dentro de la ciudad).
 * Solo para desarrollo: en producción se configura un GeocodeProvider real.
 */
export class MockGeocoder implements GeocodeProvider {
  async geocode(address: string, city: string): Promise<GeocodeResult> {
    const key = normalizeAddress(`${city} ${address}`);
    let h1 = 0;
    let h2 = 0;
    for (let i = 0; i < key.length; i++) {
      h1 = (h1 * 31 + key.charCodeAt(i)) % 100000;
      h2 = (h2 * 37 + key.charCodeAt(i)) % 100000;
    }
    const cityKey = normalizeAddress(city).replace(/\s/g, "");
    const bbox = CITY_BBOX[cityKey] ?? CITY_BBOX["bogota"]!;
    return {
      lat: bbox.latMin + (h1 / 100000) * (bbox.latMax - bbox.latMin),
      lng: bbox.lngMin + (h2 / 100000) * (bbox.lngMax - bbox.lngMin),
      source: "MOCK",
      confidence: 0.3,
    };
  }
}

/**
 * Lupap — geocodificador colombiano especializado en direcciones informales.
 * Activo solo con LUPAP_API_KEY; cualquier fallo cae al siguiente proveedor.
 */
class LupapGeocoder implements GeocodeProvider {
  constructor(private apiKey: string) {}

  async geocode(address: string, city: string): Promise<GeocodeResult | null> {
    try {
      const url = new URL("https://api.lupap.com/v1/geocode");
      url.searchParams.set("address", address);
      url.searchParams.set("city", city);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        lat?: number;
        lng?: number;
        score?: number;
      };
      if (typeof data.lat !== "number" || typeof data.lng !== "number") return null;
      return {
        lat: data.lat,
        lng: data.lng,
        source: "LUPAP",
        confidence: typeof data.score === "number" ? Math.min(Math.max(data.score, 0), 1) : 0.8,
      };
    } catch {
      return null;
    }
  }
}

/** Google Geocoding API — fallback premium (cada llamada cuesta). */
class GoogleGeocoder implements GeocodeProvider {
  constructor(private apiKey: string) {}

  async geocode(address: string, city: string): Promise<GeocodeResult | null> {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("address", `${address}, ${city}, Colombia`);
      url.searchParams.set("key", this.apiKey);
      const res = await fetch(url, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        status?: string;
        results?: Array<{
          geometry?: { location?: { lat: number; lng: number }; location_type?: string };
          partial_match?: boolean;
        }>;
      };
      const first = data.results?.[0];
      const loc = first?.geometry?.location;
      if (data.status !== "OK" || !loc) return null;
      // ROOFTOP = match exacto; RANGE_INTERPOLATED/GEOMETRIC_CENTER = aproximado.
      const locationType = first?.geometry?.location_type;
      let confidence = locationType === "ROOFTOP" ? 0.9 : 0.65;
      if (first?.partial_match) confidence = Math.min(confidence, 0.5);
      return { lat: loc.lat, lng: loc.lng, source: "GOOGLE", confidence };
    } catch {
      return null;
    }
  }
}

function buildProviderChain(): GeocodeProvider[] {
  const chain: GeocodeProvider[] = [];
  if (process.env.LUPAP_API_KEY) chain.push(new LupapGeocoder(process.env.LUPAP_API_KEY));
  if (process.env.GOOGLE_MAPS_API_KEY) chain.push(new GoogleGeocoder(process.env.GOOGLE_MAPS_API_KEY));
  chain.push(new MockGeocoder());
  return chain;
}

const providerChain: GeocodeProvider[] = buildProviderChain();

/** Registra la fuente usada (métrica de unit economics del grafo). */
async function recordGeocodeStat(tenantId: string, source: GeocodeResult["source"]) {
  const date = todayBogota();
  try {
    await prisma.geocodeDailyStat.upsert({
      where: { tenantId_date_source: { tenantId, date, source } },
      create: { tenantId, date, source, count: 1 },
      update: { count: { increment: 1 } },
    });
  } catch {
    // La métrica nunca debe tumbar una creación de pedido.
  }
}

export async function geocodeAddress(
  tenantId: string,
  addressRaw: string,
  city: string,
): Promise<GeocodeResult> {
  const addressKey = normalizeAddress(addressRaw);

  const pin = await prisma.addressPin.findUnique({
    where: { tenantId_addressKey: { tenantId, addressKey } },
  });
  if (pin) {
    await prisma.addressPin.update({
      where: { id: pin.id },
      data: { useCount: { increment: 1 } },
    });
    await recordGeocodeStat(tenantId, "ADDRESS_PIN");
    // Un pin confirmado en campo es la fuente más confiable; gana confianza
    // marginal con cada reuso.
    const confidence = Math.min(0.92 + pin.useCount * 0.01, 0.99);
    return { lat: pin.lat, lng: pin.lng, source: "ADDRESS_PIN", confidence };
  }

  for (const provider of providerChain) {
    const result = await provider.geocode(addressRaw, city);
    if (result) {
      await recordGeocodeStat(tenantId, result.source);
      return result;
    }
  }
  throw new Error(`No se pudo geocodificar: ${addressRaw}`);
}

/**
 * Aprende un pin GPS confirmado en campo (entrega exitosa, corrección del
 * conductor o triage del despachador). Cada confirmación mejora el grafo.
 */
export async function learnAddressPin(
  tenantId: string,
  addressRaw: string,
  lat: number,
  lng: number,
  referenceNotes?: string,
  options?: { source?: string; city?: string },
) {
  const addressKey = normalizeAddress(addressRaw);
  const source = options?.source ?? "DELIVERY_CONFIRMED";
  await prisma.addressPin.upsert({
    where: { tenantId_addressKey: { tenantId, addressKey } },
    create: {
      tenantId,
      addressKey,
      lat,
      lng,
      city: options?.city,
      referenceNotes,
      source,
      useCount: 1,
    },
    update: { lat, lng, referenceNotes, source, useCount: { increment: 1 }, ...(options?.city ? { city: options.city } : {}) },
  });
}
