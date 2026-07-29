import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  getToken,
  isImpersonating,
  refreshAccess,
  setImpersonationToken,
  setToken,
} from "./api";

interface Session {
  user: { id: string; name: string; email: string; role: string };
  tenant: { id: string; name: string; city: string };
  modules: string[];
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>(null!);

/**
 * Consola de soporte (A4): el panel de plataforma abre el dashboard con
 * #impersonar=<token de 30 min>. FRAGMENTO, no query string: el fragmento
 * nunca viaja en la petición HTTP, así el token no queda en logs del host
 * estático ni de proxies. Se guarda en sessionStorage (aislado por pestaña
 * — no pisa la sesión normal de otras pestañas) y se limpia de la URL.
 */
function adoptImpersonationToken(): void {
  const hash = window.location.hash;
  if (!hash.startsWith("#impersonar=")) return;
  const token = decodeURIComponent(hash.slice("#impersonar=".length));
  if (!token) return;
  setImpersonationToken(token);
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
}

/** Email del operador de plataforma si la sesión es de soporte (claim JWT). */
export function getImpersonatedBy(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(
      atob(part.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { impersonatedBy?: unknown };
    return typeof payload.impersonatedBy === "string"
      ? payload.impersonatedBy
      : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  adoptImpersonationToken();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Bootstrap tras recargar: el access token (en memoria) se perdió, así que
    // se intenta renovar con la cookie httpOnly de refresh antes de darse por
    // deslogueado. Si no hay sesión válida, queda en login.
    if (!getToken()) {
      const ok = await refreshAccess();
      if (!ok) {
        setSession(null);
        setLoading(false);
        return;
      }
    }
    try {
      const me = await api<Session>("GET", "/auth/me");
      setSession(me);
    } catch {
      setToken(null);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<{ token: string }>("POST", "/auth/login", {
        email,
        password,
      });
      setToken(res.token);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    // Logout real: revoca los JWT del usuario en el servidor (no solo limpia el
    // cliente). NO se revoca si la sesión activa es de impersonación — terminar
    // el soporte no debe cerrar las sesiones reales del usuario impersonado.
    if (!isImpersonating()) {
      try {
        await api("POST", "/auth/logout");
      } catch {
        /* mejor esfuerzo: si falla, igual limpiamos la sesión local */
      }
    }
    setToken(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
