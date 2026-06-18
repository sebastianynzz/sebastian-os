# MoveOS — Competitive Gap & Adoption Plan (vs. Spoke Dispatch)

What to take from a mature incumbent (Spoke Dispatch) to reach parity on delivery-ops fundamentals WITHOUT losing the MoveOS moat. Each complement is a Claude Code spec section: data model + where it slots into existing modules + how to adapt it to MoveOS constraints (CLAUDE.md: EV-only, B2B-only notifications, tenant isolation, Spanish/Bogotá). AI features ◆, EV ⚡, cold-chain ❄️.

## Strategic frame
Spoke has none of the MoveOS moat — no EV/charging, cold chain, AI optimization/Copilot, address-graph, anti-piratería/immobilization, telematics, CO₂, or multi-tenant FaaS. It IS more mature on operational plumbing. Adopt the plumbing; keep racing on the moat. Do not reintroduce direct-to-consumer messaging (B2B-only) or non-EV concepts (cost/energy stays EV-native).

## TIER 1 — adopt now (table-stakes gaps)

### 1. Optimization strategy selector ◆ (near-free win — do first)
Spoke exposes 5 objectives; you run a single greedy strategy. Maps directly to the `objective` param already in your OptimizationAction registry.

  export const OPTIMIZATION_OBJECTIVES = [
    'ASSIGN_TO_SELECTED',   // add specific drivers first, then optimize
    'EQUALIZE_WORKLOAD',    // ~equal stop count per driver
    'BALANCE',              // ~equal route time per driver (default)
    'MAXIMIZE_EFFICIENCY',  // minimize total time, routes may be uneven
    'FEWEST_DRIVERS',       // system computes min drivers needed
  ] as const;
  export type OptimizationObjective = typeof OPTIMIZATION_OBJECTIVES[number];

- Slots: packages/optimizer/vrp.ts (planRoutes(req, objective) — change construction/assignment policy per objective); Planificacion.tsx (radio picker); OptimizationAction.optimize_routes (context.objective). Info note "applies to newly created routes only."
- Effort: low. Value: high. Ship first.

### 2. Configurable Proof of Delivery per type
Spoke configures Signature/Photo as Mandatory/Optional/Disabled per delivery & pickup type, and the driver app BLOCKS completion when mandatory. Yours is fixed.

  DELIVERY_TYPES = ['RECIPIENT','THIRD_PARTY','PICKUP_POINT','SAFE_PLACE','MAILBOX','OTHER']
  PICKUP_TYPES   = ['FROM_CUSTOMER','UNMANNED','FROM_LOCKER','OTHER']
  POD_REQ        = ['MANDATORY','OPTIONAL','DISABLED']

  model PodPolicy { id; tenantId; scope ('TEAM_DEFAULT' | serviceId); config Json /* { delivery:{RECIPIENT:{signature,photo},...}, pickup:{...} } */ }

- Slots: Controls > Proof of delivery (tabs Delivery / Pickup / COD); driver StopActionSheet reads policy for chosen type and ENFORCES mandatory offline (not bypassable). Keep OTP/geofence as extra options. Wire COD tab to the driver COD-collected capture.

### 3. Services / SLA tiers
Spoke's Service = named delivery promise with price + SLA. You have NONE — foundational B2B and the basis for billing.

  model Service { id; tenantId; name; identifier; pricePerStopCop Decimal; completionDeadlineMin Int; cutoffTime ('15:00' Bogotá); serviceDays String[]; stopType (DELIVERY|PICKUP|BOTH); podMode (TEAM_DEFAULT|CUSTOM); notificationMode; codEnabled Boolean }
  // Order.serviceId references it.

- SLA tracking: compute due time from service; a breach (or predicted breach) raises an SLA_BREACH exception in the Exceptions Cockpit (reuse exception machinery). Per-client SLA report in analytics.
- Slots: Controls > Services; Pedidos (service column/filter); analytics; billing later.

### 4. Multi-depot
Spoke supports many depots with a main badge, depot selector filter, per-depot route defaults. You're effectively single-depot.

  model Depot { id; tenantId; name; address; lat; lng; isMain Boolean; routeDefaults Json }
  // Driver.depotId, Route.depotId, optional Vehicle.homeDepotId

- Slots: Controls > Depots; a depot selector filter in the web header scoping Pedidos/Rutas/Mapa/Analítica; route creation picks a depot; optimizer return-to-depot uses the route's depot. Nearest-depot assignment is a fast-follow.
- ⚡ Needed for FaaS across cities and per-depot charging planning.

### 5. Delivery zones
Spoke draws geographic zones and assigns drivers to them. You lack zones.

  model Zone { id; tenantId; name; color; geometry Json (polygon or H3 cells); driverIds String[] }

- Slots: Controls > Delivery zones (draw on Leaflet — already in use); order create runs serviceability check (point-in-zone); assignment prefers a zone's drivers. Ties to the demand-heatmap AI feature.

### 6. Cost-per-delivery + failure analytics
Spoke charts cost/delivery (cost/hr × cost/km) and categorizes failed attempts. You have CO₂ + success rate but neither.

- ⚡ Cost is energy-native: costPerDelivery = (routeHours × driverCostPerHour + kWh × energyTariffCop) / stops. Reuse reeferEnergyKwh + EV energy already specced; add driverCostPerHour + electricity tariff.
- Failure analysis: you already store standardized fail reasons (CLIENTE_AUSENTE, DIRECCION_ERRADA, RECHAZO_PRODUCTO, ZONA_INSEGURA, OTRO) — aggregate into a chart (by reason, by zone, over time). DIRECCION_ERRADA ties to the address-graph moat narrative.
- Slots: Analitica.tsx + services/dailyMetrics / analytics.

## TIER 2 — adopt next (strong)

### 7. Event-driven notification engine (B2B-adapted)
Spoke has an event catalog → templated SMS/Email per event, scheduling windows, custom sender ID, privacy-tiered recipient tracking. Adapt, don't copy: stay B2B — notify the MERCHANT, and enrich the PUBLIC TRACKING PAGE; never message the end consumer.

  NOTIFICATION_EVENTS = ['STOP_ALLOCATED','OUT_FOR_DELIVERY','NEXT_IN_ROUTE','DEPARTED','ATTEMPTED','DELIVERED','FAILED']
  TRACKING_TIER = ['ETA_ONLY','ETA_POSITION','FULL']  // public page privacy
  model MessageTemplate { id; tenantId; event; channel (WHATSAPP|EMAIL|WEBHOOK|IN_APP — B2B targets only); body ('{{order.guia}}','{{eta}}','{{driver.name}}'); enabled Boolean; scheduleWindow Json }

- Slots: Controls > Tracking & notifications; extend services/notifications (you have dispatchToChannel). Add TRACKING_TIER to the public tracking page (Track.tsx) — ETA only / ETA+queue position / full live driver location once next. Big UX upgrade that respects B2B.

### 8. Developer platform (webhooks + API + connectors)
Spoke has a real event/webhook system, API key management, Shopify/Zapier. You have basic B2B webhooks only.

  model Webhook { id; tenantId; url; secret; apiVersion; events String[]; enabled Boolean }
  model ApiKey  { id; tenantId; name; hashedKey; scopes String[]; createdAt }

- Reuse NOTIFICATION_EVENTS as the webhook event list (stop.allocated, stop.out_for_delivery, stop.attempted_delivery, stop.departed, stop.next_in_route). Add test-webhook + API key management.
- Connectors: Shopify + Zapier PLUS your LatAm priorities VTEX + Mercado Libre (order-ingestion is the scale unlock).
- Slots: App settings > Integrations.

### 9. Custom stop properties
Up to N custom fields per stop, visible-to-driver / visible-to-recipient, via import/API/manual.

  model CustomProperty { id; tenantId; name; visibleToDriver Boolean; visibleToRecipient Boolean }
  // Order.customFields Json

- Cap count by plan (gating) with upsell — see Tier 3. Slots: Controls > Routes and stops; Pedidos import/manual; portal; driver app.

### 10. Driver permissions layer
Spoke controls what drivers can edit, whether drivers create their own routes, and nav-app/map preferences. Your driver app is locked.

  model DriverPermissionPolicy { id; tenantId; navApp (INTERNAL_GMAPS|WAZE|GOOGLE — your deeplink target); allowEditDispatcherRoutes Boolean; allowCreateRoutes Boolean; allowEditStartedRoutes Boolean; granular Json }

- Slots: Controls > Driver permissions; driver app reads the policy. Unlocks driver-created routes for ad-hoc work.

### 11. Barcode scanning at loading + confirmation
Already planned in the driver refinement plan — Spoke confirms the vehicle-LOADING use (verify the manifest at load-out) in addition to delivery confirmation.

  model ScanEvent { id; tenantId; orderId; type (LOAD|DELIVER|PICKUP); barcode; scannedAt }

- Slots: driver app (load manifest verification + delivery scan); Rutas shows a loading manifest. Chain of custody depot → doorstep.

## TIER 3 — SaaS maturity (later)
- Usage metering + feature-flag upsell — meter stops/month per tenant vs plan limits; upsell banners (custom-properties cap 3 → 10). You have module entitlements but not usage limits.
- Tenant-facing billing — invoice history, plan/billing tabs, tax-ID/VAT capture. (Platform admin has plans; this is the tenant's view.)
- Guided onboarding — depot setup → welcome pathways → setup checklist → connect driver app via QR + app-store badges. Pairs with the tenant-onboarding wizard in the roadmap.

## Build order (feed to Claude Code in this sequence)
1. Optimization strategy selector (1.1) — near-free, ships immediately.
2. Configurable POD per type (1.2).
3. Services / SLA (1.3) — foundational; unlocks SLA tracking + billing.
4. Multi-depot (1.4).
5. Delivery zones (1.5) and Cost/failure analytics (1.6).
6. Tier 2 in order (notification engine → developer platform → custom properties → driver permissions → barcode).
7. Tier 3 once selling.

Guardrails for every item: stay EV-native (cost = energy), B2B-only (notify merchant + tracking page, never the consumer), tenant-isolated, Spanish/Bogotá, route reefer orders only to Cold Box configs. Reuse existing machinery — Exceptions Cockpit for SLA breaches, dispatchToChannel for notifications, the OptimizationAction registry for the strategy selector, Leaflet for zones.

The one rule: reach parity on these fundamentals, but keep out-investing Spoke on EV + AI + cold chain + anti-piratería — that's where you win, and where they can't follow quickly.
