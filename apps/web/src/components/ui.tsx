import type { ReactNode } from "react";

const ORDER_STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-niebla text-navy/70",
  GEOCODED: "bg-cielo/40 text-navy",
  ASSIGNED: "bg-cielo/70 text-navy",
  IN_TRANSIT: "bg-amber-100 text-amber-700",
  DELIVERED: "bg-lima/60 text-navy",
  FAILED: "bg-red-100 text-red-700",
  REJECTED: "bg-red-100 text-red-700",
  CANCELLED: "bg-niebla text-navy/50",
  PLANNED: "bg-cielo/40 text-navy",
  DISPATCHED: "bg-cielo/70 text-navy",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  COMPLETED: "bg-lima/60 text-navy",
  OPEN: "bg-red-100 text-red-700",
  RESOLVED: "bg-lima/60 text-navy",
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  GEOCODED: "Geocodificado",
  ASSIGNED: "Asignado",
  IN_TRANSIT: "En camino",
  DELIVERED: "Entregado",
  FAILED: "Fallido",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado",
  PLANNED: "Planificada",
  DISPATCHED: "Despachada",
  IN_PROGRESS: "En curso",
  COMPLETED: "Completada",
  OPEN: "Abierta",
  ACKNOWLEDGED: "Atendida",
  RESOLVED: "Resuelta",
  FALSE_ALARM: "Falsa alarma",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700"}`}
    >
      {ORDER_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Card({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-cielo/40 bg-white p-4 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-sm font-semibold text-navy">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  // Botones según manual Move: lima (acento) y cielo sobre fondos claros.
  const styles = {
    primary: "bg-lima text-navy hover:brightness-95 font-semibold",
    secondary: "bg-white text-navy border border-cielo hover:bg-niebla",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-cielo px-3 py-1.5 text-sm focus:border-navy focus:outline-none";

export function formatEta(etaMin: number): string {
  const h = Math.floor(etaMin / 60);
  const m = etaMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
