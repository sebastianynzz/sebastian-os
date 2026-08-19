// packages/shared/src/vehicleTypeProfiles.ts
// daleGo EV fleet — 6 configurations across two product lines (Rap Move, IONAx).
// Single source of truth read by the optimizer, the Vehiculos UI, the EV range model, and cold chain.
// All vehicles are electric → pico y placa exempt nationally (Ley 1964/2019).
//
// OPEN ITEMS (flagged inline as TODO):
//  1. IONAX_PICKUP flatbed bed length × width (it's open — no enclosed volume).
//  2. IONAX_COLD_BOX effective cargo payload: 530 kg is the chassis rating; the insulated
//     body + JONWAY unit weighs ~157 kg — confirm whether 530 is net cargo or gross.
//  3. RESOLVED: all published ranges are reefer-ON (manufacturer measured them with the
//     refrigerated unit running). The EV range model therefore uses nominalRangeKm AS-IS and
//     must NOT subtract any additional cooling draw — that would double-count. `coolingDrawKw`
//     is retained ONLY for energy/cost analytics, never as a range penalty.

export type VehicleConfig =
  | 'RAP_MOVE_LIGHT'
  | 'RAP_MOVE_XL'
  | 'RAP_MOVE_COLD_BOX'
  | 'IONAX'
  | 'IONAX_COLD_BOX'
  | 'IONAX_PICKUP';

export type VehicleLine = 'RAP_MOVE' | 'IONAX';
export type BodyType = 'CLOSED_BOX' | 'REFRIGERATED_BOX' | 'OPEN_FLATBED';
export type ReeferMode = 'CHILLED' | 'FROZEN'; // matches order.tempProfile

export interface BatteryOption {
  batteryKwh: number;
  rangeKm: number; // manufacturer range for this pack
}

export interface ReeferSpec {
  unit: string;
  unitWeightKg?: number;
  tempMinC: number;
  tempMaxC: number;
  modes: ReeferMode[];            // which cold-chain profiles this config can serve
  coolingDrawKw: [number, number] | number; // electrical draw for the EV range model
  insulationMm?: number;
  powerSource?: 'PROPULSION_BATTERY' | 'SEPARATE';
}

export interface ChargingSpec {
  type: string;                   // e.g. 'AC_onboard', 'AC_onboard_Type2'
  voltageV: string;
  powerKw: number | [number, number] | null;
  timeH: [number, number] | string[]; // 0–100% window(s)
}

export interface VehicleTypeProfile {
  id: VehicleConfig;
  line: VehicleLine;
  labelEs: string;
  body: BodyType;
  payloadKg: number;
  cargoVolumeM3: number | null;   // null = open flatbed (area/weight-constrained, not volume)
  cargoDimsMm: [number, number, number] | null; // internal usable; null for flatbed
  flatbedDimsMm?: { lengthMm: number | null; widthMm: number | null }; // pickup only
  batteryOptions: BatteryOption[];
  nominalRangeKm: number;         // conservative default = smallest battery option
  topSpeedKmh: number;
  agilityFactor: number;          // travel-model multiplier (relative); TODO calibrate vs OSRM
  charging: ChargingSpec;
  reefer: ReeferSpec | null;
  reeferCapable: boolean;
  reeferRangeBasis?: 'REEFER_ON' | 'REEFER_OFF'; // is published range already cooling-loaded?
  picoYPlacaExempt: true;
  notes?: string[];
}

export const VEHICLE_TYPE_PROFILES: Record<VehicleConfig, VehicleTypeProfile> = {
  RAP_MOVE_LIGHT: {
    id: 'RAP_MOVE_LIGHT',
    line: 'RAP_MOVE',
    labelEs: 'Rap Move Light',
    body: 'CLOSED_BOX',
    payloadKg: 115,
    cargoVolumeM3: 0.5,
    cargoDimsMm: [740, 750, 1150],
    batteryOptions: [{ batteryKwh: 4.864, rangeKm: 100 }],
    nominalRangeKm: 100,
    topSpeedKmh: 65,
    agilityFactor: 1.0, // smallest/most agile in dense urban
    charging: { type: 'AC_onboard', voltageV: '205-265', powerKw: null, timeH: [1.5, 3.0] },
    reefer: null,
    reeferCapable: false,
    picoYPlacaExempt: true,
  },

  RAP_MOVE_XL: {
    id: 'RAP_MOVE_XL',
    line: 'RAP_MOVE',
    labelEs: 'Rap Move XL',
    body: 'CLOSED_BOX',
    payloadKg: 250,
    cargoVolumeM3: 1.6,
    cargoDimsMm: [1300, 940, 1250],
    batteryOptions: [{ batteryKwh: 7.36, rangeKm: 120 }],
    nominalRangeKm: 120,
    topSpeedKmh: 75,
    agilityFactor: 0.95,
    charging: { type: 'AC_onboard', voltageV: '205-265', powerKw: null, timeH: [1.5, 3.0] },
    reefer: null,
    reeferCapable: false,
    picoYPlacaExempt: true,
    notes: ['Motor 4.0 kW'],
  },

  RAP_MOVE_COLD_BOX: {
    id: 'RAP_MOVE_COLD_BOX',
    line: 'RAP_MOVE',
    labelEs: 'Rap Move Cold Box',
    body: 'REFRIGERATED_BOX',
    payloadKg: 200,
    cargoVolumeM3: 1.0,
    cargoDimsMm: [1112, 1529, 1138],
    batteryOptions: [{ batteryKwh: 7.36, rangeKm: 90 }],
    nominalRangeKm: 90,
    topSpeedKmh: 75,
    agilityFactor: 0.9,
    charging: { type: 'AC_onboard', voltageV: '205-265', powerKw: null, timeH: [1.5, 3.0] },
    reefer: {
      unit: 'GP-1000A',
      tempMinC: -25,
      tempMaxC: 0,
      modes: ['CHILLED', 'FROZEN'], // the FROZEN-capable unit of the fleet
      coolingDrawKw: [0.45, 0.65],
      powerSource: 'PROPULSION_BATTERY',
    },
    reeferCapable: true,
    reeferRangeBasis: 'REEFER_ON', // confirmed: 90 km measured with reefer running (vs XL 120 km, same battery)
    picoYPlacaExempt: true,
    notes: ['Frozen-capable to -25°C — assign FROZEN tempProfile orders here.'],
  },

  IONAX: {
    id: 'IONAX',
    line: 'IONAX',
    labelEs: 'IONAx',
    body: 'CLOSED_BOX',
    payloadKg: 530,
    cargoVolumeM3: 3.0,
    cargoDimsMm: null, // "variable" per manufacturer
    batteryOptions: [
      { batteryKwh: 11.52, rangeKm: 130 },
      { batteryKwh: 23.04, rangeKm: 260 },
    ],
    nominalRangeKm: 130,
    topSpeedKmh: 75,
    agilityFactor: 0.9,
    charging: { type: 'AC_onboard_Type2', voltageV: '220', powerKw: [2.2, 3.3], timeH: ['4-5', '6-8'] },
    reefer: null,
    reeferCapable: false,
    picoYPlacaExempt: true,
  },

  IONAX_COLD_BOX: {
    id: 'IONAX_COLD_BOX',
    line: 'IONAX',
    labelEs: 'IONAx Cold Box',
    body: 'REFRIGERATED_BOX',
    payloadKg: 530, // TODO confirm net vs gross — insulated body + unit ≈ 157 kg
    cargoVolumeM3: 2.8,
    cargoDimsMm: [1710, 1450, 1360], // internal (external 2260 × 1450 × 1360)
    batteryOptions: [
      { batteryKwh: 11.52, rangeKm: 130 },
      { batteryKwh: 23.04, rangeKm: 260 },
    ],
    nominalRangeKm: 130,
    topSpeedKmh: 75,
    agilityFactor: 0.88,
    charging: { type: 'AC_onboard_Type2', voltageV: '220', powerKw: [2.2, 3.3], timeH: ['4-5', '6-8'] },
    reefer: {
      unit: 'JONWAY XD-250',
      unitWeightKg: 32,
      tempMinC: -18,
      tempMaxC: 10,
      modes: ['CHILLED'], // refrigeration optional; chilled-oriented (-18 to +10)
      coolingDrawKw: 0.7,
      insulationMm: 85,
      powerSource: 'PROPULSION_BATTERY',
    },
    reeferCapable: true,
    reeferRangeBasis: 'REEFER_ON', // confirmed: 130–260 km already measured with reefer running
    picoYPlacaExempt: true,
    notes: [
      'Total refrigerated body incl. unit ≈ 157 kg.',
      'Chilled/refrigeration (-18…+10°C). For deep-frozen use RAP_MOVE_COLD_BOX.',
      'Published range is reefer-on — do not subtract cooling draw again.',
    ],
  },

  IONAX_PICKUP: {
    id: 'IONAX_PICKUP',
    line: 'IONAX',
    labelEs: 'IONAx Pick Up',
    body: 'OPEN_FLATBED',
    payloadKg: 530,
    cargoVolumeM3: null, // open flatbed — no enclosed volume; constrained by bed area + weight
    cargoDimsMm: null,
    flatbedDimsMm: { lengthMm: null, widthMm: null }, // TODO: provide bed L × W
    batteryOptions: [
      { batteryKwh: 11.52, rangeKm: 130 },
      { batteryKwh: 23.04, rangeKm: 260 },
    ],
    nominalRangeKm: 130,
    topSpeedKmh: 75,
    agilityFactor: 0.9,
    charging: { type: 'AC_onboard_Type2', voltageV: '220', powerKw: [2.2, 3.3], timeH: ['4-5', '6-8'] },
    reefer: null,
    reeferCapable: false,
    picoYPlacaExempt: true,
    notes: ['Open flatbed — pack by bed area + weight, not volume. Good for oversized/irregular loads.'],
  },
};

// Helper the load/vehicle-pick solvers should use to match a shipment's cold-chain need to a config.
export function configSupportsTempProfile(id: VehicleConfig, profile: ReeferMode): boolean {
  const r = VEHICLE_TYPE_PROFILES[id].reefer;
  return !!r && r.modes.includes(profile);
}
