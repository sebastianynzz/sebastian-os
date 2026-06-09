import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { Loading } from "./components/ui";
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
    return <Loading label="Cargando su sesión…" />;
  }
  if (!session) return <Login />;

  const visibleNav = NAV_ITEMS.filter(
    (item) => !item.module || session.modules.includes(item.module),
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* En pantallas pequeñas la barra lateral se vuelve barra superior. */}
      <aside className="flex shrink-0 flex-col bg-navy md:w-56">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4 md:block">
          <div className="min-w-0">
            <div className="text-xl font-bold text-white">
              move<span className="text-lima">.</span>
            </div>
            <div className="mt-1 truncate text-xs text-cielo">
              {session.tenant.name}
            </div>
          </div>
          <button
            onClick={logout}
            className="text-xs text-white underline-offset-2 hover:underline md:hidden"
          >
            Cerrar sesión
          </button>
        </div>
        <nav
          aria-label="Secciones de la plataforma"
          className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible"
        >
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lima ${
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
        <div className="mt-auto hidden border-t border-white/10 p-4 text-xs text-cielo md:block">
          <div className="mb-2 truncate">{session.user.name}</div>
          <button
            onClick={logout}
            className="text-white underline-offset-2 hover:underline"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">
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
