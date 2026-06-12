---
name: moveos-address-intelligence
description: Use when touching geocoding, AddressPin, the triage queue, driver pin fixes, portal address validation, or the data-flywheel metrics — the address graph is the product's moat and has strict learning rules.
---

# MoveOS Address Intelligence — the moat

Everything lives around `apps/api/src/services/geocoding.ts`. The learned
`AddressPin` graph is the compounding asset: every cache hit is a
Google/Lupap call that was NOT paid, and the **graph hit rate** is a core
unit-economics metric.

## The cascade (order matters)

1. `AddressPin` (tenant-scoped, key = `normalizeAddress(raw)`) —
   confidence 0.92 + 0.01/reuse (cap 0.99); counts as a graph hit.
2. Lupap (`LUPAP_API_KEY`) — Colombian informal addresses.
3. Google (`GOOGLE_MAPS_API_KEY`) — ROOFTOP 0.9, interpolated 0.65,
   partial match ≤0.5.
4. `MockGeocoder` — deterministic, confidence 0.3, dev only, never fails.

Every resolution records `GeocodeDailyStat (tenantId, date, source)` via
upsert in a try/catch — the metric must NEVER break order creation.
Providers time out at 6 s and fall through silently.

## Learning rules (what writes to the graph)

`learnAddressPin(tenantId, raw, lat, lng, notes?, {source, city})` is called
from exactly these flows — keep it that way:
- successful geo-stamped delivery (`DELIVERY_CONFIRMED`)
- driver pin fix `POST /addresses/orders/:id/driver-fix`
  (`DRIVER_CONFIRMED`; driver must own a stop on the order; app nudges when
  arrival is >300 m from the stored pin — `ADDRESS_FIX_THRESHOLD_M`)
- dispatcher triage `PATCH /addresses/orders/:id/location`
  (`DISPATCHER_CONFIRMED`)
Never learn from a FAILED stop with reason DIRECCION_ERRADA — the driver is
at the WRONG place.

## Confidence plumbing

`Order.geoConfidence` + `Order.addressVerifiedAt` drive the triage queue
(`GET /addresses/triage`, threshold `LOW_CONFIDENCE_THRESHOLD = 0.7`,
also `geocodeSource: "MOCK"` and null-confidence rows). Human confirmation
(driver/dispatcher/integration coords) sets confidence 1 + verifiedAt.
Sources: CLIENT | ADDRESS_PIN | LUPAP | GOOGLE | MOCK | MANUAL_PIN |
DRIVER_PIN. Bitácora event: `ADDRESS_CONFIRMED`.

## Surfaces that depend on this

- Web `Direcciones.tsx` (draggable-pin triage) and the
  `ADDRESS_UNCONFIRMED` item in the exceptions cockpit.
- Portal `POST /portal/address/validate` ("esta dirección es ambigua…" at
  order entry; `knownAddress` = graph hit).
- Platform `GET /platform/flywheel` + admin `Flywheel.tsx`: pins total/new,
  hit rate, paid calls avoided, coverage by city/tenant. If you add a
  provider, add its source string to the stats and the flywheel breakdown.
