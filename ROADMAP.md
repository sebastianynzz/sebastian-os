# MoveOS — Roadmap

Staged plan from the research brief. Checked items exist in this repo.

## Stage 1 — MVP: win Bogotá SMBs (0–6 months)

- [x] Mandatory core: orders, dispatch, driver app, tracking, POD, notifications
- [x] Multi-tenant module entitlements with instant toggle (the packaging moat)
- [x] Route optimization: VRP with pico y placa, capacity, time windows,
      moto/car/van/EV profiles
- [x] Informal-address handling: geocode cascade + learned AddressPin graph
- [x] Safety module: panic button + route-deviation alerts
- [x] EV module: SoC, dynamic usable range, charging stations (static list)
- [x] Driver app: offline action queue, geo-stamped POD, SOS, telemetry pings
- [x] Spanish-first dashboard with module toggles
- [x] Tracking numbers (guía MV-XXXXXXXX) + bitácora auditable per order
- [x] CSV order import UI with downloadable template
- [x] SPR/SPH productivity metrics in analytics
- [x] Move brand system applied (navy 534C / cielo 537C / lima 373C accent)
- [x] Client portal (CLIENT role): each business logs in, creates orders with
      pickup at its registered address, tracks them and sees only its own data
- [x] Monthly green report (CO₂): per-fleet, per-vehicle-type and per-client
      emissions + savings vs ICE baseline; client-facing version in the portal
- [x] Realtime SSE streams (live map, safety alerts, orders, public tracking,
      platform FaaS fleet) replacing frontend polling
- [ ] WhatsApp Business API credentials in production (adapter ready)
- [ ] Per-order pricing + free tier billing (suggested: first 100 orders free)
- [x] Payments removed by product decision: MoveOS is delivery software only
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
      same constraint layer — adapter shipped (`OSRM_URL`), self-host guide in
      `docs/OSRM_RENDER.md`, pending host provisioning

## Stage 3 — Differentiation & expansion (18+ months)

- [ ] AI add-ons: predictive ETAs, failed-delivery prediction (data already
      accumulating in `failureReason`), theft anomaly detection,
      address-resolution ML over the AddressPin graph
- [ ] EV: OCPP depot charging, charge scheduling vs time-of-use tariffs,
      live Terpel Voltex / Enel X availability
- [ ] Mexico, Chile, Peru: per-country addressing and compliance packs

## Triggers to revisit (from the brief)

- SimpliRoute or a global player localizes RNDC aggressively → accelerate
  compliance + channel partnerships.
- Ley 2486 e-moto registration formalizes → prioritize e-moto profiles.
