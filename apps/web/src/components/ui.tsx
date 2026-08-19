import type { ReactNode } from "react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";

/*
 * Sistema de componentes base — daleGo, Paleta Circuito.
 *
 * Reglas de color que este archivo hace cumplir:
 *  - El VERDE es firma y acción: CTA primaria, ítem activo y estados
 *    terminales positivos CONFIRMADOS (entregado, completado, resuelto).
 *    Nunca contadores, alertas, severidad ni selección de fila.
 *  - El ROJO es exclusivo de error, emergencia y acciones destructivas.
 *  - El ÁMBAR es advertencia, y no se mezcla con el rojo.
 *  - Sin sombras: separación por color de superficie y borde de 1px.
 *  - Plecas y badges en rectángulo recto (radio 0); solo las barras de
 *    progreso y el punto ● son completamente redondeados.
 */

/** Pleca: 10px, weight 800, padding 2px 8px, radio 0 (manual). */
const PLECA_BASE =
  "inline-block whitespace-nowrap rounded-none px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em]";

// Estado terminal positivo confirmado = verde sólido con texto Asfalto. El
// resto usa fondo suave + texto de la misma familia semántica.
const ORDER_STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-canvas text-text-secondary",
  GEOCODED: "bg-info-bg text-info",
  ASSIGNED: "bg-info-bg text-info",
  IN_TRANSIT: "bg-warning-bg text-warning",
  DELIVERED: "bg-verde text-asfalto",
  FAILED: "bg-danger-bg text-danger",
  REJECTED: "bg-danger-bg text-danger",
  CANCELLED: "bg-canvas text-text-tertiary",
  PLANNED: "bg-info-bg text-info",
  DISPATCHED: "bg-info-bg text-info",
  IN_PROGRESS: "bg-warning-bg text-warning",
  COMPLETED: "bg-verde text-asfalto",
  OPEN: "bg-danger-bg text-danger",
  ACKNOWLEDGED: "bg-warning-bg text-warning",
  RESOLVED: "bg-verde text-asfalto",
  FALSE_ALARM: "bg-canvas text-text-secondary",
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
      className={`${PLECA_BASE} ${ORDER_STATUS_STYLES[status] ?? "bg-canvas text-text-secondary"}`}
    >
      {ORDER_STATUS_LABELS[status] ?? status}
    </span>
  );
}

/** Badge genérico con tono semántico (fondo suave + texto de la misma familia). */
const BADGE_TONES: Record<string, string> = {
  neutral: "bg-canvas text-text-secondary",
  success: "bg-verde text-asfalto",
  info: "bg-info-bg text-info",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "info" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <span
      className={`${PLECA_BASE} ${BADGE_TONES[tone]}`}
    >
      {children}
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
    <div className="rounded-xl border border-border bg-surface p-4 transition-colors duration-200 ease-brand hover:border-border-strong">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-text-primary">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Tarjeta KPI. `tone="hero"` = relleno Asfalto con la cifra en Gabarito y el
 * punto verde ● de cierre (manual). En tarjeta clara la cifra va en Asfalto, y
 * `accent` la pasa a Verde Profundo — nunca Verde Eléctrico sobre claro (1.54:1).
 */
export function KpiCard({
  label,
  value,
  hint,
  tone = "default",
  accent = false,
  active = false,
  onClick,
  className = "",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "hero";
  accent?: boolean;
  /** Cuando la tarjeta actúa de filtro: activa = rellena en navy. */
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const hero = tone === "hero" || active;
  const body = (
    <>
      <div
        className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
          hero ? "text-gris-senal" : "text-text-secondary"
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-1.5 flex items-baseline gap-1.5 font-display text-[26px] font-extrabold leading-none tracking-[-0.01em] ${
          hero ? "text-humo" : accent ? "text-success" : "text-text-primary"
        }`}
      >
        {value}
        {hero && (
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-verde" />
        )}
      </div>
      {hint && (
        <div className={`mt-1.5 text-xs ${hero ? "text-gris-senal" : "text-text-tertiary"}`}>
          {hint}
        </div>
      )}
    </>
  );
  const surface = `rounded-xl border p-4 transition-colors duration-200 ease-brand ${
    hero ? "border-asfalto bg-asfalto" : "border-border bg-surface"
  } ${className}`;
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`${surface} text-left hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`}
      >
        {body}
      </button>
    );
  }
  return <div className={surface}>{body}</div>;
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
        <h1 className="font-display text-[24px] font-extrabold tracking-[-0.02em] text-text-primary">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">{subtitle}</p>
        )}
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
  kind?: "info" | "success" | "error" | "warning";
  children: ReactNode;
  onDismiss?: () => void;
}) {
  // Manual: planos, borde izquierdo 3px del color semántico, sin sombra.
  const styles = {
    info: "border-l-info bg-info-bg text-info",
    success: "border-l-verde-profundo bg-success-bg text-success",
    error: "border-l-danger bg-danger-bg text-danger",
    warning: "border-l-warning bg-warning-bg text-warning",
  };
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`flex items-start justify-between gap-3 rounded-none border-l-[3px] px-3 py-2 text-sm ${styles[kind]}`}
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
      className="flex items-center justify-center gap-2 py-10 text-sm text-text-tertiary"
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-border-strong border-t-verde"
      />
      {label}
    </div>
  );
}

/**
 * Estado vacío cálido (tono Cercano): ícono opcional + título + mensaje + un CTA
 * + una frase de marca. `children` es el mensaje descriptivo.
 */
export function EmptyState({
  title,
  children,
  action,
  icon,
  phrase,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  phrase?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 py-10 text-center">
      {icon && (
        <div aria-hidden="true" className="mb-1 text-3xl text-text-tertiary">
          {icon}
        </div>
      )}
      {title && <p className="text-sm font-semibold text-text-primary">{title}</p>}
      <p className="max-w-md text-sm text-text-secondary">{children}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
      {phrase && <p className="mt-3 text-xs italic text-text-tertiary">{phrase}</p>}
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
        icon={<Lock aria-hidden="true" className="h-8 w-8" strokeWidth={1.75} />}
        title="Módulo no activo"
        phrase="El kilómetro final, resuelto ●"
        action={
          <Link
            to="/modulos"
            className="rounded-md bg-verde px-4 py-2 text-sm font-bold text-asfalto transition hover:bg-verde-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Ir a Módulos
          </Link>
        }
      >
        El módulo {moduleName} no está activo para su operación. Actívelo desde la
        página de Módulos.
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
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "cta" | "secondary" | "tertiary" | "danger";
  disabled?: boolean;
  className?: string;
  /** Ícono Lucide inicial (14px) — patrón del botón fantasma del revamp. */
  icon?: ReactNode;
}) {
  // Jerarquía Circuito: CTA = Verde Eléctrico + texto Asfalto, weight 700-800,
  // máximo una por página; primario = Asfalto (el caballo de batalla);
  // secundario = borde 1px; terciario = texto subrayado; peligro = Rojo Alerta,
  // reservado a acciones destructivas.
  const styles = {
    primary: "bg-asfalto text-humo hover:bg-asfalto-hover",
    cta: "bg-verde font-bold text-asfalto hover:bg-verde-hover",
    secondary:
      "bg-surface text-text-primary border border-border-strong hover:border-asfalto",
    tertiary:
      "bg-transparent text-text-primary underline underline-offset-[3px] hover:text-verde-profundo",
    danger: "bg-danger text-white hover:brightness-110",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition duration-200 ease-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {icon && (
        <span aria-hidden="true" className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}

/**
 * Pastilla de filtro de una sola fila (revamp): activa = navy relleno con texto
 * blanco; inactiva = blanca con borde. Siempre completamente redondeada.
 */
export function FilterPill({
  active = false,
  onClick,
  children,
  count,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition duration-200 ease-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
        active
          ? "bg-asfalto text-humo"
          : "border border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text-primary"
      }`}
    >
      {children}
      {count != null && (
        <span className={`text-[11px] font-bold tabular-nums ${active ? "text-humo" : "text-text-tertiary"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

/** Pastilla "En vivo" con punto limón pulsante, alimentada por el SSE. */
export function LivePill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-text-secondary">
      <span aria-hidden="true" className="h-2 w-2 animate-livepulse rounded-full bg-verde" />
      {children}
    </span>
  );
}

/** Interruptor tipo píldora: navy encendido, gris apagado. */
export function PillToggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-verde" : "bg-border-strong"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
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
      <span className="mb-1 block font-medium text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-asfalto focus:outline-none focus:ring-2 focus:ring-verde-profundo/30";

/* Estilos compartidos de tablas: mismo encabezado y filas en toda la app. */
/* Cabecera: 10px MAYÚSCULAS, tracking .12em, Gris Señal (manual, Tablas). */
export const theadRowClass =
  "border-b border-border text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary";
/* Fila activa: fondo suave + pleca izquierda Asfalto como SEGUNDO canal — la
   selección nunca se marca solo con color (auditoría D-07/D-08). */
export const tableRowClass =
  "border-b border-border/60 text-[13px] hover:bg-row-active";
/** Cabecera pegajosa para tablas con scroll (combinar con theadRowClass). */
export const stickyTheadClass = "sticky top-0 z-10 bg-surface";

/**
 * Capa base de superposición para modales/drawers: fondo oscurecido + bloqueo de
 * scroll + cierre con Escape. No atrapa el foco (suficiente para los flujos
 * actuales); endurecer en hardening si se requiere AA estricto.
 */
function Overlay({
  onClose,
  children,
  align,
}: {
  onClose: () => void;
  children: ReactNode;
  align: "center" | "right";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div
      className={`fixed inset-0 z-50 flex bg-asfalto/60 ${
        align === "center" ? "items-center justify-center p-4" : "justify-end"
      }`}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

/** Modal centrado: blanco, sombra suave, radio suave. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <Overlay onClose={onClose} align="center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85vh] w-[min(32rem,92vw)] flex-col rounded-xl border border-border bg-surface"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="font-display text-base font-extrabold text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="text-text-tertiary transition hover:text-text-primary"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-sm text-text-primary">
          {children}
        </div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </Overlay>
  );
}

/** Drawer lateral derecho para flujos de creación/edición. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <Overlay onClose={onClose} align="right">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-full w-[min(28rem,92vw)] flex-col border-l border-border bg-surface"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="font-display text-base font-extrabold text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="text-text-tertiary transition hover:text-text-primary"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-sm text-text-primary">
          {children}
        </div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </Overlay>
  );
}

export function formatEta(etaMin: number): string {
  const h = Math.floor(etaMin / 60);
  const m = etaMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
