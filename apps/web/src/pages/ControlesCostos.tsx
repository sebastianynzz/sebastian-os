import { useEffect, useState } from "react";
import { costConfigSchema } from "@moveos/shared";
import { api } from "../api";
import { useToast } from "../toast";
import { Banner, Button, Card, Field, Loading, PageHeader, inputClass } from "../components/ui";

/**
 * Controles › Costos (D6, energía-nativo): parámetros con los que la analítica
 * calcula el costo por entrega — costo del conductor por hora y tarifa de
 * energía (COP/kWh). La unidad de costo es la energía, nunca el combustible
 * (restricción dura 1.7). Solo ADMIN (el API lo exige); núcleo, sin gating.
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Costos"
        subtitle="Con estos parámetros la analítica calcula el costo por entrega: horas de ruta × costo/hora del conductor + kWh × tarifa de energía. La unidad de costo es la energía, no el combustible."
        actions={
          <Button variant="cta" onClick={save} disabled={saving || loading}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        }
      />
      {loading ? (
        <Loading label="Cargando configuración…" />
      ) : error ? (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      ) : (
        <Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Field label="Costo del conductor por hora (COP)">
                <input
                  type="number"
                  min="0"
                  step="500"
                  className={inputClass}
                  value={driver}
                  onChange={(e) => setDriver(e.target.value)}
                />
              </Field>
              <p className="mt-1 text-xs text-navy/50">
                {Number(driver) > 0 ? `${COP.format(Number(driver))} / hora` : "—"}
              </p>
            </div>
            <div>
              <Field label="Tarifa de energía (COP por kWh)">
                <input
                  type="number"
                  min="0"
                  step="50"
                  className={inputClass}
                  value={energy}
                  onChange={(e) => setEnergy(e.target.value)}
                />
              </Field>
              <p className="mt-1 text-xs text-navy/50">
                {Number(energy) > 0 ? `${COP.format(Number(energy))} / kWh` : "—"}
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
