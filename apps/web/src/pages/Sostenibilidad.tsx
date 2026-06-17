import { useCallback, useEffect, useState } from "react";
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
 * última milla eléctrica. Imprimible y exportable (CSV) para enviarlo a cada
 * cliente.
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

/** Celda CSV: entre comillas, con comillas internas escapadas. */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function reportToCsv(r: GreenReport): string {
  const rows: string[][] = [
    ["Informe verde", r.month],
    [],
    ["Resumen"],
    ["km recorridos", String(r.totalKm)],
    ["CO2e emitido (kg)", String(r.co2Kg)],
    ["CO2e evitado vs gasolina (kg)", String(r.co2SavedKg)],
    ["km electricos (%)", String(r.electricSharePct ?? 0)],
    ["arboles equivalentes/ano", String(r.treesEquivalent)],
    ["rutas", String(r.routes)],
    ["entregas", String(r.deliveredOrders)],
    [
      "CO2 por entrega (kg)",
      r.co2PerDeliveryKg === null ? "" : String(r.co2PerDeliveryKg),
    ],
    [],
    ["Por tipo de vehiculo"],
    ["tipo", "electrico", "rutas", "km", "co2_kg", "co2_evitado_kg"],
    ...r.byVehicleType.map((t) => [
      vehicleLabel(t),
      t.isElectric ? "si" : "no",
      String(t.routes),
      String(t.km),
      String(t.co2Kg),
      String(t.co2SavedKg),
    ]),
    [],
    ["Por negocio cliente"],
    ["negocio", "entregas", "km", "co2_kg", "co2_evitado_kg"],
    ...r.byClient.map((c) => [
      c.name,
      String(c.deliveredOrders),
      String(c.km),
      String(c.co2Kg),
      String(c.co2SavedKg),
    ]),
  ];
  // BOM para que Excel reconozca UTF-8 (acentos en español).
  return "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export default function Sostenibilidad() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<GreenReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [moduleOff, setModuleOff] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    void api<GreenReport>("GET", `/analytics/green-report?month=${month}`)
      .then(setReport)
      .catch((err) => {
        if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
          setModuleOff(true);
        } else {
          setError(true);
        }
      })
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  function exportCsv() {
    if (!report) return;
    const blob = new Blob([reportToCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `informe-verde-${report.month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

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
            <Button variant="secondary" onClick={exportCsv} disabled={!report}>
              Exportar CSV
            </Button>
            <Button variant="secondary" onClick={() => window.print()} disabled={!report}>
              Imprimir / PDF
            </Button>
          </div>
        }
      />

      {loading && <Loading label="Calculando huella de la flota…" />}

      {!loading && error && (
        <Card>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-danger">No se pudo calcular el informe verde.</span>
            <Button variant="secondary" onClick={load}>
              Reintentar
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && report && (
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
              <div className="text-2xl font-bold text-success">
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

          {report.routes === 0 && (
            <Card>
              <EmptyState>
                Sin operación registrada en {report.month}. Elige otro mes o
                despacha rutas para ver la huella.
              </EmptyState>
            </Card>
          )}

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
                        <td className="text-right text-success">
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
                        <td className="text-right text-success">
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
