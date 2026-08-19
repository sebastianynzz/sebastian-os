-- Retención de telemetría (Etapa 0 de escalabilidad).
--
-- TelemetryPing crecía sin límite: ~500 B por fila con índices y un ping cada
-- 30 s por conductor activo son ~175 MB por conductor y por año, para siempre.
-- Esta migración habilita (a) podar los pings crudos a los 90 días y (b)
-- conservar la historia de cada ruta completada como una traza submuestreada.
--
-- Aditiva: solo columnas anulables e índices nuevos. Sin CONCURRENTLY porque
-- Prisma envuelve la migración en una transacción, y sin FK sobre routeId.
-- El CMD del contenedor encadena `db:migrate:deploy && start`, así que un
-- fallo aquí impide arrancar la API: mantener esto estrictamente aditivo.

-- Odómetro denormalizado: el mapa en vivo lo lee del vehículo para dejar de
-- recorrer TelemetryPing (que ahora se poda).
ALTER TABLE "Vehicle" ADD COLUMN "lastOdometerKm" DOUBLE PRECISION;

-- Traza de la ruta: la historia que sobrevive a la poda.
ALTER TABLE "Route" ADD COLUMN "trackJson" JSONB;
ALTER TABLE "Route" ADD COLUMN "trackBuiltAt" TIMESTAMP(3);

-- Barrido de poda por antigüedad, siempre acotado por tenant.
CREATE INDEX "TelemetryPing_tenantId_recordedAt_idx" ON "TelemetryPing"("tenantId", "recordedAt");
-- Construcción de la traza de una ruta. routeId es String suelto (sin FK):
-- los pings NO se borran en cascada con la ruta, por eso hace falta el índice.
CREATE INDEX "TelemetryPing_routeId_idx" ON "TelemetryPing"("routeId");

-- Relleno desde el último ping conocido de cada vehículo.
--
-- Necesario porque la migración 20260617010000 añadió lastLat/lastLng SIN
-- relleno: un vehículo cuyo último ping sea anterior a esa fecha tiene pings
-- pero lastLat en NULL, y al servir el mapa en vivo desde las columnas
-- denormalizadas desaparecería del mapa en silencio.
--
-- La posición solo se rellena si falta (COALESCE) para no pisar nunca un dato
-- más reciente escrito por la ingesta; el odómetro es columna nueva, así que
-- se rellena siempre.
UPDATE "Vehicle" v
SET "lastOdometerKm" = p."odometerKm",
    "lastLat"        = COALESCE(v."lastLat", p."lat"),
    "lastLng"        = COALESCE(v."lastLng", p."lng"),
    "lastSeenAt"     = COALESCE(v."lastSeenAt", p."recordedAt")
FROM (
    SELECT DISTINCT ON ("vehicleId")
           "vehicleId", "lat", "lng", "recordedAt", "odometerKm"
    FROM "TelemetryPing"
    WHERE "vehicleId" IS NOT NULL
    ORDER BY "vehicleId", "recordedAt" DESC
) p
WHERE v."id" = p."vehicleId";
