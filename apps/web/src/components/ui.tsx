import type { ReactNode } from "react";
import { Link } from "react-router-dom";

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
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_STYLES[status] ?? "bg-niebla text-navy/70"}`}
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-navy">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

/** Encabezado estándar de página: título, subtítulo y acciones alineadas. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-navy">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-navy/60">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Aviso en línea para errores, confirmaciones e información. */
export function Banner({
  kind = "info",
  children,
  onDismiss,
}: {
  kind?: "info" | "success" | "error";
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const styles = {
    info: "border-cielo bg-cielo/20 text-navy",
    success: "border-lima bg-lima/25 text-navy",
    error: "border-red-200 bg-red-50 text-red-700",
  };
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${styles[kind]}`}
    >
      <span>
        {kind === "success" && <span aria-hidden="true">✓ </span>}
        {children}
      </span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Cerrar aviso"
          className="shrink-0 font-bold opacity-50 hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
}

/** Indicador de carga consistente para todas las páginas. */
export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-10 text-sm text-navy/50"
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-cielo border-t-navy"
      />
      {label}
    </div>
  );
}

/** Estado vacío con mensaje y acción opcional para guiar el siguiente paso. */
export function EmptyState({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="py-8 text-center text-sm text-navy/50">
      <p>{children}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/** Pantalla de módulo inactivo con acceso directo a su activación. */
export function ModuleDisabled({
  title,
  moduleName,
}: {
  title: string;
  moduleName: string;
}) {
  return (
    <Card title={title}>
      <EmptyState
        action={
          <Link
            to="/modulos"
            className="rounded-lg bg-lima px-4 py-2 text-sm font-semibold text-navy hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
          >
            Ir a Módulos
          </Link>
        }
      >
        El módulo {moduleName} no está activo para su operación. Actívelo desde
        la página de Módulos.
      </EmptyState>
    </Card>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  className?: string;
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
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
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
      <span className="mb-1 block font-medium text-navy/70">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-cielo bg-white px-3 py-1.5 text-sm text-navy placeholder:text-navy/35 focus:border-navy focus:outline-none focus:ring-2 focus:ring-cielo/50";

/* Estilos compartidos de tablas: mismo encabezado y filas en toda la app. */
export const theadRowClass =
  "border-b border-cielo/40 text-left text-xs uppercase tracking-wide text-navy/50";
export const tableRowClass = "border-b border-niebla";

export function formatEta(etaMin: number): string {
  const h = Math.floor(etaMin / 60);
  const m = etaMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
