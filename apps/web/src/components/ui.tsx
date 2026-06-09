import type { ReactNode } from "react";

const ORDER_STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-700",
  GEOCODED: "bg-blue-100 text-blue-700",
  ASSIGNED: "bg-indigo-100 text-indigo-700",
  IN_TRANSIT: "bg-amber-100 text-amber-700",
  DELIVERED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-700",
  REJECTED: "bg-red-100 text-red-700",
  CANCELLED: "bg-slate-200 text-slate-500",
  PLANNED: "bg-blue-100 text-blue-700",
  DISPATCHED: "bg-indigo-100 text-indigo-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  COLLECTED: "bg-amber-100 text-amber-700",
  SETTLED: "bg-emerald-100 text-emerald-700",
  DISCREPANCY: "bg-red-100 text-red-700",
  OPEN: "bg-red-100 text-red-700",
  RESOLVED: "bg-emerald-100 text-emerald-700",
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
  COLLECTED: "Recaudado",
  SETTLED: "Liquidado",
  DISCREPANCY: "Descuadre",
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
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-sm font-semibold text-slate-700">{title}</h2>}
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
  const styles = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
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
  "w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none";

export function formatCop(amount: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatEta(etaMin: number): string {
  const h = Math.floor(etaMin / 60);
  const m = etaMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
