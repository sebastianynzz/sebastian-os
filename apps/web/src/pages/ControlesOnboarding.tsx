import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Copy, ExternalLink, QrCode, Smartphone } from "lucide-react";
import { api } from "../api";
import { useToast } from "../toast";
import { Banner, Button, Card, Loading, PageHeader } from "../components/ui";

/**
 * Controles › Primeros pasos (Tier 3 §14): onboarding guiado. La lista refleja
 * el estado real del tenant (depósito, vehículo, conductor, primer pedido,
 * facturación) y enlaza a cada sección; abajo, cómo conectar la app del
 * conductor. Pensado para llevar a un tenant nuevo a su primera ruta.
 */

interface Step {
  key: string;
  done: boolean;
}
interface Checklist {
  steps: Step[];
  completed: number;
  total: number;
}

const STEP_COPY: Record<
  string,
  { label: string; description: string; to: string; cta: string }
> = {
  depot: {
    label: "Crea tu primer depósito",
    description: "El punto desde donde salen y regresan las rutas.",
    to: "/controles/depositos",
    cta: "Ir a Depósitos",
  },
  vehicle: {
    label: "Agrega un vehículo eléctrico",
    description: "Tu flota 100% eléctrica: autonomía y carga vienen de fábrica.",
    to: "/vehiculos",
    cta: "Ir a Vehículos",
  },
  driver: {
    label: "Agrega un conductor",
    description: "Crea su acceso para que use la app del conductor.",
    to: "/conductores",
    cta: "Ir a Conductores",
  },
  order: {
    label: "Crea tu primer pedido",
    description: "Manual o por CSV — el sistema geocodifica la dirección.",
    to: "/pedidos",
    cta: "Ir a Pedidos",
  },
  billing: {
    label: "Completa tus datos de facturación",
    description: "Razón social y NIT para tus facturas de suscripción.",
    to: "/controles/facturacion",
    cta: "Ir a Facturación",
  },
};

const DRIVER_APP_URL =
  (import.meta.env.VITE_DRIVER_URL as string | undefined) ??
  "https://conductor.moveos.app";

export default function ControlesOnboarding() {
  const toast = useToast();
  const [data, setData] = useState<Checklist | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setData(await api<Checklist>("GET", "/onboarding/checklist"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el checklist.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(DRIVER_APP_URL);
      toast.success("Enlace copiado.");
    } catch {
      toast.error(new Error("No se pudo copiar el enlace."));
    }
  }

  const pct = data ? Math.round((data.completed / data.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Primeros pasos"
        subtitle="Una guía rápida para dejar tu operación lista: del depósito a tu primera ruta."
      />

      {error && (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      )}

      {data === null ? (
        <Card>
          <Loading label="Cargando primeros pasos…" />
        </Card>
      ) : (
        <Card title={`Progreso · ${data.completed} de ${data.total}`}>
          <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-canvas">
            <div
              className="h-full rounded-full bg-verde"
              style={{ width: `${Math.max(pct, 4)}%` }}
            />
          </div>
          <ul className="space-y-2">
            {data.steps.map((s) => {
              const copy = STEP_COPY[s.key];
              if (!copy) return null;
              return (
                <li
                  key={s.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                        s.done
                          ? "bg-success-bg text-success"
                          : "bg-canvas text-text-tertiary"
                      }`}
                      aria-hidden="true"
                    >
                      {s.done && <Check className="h-3 w-3" strokeWidth={2.5} />}
                    </span>
                    <div className="min-w-0">
                      <div
                        className={`font-medium ${s.done ? "text-text-tertiary line-through" : "text-asfalto"}`}
                      >
                        {copy.label}
                      </div>
                      <div className="text-xs text-text-tertiary">{copy.description}</div>
                    </div>
                  </div>
                  {!s.done && (
                    <Link
                      to={copy.to}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-asfalto px-3 py-1.5 text-sm font-medium text-white transition duration-200 ease-brand hover:bg-asfalto-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asfalto"
                    >
                      {copy.cta}
                      <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title="Conecta la app del conductor">
        <p className="text-sm text-text-secondary">
          Tus conductores abren la app web (PWA) desde el teléfono y la instalan en
          la pantalla de inicio. Comparte este enlace o pídeles escanearlo:
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="break-all rounded-lg bg-canvas px-3 py-2 font-mono text-sm text-asfalto">
            {DRIVER_APP_URL}
          </code>
          <Button variant="secondary" icon={<Copy strokeWidth={2} />} onClick={copyUrl}>
            Copiar enlace
          </Button>
          <a
            href={DRIVER_APP_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-asfalto/25 bg-surface px-3 py-1.5 text-sm font-medium text-asfalto transition duration-200 ease-brand hover:bg-verde/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asfalto"
          >
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Abrir
          </a>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-text-tertiary">
          <QrCode aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span>
            Sugerencia: genera un QR de este enlace y pégalo en el depósito para que
            cada conductor lo escanee y agregue la app a su pantalla de inicio.
          </span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary">
            <Smartphone aria-hidden="true" className="h-3 w-3" strokeWidth={1.75} />
            Agregar a inicio (Android)
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary">
            <Smartphone aria-hidden="true" className="h-3 w-3" strokeWidth={1.75} />
            Agregar a inicio (iOS)
          </span>
        </div>
      </Card>
    </div>
  );
}
