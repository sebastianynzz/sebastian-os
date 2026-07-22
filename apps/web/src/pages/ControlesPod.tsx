import { useEffect, useState } from "react";
import { Camera, Save, Signature } from "lucide-react";
import {
  DELIVERY_TYPES,
  DELIVERY_TYPE_LABELS,
  PICKUP_TYPES,
  PICKUP_TYPE_LABELS,
  POD_REQ,
  defaultPodPolicyConfig,
  type PodPolicyConfig,
  type PodReq,
} from "@moveos/shared";
import { api } from "../api";
import { useToast } from "../toast";
import { Banner, Button, Card, Loading, PageHeader, tableRowClass, theadRowClass } from "../components/ui";

const REQ_LABELS: Record<PodReq, string> = {
  MANDATORY: "Obligatoria",
  OPTIONAL: "Opcional",
  DISABLED: "Deshabilitada",
};

/**
 * Controles › Prueba de entrega (D2). El despachador define, por tipo de entrega
 * y de recogida, si la firma y la foto son obligatorias/opcionales/deshabilitadas.
 * El conductor elige el tipo en la app y la finalización se bloquea si falta una
 * evidencia obligatoria (el servidor es la fuente de verdad). Sin pagos → sin COD.
 */
export default function ControlesPod() {
  const toast = useToast();
  const [config, setConfig] = useState<PodPolicyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ config: PodPolicyConfig }>("GET", "/controls/pod-policy");
      setConfig(res.config ?? defaultPodPolicyConfig());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la política.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function setReq(
    kind: "delivery" | "pickup",
    type: string,
    field: "signature" | "photo",
    value: PodReq,
  ) {
    setConfig((prev) => {
      const base = prev ?? defaultPodPolicyConfig();
      const group = { ...(base[kind] as Record<string, { signature: PodReq; photo: PodReq }>) };
      const current = group[type] ?? { signature: "OPTIONAL", photo: "OPTIONAL" };
      group[type] = { ...current, [field]: value };
      return { ...base, [kind]: group };
    });
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      await api("PATCH", "/controls/pod-policy", { config });
      toast.success("Política de prueba de entrega guardada.");
    } catch (err) {
      toast.error(err, { retry: () => void save() });
    } finally {
      setSaving(false);
    }
  }

  function Row({
    kind,
    type,
    label,
  }: {
    kind: "delivery" | "pickup";
    type: string;
    label: string;
  }) {
    const group = (config?.[kind] ?? {}) as Record<
      string,
      { signature: PodReq; photo: PodReq } | undefined
    >;
    const value = group[type] ?? { signature: "OPTIONAL", photo: "OPTIONAL" };
    return (
      <tr className={tableRowClass}>
        <td className="py-2 pr-4 text-sm font-medium text-navy">{label}</td>
        {(["signature", "photo"] as const).map((field) => (
          <td key={field} className="py-2 pr-4">
            <select
              aria-label={`${label} — ${field === "signature" ? "firma" : "foto"}`}
              value={value[field]}
              onChange={(e) => setReq(kind, type, field, e.target.value as PodReq)}
              className="rounded-md border border-border-strong bg-surface px-2 py-1 text-sm text-navy focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/25"
            >
              {POD_REQ.map((r) => (
                <option key={r} value={r}>
                  {REQ_LABELS[r]}
                </option>
              ))}
            </select>
          </td>
        ))}
      </tr>
    );
  }

  function PolicyTable({
    title,
    kind,
    types,
    labels,
  }: {
    title: string;
    kind: "delivery" | "pickup";
    types: readonly string[];
    labels: Record<string, string>;
  }) {
    return (
      <Card title={title}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className={theadRowClass}>
                <th className="py-2 pr-4 font-medium">Tipo</th>
                <th className="py-2 pr-4 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <Signature aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Firma
                  </span>
                </th>
                <th className="py-2 pr-4 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <Camera aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Foto
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <Row key={t} kind={kind} type={t} label={labels[t] ?? t} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Prueba de entrega"
        subtitle="Define qué evidencia (firma/foto) se exige por tipo de entrega y recogida. La app del conductor bloquea la finalización si falta una prueba obligatoria."
        actions={
          <Button
            variant="cta"
            icon={<Save strokeWidth={2} />}
            onClick={save}
            disabled={saving || !config}
          >
            {saving ? "Guardando…" : "Guardar política"}
          </Button>
        }
      />
      {loading ? (
        <Loading label="Cargando política…" />
      ) : error ? (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      ) : (
        <>
          <PolicyTable
            title="Entregas"
            kind="delivery"
            types={DELIVERY_TYPES}
            labels={DELIVERY_TYPE_LABELS}
          />
          <PolicyTable
            title="Recogidas"
            kind="pickup"
            types={PICKUP_TYPES}
            labels={PICKUP_TYPE_LABELS}
          />
        </>
      )}
    </div>
  );
}
