import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Límite de error de React (Part 4 — manejo de errores). Evita la "pantalla en
 * blanco": si una vista lanza al renderizar, muestra un fallback en español con
 * reintento/recarga en vez de tumbar toda la app. Se coloca alrededor del
 * contenido enrutado (clave por ruta, para reiniciarse al navegar) y como red
 * final en la raíz. Listo para Sentry: reporta el error si está configurado.
 */

interface Props {
  children: ReactNode;
  /** Etiqueta del área protegida (para el log). */
  area?: string;
  /** Fallback personalizado (si no, usa el genérico). */
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
    // Observabilidad: log a consola (y a Sentry cuando esté configurado).
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
          Ocurrió un error inesperado en esta sección. Puedes reintentar o
          recargar la página. Si persiste, avisa al equipo.
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
