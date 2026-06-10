import { useEffect, useState } from "react";
import { api } from "../api";
import { Button, Card, EmptyState, Loading, PageHeader, inputClass } from "../components/ui";

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
  return `${VEHICLE_LABELS[v.type] ?? v.type}${v.isElectric ? " eléctrica ⚡" : ""}`;
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
          mover tu última milla con flota limpia. 🌱"
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className={inputClass}
              aria-label="Mes del informe"
            />
            <Button variant="secondary" onClick={() => window.print()}>
              Imprimir / PDF
            </Button>
          </div>
        }
      />

      {loading && <Loading label="Calculando huella…" />}

      {!loading && report && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <div className="text-2xl font-bold text-navy">{report.co2Kg} kg</div>
              <div className="text-xs text-navy/50">CO₂e emitido en tus envíos</div>
            </Card>
            <Card>
              <div className="text-2xl font-bold text-emerald-600">
                −{report.co2SavedKg} kg
              </div>
              <div className="text-xs text-navy/50">
                CO₂e evitado vs. flota a gasolina
              </div>
            </Card>
            <Card>
              <div className="text-2xl font-bold text-navy">
                {report.electricSharePct ?? 0}%
              </div>
              <div className="text-xs text-navy/50">de tus km en vehículo eléctrico</div>
            </Card>
            <Card>
              <div className="text-2xl font-bold text-navy">
                🌳 {report.treesEquivalent}
              </div>
              <div className="text-xs text-navy/50">
                árboles equivalentes (absorción anual)
              </div>
            </Card>
          </div>

          <Card
            title={`Envíos entregados en ${report.month} (${report.deliveredOrders})`}
          >
            {report.orders.length === 0 ? (
              <EmptyState>Sin entregas en este mes.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-cielo/40 text-left text-xs uppercase tracking-wide text-navy/50">
                      <th className="py-2">Guía</th>
                      <th>Destinatario</th>
                      <th>Entregado</th>
                      <th>Vehículo</th>
                      <th className="text-right">km</th>
                      <th className="text-right">CO₂ (kg)</th>
                      <th className="text-right">Ahorro (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.orders.map((o) => (
                      <tr key={o.trackingNumber} className="border-b border-niebla">
                        <td className="py-2 font-mono text-xs">{o.trackingNumber}</td>
                        <td>{o.customerName}</td>
                        <td className="text-xs text-navy/50">
                          {o.deliveredAt
                            ? new Date(o.deliveredAt).toLocaleDateString("es-CO")
                            : "—"}
                        </td>
                        <td className="text-xs">{vehicleLabel(o.vehicle)}</td>
                        <td className="text-right">{o.km}</td>
                        <td className="text-right">{o.co2Kg}</td>
                        <td className="text-right text-emerald-600">
                          {o.co2SavedKg > 0 ? `−${o.co2SavedKg}` : "0"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-navy/40">
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
