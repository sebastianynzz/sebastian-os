import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/**
 * Retención de telemetría y traza de rutas (Etapa 0 de escalabilidad).
 *
 * TelemetryPing crecía sin límite: ~500 B por fila con índices y un ping cada
 * 30 s por conductor activo son ~175 MB por conductor y por año. Aquí se poda
 * a `RETENTION_DAYS`, pero ANTES de borrar se submuestrea cada ruta completada
 * a una traza (`Route.trackJson`) para que la historia sobreviva.
 *
 * Igual que `dailyMetrics.ts`, todo es determinista e idempotente y `now` se
 * recibe por parámetro (nunca se lee el reloj por dentro): así sirve para el
 * job nocturno, para un backfill manual y para pruebas.
 *
 * ATENCIÓN: esto solo toca TelemetryPing. NUNCA podar AddressPin ni
 * AddressCorrection — el grafo de direcciones aprendido es el foso del
 * producto (restricción dura 4) y no caduca.
 */

/** Ventana de pings crudos. La traza por ruta se conserva indefinidamente. */
export const RETENTION_DAYS = 90;

/** Tope de puntos por traza: mantiene trackJson por debajo del TOAST (~2 KB). */
export const MAX_TRACK_POINTS = 300;

/** Punto de la traza. Sin campos ICE: MoveOS es EV-only (restricción dura 1.2). */
export interface TrackPoint {
  lat: number;
  lng: number;
  /** Instante ISO-8601 del ping. */
  t: string;
  /** Estado de carga (%) si el ping lo reportó. */
  soc: number | null;
}

interface PingLike {
  lat: number;
  lng: number;
  recordedAt: Date;
  batterySoc: number | null;
}

/**
 * Submuestrea los pings de una ruta a lo sumo a `maxPoints`, conservando
 * SIEMPRE el primero y el último (los extremos definen el recorrido).
 * Espera los pings ya ordenados por `recordedAt` ascendente.
 */
export function downsampleTrack(
  pings: PingLike[],
  maxPoints: number = MAX_TRACK_POINTS,
): TrackPoint[] {
  const toPoint = (p: PingLike): TrackPoint => ({
    lat: p.lat,
    lng: p.lng,
    t: p.recordedAt.toISOString(),
    soc: p.batterySoc ?? null,
  });

  if (pings.length === 0) return [];
  if (pings.length <= maxPoints) return pings.map(toPoint);

  // Muestreo uniforme de los puntos intermedios; los extremos van aparte.
  const out: TrackPoint[] = [toPoint(pings[0]!)];
  const inner = maxPoints - 2;
  const last = pings.length - 1;
  for (let i = 1; i <= inner; i++) {
    const idx = Math.round((i * last) / (inner + 1));
    // El redondeo puede repetir índice: no duplicar puntos.
    if (idx > 0 && idx < last && out.length < maxPoints - 1) {
      out.push(toPoint(pings[idx]!));
    }
  }
  out.push(toPoint(pings[last]!));
  return out;
}

/** Instante a partir del cual los pings se consideran caducados. */
export function retentionCutoff(now: Date, days: number = RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export interface PruneOptions {
  now?: Date;
  retentionDays?: number;
  /** Rutas a las que construirles traza por ejecución. */
  maxRoutes?: number;
  /** Filas borradas por lote (evita locks largos y WAL enorme en Supabase). */
  batchSize?: number;
  /** Tope de lotes por tenant y ejecución. */
  maxBatches?: number;
  /** Calcula y reporta sin borrar ni escribir nada. */
  dryRun?: boolean;
}

export interface PruneResult {
  tenantId: string;
  tracksBuilt: number;
  pingsDeleted: number;
}

/**
 * Construye la traza de una ruta completada a partir de sus pings.
 * Idempotente: marca `trackBuiltAt` y no reprocesa rutas ya marcadas.
 */
export async function buildRouteTrack(
  tenantId: string,
  routeId: string,
  now: Date,
): Promise<boolean> {
  const pings = await prisma.telemetryPing.findMany({
    where: { tenantId, routeId },
    orderBy: { recordedAt: "asc" },
    select: { lat: true, lng: true, recordedAt: true, batterySoc: true },
  });

  const track = downsampleTrack(pings);
  await prisma.route.update({
    where: { id: routeId },
    // Una ruta sin pings queda con traza vacía y marcada: no se reintenta en
    // cada ejecución del job. El cast es el puente a la columna JSONB: Prisma
    // no acepta un array tipado como InputJsonValue sin firma de índice.
    data: {
      trackJson: track as unknown as Prisma.InputJsonValue,
      trackBuiltAt: now,
    },
  });
  return track.length > 0;
}

/**
 * Poda los pings caducados. Construye trazas PRIMERO y borra DESPUÉS, de modo
 * que ninguna ruta completada pierda su historia.
 */
export async function pruneTelemetry(
  opts: PruneOptions = {},
): Promise<PruneResult[]> {
  const now = opts.now ?? new Date();
  const cutoff = retentionCutoff(now, opts.retentionDays ?? RETENTION_DAYS);
  const maxRoutes = opts.maxRoutes ?? 200;
  const batchSize = opts.batchSize ?? 5_000;
  const maxBatches = opts.maxBatches ?? 50;
  const dryRun = opts.dryRun ?? false;

  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const results: PruneResult[] = [];

  for (const { id: tenantId } of tenants) {
    // (a) Trazas pendientes. Toda consulta lleva tenantId (restricción dura 3).
    const pending = await prisma.route.findMany({
      where: { tenantId, status: "COMPLETED", trackBuiltAt: null },
      select: { id: true },
      take: maxRoutes,
    });

    let tracksBuilt = 0;
    if (!dryRun) {
      for (const route of pending) {
        await buildRouteTrack(tenantId, route.id, now);
        tracksBuilt++;
      }
    } else {
      tracksBuilt = pending.length;
    }

    // (b) Poda por lotes acotados.
    let pingsDeleted = 0;
    if (dryRun) {
      pingsDeleted = await prisma.telemetryPing.count({
        where: { tenantId, recordedAt: { lt: cutoff } },
      });
    } else {
      for (let batch = 0; batch < maxBatches; batch++) {
        const doomed = await prisma.telemetryPing.findMany({
          where: { tenantId, recordedAt: { lt: cutoff } },
          select: { id: true },
          take: batchSize,
        });
        if (doomed.length === 0) break;
        const { count } = await prisma.telemetryPing.deleteMany({
          where: { tenantId, id: { in: doomed.map((p) => p.id) } },
        });
        pingsDeleted += count;
        if (doomed.length < batchSize) break;
      }
    }

    if (tracksBuilt > 0 || pingsDeleted > 0) {
      results.push({ tenantId, tracksBuilt, pingsDeleted });
    }
  }

  return results;
}
