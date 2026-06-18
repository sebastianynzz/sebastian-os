import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
          <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-niebla">
            <div
              className="h-full rounded-full bg-lima"
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
                  className="flex items-center justify-between gap-3 rounded-lg border border-niebla p-3"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        s.done
                          ? "bg-success-bg text-success"
                          : "bg-niebla text-navy/40"
                      }`}
                      aria-hidden="true"
                    >
                      {s.done ? "✓" : ""}
                    </span>
                    <div className="min-w-0">
                      <div
                        className={`font-medium ${s.done ? "text-navy/50 line-through" : "text-navy"}`}
                      >
                        {copy.label}
                      </div>
                      <div className="text-xs text-navy/50">{copy.description}</div>
                    </div>
                  </div>
                  {!s.done && (
                    <Link
                      to={copy.to}
                      className="shrink-0 rounded-lg bg-navy px-3 py-1.5 text-sm font-medium text-white hover:brightness-110"
                    >
                      {copy.cta}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title="Conecta la app del conductor">
        <p className="text-sm text-navy/70">
          Tus conductores abren la app web (PWA) desde el teléfono y la instalan en
          la pantalla de inicio. Comparte este enlace o pídeles escanearlo:
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-niebla px-3 py-2 text-sm text-navy">
            {DRIVER_APP_URL}
          </code>
          <Button variant="secondary" onClick={copyUrl}>
            Copiar enlace
          </Button>
          <a
            href={DRIVER_APP_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-navy/30 px-3 py-1.5 text-sm font-medium text-navy hover:bg-niebla"
          >
            Abrir
          </a>
        </div>
        <p className="mt-3 text-xs text-navy/50">
          Sugerencia: genera un QR de este enlace y pégalo en el depósito para que
          cada conductor lo escanee y agregue la app a su pantalla de inicio.
        </p>
        <div className="mt-3 flex gap-2 text-xs text-navy/40">
          <span className="rounded border border-niebla px-2 py-1">
            📱 Agregar a inicio (Android)
          </span>
          <span className="rounded border border-niebla px-2 py-1">
            📱 Agregar a inicio (iOS)
          </span>
        </div>
      </Card>
    </div>
  );
}
