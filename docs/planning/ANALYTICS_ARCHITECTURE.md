# Arquitectura de analítica — registro de decisión

**Decisión (Ahora):** rollups diarios en la misma Postgres
(`DailyTenantMetric`) con **recomputación perezosa, determinista e
idempotente** al momento de la lectura. Sin warehouse, sin colas, sin Kafka.

## Estado anterior

Toda métrica se agregaba al vuelo en el handler (Prisma `groupBy`/`aggregate`
en `/analytics/summary`, raw SQL de 14 días en `/platform/metrics`,
`greenReport.ts` recorre las rutas del mes). Correcto a volumen de piloto,
pero: sin series históricas, costo creciente por request, y cada superficie
reinventaba la agregación.

## Diseño

### Tabla `DailyTenantMetric` (fuente: Order/Route/RouteStop)

Una fila por `(tenantId, date)` con: `ordersCreated`, `ordersDelivered`,
`ordersFailed` (FAILED+REJECTED), `routesPlanned`, `stopsCompleted`,
`totalDistanceKm`, `totalDurationMin`, `activeDrivers`, `co2Kg`,
`co2SavedKg`. Derivados (tasa de éxito, SPR/SPH) se calculan al servir.

### Día de corte: `America/Bogota`

Los timestamps son UTC pero `Route.date` ya es un día local. El rollup agrupa
con `(timestamp AT TIME ZONE 'America/Bogota')::date` — Colombia no tiene
horario de verano, el offset es fijo, el corte es estable. Sin esto, las
entregas de la noche caen en la barra del día siguiente.

### Cómputo: materialización perezosa al leer

`getTimeseries(tenantId, from, to)`:
1. Lee las filas existentes del rango.
2. Recomputa **solo** los días faltantes y los días `>= ayer` (hoy y ayer
   siempre se refrescan; la historia es inmutable una vez cerrado el día).
3. Devuelve serie densa con ceros en los huecos.

`recomputeDailyMetrics(tenantId, from, to)` es una función pura de la base:
un query por fuente (pedidos creados/entregados/fallidos, rutas, paradas,
conductores activos), upsert por `(tenantId, date)`. Llamarla dos veces
produce exactamente las mismas filas — esa idempotencia es la propiedad que
permite backfill, corrección histórica y migrar el disparador sin tocar la
lógica.

**Por qué perezoso y no cron ni on-write:**
- No hay cola de trabajos (pg-boss está en el roadmap, no instalado); un
  `setInterval` en proceso divergiría entre prod y tests.
- Contadores on-write esparcidos por `orders.ts`/`routes.ts` derivan con el
  tiempo y no permiten backfill.
- La recomputación perezosa hace backfill automático en la primera lectura y
  la misma función se mueve detrás de pg-boss sin cambios cuando llegue.

### Consumidores

| Endpoint | Quién | Fuente |
|---|---|---|
| `GET /analytics/timeseries` | tenant (ANALYTICS_PRO) | rollup |
| `GET /platform/metrics/timeseries?tenantId=` | MOVE: salud de UN tenant | rollup |
| `GET /platform/metrics/timeseries` | MOVE: agregado de plataforma | suma de rollups (recompute perezoso de todos los tenants del rango) |
| `GET /analytics/summary` | tenant | al vuelo (estado actual, no histórico) |
| `GET /portal/summary` | cliente B2B | al vuelo (volumen por cliente pequeño; el portal no depende de la infra de rollups) |
| `GET /analytics/green-report` | tenant/portal | al vuelo (`greenReport.ts`, atribución por parada) |

### Catálogo de KPIs (definiciones canónicas)

| KPI | Definición |
|---|---|
| Tasa de entrega exitosa | `DELIVERED / (DELIVERED + FAILED + REJECTED)` (intentos) |
| SPR (paradas por ruta) | paradas totales / rutas planificadas |
| SPH (paradas por hora) | paradas totales / horas de ruta (`totalDurationMin/60`) |
| Distancia | `Route.totalDistanceKm` (haversine ×1.4; OSRM la reemplazará) |
| CO₂ | `co2KgForKm(tipo, eléctrico, km)` por ruta; ahorro vs línea base ICE del mismo recorrido |
| Conductores activos | conductores con ruta ese día |

## Límites conocidos y camino de evolución

1. **El agregado de plataforma recomputa perezosamente todos los tenants del
   rango**: correcto a decenas de tenants. Primer umbral: cuando
   tenants × días del rango haga lenta la primera lectura del día (~100
   tenants), mover el recompute a pg-boss nocturno — misma función,
   disparador distinto.
2. **Export nocturno** (warehouse ligero: archivos/DuckDB) cuando empiece el
   trabajo de ML entre tenants (`AI_ADDONS`: ETAs predictivos, riesgo de
   fallo) — el rollup operacional no es corpus de entrenamiento.
3. **Warehouse real / CQRS** solo con señal de escala multi-región o
   benchmarks anonimizados entre tenants (Después).
4. `DailyClientMetric` (por negocio cliente) solo si el portal necesita
   históricos largos; hoy el al-vuelo basta y un `clientId` nullable rompería
   el upsert por clave única.
