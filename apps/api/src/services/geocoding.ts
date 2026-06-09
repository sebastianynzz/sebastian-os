import { prisma } from "../lib/prisma.js";

/**
 * Servicio de geocodificación con estrategia en cascada, diseñado para la
 * informalidad de direcciones colombianas:
 *
 *  1. AddressPin: grafo propio de direcciones aprendidas (pines GPS capturados
 *     en entregas exitosas). Es la fuente más confiable y un moat acumulativo.
 *  2. Proveedor externo (Google / Lupap / Mapbox) — interfaz GeocodeProvider.
 *  3. MockGeocoder determinístico para desarrollo y pruebas.
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  source: "ADDRESS_PIN" | "MOCK" | "GOOGLE" | "LUPAP";
}

export interface GeocodeProvider {
  geocode(address: string, city: string): Promise<GeocodeResult | null>;
}

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
    };
  }
}

const fallbackProvider: GeocodeProvider = new MockGeocoder();

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
    return { lat: pin.lat, lng: pin.lng, source: "ADDRESS_PIN" };
  }

  const result = await fallbackProvider.geocode(addressRaw, city);
  if (result) return result;
  throw new Error(`No se pudo geocodificar: ${addressRaw}`);
}

/**
 * Aprende un pin GPS confirmado en entrega exitosa.
 * Cada entrega con POD georreferenciado mejora el grafo de direcciones.
 */
export async function learnAddressPin(
  tenantId: string,
  addressRaw: string,
  lat: number,
  lng: number,
  referenceNotes?: string,
) {
  const addressKey = normalizeAddress(addressRaw);
  await prisma.addressPin.upsert({
    where: { tenantId_addressKey: { tenantId, addressKey } },
    create: {
      tenantId,
      addressKey,
      lat,
      lng,
      referenceNotes,
      source: "DELIVERY_CONFIRMED",
      useCount: 1,
    },
    update: { lat, lng, referenceNotes, useCount: { increment: 1 } },
  });
}
