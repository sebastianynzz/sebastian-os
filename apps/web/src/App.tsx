import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import Login from "./pages/Login";
import Pedidos from "./pages/Pedidos";
import Planificacion from "./pages/Planificacion";
import Rutas from "./pages/Rutas";
import Conductores from "./pages/Conductores";
import Vehiculos from "./pages/Vehiculos";
import Cod from "./pages/Cod";
import Modulos from "./pages/Modulos";
import Ev from "./pages/Ev";
import Seguridad from "./pages/Seguridad";
import Analitica from "./pages/Analitica";

const NAV_ITEMS: { to: string; label: string; module?: string }[] = [
  { to: "/pedidos", label: "Pedidos" },
  { to: "/planificacion", label: "Planificación", module: "ROUTE_OPTIMIZATION" },
  { to: "/rutas", label: "Rutas" },
  { to: "/conductores", label: "Conductores" },
  { to: "/vehiculos", label: "Vehículos" },
  { to: "/cod", label: "Contra-entrega", module: "COD" },
  { to: "/ev", label: "Flota eléctrica", module: "EV_MANAGEMENT" },
  { to: "/seguridad", label: "Seguridad", module: "SAFETY" },
  { to: "/analitica", label: "Analítica", module: "ANALYTICS_PRO" },
  { to: "/modulos", label: "Módulos" },
];

function Shell() {
  const { session, loading, logout } = useAuth();

  if (loading) {
    return <div className="p-10 text-center text-slate-500">Cargando…</div>;
  }
  if (!session) return <Login />;

  const visibleNav = NAV_ITEMS.filter(
    (item) => !item.module || session.modules.includes(item.module),
  );

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <div className="text-lg font-bold text-indigo-700">MoveOS</div>
          <div className="mt-1 truncate text-xs text-slate-500">
            {session.tenant.name}
          </div>
        </div>
        <nav className="flex flex-col gap-1 p-2">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-slate-200 p-4 text-xs text-slate-500">
          <div className="mb-2 truncate">{session.user.name}</div>
          <button
            onClick={logout}
            className="text-indigo-600 hover:underline"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto p-6">
        <Routes>
          <Route path="/" element={<Navigate to="/pedidos" replace />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/planificacion" element={<Planificacion />} />
          <Route path="/rutas" element={<Rutas />} />
          <Route path="/conductores" element={<Conductores />} />
          <Route path="/vehiculos" element={<Vehiculos />} />
          <Route path="/cod" element={<Cod />} />
          <Route path="/ev" element={<Ev />} />
          <Route path="/seguridad" element={<Seguridad />} />
          <Route path="/analitica" element={<Analitica />} />
          <Route path="/modulos" element={<Modulos />} />
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
