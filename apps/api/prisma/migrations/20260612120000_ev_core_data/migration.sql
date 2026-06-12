-- EV como núcleo: datos (roadmap P0.4b + restricción dura 1.3).
-- Aditiva/idempotente: backfill de entitlements + directorio público de carga.

-- 1) Backfill: EV_MANAGEMENT pasó a ser núcleo (siempre activo). Los tenants
--    existentes conservaban filas enabled=false que el runtime ya ignora,
--    pero que mentían en métricas de adopción y cualquier consulta directa.
UPDATE "ModuleEntitlement"
SET "enabled" = true
WHERE "moduleKey" = 'EV_MANAGEMENT' AND "enabled" = false;

-- 2) Directorio público de carga (tenantId NULL = compartido entre tenants).
--    La migración es la fuente de estos datos en producción: el deploy corre
--    solo `migrate deploy` (nunca el seed demo). IDs fijos → re-ejecutable.
INSERT INTO "ChargingStation"
  ("id", "tenantId", "name", "network", "address", "city", "lat", "lng", "connectors", "powerKw", "dcFast", "status")
VALUES
  ('chst_pub_terpel_calle100',  NULL, 'Terpel Voltex — Calle 100',       'Terpel Voltex', 'Ac 100 # 19-61',          'Bogotá',   4.6864, -74.0521, ARRAY['CCS','TYPE_2'],   50,  true,  'ACTIVE'),
  ('chst_pub_terpel_boyaca',    NULL, 'Terpel Voltex — Av. Boyacá',      'Terpel Voltex', 'Av. Boyacá # 12B-12',     'Bogotá',   4.6612, -74.1149, ARRAY['CCS','CHADEMO'],  50,  true,  'ACTIVE'),
  ('chst_pub_terpel_autonorte', NULL, 'Terpel Voltex — Autopista Norte', 'Terpel Voltex', 'Autopista Norte # 193-30','Bogotá',   4.7649, -74.0463, ARRAY['CCS'],            100, true,  'ACTIVE'),
  ('chst_pub_enelx_parque93',   NULL, 'Enel X — Parque de la 93',        'Enel X',        'Cl 93A # 13-45',          'Bogotá',   4.6766, -74.0488, ARRAY['TYPE_2'],         22,  false, 'ACTIVE'),
  ('chst_pub_enelx_centromayor',NULL, 'Enel X — Centro Mayor',           'Enel X',        'Cl 38A Sur # 34D-51',     'Bogotá',   4.5781, -74.1206, ARRAY['TYPE_2','CCS'],   50,  true,  'ACTIVE'),
  ('chst_pub_celsia_montevideo',NULL, 'Celsia — Zona Industrial Montevideo','Celsia',     'Cra 68D # 17-11',         'Bogotá',   4.6253, -74.1247, ARRAY['CCS'],            50,  true,  'ACTIVE'),
  ('chst_pub_epm_inteligente',  NULL, 'EPM — Edificio Inteligente',      'EPM',           'Cra 58 # 42-125',         'Medellín', 6.2447, -75.5748, ARRAY['TYPE_2'],         22,  false, 'ACTIVE'),
  ('chst_pub_epm_premiumplaza', NULL, 'EPM — Premium Plaza',             'EPM',           'Cra 43A # 30-25',         'Medellín', 6.2381, -75.5660, ARRAY['CCS','TYPE_2'],   50,  true,  'ACTIVE'),
  ('chst_pub_celsia_poblado',   NULL, 'Celsia — El Poblado',             'Celsia',        'Cra 43A # 1A Sur-69',     'Medellín', 6.2087, -75.5658, ARRAY['TYPE_2'],         22,  false, 'ACTIVE')
ON CONFLICT ("id") DO NOTHING;
