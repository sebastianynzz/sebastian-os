import { useEffect, useState } from "react";
import { Leaf, Printer, TreePine, Zap } from "lucide-react";
import { api } from "../api";
import { formatDateBogota } from "../format";
import {
  Button,
  Card,
  EmptyState,
  KpiCard,
  Loading,
  PageHeader,
  inputClass,
  tableRowClass,
  theadRowClass,
} from "../components/ui";

/**
 * Portal de clientes — "Informe verde": CO₂ de los envíos del negocio en el
 * mes, con el ahorro frente a la línea base de combustión. Imprimible para
 * anexar a reportes ESG del propio negocio.
 */

interface GreenOrder {
  trackingNumber: string | null;
  customerName: string;
  deliveredAt: string | null;
  vehicle: { plate: string; type: string; isElectric: boolean };
  km: number;
  co2Kg: number;
  co2SavedKg: number;
}

interface GreenReport {
  month: string;
  totalKm: number;
  co2Kg: number;
  co2BaselineKg: number;
  co2SavedKg: number;
  electricSharePct: number | null;
  treesEquivalent: number;
  deliveredOrders: number;
  co2PerDeliveryKg: number | null;
  orders: GreenOrder[];
}

const VEHICLE_LABELS: Record<string, string> = {
  MOTO: "Moto",
  BICICLETA: "Bicicleta",
  CARRO: "Carro",
  VAN: "Van",
  CAMION: "Camión",
};

export function vehicleLabel(v: { type: string; isElectric: boolean }) {
  return `${VEHICLE_LABELS[v.type] ?? v.type}${v.isElectric ? " eléctrica" : ""}`;
}

/** Etiqueta de vehículo con rayo Lucide (nunca emoji) cuando es eléctrico. */
function VehicleCell({ vehicle }: { vehicle: GreenOrder["vehicle"] }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {vehicleLabel(vehicle)}
      {vehicle.isElectric && (
        <Zap aria-hidden="true" className="h-3 w-3 text-olive" strokeWidth={2} />
      )}
    </span>
  );
}

export default function PortalVerde() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<GreenReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void api<GreenReport>("GET", `/portal/green-report?month=${month}`)
      .then(setReport)
      .finally(() => setLoading(false));
  }, [month]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Informe verde"
        subtitle="La huella de carbono de tus envíos del mes y lo que ahorras al
          mover tu última milla con flota limpia."
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className={inputClass}
              aria-label="Mes del informe"
            />
            <Button
              variant="secondary"
              icon={<Printer strokeWidth={2} />}
              onClick={() => window.print()}
            >
              Imprimir / PDF
            </Button>
          </div>
        }
      />

      {loading && <Loading label="Calculando huella…" />}

      {!loading && report && (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_1fr_1fr]">
            <KpiCard
              tone="hero"
              className="flex flex-col justify-center"
              label="CO₂e evitado vs. gasolina"
              value={`−${report.co2SavedKg} kg`}
              hint={
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <TreePine
                    aria-hidden="true"
                    className="h-3.5 w-3.5 text-verde"
                    strokeWidth={2}
                  />
                  <span>
                    equivale a{" "}
                    <strong className="font-semibold text-verde">
                      {report.treesEquivalent} árboles
                    </strong>{" "}
                    plantados/año
                  </span>
                </span>
              }
            />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
              <KpiCard label="km recorridos" value={report.totalKm} />
              <KpiCard label="CO₂e emitido" value={`${report.co2Kg} kg`} />
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
              <KpiCard
                label="km eléctricos"
                value={`${report.electricSharePct ?? 0}%`}
                accent
              />
              <KpiCard
                label="CO₂ por entrega"
                value={
                  report.co2PerDeliveryKg === null
                    ? "—"
                    : `${report.co2PerDeliveryKg} kg`
                }
              />
            </div>
          </div>

          <Card
            title={`Envíos entregados en ${report.month} (${report.deliveredOrders})`}
          >
            {report.orders.length === 0 ? (
              <EmptyState
                icon={<Leaf aria-hidden="true" className="h-8 w-8" strokeWidth={1.75} />}
              >
                Sin entregas en este mes.
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-asfalto">
                  <thead>
                    <tr className={theadRowClass}>
                      <th className="py-2 font-semibold">Guía</th>
                      <th className="font-semibold">Destinatario</th>
                      <th className="font-semibold">Entregado</th>
                      <th className="font-semibold">Vehículo</th>
                      <th className="text-right font-semibold">km</th>
                      <th className="text-right font-semibold">CO₂ (kg)</th>
                      <th className="text-right font-semibold">Ahorro (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.orders.map((o) => (
                      <tr key={o.trackingNumber} className={tableRowClass}>
                        <td className="py-2 font-mono text-xs">{o.trackingNumber}</td>
                        <td className="font-medium">{o.customerName}</td>
                        <td className="font-mono text-xs text-text-secondary">
                          {o.deliveredAt ? formatDateBogota(o.deliveredAt) : "—"}
                        </td>
                        <td className="text-xs">
                          <VehicleCell vehicle={o.vehicle} />
                        </td>
                        <td className="text-right font-mono text-xs">{o.km}</td>
                        <td className="text-right font-mono text-xs">{o.co2Kg}</td>
                        <td className="text-right font-mono text-xs font-semibold text-asfalto">
                          {o.co2SavedKg > 0 ? `−${o.co2SavedKg}` : "0"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-text-tertiary">
              Metodología: distancia de ruta repartida entre las entregas del
              recorrido; emisión según tipo y propulsión del vehículo; línea
              base = el mismo recorrido con el equivalente a gasolina. Red
              eléctrica colombiana: 0.126 kg CO₂e/kWh.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
