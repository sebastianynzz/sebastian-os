import { useEffect, useState } from "react";
import {
  TRACKING_TIERS,
  TRACKING_TIER_LABELS,
  type TrackingTier,
} from "@moveos/shared";
import { api } from "../api";
import { useToast } from "../toast";
import { Banner, Card, Loading, PageHeader } from "../components/ui";

/**
 * Controles › Seguimiento público (Tier 2, B2B): nivel de privacidad de la
 * página pública de rastreo que el negocio comparte. Controla cuánto se expone
 * (solo ETA / + posición en cola / + ubicación en vivo). Nunca se mensajea al
 * consumidor final: el enlace lo comparte el negocio. Solo ADMIN.
 */

const TIER_HELP: Record<TrackingTier, string> = {
  ETA_ONLY: "Estado, ETA estimada e historial del envío. Sin ubicación del conductor.",
  ETA_POSITION:
    "Lo anterior, más la posición del envío en la cola de la ruta (cuántas paradas faltan).",
  FULL: "Lo anterior, más la ubicación del conductor en vivo mientras está en camino.",
};

export default function ControlesSeguimiento() {
  const toast = useToast();
  const [tier, setTier] = useState<TrackingTier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ trackingTier: TrackingTier }>("GET", "/controls/tracking");
      setTier(res.trackingTier);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la configuración.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function choose(next: TrackingTier) {
    const prev = tier;
    setTier(next);
    setSaving(true);
    try {
      await api("PATCH", "/controls/tracking", { trackingTier: next });
      toast.success("Nivel de rastreo guardado.");
    } catch (err) {
      setTier(prev);
      toast.error(err, { retry: () => void choose(next) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Seguimiento público"
        subtitle="Define cuánta información muestra la página pública de rastreo que el negocio comparte. MoveOS nunca contacta al consumidor final: solo enriquece el enlace que el negocio decide compartir."
      />
      {loading ? (
        <Loading label="Cargando configuración…" />
      ) : error ? (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      ) : (
        <Card title="Nivel de privacidad del rastreo">
          <div className="space-y-2">
            {TRACKING_TIERS.map((t) => (
              <label
                key={t}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                  tier === t ? "border-navy bg-niebla" : "border-border hover:bg-niebla/50"
                }`}
              >
                <input
                  type="radio"
                  name="trackingTier"
                  className="mt-1"
                  checked={tier === t}
                  disabled={saving}
                  onChange={() => void choose(t)}
                />
                <span>
                  <span className="block font-medium text-navy">
                    {TRACKING_TIER_LABELS[t]}
                  </span>
                  <span className="block text-sm text-navy/60">{TIER_HELP[t]}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
