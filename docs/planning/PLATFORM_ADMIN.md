# Superficie: Panel de control de MOVE (`apps/admin`)

## 1. Resumen y estado actual

Panel del **operador de plataforma** (la organización MOVE), en un plano de
autenticación separado (`PlatformAdmin`, JWT `typ: "platform"`, guardas de
fuga entre planos probadas en `platform.test.ts`).

Construido: lista y detalle de tenants con conteos de uso, aprovisionamiento
FaaS (tenant SUB_OPERATOR + admin), suspender/reactivar (inmediato), plan
comercial, overrides de módulos, asignación de vehículos de MOVE
(`ownerTenantId`), Flota en sitio, Métricas de plataforma, y — de este
incremento — **edición completa del tenant** (nombre, NIT, ciudad, tipo de
operador, modelo de negocio), **gestión de usuarios del equipo del tenant**
(crear, rol, reset de contraseña, eliminar), **bitácora de auditoría**
(`PlatformAuditLog` + página Auditoría) y **series de tiempo** por tenant y
de toda la plataforma.

Principio: **todo lo que MOVE configura de un tenant debe ser editable desde
este panel** — sin tocar la base de datos. Y todo cambio queda auditado.

## 2. Personas y departamentos (organización MOVE)

| Departamento | Trabajos por hacer | Cubierto | Brechas |
|---|---|---|---|
| Ops de plataforma | aprovisionar, suspender, asignar flota, soporte | Tenants, TenantDetail, Flota en sitio | impersonación auditada ("entrar como tenant") |
| Customer Success | salud y adopción por tenant | tendencia 30 días por tenant, adopción de módulos | score de activación/salud, alertas de inactividad |
| Comercial | empaquetado y oferta | plan + businessModel + presets de módulos | cotizador de tarifas (solo reporte), quotas por plan |
| Finanzas | uso por tenant para facturar fuera del producto | conteos + series de pedidos/rutas | reporte de uso exportable por período (sin pagos: fuera de alcance) |
| Producto / Ingeniería | qué se usa, qué falla | Métricas, Auditoría | feature flags desacoplados de módulos comerciales |

## 3. Casos de uso (priorizados)

| Caso | Flujo actual | Brecha | Prioridad |
|---|---|---|---|
| Editar datos del tenant (nombre/NIT/ciudad/modelo) | formulario en TenantDetail | — (construido) | P0 ✓ |
| Crear/resetear usuarios del equipo de un tenant | tarjeta Usuarios en TenantDetail | — (construido) | P0 ✓ |
| Auditar quién cambió qué | página Auditoría + log por tenant | — (construido) | P0 ✓ |
| Ver salud operativa de un tenant | tendencia 30 días en TenantDetail | score sintético + comparativa entre tenants | P1 |
| Entrar como tenant para soporte | no existe | impersonación con sesión marcada y auditada | P1 |
| Quotas por plan (pedidos/asientos) | plan = etiqueta | enforcement suave + aviso de upgrade (solo reporte) | P1 |
| Aprobar registros self-serve | registro abierto | cola de aprobación | P2 |
| Gestión de resellers/partners | no existe | canal telemático | P2 (Después) |

## 4. Crítica de diseño (UI/UX)

- **`TenantDetail` mezclaba lectura y escritura sin jerarquía**: conteos
  read-only junto a un input crudo de `ownerTenantId`. Mitigado con tarjetas
  por intención (Empresa editable / Uso / Plan / Módulos / Usuarios /
  Vehículos / Actividad); el selector de dueño por nombre sigue pendiente.
- **`confirm()` nativo** para suspender/eliminar: suficiente hoy; migrar a un
  diálogo propio con texto de consecuencias (Próximo).
- **Métricas era una página estática**: ahora con tendencia; falta drill-down
  (clic en un día → pedidos de ese día).
- **Sin paginación en Tenants**: aceptable a decenas de tenants; paginar
  antes de centenas.

## 5. Sistema de diseño

- **Tema oscuro** (navy de fondo, texto `niebla`/`cielo`, acento lima):
  distinción deliberada frente al dashboard claro del tenant — el operador
  nunca confunde en qué plano está.
- Componentes propios (`src/components/ui.tsx`): `Card`, `StatusBadge`,
  `PlanBadge`, `Toggle`, `Button`, `inputClass` (variante oscura).
- `charts.tsx` (nuevo): mismo `TrendChart` SVG que `apps/web`, paleta
  adaptada al tema oscuro.

## 6. Diseño de sistema

- **Plano separado**: `/platform/*` exige `requirePlatformAdmin`; un token de
  plataforma no puede leer rutas de tenant y viceversa (probado).
- **Modelos**: `Tenant` (+ `businessModel`), `ModuleEntitlement`,
  `PlatformAuditLog` (acción, admin, tenant/usuario objetivo, `details` JSON
  con diff antes/después), `DailyTenantMetric` (ver
  `ANALYTICS_ARCHITECTURE.md`).
- **Endpoints**: `/platform/tenants` (CRUD + módulos + vehículos + usuarios
  del tenant), `/platform/metrics` y `/platform/metrics/timeseries`
  (por tenant o agregado), `/platform/audit` (paginado por cursor).
- **Auditoría**: toda mutación del plano de plataforma llama
  `auditPlatform()` (`services/platformAudit.ts`). **Checklist para PRs:
  endpoint nuevo de plataforma que mute estado ⇒ registra auditoría.**
  Endurecimiento futuro: hook `onSend` que lo garantice estructuralmente.
- **Decisiones documentadas**: (1) el reset de contraseña no revoca JWTs ya
  emitidos (viven ≤12 h) — misma clase de riesgo aceptado que la caché de
  suspensión; el fix futuro es un claim de versión de token. (2) No se puede
  eliminar/degradar al último ADMIN de un tenant. (3) Usuarios DRIVER se
  gestionan vía Conductores (vinculados a `driverId`), no desde este panel.
- **Sin pagos**: plan y businessModel son etiquetas + presets; el producto
  reporta uso, nunca cobra.

## 7. Estrategia de pruebas

- **Hoy**: `platform.test.ts` (planos, suspensión, FaaS, flota cruzada) +
  `platformAdmin.test.ts` (edición de tenant, presets por modelo de negocio,
  CRUD de usuarios con guarda de último ADMIN, reset de contraseña efectivo,
  auditoría escrita y filtrable, guarda de fuga en `/users`).
- **Ahora**: mantener la matriz rol×plano en cada endpoint nuevo.
- **Próximo**: fuzzing de acceso cruzado entre tenants; property tests del
  recompute de métricas; golden files del informe de uso.

## 8. Roadmap de la superficie

| Fase | Ítems |
|---|---|
| **Ahora** | ✓ edición de tenant; ✓ usuarios del equipo; ✓ PlatformAuditLog + Auditoría; ✓ businessModel + presets; ✓ series por tenant y plataforma |
| **Próximo** | impersonación auditada; quotas por plan (solo reporte) + prompts de upgrade; score de salud/activación; selector de dueño de vehículo; aprobación de registros; feature flags |
| **Después** | gestión de resellers/partners; residencia de datos por tenant; detección de anomalías de uso; automatización de evidencias de cumplimiento |
