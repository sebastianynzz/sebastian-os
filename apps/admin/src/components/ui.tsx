import type { ReactNode } from "react";

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      {title && (
        <h2 className="mb-3 text-sm font-semibold text-cielo">{title}</h2>
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
    primary: "bg-lima text-navy hover:brightness-95 font-semibold",
    secondary: "bg-white/10 text-niebla hover:bg-white/20",
    danger: "bg-danger text-white hover:brightness-110",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm transition disabled:opacity-50 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

const PLAN_STYLES: Record<string, string> = {
  FREE: "bg-white/10 text-cielo",
  PRO: "bg-lima/20 text-lima",
  ENTERPRISE: "bg-lima text-navy",
};
export function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PLAN_STYLES[plan] ?? "bg-white/10"}`}>
      {plan}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const ok = status === "ACTIVE";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
      }`}
    >
      {ok ? "Activo" : "Suspendido"}
    </span>
  );
}

export function Toggle({
  on,
  onClick,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${
        on ? "bg-lima" : "bg-white/20"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
          on ? "left-5.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

export const inputClass =
  "w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-niebla placeholder:text-white/30 focus:border-lima focus:outline-none";
