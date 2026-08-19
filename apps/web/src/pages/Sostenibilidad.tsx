import { useCallback, useEffect, useState } from "react";
import { Download, Leaf, Printer, RotateCcw } from "lucide-react";
import { api, ApiError } from "../api";
import {
  Button,
  Card,
  EmptyState,
  KpiCard,
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
 * cliente. Las cifras ICE existen SOLO como línea base contrafactual
 * ("emisiones evitadas"), nunca como vehículos propios.
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

/** Etiqueta de vehículo para pantalla: sin glifos emoji (regla del revamp). */
function displayVehicleLabel(v: { type: string; isElectric: boolean }): string {
  return vehicleLabel(v).replace("⚡", "").trim();
}

/** Barra de ahorro comparable (relativa al mayor ahorro del grupo). */
function SavingsBar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <span
      aria-hidden="true"
      className="inline-block h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-canvas"
    >
      <span className="block h-full bg-verde" style={{ width: `${pct}%` }} />
    </span>
  );
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

  const maxTypeSaved = Math.max(0, ...(report?.byVehicleType.map((t) => t.co2SavedKg) ?? []));
  const maxClientSaved = Math.max(0, ...(report?.byClient.map((c) => c.co2SavedKg) ?? []));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sostenibilidad"
        subtitle="Informe verde mensual · listo para enviar como argumento ESG"
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className={`${inputClass} w-auto font-mono`}
              aria-label="Mes del informe"
            />
            <Button
              variant="secondary"
              onClick={exportCsv}
              disabled={!report}
              icon={<Download strokeWidth={2} />}
            >
              CSV
            </Button>
            <Button
              variant="secondary"
              onClick={() => window.print()}
              disabled={!report}
              icon={<Printer strokeWidth={2} />}
            >
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
            <Button variant="secondary" onClick={load} icon={<RotateCcw strokeWidth={2} />}>
              Reintentar
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && report && (
        <>
          {/* Héroe ESG: el ahorro es el protagonista (navy + cifra limón). */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.3fr_1fr_1fr]">
            <KpiCard
              tone="hero"
              label="CO₂e evitado vs. gasolina"
              value={`−${report.co2SavedKg} kg`}
              hint={
                <span className="inline-flex items-center gap-1.5">
                  <Leaf
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-verde"
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
            <div className="flex flex-col gap-3">
              <KpiCard className="flex-1" label="km recorridos" value={report.totalKm} />
              <KpiCard className="flex-1" label="CO₂e emitido" value={`${report.co2Kg} kg`} />
            </div>
            <div className="flex flex-col gap-3">
              <KpiCard
                className="flex-1"
                label="km eléctricos"
                value={`${report.electricSharePct ?? 0}%`}
                accent
              />
              <KpiCard
                className="flex-1"
                label="CO₂ por entrega"
                value={
                  report.co2PerDeliveryKg === null ? "—" : `${report.co2PerDeliveryKg} kg`
                }
              />
            </div>
          </div>

          {report.routes === 0 && (
            <Card>
              <EmptyState>
                Sin operación registrada en {report.month}. Elige otro mes o
                despacha rutas para ver la huella.
              </EmptyState>
            </Card>
          )}

          <Card title="Por tipo de vehículo">
            {report.byVehicleType.length === 0 ? (
              <EmptyState>Sin rutas en este mes.</EmptyState>
            ) : (
              <div className="flex flex-col gap-2 text-[12.5px] text-asfalto">
                {report.byVehicleType.map((t) => (
                  <div
                    key={`${t.type}-${t.isElectric}`}
                    className="flex items-center gap-2"
                  >
                    <span className="w-44 shrink-0 truncate font-medium">
                      {displayVehicleLabel(t)}{" "}
                      <span className="font-normal text-text-tertiary">
                        · {t.routes} ruta{t.routes === 1 ? "" : "s"} · {t.km} km ·{" "}
                        {t.co2Kg} kg CO₂
                      </span>
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas">
                      <span
                        className="block h-full bg-verde"
                        style={{
                          width: `${Math.max(0, Math.min(100, maxTypeSaved > 0 ? (t.co2SavedKg / maxTypeSaved) * 100 : 0))}%`,
                        }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right font-mono text-[11px] text-asfalto">
                      {t.co2SavedKg > 0 ? `−${t.co2SavedKg} kg` : "0 kg"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Por negocio cliente (entregas del mes)">
            {report.byClient.length === 0 ? (
              <EmptyState>Sin entregas atribuibles en este mes.</EmptyState>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-text-tertiary">
                    <th className="py-2 font-semibold">Negocio</th>
                    <th className="text-right font-semibold">Entregas</th>
                    <th className="text-right font-semibold">km</th>
                    <th className="text-right font-semibold">CO₂ (kg)</th>
                    <th className="text-right font-semibold">Ahorro</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byClient.map((c) => (
                    <tr key={c.clientId ?? "none"} className="border-b border-border/60">
                      <td className="py-2 font-medium">{c.name}</td>
                      <td className="text-right">{c.deliveredOrders}</td>
                      <td className="text-right">{c.km}</td>
                      <td className="text-right font-mono text-xs">{c.co2Kg}</td>
                      <td className="text-right">
                        <span className="inline-flex items-center justify-end gap-2">
                          <SavingsBar value={c.co2SavedKg} max={maxClientSaved} />
                          <span className="w-16 text-right font-mono text-xs font-semibold text-asfalto">
                            {c.co2SavedKg > 0 ? `−${c.co2SavedKg} kg` : "0 kg"}
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-[11px] text-text-tertiary">
              Cada negocio ve este informe (solo sus envíos) en su portal.
              Metodología: distancia de ruta repartida entre entregas; línea
              base = mismo recorrido a gasolina.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
