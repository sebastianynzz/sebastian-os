# MoveOS — Roadmap

Staged plan from the research brief. Checked items exist in this repo.

## Stage 1 — MVP: win Bogotá SMBs (0–6 months)

- [x] Mandatory core: orders, dispatch, driver app, tracking, POD, notifications
- [x] Multi-tenant module entitlements with instant toggle (the packaging moat)
- [x] Route optimization: VRP with pico y placa, capacity, time windows,
      moto/car/van/EV profiles
- [x] COD module: collection methods, driver cash summary, settlements,
      discrepancy + rejection analytics
- [x] Informal-address handling: geocode cascade + learned AddressPin graph
- [x] Safety module: panic button + route-deviation alerts
- [x] EV module: SoC, dynamic usable range, charging stations (static list)
- [x] Driver app: offline action queue, COD capture, SOS, telemetry pings
- [x] Spanish-first dashboard with module toggles
- [x] Tracking numbers (guía MV-XXXXXXXX) + bitácora auditable per order
- [x] CSV order import UI with downloadable template
- [x] SPR/SPH productivity metrics in analytics
- [x] Move brand system applied (navy 534C / cielo 537C / lima 373C accent)
- [ ] WhatsApp Business API credentials in production (adapter ready)
- [ ] Per-order pricing + free tier billing (suggested: first 100 orders free)
- [ ] Pilot: 5–10 moto courier SMBs in Bogotá

## Stage 2 — Up-market: compliance, telematics, security (6–18 months)

- [ ] RNDC module: MEC generation, georeferenced tiempos logísticos via
      web service (Decreto 1017/2025), SICE-TAC validation
- [ ] Hardware-agnostic telematics ingestion (Teltonika, Queclink, Suntech,
      Wialon retranslation) into `TelemetryPing`
- [ ] Geofenced safe corridors, trusted-stop enforcement, engine shut-off
      integration via telematics partners
- [ ] VTEX / Shopify / Mercado Libre connectors; Siigo ERP
- [ ] Customer Experience Pro: branded live-tracking page, WhatsApp two-way
      chat, self-serve reschedule
- [ ] Per-vehicle + platform-fee enterprise pricing; white-label for
      telematics resellers
- [ ] Routing engine upgrade: road-network distances (OSRM/VROOM) behind the
      same constraint layer

## Stage 3 — Differentiation & expansion (18+ months)

- [ ] AI add-ons: predictive ETAs, COD-rejection prediction (data already
      accumulating in `failureReason`), theft anomaly detection,
      address-resolution ML over the AddressPin graph
- [ ] EV: OCPP depot charging, charge scheduling vs time-of-use tariffs,
      live Terpel Voltex / Enel X availability
- [ ] Mexico, Chile, Peru: per-country addressing, payments, compliance packs
- [ ] Bre-B / PSE / Nequi payment rails for COD digital collection and
      instant driver payouts

## Triggers to revisit (from the brief)

- SimpliRoute or a global player localizes COD/RNDC aggressively → accelerate
  compliance + channel partnerships.
- Ley 2486 e-moto registration formalizes → prioritize e-moto profiles.
- COD share declines as Bre-B grows → shift weight to optimization/telematics.
