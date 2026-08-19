import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import { api } from "../api";

/*
 * Shell de Controles (revamp 6a): sub-nav blanca de 230px agrupada por
 * intención (Operación / Comunicación / Plataforma) con estado de configuración
 * por ítem — punto verde = configurado, "—" = sin configurar, pastillas con
 * conteo/porcentaje donde aporta ("3 de 5", "82%"). Reemplaza los 14 enlaces
 * planos del grupo Configuración del sidebar principal.
 *
 * El estado se calcula best-effort con los mismos GET que ya usan las páginas
 * (tenant-scoped, solo ADMIN llega aquí); si una llamada falla, el ítem
 * simplemente no muestra indicador.
 */

type ItemStatus =
  | { kind: "configured" }
  | { kind: "pending" }
  | { kind: "pill"; text: string; tone: "warning" | "neutral" }
  | { kind: "count"; n: number };

interface SubItem {
  to: string;
  label: string;
  /** Clave del estado calculado en `useControlesStatus`. */
  statusKey?: string;
}

const GROUPS: { label: string; items: SubItem[] }[] = [
  {
    label: "Operación",
    items: [
      { to: "/controles/primeros-pasos", label: "Primeros pasos", statusKey: "onboarding" },
      { to: "/controles/servicios", label: "Servicios", statusKey: "services" },
      { to: "/controles/depositos", label: "Depósitos", statusKey: "depots" },
      { to: "/controles/zonas", label: "Zonas", statusKey: "zones" },
      { to: "/controles/costos", label: "Costos", statusKey: "cost" },
      { to: "/controles/prueba-entrega", label: "Prueba de entrega", statusKey: "pod" },
      { to: "/controles/campos", label: "Campos personalizados", statusKey: "fields" },
      { to: "/controles/permisos-conductor", label: "Permisos de conductor", statusKey: "permissions" },
    ],
  },
  {
    label: "Comunicación",
    items: [
      { to: "/controles/seguimiento", label: "Seguimiento público", statusKey: "tracking" },
      { to: "/controles/notificaciones", label: "Notificaciones", statusKey: "notifications" },
      { to: "/controles/integraciones", label: "Integraciones", statusKey: "integrations" },
    ],
  },
  {
    label: "Plataforma",
    items: [
      { to: "/modulos", label: "Módulos" },
      { to: "/controles/uso", label: "Uso y plan", statusKey: "usage" },
      { to: "/controles/facturacion", label: "Facturación" },
    ],
  },
];

function arrayLen(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** Carga best-effort del estado de configuración de cada sección. */
function useControlesStatus(): Record<string, ItemStatus> {
  const [status, setStatus] = useState<Record<string, ItemStatus>>({});

  useEffect(() => {
    let cancelled = false;
    const configuredIf = (ok: boolean): ItemStatus =>
      ok ? { kind: "configured" } : { kind: "pending" };

    const tasks: [string, () => Promise<ItemStatus>][] = [
      [
        "onboarding",
        async () => {
          const r = await api<{ completed: number; total: number }>(
            "GET",
            "/onboarding/checklist",
          );
          return r.completed >= r.total
            ? { kind: "configured" }
            : { kind: "pill", text: `${r.completed} de ${r.total}`, tone: "warning" };
        },
      ],
      ["services", async () => configuredIf(arrayLen(await api("GET", "/services")) > 0)],
      ["depots", async () => configuredIf(arrayLen(await api("GET", "/depots")) > 0)],
      [
        "zones",
        async () => {
          const n = arrayLen(await api("GET", "/zones"));
          return n > 0 ? { kind: "count", n } : { kind: "pending" };
        },
      ],
      [
        "cost",
        async () => {
          const r = await api<{ driverCostPerHourCop: number; energyTariffCop: number }>(
            "GET",
            "/controls/cost",
          );
          return configuredIf(r.driverCostPerHourCop > 0 || r.energyTariffCop > 0);
        },
      ],
      ["pod", async () => (await api("GET", "/controls/pod-policy"), { kind: "configured" })],
      [
        "fields",
        async () => {
          const r = await api<{ items?: unknown[] }>("GET", "/custom-properties");
          return configuredIf(arrayLen(r.items) > 0);
        },
      ],
      [
        "permissions",
        async () => (await api("GET", "/controls/driver-permissions"), { kind: "configured" }),
      ],
      ["tracking", async () => (await api("GET", "/controls/tracking"), { kind: "configured" })],
      [
        "notifications",
        async () => {
          const r = await api<{ enabled?: boolean }[]>("GET", "/controls/notifications");
          return configuredIf(Array.isArray(r) && r.some((t) => t.enabled));
        },
      ],
      [
        "integrations",
        async () => configuredIf(arrayLen(await api("GET", "/developer/webhooks")) > 0),
      ],
      [
        "usage",
        async () => {
          const r = await api<{
            usage: Record<string, number>;
            limits: Record<string, number>;
          }>("GET", "/usage");
          let max = 0;
          for (const [key, used] of Object.entries(r.usage)) {
            const limit = r.limits[key] ?? -1;
            if (limit > 0) max = Math.max(max, Math.round((used / limit) * 100));
          }
          return {
            kind: "pill",
            text: `${Math.min(max, 100)}%`,
            tone: max >= 80 ? "warning" : "neutral",
          };
        },
      ],
    ];

    void Promise.allSettled(
      tasks.map(async ([key, run]) => {
        const value = await run();
        if (!cancelled) setStatus((prev) => ({ ...prev, [key]: value }));
      }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}

function StatusIndicator({ status, active }: { status?: ItemStatus; active: boolean }) {
  if (!status) return null;
  if (status.kind === "count") {
    return active ? (
      <span className="ml-auto text-[10px] font-bold">{status.n}</span>
    ) : (
      <span aria-label="Configurado" className="ml-auto h-1.5 w-1.5 rounded-full bg-olive" />
    );
  }
  if (status.kind === "configured") {
    return (
      <span aria-label="Configurado" className="ml-auto h-1.5 w-1.5 rounded-full bg-olive" />
    );
  }
  if (status.kind === "pending") {
    return (
      <span aria-label="Sin configurar" className="ml-auto text-[10px] text-border-strong">
        —
      </span>
    );
  }
  return (
    <span
      className={`ml-auto rounded-full px-1.5 py-px text-[10px] font-semibold ${
        status.tone === "warning"
          ? "bg-warning-bg text-warning"
          : "bg-canvas text-text-tertiary"
      }`}
    >
      {status.text}
    </span>
  );
}

export default function ControlesShell() {
  const status = useControlesStatus();

  const item = (it: SubItem) => (
    <NavLink
      key={it.to}
      to={it.to}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] transition duration-200 ease-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asfalto ${
          isActive
            ? "bg-verde font-semibold text-asfalto"
            : "text-text-secondary hover:bg-canvas hover:text-asfalto"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className="min-w-0 flex-1 truncate">{it.label}</span>
          <StatusIndicator
            status={it.statusKey ? status[it.statusKey] : undefined}
            active={isActive}
          />
        </>
      )}
    </NavLink>
  );

  return (
    <div className="-m-4 flex flex-col md:-m-6 md:min-h-[calc(100%+3rem)] md:flex-row">
      <aside className="flex shrink-0 flex-col gap-3.5 border-b border-border bg-surface p-3 pt-4 md:min-h-full md:w-[230px] md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-1.5">
          <SlidersHorizontal aria-hidden="true" className="h-[15px] w-[15px] text-asfalto" strokeWidth={1.75} />
          <span className="text-sm font-semibold text-asfalto">Controles</span>
          <span className="ml-auto rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold text-text-tertiary">
            ADMIN
          </span>
        </div>
        {GROUPS.map((group) => (
          <div key={group.label}>
            <div className="mb-1 px-1.5 text-[10px] font-semibold uppercase tracking-[.06em] text-text-tertiary">
              {group.label}
            </div>
            <div className="flex flex-col gap-px">{group.items.map(item)}</div>
          </div>
        ))}
        <span className="mt-auto hidden px-1.5 text-[10.5px] text-text-tertiary md:block">
          <span aria-hidden="true" className="text-olive">
            ●
          </span>{" "}
          verde = configurado · — = sin configurar
        </span>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
