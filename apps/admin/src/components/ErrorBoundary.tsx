import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Límite de error de React (Part 4 — manejo de errores). Evita la "pantalla en
 * blanco" del panel de plataforma: si una vista falla al renderizar, muestra un
 * fallback en español con reintento/recarga. Listo para Sentry.
 */

interface Props {
  children: ReactNode;
  area?: string;
  fallback?: (reset: () => void, error: Error) => ReactNode;
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
    if (this.props.fallback) return this.props.fallback(this.reset, error);

    return (
      <div
        role="alert"
        className="mx-auto mt-10 max-w-lg rounded-xl border border-danger/30 bg-danger-bg p-6 text-center"
      >
        <h2 className="text-lg font-bold text-danger">Algo salió mal</h2>
        <p className="mt-2 text-sm text-navy/70">
          Ocurrió un error inesperado en el panel. Puedes reintentar o recargar
          la página.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-white/70 p-2 text-left text-xs text-danger">
          {error.message}
        </pre>
        <div className="mt-4 flex justify-center gap-2">
          <button
            onClick={this.reset}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            Reintentar
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg border border-cielo px-4 py-2 text-sm font-semibold text-navy hover:bg-niebla"
          >
            Recargar la página
          </button>
        </div>
      </div>
    );
  }
}
