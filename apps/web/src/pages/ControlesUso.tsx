import { useEffect, useState, type ReactNode } from "react";
import { Package, Rows3, Users } from "lucide-react";
import { api } from "../api";
import { Badge, Banner, Card, Loading, PageHeader } from "../components/ui";

/**
 * Controles › Uso y plan (Tier 3 §12): uso del mes actual frente a los límites
 * del plan, con banner de upsell al acercarse o superar un límite. La medición
 * es informativa (no bloquea la operación). Tenant-scoped.
 */

interface Usage {
  plan: string;
  month: string;
  usage: { ordersThisMonth: number; customProperties: number; drivers: number };
  limits: { ordersPerMonth: number; customProperties: number; drivers: number };
}

const UPSELL_PLAN: Record<string, string> = {
  FREE: "PRO",
  PRO: "ENTERPRISE",
};

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}
function near(used: number, limit: number): boolean {
  return limit > 0 && used / limit >= 0.8;
}

function Meter({
  label,
  icon,
  used,
  limit,
}: {
  label: string;
  icon: ReactNode;
  used: number;
  limit: number;
}) {
  const unlimited = limit < 0;
  const p = pct(used, limit);
  const over = limit > 0 && used >= limit;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-asfalto">
          <span aria-hidden="true" className="text-text-secondary [&>svg]:h-3.5 [&>svg]:w-3.5">
            {icon}
          </span>
          {label}
        </span>
        <span className="font-mono text-xs text-text-secondary">
          {used} {unlimited ? "· ilimitado" : `de ${limit}`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-canvas">
        <div
          className={`h-full rounded-full ${
            unlimited
              ? "bg-gris-senal"
              : over
                ? "bg-danger"
                : near(used, limit)
                  ? "bg-warning"
                  : "bg-verde"
          }`}
          style={{ width: unlimited ? "12%" : `${Math.max(p, 4)}%` }}
        />
      </div>
    </div>
  );
}

export default function ControlesUso() {
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setData(await api<Usage>("GET", "/usage"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el uso.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const anyNear =
    data !== null &&
    (near(data.usage.ordersThisMonth, data.limits.ordersPerMonth) ||
      near(data.usage.customProperties, data.limits.customProperties) ||
      near(data.usage.drivers, data.limits.drivers));
  const upsellTo = data ? UPSELL_PLAN[data.plan] : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Uso y plan"
        subtitle="Tu consumo del mes frente a los límites de tu plan. La medición no bloquea la operación; te avisamos cuando convenga mejorar el plan."
      />

      {error && (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      )}

      {data && anyNear && upsellTo && (
        <Banner kind="warning">
          Estás cerca del límite de tu plan <strong>{data.plan}</strong>. Mejora a{" "}
          <strong>{upsellTo}</strong> para ampliar pedidos, campos y conductores.
        </Banner>
      )}

      {data === null ? (
        <Card>
          <Loading label="Cargando uso…" />
        </Card>
      ) : (
        <Card
          title={`Plan ${data.plan}`}
          actions={
            <Badge tone="neutral">
              <span className="font-mono">{data.month}</span>
            </Badge>
          }
        >
          <div className="space-y-5">
            <Meter
              label="Pedidos este mes"
              icon={<Package strokeWidth={1.75} />}
              used={data.usage.ordersThisMonth}
              limit={data.limits.ordersPerMonth}
            />
            <Meter
              label="Campos personalizados"
              icon={<Rows3 strokeWidth={1.75} />}
              used={data.usage.customProperties}
              limit={data.limits.customProperties}
            />
            <Meter
              label="Conductores"
              icon={<Users strokeWidth={1.75} />}
              used={data.usage.drivers}
              limit={data.limits.drivers}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
