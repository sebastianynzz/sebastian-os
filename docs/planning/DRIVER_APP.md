# Superficie: App de conductor (`apps/driver`)

## 1. Resumen y estado actual

PWA mobile-first (React) para el conductor: login, ruta del día, iniciar
ruta, llegar/completar paradas con POD foto geo-estampada (compresión en el
dispositivo), razones de fallo tipificadas, recogidas (pickup→delivery),
botón SOS, pings de telemetría cada 30 s (GPS + SoC) y **cola offline**: toda
mutación pasa por `apiOrQueue` — los fallos de red se encolan en localStorage
y se reenvían al volver la señal (los errores 4xx se muestran, no se encolan).

## 2. Personas y departamentos

| Persona | Trabajos por hacer | Cubierto | Brechas |
|---|---|---|---|
| Conductor empleado | ruta clara, evidencia, turnos, seguridad | ruta, POD, SOS, offline | check-in/out de turno, inspección preoperacional (requisito de flota colombiano), chat con despacho |
| Conductor gig | onboarding rápido, asignación justa | login + ruta | KYC/onboarding, scorecards, ratings |
| Flota / Mantenimiento (indirecto) | datos del vehículo en campo | pings GPS + SoC | lectura OBD/BLE (CAN por teléfono), reporte de daños con foto |
| Seguridad (indirecto) | pánico, desviaciones | SOS, deviation alerts (server) | corredores seguros visibles en la app, paradas confiables |

## 3. Casos de uso (priorizados)

| Caso | Flujo actual | Brecha | Prioridad |
|---|---|---|---|
| Entregar sin señal (zonas muertas) | cola offline localStorage | migrar a IndexedDB + claves de idempotencia | P0 |
| Navegar a la parada | coordenadas en pantalla | deep links a Google Maps/Waze | P0 |
| Instalar como app | PWA básica | manifest completo + onboarding de instalación | P1 |
| Escanear paquete en la entrega | no existe | escáner código de barras/QR | P1 |
| Turnos e inspección preoperacional | no existe | check-in/out + checklist (cumplimiento) | P1 (Próximo) |
| Documentos del conductor | no existe | wallet licencia/SOAT/tecno con alertas | P2 |
| Telemetría con batería baja | ping fijo 30 s | cadencia adaptativa según batería | P2 |

## 4. Crítica de diseño (UI/UX)

- **Una sola pantalla larga** (`App.tsx` monolítico): funciona para el MVP,
  pero los flujos de fallo/POD crecen; separar vistas por estado de la parada.
- **El estado offline es invisible**: el conductor no ve cuántas acciones
  están encoladas ni si se sincronizaron; añadir indicador de cola pendiente.
- **POD es el momento crítico**: foto + geocerca ya validan; falta feedback
  explícito cuando la geocerca falla (hoy se guarda `geofenceOk=false` sin
  avisar al conductor).
- **Sin modo guante/sol**: botones de acción principales deben crecer
  (mínimo 48 px) y subir contraste para uso en moto.

## 5. Sistema de diseño

- Mismos tokens Move (navy/cielo/lima) con jerarquía simplificada: una
  columna, tarjetas grandes, tipografía mayor que el dashboard.
- `ui.tsx` propio duplicado (convención actual); migrará a `@moveos/ui`.
- Patrón de acción única por pantalla: el siguiente paso de la ruta siempre
  es el botón primario lima.

## 6. Diseño de sistema

- **Identidad**: JWT con `driverId`; el conductor solo ve su ruta
  (`requireRole("DRIVER")` + scoping por `driverId`).
- **Offline**: `apiOrQueue` reintenta en evento `online` y cada 20 s. El
  paso a IndexedDB + idempotencia evita duplicados de POD al reintentar
  (las claves viajan como header y el server hace upsert).
- **Telemetría**: `POST /tracking/pings` alimenta `TelemetryPing`, el mapa
  en vivo (SSE) y la heurística de desviación (`services/safety.ts`).
- **POD**: foto comprimida en canvas → upload multipart (8 MB máx., solo
  imagen, clave scoped por tenant) → Supabase Storage/S3 o `/files` en dev.
- **Próximo**: Capacitor Android (GPS en segundo plano, push FCM, cámara,
  BLE OBD) manteniendo el mismo core web.

## 7. Estrategia de pruebas

- **Hoy**: el contrato de la app se prueba vía e2e de API (`api.test.ts`
  flujo completo de entrega, `uploads.test.ts` POD multipart,
  `pickup.test.ts` recogidas, `telematics.test.ts` pings).
- **Ahora**: pruebas unitarias de la cola offline (encolar en TypeError, no
  encolar en 4xx, drenado idempotente) — es la lógica más crítica y la menos
  cubierta.
- **Próximo**: Playwright móvil (viewport pequeño) con red simulada offline;
  device farm para gama baja Android.
- **Después**: pruebas de campo instrumentadas (telemetría de la propia app).

## 8. Roadmap de la superficie

| Fase | Ítems |
|---|---|
| **Ahora** | IndexedDB + idempotencia; deep links de navegación; indicador de cola offline; manifest PWA completo; escáner QR |
| **Próximo** | Capacitor Android (Play Store, GPS background, push, BLE OBD); chat despacho↔conductor; turnos + inspección preoperacional; wallet de documentos; onboarding gig (KYC) |
| **Después** | mapas offline; guía por voz; detección de caída/accidente; scoring de fatiga; iOS |
