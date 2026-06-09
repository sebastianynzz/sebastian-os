import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import Login from "./pages/Login";
import Pedidos from "./pages/Pedidos";
import Clientes from "./pages/Clientes";
import Planificacion from "./pages/Planificacion";
import Rutas from "./pages/Rutas";
import Conductores from "./pages/Conductores";
import Vehiculos from "./pages/Vehiculos";
import MapaEnVivo from "./pages/MapaEnVivo";
import Modulos from "./pages/Modulos";
import Ev from "./pages/Ev";
import Seguridad from "./pages/Seguridad";
import Analitica from "./pages/Analitica";

const NAV_ITEMS: { to: string; label: string; module?: string }[] = [
  { to: "/pedidos", label: "Pedidos" },
  { to: "/clientes", label: "Clientes" },
  { to: "/planificacion", label: "Planificación", module: "ROUTE_OPTIMIZATION" },
  { to: "/rutas", label: "Rutas" },
  { to: "/mapa", label: "Mapa en vivo", module: "TELEMATICS" },
  { to: "/conductores", label: "Conductores" },
  { to: "/vehiculos", label: "Vehículos" },
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
      <aside className="flex w-56 shrink-0 flex-col bg-navy">
        <div className="border-b border-white/10 p-4">
          <div className="text-xl font-bold text-white">
            move<span className="text-lima">.</span>
          </div>
          <div className="mt-1 truncate text-xs text-cielo">
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
                    ? "bg-lima text-navy"
                    : "text-cielo hover:bg-white/10 hover:text-white"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-white/10 p-4 text-xs text-cielo">
          <div className="mb-2 truncate">{session.user.name}</div>
          <button onClick={logout} className="text-white hover:underline">
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto p-6">
        <Routes>
          <Route path="/" element={<Navigate to="/pedidos" replace />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/planificacion" element={<Planificacion />} />
          <Route path="/rutas" element={<Rutas />} />
          <Route path="/conductores" element={<Conductores />} />
          <Route path="/vehiculos" element={<Vehiculos />} />
          <Route path="/mapa" element={<MapaEnVivo />} />
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
