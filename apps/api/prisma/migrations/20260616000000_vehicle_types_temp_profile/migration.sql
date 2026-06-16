-- Catálogo de 6 configuraciones EV + perfil de cadena de frío del pedido.
-- Aditiva e idempotente: segura para `migrate deploy` en el arranque.
-- (Constraint dura 1: flota 100% EV; reefer → solo Cold Box compatible.)

-- 1) Order.tempProfile: nueva columna NOT NULL con default 'AMBIENT' (seco).
--    Las filas existentes quedan en AMBIENT (comportamiento previo: sin frío).
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "tempProfile" TEXT NOT NULL DEFAULT 'AMBIENT';

-- 2) Remap de Vehicle.type al catálogo nuevo. Los valores del enum CAMBIAN
--    respecto a cualquier conjunto previo (MOTO/BICICLETA/CARRO/VAN/CAMION).
--    Pre-revenue el volumen de filas es pequeño: este mapeo es conservador
--    (e-moto → Rap Move Light; utilitarios/carga → IONAx). Revisar
--    manualmente cualquier fila que quede marcada para revisión.
UPDATE "Vehicle" SET "type" = 'RAP_MOVE_LIGHT'
  WHERE "type" IN ('MOTO', 'BICICLETA');
UPDATE "Vehicle" SET "type" = 'IONAX'
  WHERE "type" IN ('CARRO', 'VAN', 'CAMION');

-- 3) Red de seguridad: cualquier valor que no sea ya una de las 6
--    configuraciones se normaliza a IONAx (default seguro) para no dejar tipos
--    huérfanos que el optimizador no sabría interpretar.
UPDATE "Vehicle" SET "type" = 'IONAX'
  WHERE "type" NOT IN (
    'RAP_MOVE_LIGHT', 'RAP_MOVE_XL', 'RAP_MOVE_COLD_BOX',
    'IONAX', 'IONAX_COLD_BOX', 'IONAX_PICKUP'
  );
