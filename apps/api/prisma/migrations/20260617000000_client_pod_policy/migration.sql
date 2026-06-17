-- Política POD configurable por cliente: pruebas que el comercio exige para
-- aceptar una entrega (PHOTO | RECEIVER_NAME). Aditiva y con default vacío, así
-- que los clientes existentes conservan el comportamiento actual (sin exigencia).
ALTER TABLE "Client" ADD COLUMN "podRequired" TEXT[] NOT NULL DEFAULT '{}';
