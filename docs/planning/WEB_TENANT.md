# Superficie: Dashboard del tenant + Portal de clientes (`apps/web`)

## 1. Resumen y estado actual

Una sola SPA (React + Vite + Tailwind, español primero) con dos planos según
el rol del JWT: el **equipo del tenant** (ADMIN/DISPATCHER) ve la operación
completa; el **negocio cliente** (CLIENT) ve solo su plano `/portal/*`.

Construido y verificado en código: Pedidos (guía MV-, bitácora, import CSV),
Planificación 4 pasos (pico y placa + autonomía EV + capacidad + ventanas),
Rutas y despacho, Mapa en vivo (SSE), Conductores, Vehículos (alertas
SOAT/tecno), Flota eléctrica, Seguridad, Analítica (KPIs + series diarias),
Sostenibilidad (informe verde), Módulos (toggles), portal de clientes
(resumen, envíos, nuevo envío, informe verde).

## 2. Personas y departamentos

| Departamento | Trabajos por hacer | Pantallas que lo cubren | Brechas |
|---|---|---|---|
| Operaciones / Despacho | planear el día, despachar, monitorear, resolver fallos | Planificación, Rutas, Mapa en vivo, Pedidos | tablero de excepciones (fallidos para re-gestión), edición manual de rutas |
| Flota / Mantenimiento | vencimientos, SoC, salud del activo | Vehículos, Ev, Mapa en vivo | mantenimiento preventivo desde CAN, historial por vehículo |
| Servicio al cliente | responder "¿dónde está mi pedido?" | Pedidos + bitácora, rastreo público | reagendar/cancelar desde el dashboard, chat con conductor |
| Finanzas / Administración | costo y productividad, tendencias | Analítica (KPIs + tendencias) | export CSV/PDF, costo por parada con tarifas propias |
| Comercial | argumento ESG, servicio por cliente | Clientes, Sostenibilidad (por cliente) | SLA por cliente, scorecards |
| Seguridad | piratería terrestre, pánico | Seguridad | corredores geocercados, integración con centrales |
| Cliente B2B (portal) | crear envíos, **entender su operación** | Resumen (KPIs + tendencia 30 días), Mis envíos, Nuevo envío, Informe verde | editar/cancelar envíos, libreta de direcciones |

## 3. Casos de uso (priorizados)

| Caso | Persona | Flujo actual | Brecha | Prioridad |
|---|---|---|---|---|
| Ver tendencia operativa (pedidos/distancia/CO₂ por día) | Finanzas, Ops | Analítica con series 7/30/90 días | — (construido en este incremento) | P0 ✓ |
| Portal: entender la operación de un vistazo | Cliente B2B | `/portal/resumen` con KPIs, tasa de éxito y tendencia | — (construido en este incremento) | P0 ✓ |
| Re-gestionar entregas fallidas | Ops, Servicio | filtrar Pedidos por estado | tablero de triage con acciones (reintentar, devolver) | P0 |
| Editar/cancelar pedido después de creado | Ops, Cliente B2B | no existe | edición con re-geocodificación + evento en bitácora | P0 |
| Gestionar usuarios del equipo | Admin tenant | no hay UI (solo seed/API) | página de usuarios (invitar, rol, reset); existe ya en el plano de plataforma | P1 |
| Editar rutas manualmente (reordenar/reasignar) | Despacho | re-optimizar todo | drag & drop de paradas entre rutas | P1 |
| Export CSV de pedidos y analítica | Finanzas | no existe | botón export en Pedidos y Analítica | P1 |
| Zonas de servicio y multi-depósito | Ops | depósito único por plan | modelo de zonas + depots | P2 |
| Marca propia en rastreo y WhatsApp | Comercial | plantilla MoveOS | branding por tenant (CUSTOMER_EXPERIENCE_PRO) | P2 |

## 4. Crítica de diseño (UI/UX)

- **Sin gráficas hasta este incremento**: Analítica era solo tarjetas; una
  tendencia temporal es la primera pregunta de cualquier gerente. Resuelto con
  `TrendChart` (SVG propio, sin dependencias).
- **El portal aterrizaba en una lista** (`/portal/envios`): el cliente B2B
  no tenía visión de conjunto. Resuelto: `/portal/resumen` es el nuevo home.
- **`ui.tsx` duplicado en 3 apps**: misma `Card`/`Button`/`StatusBadge`
  copiada; extraer `@moveos/ui` sigue en el roadmap (Próximo). Hasta
  entonces, la convención es duplicar consciente y mantener paridad.
- **Sin gestión de usuarios del equipo**: un ADMIN no puede invitar a su
  despachador desde la UI (P1 arriba).
- **Navegación crece linealmente**: con 12+ entradas la barra lateral
  necesitará agrupación por dominio (Operación / Flota / Análisis) — Próximo.
- **Faltan estados de error consistentes**: varias páginas solo muestran
  `Loading`; estandarizar `Banner` de error + reintento.

## 5. Sistema de diseño

- **Tokens Move**: navy 534C (fondo de marca), cielo 537C (texto secundario
  sobre navy), lima 373C (acento/acciones). Tailwind v4 con clases
  `bg-navy`, `text-cielo`, `bg-lima`, `border-niebla`.
- **Tema claro** en el dashboard del tenant (cards blancas sobre `niebla`);
  el panel de plataforma usa tema oscuro — distinción intencional de plano.
- **Componentes existentes** (`src/components/ui.tsx`): `Card`, `PageHeader`,
  `StatusBadge` (estados es-CO), `Banner`, `Loading`, `EmptyState`,
  `ModuleDisabled`, `Button`, `Field`, `inputClass`, `theadRowClass`.
- **Gráficas (nuevo)** (`src/components/charts.tsx`): `TrendChart` — SVG de
  línea/área hasta 2 series, sin librerías; ejes mínimos, tooltip por `title`.
  Convención: serie principal en lima, comparativa en cielo. Reutilizado con
  tema oscuro en el panel de plataforma.
- **Próximo**: paquete `@moveos/ui` + tokens compartidos; Storybook; pase de
  accesibilidad (focus visible ya existe; faltan landmarks y contraste AA en
  cielo/blanco).

## 6. Diseño de sistema

- **Datos**: todas las vistas consumen la API Fastify multi-tenant; el portal
  usa `authenticateClient` (scoping `tenantId + clientId`); el equipo usa
  `authenticate` + gating `requireModule` (la nav esconde módulos apagados).
- **Analítica**: `GET /analytics/summary` (agregación al vuelo) +
  `GET /analytics/timeseries` (rollup `DailyTenantMetric`, ver
  `ANALYTICS_ARCHITECTURE.md`). Portal: `GET /portal/summary` (al vuelo, con
  `byDay`; volumen por cliente es pequeño, no necesita rollup).
- **Tiempo real**: SSE `/realtime/stream` (pedidos, mapa, alertas); el portal
  recarga al evento `order`.
- **Límite del plano**: el rol CLIENT está bloqueado por el preHandler
  `authenticate` de las rutas operativas; probado en `portal.test.ts`.

## 7. Estrategia de pruebas

- **Hoy**: la lógica de esta superficie se prueba vía e2e de API
  (`api.test.ts`, `portal.test.ts`, `green.test.ts`, `analytics.test.ts`);
  cero pruebas de frontend.
- **Ahora**: mantener la regla "cada endpoint nuevo de esta superficie llega
  con su e2e" (timeseries y portal summary la cumplen).
- **Próximo**: Playwright smoke por app (login → pedido → planificar →
  despachar; portal: login → resumen → nuevo envío); pruebas de componentes
  para `charts.tsx` cuando se extraiga `@moveos/ui`.
- **Después**: monitoreo sintético del viaje pedido→entrega.

## 8. Roadmap de la superficie

| Fase | Ítems |
|---|---|
| **Ahora** | ✓ tendencias en Analítica; ✓ portal `/portal/resumen`; tablero de excepciones; edición/cancelación de pedidos; gestión de usuarios del equipo (UI tenant); export CSV |
| **Próximo** | edición manual de rutas; zonas/multi-depósito; SLA por cliente + alertas; scorecards de conductores; branding por tenant; libreta de direcciones del portal (reusa AddressPin); agrupación de navegación |
| **Después** | marketplace/broker; reserva de franjas por el consumidor; torre de control multi-ciudad; portales white-label |
