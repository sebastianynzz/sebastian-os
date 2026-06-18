import {
  evKwhForKm,
  DEFAULT_DRIVER_COST_PER_HOUR_COP,
  DEFAULT_ENERGY_TARIFF_COP,
  type VehicleType,
} from "@moveos/shared";
import { prisma } from "../lib/prisma.js";

/**
 * Costo por entrega ENERGÍA-NATIVO (D6, restricción dura 1.7): el costo se deriva
 * de horas de ruta × costo/hora del conductor + kWh × tarifa de energía, nunca
 * de combustible. kWh sale del consumo del EV (evKwhForKm). Por ruta del rango;
 * tenant-scoped. Determinista.
 */

export interface CostReport {
  from: string;
  to: string;
  driverCostPerHourCop: number;
  energyTariffCop: number;
  routes: number;
  stops: number;
  totalKm: number;
  totalKwh: number;
  routeHours: number;
  laborCostCop: number;
  energyCostCop: number;
  totalCostCop: number;
  costPerDeliveryCop: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function tenantCostReport(
  tenantId: string,
  from: string,
  to: string,
): Promise<CostReport> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { driverCostPerHourCop: true, energyTariffCop: true },
  });
  const driverCostPerHourCop =
    tenant.driverCostPerHourCop ?? DEFAULT_DRIVER_COST_PER_HOUR_COP;
  const energyTariffCop = tenant.energyTariffCop ?? DEFAULT_ENERGY_TARIFF_COP;

  // route.date es "YYYY-MM-DD"; la comparación de strings ordena por fecha.
  const routes = await prisma.route.findMany({
    where: { tenantId, date: { gte: from, lte: to } },
    select: {
      totalDistanceKm: true,
      totalDurationMin: true,
      vehicle: { select: { type: true } },
      stops: { select: { kind: true } },
    },
  });

  let totalKm = 0;
  let totalKwh = 0;
  let routeHours = 0;
  let stops = 0;
  for (const r of routes) {
    totalKm += r.totalDistanceKm;
    routeHours += r.totalDurationMin / 60;
    totalKwh += evKwhForKm(r.vehicle.type as VehicleType, r.totalDistanceKm);
    stops += r.stops.filter((s) => s.kind === "DELIVERY").length;
  }

  const laborCostCop = routeHours * driverCostPerHourCop;
  const energyCostCop = totalKwh * energyTariffCop;
  const totalCostCop = laborCostCop + energyCostCop;

  return {
    from,
    to,
    driverCostPerHourCop,
    energyTariffCop,
    routes: routes.length,
    stops,
    totalKm: round1(totalKm),
    totalKwh: round1(totalKwh),
    routeHours: round1(routeHours),
    laborCostCop: Math.round(laborCostCop),
    energyCostCop: Math.round(energyCostCop),
    totalCostCop: Math.round(totalCostCop),
    costPerDeliveryCop: stops === 0 ? null : Math.round(totalCostCop / stops),
  };
}
