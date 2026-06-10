# MoveOS — Planificación por superficie de producto

Desglose de las **tres superficies** (dashboard del tenant + portal de
clientes, app de conductor, panel de plataforma) en seis dimensiones cada una:
casos de uso por departamento, crítica de diseño, sistema de diseño, diseño de
sistema, estrategia de pruebas y roadmap.

- **Fases** (convención de `docs/MASTER_ROADMAP.md`): **Ahora** (0–6 meses,
  piloto), **Próximo** (6–18 meses, up-market), **Después** (18 meses+).
- **Alcance**: software de entregas únicamente — sin procesamiento de pagos
  (decisión de producto). Los modelos de negocio (FaaS, 3PL) son etiquetas
  comerciales + presets de módulos; la facturación queda fuera del producto.

| Documento | Superficie | Código |
|---|---|---|
| `WEB_TENANT.md` | Dashboard del tenant + portal de clientes | `apps/web` |
| `DRIVER_APP.md` | App de conductor (PWA) | `apps/driver` |
| `PLATFORM_ADMIN.md` | Panel de control de MOVE | `apps/admin` |
| `ANALYTICS_ARCHITECTURE.md` | Arquitectura de analítica (decisión) | `apps/api` |

## Matriz de departamentos y personas

El SaaS lo usan tres organizaciones distintas; cada departamento tiene una
superficie principal y necesidades propias. Esta matriz gobierna la
priorización de casos de uso en los documentos por superficie.

| Lado | Departamento / persona | Superficie principal | Necesidades clave |
|---|---|---|---|
| Tenant | Operaciones / Despacho | web: Pedidos, Planificación, Rutas, Mapa en vivo | planear, despachar, resolver excepciones en tiempo real |
| Tenant | Flota / Mantenimiento | web: Vehículos, Flota eléctrica, Telemática | SOAT/tecno, SoC y autonomía, salud del activo, inmovilización |
| Tenant | Servicio al cliente | web: Pedidos + bitácora, página pública de rastreo | estado de cada guía, evidencias POD, razones de fallo |
| Tenant | Finanzas / Administración | web: Analítica, informe verde | costo por parada (SPR/SPH), tendencias de volumen, reportes |
| Tenant | Comercial | web: Clientes, informe verde por cliente | argumento ESG por cliente, niveles de servicio |
| Tenant | Seguridad | web: Seguridad (pánico, desviaciones) | alertas, corredores seguros, auditoría de comandos |
| Cliente B2B | Gerencia / Bodega | portal `/portal/*` | crear envíos, **ver su operación completa**, informe verde |
| Consumidor final | — | página pública `/t/:token` | estado en vivo sin login |
| Conductor | Empleado / gig | app conductor | ruta clara, POD, SOS, trabajo sin señal |
| MOVE | Ops de plataforma | admin: Tenants, Flota en sitio | aprovisionar, suspender, asignar flota FaaS |
| MOVE | Customer Success | admin: TenantDetail, métricas por tenant | salud operativa, adopción de módulos, activación |
| MOVE | Comercial | admin: planes, módulos, modelo de negocio | empaquetado FaaS vs 3PL vs SaaS autoservicio |
| MOVE | Finanzas | admin: Métricas, uso por tenant | reporte de uso por tenant (sin pagos: fuera de alcance) |

## Modelos de negocio (FaaS + 3PL)

`Tenant.businessModel` (`SAAS` | `FAAS` | `LOGISTICS_3PL`) describe la oferta
comercial y es **ortogonal** a `operatorType` (mecánica de aprovisionamiento y
propiedad de activos): un contrato 3PL puede ser un tenant `SUB_OPERATOR` con
vehículos de MOVE, o una operación dentro de `PLATFORM_FLEET` donde el cliente
es un negocio del portal.

| Modelo | Qué vende MOVE | Preset de módulos al aprovisionar |
|---|---|---|
| `SAAS` | Software autoservicio | catálogo por defecto (solo ROUTE_OPTIMIZATION) |
| `FAAS` | Flota + software (vehículos de MOVE en sitio) | + TELEMATICS, EV_MANAGEMENT, SAFETY, ANALYTICS_PRO |
| `LOGISTICS_3PL` | Operación logística completa | + ANALYTICS_PRO, CUSTOMER_EXPERIENCE_PRO |

Los presets son **valores iniciales**: cada módulo sigue siendo togglable por
tenant desde el panel de plataforma. Brechas conocidas para profundizar 3PL
(Próximo): tarifarios por vehículo/km/kg (solo reporte, sin cobro), módulo
RNDC (MEC + tiempos logísticos), contabilidad de sub-operadores.
