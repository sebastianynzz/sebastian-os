-- Posición denormalizada del vehículo: última lat/lng conocida, escrita por el
-- path de ingesta telemática junto a lastSpeedKmh/lastSeenAt. Alimenta el mapa
-- de flota agrupado del panel de plataforma sin recorrer TelemetryPing.
-- Aditiva y anulable: los vehículos sin ping aún quedan en NULL (sin posición).
ALTER TABLE "Vehicle" ADD COLUMN "lastLat" DOUBLE PRECISION;
ALTER TABLE "Vehicle" ADD COLUMN "lastLng" DOUBLE PRECISION;
