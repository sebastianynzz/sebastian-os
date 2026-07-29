import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, getToken, refreshAccess, setToken } from "./api";

interface Admin {
  id: string;
  email: string;
  name: string;
}

interface AuthContextValue {
  admin: Admin | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Bootstrap tras recargar: el access token (memoria) se perdió; intentar
    // renovar con la cookie httpOnly de refresh antes de darse por deslogueado.
    if (!getToken()) {
      const ok = await refreshAccess();
      if (!ok) {
        setAdmin(null);
        setLoading(false);
        return;
      }
    }
    try {
      const me = await api<{ admin: Admin }>("GET", "/auth/me");
      setAdmin(me.admin);
    } catch {
      setToken(null);
      setAdmin(null);
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
    // Borra la cookie httpOnly de refresh en el servidor, luego limpia memoria.
    try {
      await api("POST", "/auth/logout");
    } catch {
      /* mejor esfuerzo */
    }
    setToken(null);
    setAdmin(null);
  }, []);

  return (
    <AuthContext.Provider value={{ admin, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
