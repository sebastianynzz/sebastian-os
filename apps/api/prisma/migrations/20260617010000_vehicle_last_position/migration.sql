-- Última posición conocida del vehículo (denormalizada desde TelemetryPing,
-- igual que lastSpeedKmh/lastSeenAt) para el mapa de flota del plano de
-- plataforma. Aditiva y nullable: no afecta datos existentes.
ALTER TABLE "Vehicle" ADD COLUMN "lastLat" DOUBLE PRECISION;
ALTER TABLE "Vehicle" ADD COLUMN "lastLng" DOUBLE PRECISION;
