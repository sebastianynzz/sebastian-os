import {
  haversineTravelModel,
  matrixTravelModel,
  type TravelModel,
} from "@moveos/optimizer";
import type { LatLng } from "@moveos/shared";

/**
 * Modelo de viaje para el optimizador.
 *
 * Si OSRM_URL está configurado (OSRM autoalojado con el extracto OSM de
 * Colombia), se precalcula UNA matriz /table con distancias y tiempos por red
 * vial real para los puntos del plan. Si no, o si OSRM falla/expira, se cae
 * al modelo haversine — el plan nunca se bloquea por el proveedor de mapas.
 */

const OSRM_TIMEOUT_MS = 8000;
/** /table crece O(n²): por encima de este número de puntos, usar haversine. */
const MAX_MATRIX_POINTS = 120;

export interface BuiltTravelModel {
  model: TravelModel;
  source: "osrm" | "haversine";
}

export async function buildTravelModel(points: LatLng[]): Promise<BuiltTravelModel> {
  const osrmUrl = process.env.OSRM_URL;
  if (!osrmUrl || points.length === 0 || points.length > MAX_MATRIX_POINTS) {
    return { model: haversineTravelModel(), source: "haversine" };
  }

  try {
    // OSRM espera lng,lat separados por ';'.
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
    const url = `${osrmUrl.replace(/\/$/, "")}/table/v1/driving/${coords}?annotations=duration,distance`;
    const res = await fetch(url, { signal: AbortSignal.timeout(OSRM_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = (await res.json()) as {
      code: string;
      distances?: number[][]; // metros
      durations?: number[][]; // segundos
    };
    if (data.code !== "Ok" || !data.distances || !data.durations) {
      throw new Error(`OSRM respuesta inválida: ${data.code}`);
    }

    const distancesKm = data.distances.map((row) => row.map((m) => m / 1000));
    const durationsMin = data.durations.map((row) => row.map((s) => s / 60));
    return {
      model: matrixTravelModel(points, distancesKm, durationsMin),
      source: "osrm",
    };
  } catch (err) {
    console.warn(
      `OSRM no disponible (${err instanceof Error ? err.message : err}): usando haversine`,
    );
    return { model: haversineTravelModel(), source: "haversine" };
  }
}

/**
 * Minutos desde medianoche en hora de Colombia (America/Bogota, UTC-5 fijo,
 * sin horario de verano). Corrige el bug latente de usar getUTCHours: las
 * ventanas horarias y el pico y placa son hora local.
 */
export function toMinOfDayBogota(d: Date): number {
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (utcMin - 5 * 60 + 24 * 60) % (24 * 60);
}
