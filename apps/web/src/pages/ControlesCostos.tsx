import { useEffect, useState } from "react";
import { costConfigSchema } from "@moveos/shared";
import { api } from "../api";
import { useToast } from "../toast";
import { Banner, Button, Loading } from "../components/ui";

/**
 * Controles › Costos (D6, energía-nativo, revamp 6b): parámetros con los que la
 * analítica calcula el costo por entrega — costo del conductor por hora y
 * tarifa de energía (COP/kWh). La unidad de costo es la energía, nunca el
 * combustible (restricción dura 1.7). Solo ADMIN (el API lo exige); núcleo,
 * sin gating.
 *
 * Revamp: campos con la unidad como sufijo dentro del campo (COP/h, COP/kWh) y
 * vista previa en vivo de la fórmula del costo por entrega. El endpoint
 * /controls/cost no devuelve la operación del mes, así que la vista previa se
 * arma con los dos parámetros actuales sobre la fórmula.
 */

interface CostConfig {
  driverCostPerHourCop: number;
  energyTariffCop: number;
}

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

/** Mes en curso en América/Bogotá, en minúscula ("julio"). */
const CURRENT_MONTH = new Intl.DateTimeFormat("es-CO", {
  month: "long",
  timeZone: "America/Bogota",
}).format(new Date());

/** Campo numérico con la unidad como sufijo dentro del campo. */
function UnitInput({
  id,
  label,
  value,
  unit,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  unit: string;
  step: string;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-semibold text-text-secondary">
        {label}
      </label>
      <div className="flex items-stretch overflow-hidden rounded-md border border-border-strong bg-surface transition duration-200 ease-brand focus-within:border-asfalto focus-within:ring-2 focus-within:ring-asfalto/25">
        <input
          id={id}
          type="number"
          min="0"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-sm text-asfalto placeholder:text-text-tertiary focus:outline-none"
        />
        <span className="flex shrink-0 items-center border-l border-border bg-canvas px-2.5 text-[11px] text-text-tertiary">
          {unit}
        </span>
      </div>
    </div>
  );
}

export default function ControlesCostos() {
  const toast = useToast();
  const [driver, setDriver] = useState("");
  const [energy, setEnergy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const cfg = await api<CostConfig>("GET", "/controls/cost");
      setDriver(String(cfg.driverCostPerHourCop));
      setEnergy(String(cfg.energyTariffCop));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la configuración.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    const parsed = costConfigSchema.safeParse({
      driverCostPerHourCop: Number(driver),
      energyTariffCop: Number(energy),
    });
    if (!parsed.success) {
      toast.error(new Error(parsed.error.issues[0]?.message ?? "Datos inválidos"));
      return;
    }
    setSaving(true);
    try {
      await api("PATCH", "/controls/cost", parsed.data);
      toast.success("Parámetros de costo guardados.");
    } catch (err) {
      toast.error(err, { retry: () => void save() });
    } finally {
      setSaving(false);
    }
  }

  const driverCop = Number(driver) || 0;
  const energyCop = Number(energy) || 0;

  return (
    <div className="space-y-3.5">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-asfalto">Costos</h1>
        <p className="mt-0.5 max-w-2xl text-[12.5px] text-text-secondary">
          Con estos parámetros la analítica calcula el costo por entrega: horas de ruta ×
          costo/hora del conductor + kWh × tarifa de energía.
        </p>
      </div>

      {loading ? (
        <Loading label="Cargando configuración…" />
      ) : error ? (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      ) : (
        <div className="flex max-w-2xl flex-col gap-2.5 rounded-lg border border-border bg-surface p-4 shadow-soft">
          <div>
            <span className="text-sm font-semibold text-asfalto">Costos (energía-nativo)</span>
            <span className="mt-0.5 block text-[11.5px] text-text-tertiary">
              Parámetros del costo por entrega en Analítica
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <UnitInput
              id="costo-conductor"
              label="Costo del conductor / hora"
              value={driver}
              unit="COP/h"
              step="500"
              onChange={setDriver}
            />
            <UnitInput
              id="tarifa-energia"
              label="Tarifa de energía"
              value={energy}
              unit="COP/kWh"
              step="50"
              onChange={setEnergy}
            />
          </div>

          {/* Vista previa en vivo de la fórmula con los parámetros actuales. */}
          <div className="rounded-md bg-info-bg px-3 py-2 text-[11.5px] leading-relaxed text-info">
            <strong className="font-semibold">Vista previa</strong> con la operación de{" "}
            {CURRENT_MONTH}: horas de ruta × <strong>{COP.format(driverCop)}</strong>/h + kWh
            consumidos × <strong>{COP.format(energyCop)}</strong>/kWh ÷ entregas del mes →{" "}
            <strong className="font-semibold text-asfalto">costo por entrega</strong> en Analítica.
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-text-tertiary">
              La unidad de costo es la energía, nunca el combustible.
            </span>
            <Button variant="cta" onClick={save} disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
