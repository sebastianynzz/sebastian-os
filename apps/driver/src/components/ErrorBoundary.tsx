import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Límite de error de React para la PWA del conductor (Part 4 — manejo de
 * errores). Crítico offline: un fallo de render no debe dejar al conductor con
 * pantalla en blanco a mitad de ruta. Muestra un fallback en español con
 * reintento/recarga. Usa colores estándar (sin depender de tokens de tema).
 */

interface Props {
  children: ReactNode;
  area?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[ErrorBoundary${this.props.area ? ` ${this.props.area}` : ""}]`,
      error,
      info.componentStack,
    );
    const sentry = (window as unknown as {
      Sentry?: { captureException: (e: unknown) => void };
    }).Sentry;
    sentry?.captureException?.(error);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="m-4 rounded-xl border border-danger/30 bg-danger-bg p-5 text-center"
      >
        <h2 className="text-base font-bold text-danger">Algo salió mal</h2>
        <p className="mt-2 text-sm text-text-secondary dark:text-sky">
          Ocurrió un error inesperado. Toca Reintentar; si sigue, recarga la app.
          Tu trabajo pendiente queda guardado en este dispositivo.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-white/70 p-2 text-left text-xs text-danger">
          {error.message}
        </pre>
        <div className="mt-4 flex justify-center gap-2">
          <button
            onClick={this.reset}
            className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Reintentar
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg border border-border dark:border-white/10 px-4 py-2 text-sm font-semibold text-text-secondary dark:text-sky"
          >
            Recargar
          </button>
        </div>
      </div>
    );
  }
}
