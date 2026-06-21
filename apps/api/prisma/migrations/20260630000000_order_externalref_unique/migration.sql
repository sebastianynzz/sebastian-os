-- Idempotencia a nivel de BD para la ingesta/import de pedidos (MO-14,
-- auditoría de seguridad): un índice único en (tenantId, externalRef) evita
-- que dos reintentos concurrentes con el mismo externalRef creen pedidos
-- duplicados (la dedupe por código era TOCTOU). Postgres trata los NULL como
-- distintos, así que los pedidos manuales (externalRef NULL) no chocan.
-- Aditiva; segura para `prisma migrate deploy` sobre una BD sin duplicados.
CREATE UNIQUE INDEX "Order_tenantId_externalRef_key" ON "Order"("tenantId", "externalRef");
