import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import {
  Button,
  Card,
  EmptyState,
  Loading,
  ModuleDisabled,
  PageHeader,
  inputClass,
} from "../components/ui";
import { vehicleLabel } from "./PortalVerde";

/**
 * Informe verde mensual del tenant (módulo Analítica Pro): CO₂ de la flota
 * por tipo de vehículo y por negocio cliente — el argumento ESG para vender
 * última milla eléctrica. Imprimible para enviarlo a cada cliente.
 */

interface TypeRow {
  type: string;
  isElectric: boolean;
  routes: number;
  km: number;
  co2Kg: number;
  co2SavedKg: number;
}

interface ClientRow {
  clientId: string | null;
  name: string;
  deliveredOrders: number;
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
  electricKm: number;
  electricSharePct: number | null;
  treesEquivalent: number;
  routes: number;
  deliveredOrders: number;
  co2PerDeliveryKg: number | null;
  byVehicleType: TypeRow[];
  byClient: ClientRow[];
}

export default function Sostenibilidad() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<GreenReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [moduleOff, setModuleOff] = useState(false);

  useEffect(() => {
    setLoading(true);
    void api<GreenReport>("GET", `/analytics/green-report?month=${month}`)
      .then(setReport)
      .catch((err) => {
        if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
          setModuleOff(true);
        }
      })
      .finally(() => setLoading(false));
  }, [month]);

  if (moduleOff) {
    return <ModuleDisabled title="Sostenibilidad" moduleName="Analítica Pro" />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sostenibilidad"
        subtitle="Informe verde mensual de la operación: huella de CO₂, ahorro por
          electrificación y desglose por negocio cliente (listo para enviar
          como argumento ESG)."
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

      {loading && <Loading label="Calculando huella de la flota…" />}

      {!loading && report && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Card>
              <div className="text-2xl font-bold text-navy">{report.totalKm}</div>
              <div className="text-xs text-navy/50">km recorridos</div>
            </Card>
            <Card>
              <div className="text-2xl font-bold text-navy">{report.co2Kg} kg</div>
              <div className="text-xs text-navy/50">CO₂e emitido</div>
            </Card>
            <Card>
              <div className="text-2xl font-bold text-emerald-600">
                −{report.co2SavedKg} kg
              </div>
              <div className="text-xs text-navy/50">CO₂e evitado vs. gasolina</div>
            </Card>
            <Card>
              <div className="text-2xl font-bold text-navy">
                {report.electricSharePct ?? 0}%
              </div>
              <div className="text-xs text-navy/50">km eléctricos</div>
            </Card>
            <Card>
              <div className="text-2xl font-bold text-navy">
                🌳 {report.treesEquivalent}
              </div>
              <div className="text-xs text-navy/50">árboles equivalentes/año</div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Por tipo de vehículo">
              {report.byVehicleType.length === 0 ? (
                <EmptyState>Sin rutas en este mes.</EmptyState>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-cielo/40 text-left text-xs uppercase tracking-wide text-navy/50">
                      <th className="py-2">Vehículo</th>
                      <th className="text-right">Rutas</th>
                      <th className="text-right">km</th>
                      <th className="text-right">CO₂ (kg)</th>
                      <th className="text-right">Ahorro (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byVehicleType.map((t) => (
                      <tr
                        key={`${t.type}-${t.isElectric}`}
                        className="border-b border-niebla"
                      >
                        <td className="py-2">{vehicleLabel(t)}</td>
                        <td className="text-right">{t.routes}</td>
                        <td className="text-right">{t.km}</td>
                        <td className="text-right">{t.co2Kg}</td>
                        <td className="text-right text-emerald-600">
                          {t.co2SavedKg > 0 ? `−${t.co2SavedKg}` : "0"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Por negocio cliente (entregas del mes)">
              {report.byClient.length === 0 ? (
                <EmptyState>Sin entregas atribuibles en este mes.</EmptyState>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-cielo/40 text-left text-xs uppercase tracking-wide text-navy/50">
                      <th className="py-2">Negocio</th>
                      <th className="text-right">Entregas</th>
                      <th className="text-right">km</th>
                      <th className="text-right">CO₂ (kg)</th>
                      <th className="text-right">Ahorro (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byClient.map((c) => (
                      <tr key={c.clientId ?? "none"} className="border-b border-niebla">
                        <td className="py-2 font-medium">{c.name}</td>
                        <td className="text-right">{c.deliveredOrders}</td>
                        <td className="text-right">{c.km}</td>
                        <td className="text-right">{c.co2Kg}</td>
                        <td className="text-right text-emerald-600">
                          {c.co2SavedKg > 0 ? `−${c.co2SavedKg}` : "0"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-3 text-xs text-navy/40">
                Cada negocio cliente ve este mismo informe (solo con sus envíos)
                en su portal. Metodología: distancia de ruta repartida entre las
                entregas; línea base = mismo recorrido a gasolina.
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
