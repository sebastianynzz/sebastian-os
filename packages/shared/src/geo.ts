export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

/** Distancia haversine en kilómetros. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Factor de corrección urbano: la distancia real por vías es mayor que la
 * línea recta. 1.4 es un valor típico para malla vial latinoamericana.
 */
export const URBAN_DETOUR_FACTOR = 1.4;

export function roadDistanceKm(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * URBAN_DETOUR_FACTOR;
}
