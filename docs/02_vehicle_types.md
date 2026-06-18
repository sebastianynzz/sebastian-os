# MoveOS — Vehicle Types: Shared Enum, Prisma Migration & Optimizer Diff

Claude Code implementation task. Wires the 6 EV configs into shared types, the database, and the optimizer. Companion file: `vehicle-type-profiles.ts` (drop into `packages/shared`). Respects `CLAUDE.md` (EV-only → all pico y placa exempt; reefer orders → matching Cold Box only).

**Confirmed:** all published ranges are **reefer-on**. The range model uses `nominalRangeKm` as-is and never subtracts cooling draw again. `coolingDrawKw` is for energy analytics only.

---

## 1. `packages/shared`

### 1.1 Enum + profiles
- Replace `VehicleType` in `enums.ts` with exactly the 6 configs; export the union and add `vehicle-type-profiles.ts` (already written) exporting `VEHICLE_TYPE_PROFILES` + `configSupportsTempProfile()`.

```ts
// enums.ts
export const VEHICLE_TYPES = [
  'RAP_MOVE_LIGHT', 'RAP_MOVE_XL', 'RAP_MOVE_COLD_BOX',
  'IONAX', 'IONAX_COLD_BOX', 'IONAX_PICKUP',
] as const;
export type VehicleType = typeof VEHICLE_TYPES[number];

export const TEMP_PROFILES = ['AMBIENT', 'CHILLED', 'FROZEN'] as const;
export type TempProfile = typeof TEMP_PROFILES[number];
```

### 1.2 Zod (`schemas.ts`)
- Vehicle create/update: `vehicleType: z.enum(VEHICLE_TYPES)`; `batteryKwh` optional (defaults from profile's smallest option if omitted).
- Order create (full + portal): add `tempProfile: z.enum(TEMP_PROFILES).optional()` (defaults `AMBIENT`).

---

## 2. Prisma migration (additive — runs via `prisma migrate deploy` on boot)

```prisma
enum VehicleType {
  RAP_MOVE_LIGHT
  RAP_MOVE_XL
  RAP_MOVE_COLD_BOX
  IONAX
  IONAX_COLD_BOX
  IONAX_PICKUP
}

enum TempProfile { AMBIENT CHILLED FROZEN }

model Vehicle {
  // ...existing fields...
  vehicleType   VehicleType
  batteryKwh    Float?     // which pack is installed (IONAx: 11.52 or 23.04)
  nominalRangeKm Float?    // optional override; else resolved from profile + installed battery
  // reefer capability is DERIVED from vehicleType via VEHICLE_TYPE_PROFILES — do not duplicate.
}

model Order {
  // ...existing fields...
  tempProfile   TempProfile @default(AMBIENT)
}
```

**Migration notes**
- The `VehicleType` enum **values change** from any prior set. Add a data-migration step to remap existing `Vehicle.vehicleType` rows to one of the 6 (or set a safe default + flag for manual review). Pre-revenue, row count is small — review them.
- Everything else is additive (`ADD COLUMN`, new enum type) — safe for `migrate deploy`.
- CI: keep the existing "migration applies to fresh Postgres" check.

---

## 3. `packages/optimizer` diff

All values read from `VEHICLE_TYPE_PROFILES` — never hardcode a second copy.

### 3.1 `travel.ts` — per-type speed/duration factors
Derive from `topSpeedKmh` and `agilityFactor` against a 75 km/h urban baseline. First-pass numbers below; calibrate against OSRM later.

```ts
import { VEHICLE_TYPE_PROFILES, VehicleConfig } from '@move/shared';

const BASE_URBAN_KMH = 75;

/** >1 = faster than baseline, <1 = slower. */
export function speedFactor(type: VehicleConfig): number {
  const p = VEHICLE_TYPE_PROFILES[type];
  return (p.topSpeedKmh / BASE_URBAN_KMH) * p.agilityFactor;
}
export function durationFactor(type: VehicleConfig): number {
  return 1 / speedFactor(type);
}
```

Resulting factors (informational): LIGHT 0.87 · XL 0.95 · RAP_COLD_BOX 0.90 · IONAX 0.90 · IONAX_COLD_BOX 0.88 · PICKUP 0.90. Wire `matrixTravelModel` / `haversineTravelModel` to multiply per-leg duration by `durationFactor(vehicle.type)`.

### 3.2 `vrp.ts` / `simulateRoute()` — capacity + reefer feasibility
Two changes to the per-stop feasibility check:

```ts
import { VEHICLE_TYPE_PROFILES, configSupportsTempProfile } from '@move/shared';

function capacityOk(vehicleType, loadKg, loadM3) {
  const p = VEHICLE_TYPE_PROFILES[vehicleType];
  if (loadKg > p.payloadKg) return false;
  if (p.cargoVolumeM3 != null && loadM3 > p.cargoVolumeM3) return false; // flatbed: volume null → skip
  return true;
}

/** A vehicle can serve an order only if the order's cold-chain need is met. */
function reeferOk(vehicleType, orderTempProfile /* 'AMBIENT'|'CHILLED'|'FROZEN' */) {
  if (!orderTempProfile || orderTempProfile === 'AMBIENT') return true;
  return configSupportsTempProfile(vehicleType, orderTempProfile); // FROZEN→RAP_MOVE_COLD_BOX, CHILLED→either cold box
}
```

- Add both to the assignment feasibility. On failure, push to `excludedVehicles[]` / `unassigned[]` with a Spanish reason, e.g. `"Requiere cadena de frío FROZEN; vehículo no refrigerado"` or `"Vehículo refrigerado solo soporta CHILLED"`.
- `OPEN_FLATBED` (PICKUP): no volume constraint; constrain by payload (and bed area once L×W lands). Never assign reefer orders to it.

### 3.3 `evRange.ts` — reefer-on baseline (no double subtraction)
`nominalRangeKm` already includes the reefer load, so **do not** add a cooling penalty. Keep the existing deration (SoC, temp, payload, elevation, 15% margin, 40% floor). Add a helper to pick the right range for the installed battery (IONAx has two packs):

```ts
import { VEHICLE_TYPE_PROFILES } from '@move/shared';

/** Resolve nominal range from the installed battery pack (handles IONAx 11.52 vs 23.04). */
export function resolveNominalRangeKm(vehicle): number {
  if (vehicle.nominalRangeKm) return vehicle.nominalRangeKm; // explicit override
  const opts = VEHICLE_TYPE_PROFILES[vehicle.vehicleType].batteryOptions;
  const match = vehicle.batteryKwh
    ? opts.find(o => Math.abs(o.batteryKwh - vehicle.batteryKwh) < 0.01)
    : undefined;
  return (match ?? opts[0]).rangeKm; // default to smallest/conservative pack
}

// estimateUsableRangeKm(vehicle, conditions) stays as-is, seeded with resolveNominalRangeKm(vehicle).
// DO NOT subtract coolingDrawKw — ranges are already reefer-on.

/** Analytics only (energy/cost), NOT range. */
export function reeferEnergyKwh(vehicleType, hoursRunning): number {
  const r = VEHICLE_TYPE_PROFILES[vehicleType].reefer;
  if (!r) return 0;
  const draw = Array.isArray(r.coolingDrawKw)
    ? (r.coolingDrawKw[0] + r.coolingDrawKw[1]) / 2
    : r.coolingDrawKw;
  return draw * hoursRunning;
}
```

### 3.4 `picoYPlaca.ts` — all EV exempt
All 6 are electric → exempt nationally (Ley 1964/2019). Short-circuit the check and surface it positively in the planner ("exento — vehículo eléctrico").

```ts
export function checkPicoYPlaca(/* plate, city, date */): { restricted: false; reasonEs: 'Exento (vehículo eléctrico)' } {
  return { restricted: false, reasonEs: 'Exento (vehículo eléctrico)' };
}
```

---

## 4. `apps/web/Vehiculos.tsx` — type-driven UI

- Selecting a `vehicleType` pre-fills payload / volume / range / battery from `VEHICLE_TYPE_PROFILES`.
- IONAx configs: show a **battery-pack selector** (11.52 → 130 km · 23.04 → 260 km) that sets `batteryKwh` + range.
- Show reefer config (temp range + modes, read-only from profile) **only** when `profile.reefer != null` (the two Cold Box configs).
- `IONAX_PICKUP`: hide volume; show flatbed (and bed L×W once provided).

---

## 5. Tests (`packages/optimizer`)

- **Capacity:** each config accepts ≤ its payload/volume and rejects above; flatbed ignores volume.
- **Reefer matching:** a `FROZEN` order is feasible **only** on `RAP_MOVE_COLD_BOX`; a `CHILLED` order on either Cold Box; an `AMBIENT` order on all 6; reefer orders never feasible on `IONAX_PICKUP`.
- **Range by battery:** `resolveNominalRangeKm` returns 130 for the 11.52 kWh IONAx pack and 260 for 23.04; Rap Move configs return their single value.
- **No double-count:** estimated usable range for a Cold Box equals the deration of its published (reefer-on) range — cooling draw is not subtracted.
- **Pico y placa:** exempt for all 6.
- **Reasons:** infeasible assignments produce Spanish `unassigned[]`/`excluded[]` reasons.

---

## 6. Order of operations

1. `packages/shared` — enum + profiles + Zod (+ `tempProfile` on order).
2. Prisma migration (additive) + remap existing vehicle rows.
3. `packages/optimizer` — travel factors → capacity/reefer feasibility → range helper → pico y placa.
4. `Vehiculos.tsx` defaults + battery selector + conditional reefer panel.
5. Tests.

**Definition of done:** optimizer reads all vehicle math from `VEHICLE_TYPE_PROFILES`; frozen/chilled orders route only to the correct Cold Box; range resolves per installed battery with no reefer double-count; all 6 exempt from pico y placa; tests green; migration applies cleanly to a fresh Postgres.

**Still-open inputs (don't block):** `IONAX_PICKUP` bed length × width (bed-area packing) and `IONAX_COLD_BOX` net-vs-gross payload — both are marked `TODO` in `vehicle-type-profiles.ts`.
