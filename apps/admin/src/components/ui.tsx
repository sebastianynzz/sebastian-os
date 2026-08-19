import type { ReactNode } from "react";

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      {title && (
        <h2 className="mb-3 text-sm font-semibold text-gris-senal">{title}</h2>
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
    primary: "bg-verde text-asfalto hover:brightness-95 font-semibold",
    secondary: "bg-white/10 text-canvas hover:bg-white/20",
    danger: "bg-danger text-white hover:brightness-110",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

const PLAN_STYLES: Record<string, string> = {
  FREE: "bg-white/10 text-gris-senal",
  PRO: "bg-verde/20 text-verde",
  ENTERPRISE: "bg-verde text-asfalto",
};
export function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className={`rounded-none px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] ${PLAN_STYLES[plan] ?? "bg-white/10"}`}>
      {plan}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const ok = status === "ACTIVE";
  return (
    <span
      className={`rounded-none px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] ${
        ok ? "bg-verde/20 text-verde" : "bg-danger/20 text-danger"
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
        on ? "bg-verde" : "bg-white/20"
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
  "w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-canvas placeholder:text-white/30 focus:border-verde focus:outline-none";
