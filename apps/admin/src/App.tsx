import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import Login from "./pages/Login";
import Tenants from "./pages/Tenants";
import TenantDetail from "./pages/TenantDetail";
import Metricas from "./pages/Metricas";
import Flota from "./pages/Flota";
import Auditoria from "./pages/Auditoria";
import Flywheel from "./pages/Flywheel";
import Integraciones from "./pages/Integraciones";
import { Wordmark } from "./components/brand";

function Shell() {
  const { admin, loading, logout } = useAuth();

  if (loading) return <div className="p-10 text-center text-cielo">Cargando…</div>;
  if (!admin) return <Login />;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-white/10 bg-navy">
        <div className="border-b border-white/10 p-4">
          <div className="text-xl font-bold">
            <Wordmark size={24} className="text-humo" />
          </div>
          <div className="mt-1 text-xs text-cielo">Plataforma</div>
        </div>
        <nav className="flex flex-col gap-1 p-2">
          {[
            { to: "/tenants", label: "Tenants" },
            { to: "/flota", label: "Flota en sitio" },
            { to: "/flywheel", label: "Data flywheel" },
            { to: "/integraciones", label: "Integraciones" },
            { to: "/metricas", label: "Métricas" },
            { to: "/auditoria", label: "Auditoría" },
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? "bg-lima text-navy" : "text-cielo hover:bg-white/10"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-white/10 p-4 text-xs text-cielo">
          <div className="mb-2 truncate">{admin.name}</div>
          <button onClick={logout} className="text-niebla hover:underline">
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto p-6">
        <Routes>
          <Route path="/" element={<Navigate to="/tenants" replace />} />
          <Route path="/tenants" element={<Tenants />} />
          <Route path="/tenants/:id" element={<TenantDetail />} />
          <Route path="/flota" element={<Flota />} />
          <Route path="/flywheel" element={<Flywheel />} />
          <Route path="/integraciones" element={<Integraciones />} />
          <Route path="/metricas" element={<Metricas />} />
          <Route path="/auditoria" element={<Auditoria />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </AuthProvider>
  );
}
