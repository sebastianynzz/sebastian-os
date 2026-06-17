import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError } from "./api";

type ToastKind = "error" | "success" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  retry?: () => void;
}

interface ToastApi {
  success: (message: string) => void;
  info: (message: string) => void;
  /** Muestra un error (tipado o no) con mensaje claro y reintento opcional. */
  error: (err: unknown, opts?: { retry?: () => void; fallback?: string }) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}

/**
 * Traduce un error del API a un mensaje claro en español (tono Claro/Cercano/
 * Profesional). Centraliza los casos tipados: módulo no activo, conflicto de
 * estado (409), sesión vencida (401) y red caída.
 */
export function describeApiError(
  err: unknown,
  fallback = "Algo salió mal. Intenta de nuevo.",
): string {
  if (err instanceof ApiError) {
    if (err.code === "MODULE_NOT_ENABLED")
      return "Este módulo no está activo en tu plan.";
    if (err.status === 409)
      return "El recurso cambió de estado. Actualizamos la vista; vuelve a intentar.";
    if (err.status === 401) return "Tu sesión expiró. Ingresa de nuevo.";
    if (err.status === 0 || err.message === "Error de red")
      return "Sin conexión. Revisa tu internet e intenta de nuevo.";
    return err.message; // 4xx con mensaje útil del servidor (validación, etc.)
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

const KIND_STYLES: Record<ToastKind, string> = {
  error: "border-danger bg-danger-bg text-danger",
  success: "border-lima bg-lima/10 text-navy",
  info: "border-cielo bg-cielo/10 text-navy",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    [],
  );

  const push = useCallback(
    (kind: ToastKind, message: string, retry?: () => void) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, kind, message, retry }]);
      // Éxito/info se autodescartan; un error persiste hasta cerrarse o
      // reintentarse — un fallo no debe desaparecer sin que el usuario lo vea.
      if (kind !== "error") setTimeout(() => remove(id), 4500);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push("success", message),
      info: (message) => push("info", message),
      error: (err, opts) =>
        push("error", describeApiError(err, opts?.fallback), opts?.retry),
    }),
    [push],
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-3 sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto w-full max-w-sm rounded-lg border-l-4 px-3 py-2 text-sm shadow-md ${KIND_STYLES[t.kind]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <span>{t.message}</span>
              <button
                onClick={() => remove(t.id)}
                aria-label="Cerrar aviso"
                className="shrink-0 font-bold opacity-60 hover:opacity-100"
              >
                ✕
              </button>
            </div>
            {t.retry && (
              <button
                onClick={() => {
                  const retry = t.retry!;
                  remove(t.id);
                  retry();
                }}
                className="mt-1 font-semibold underline"
              >
                Reintentar
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
