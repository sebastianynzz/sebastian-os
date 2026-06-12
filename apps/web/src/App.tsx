import {
  BrowserRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { AuthProvider, getImpersonatedBy, useAuth } from "./auth";
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
import Sostenibilidad from "./pages/Sostenibilidad";
import Track from "./pages/Track";
import Excepciones from "./pages/Excepciones";
import Direcciones from "./pages/Direcciones";
import Copilot from "./pages/Copilot";
import PortalResumen from "./pages/PortalResumen";
import PortalPedidos from "./pages/PortalPedidos";
import PortalNuevoEnvio from "./pages/PortalNuevoEnvio";
import PortalVerde from "./pages/PortalVerde";

const NAV_ITEMS: { to: string; label: string; module?: string }[] = [
  { to: "/excepciones", label: "Excepciones" },
  { to: "/pedidos", label: "Pedidos" },
  { to: "/direcciones", label: "Direcciones" },
  { to: "/copiloto", label: "Copiloto IA", module: "AI_ADDONS" },
  { to: "/clientes", label: "Clientes" },
  { to: "/planificacion", label: "Planificación", module: "ROUTE_OPTIMIZATION" },
  { to: "/rutas", label: "Rutas" },
  { to: "/mapa", label: "Mapa en vivo", module: "TELEMATICS" },
  { to: "/conductores", label: "Conductores" },
  { to: "/vehiculos", label: "Vehículos" },
  // Flota eléctrica: núcleo EV-only, siempre visible (restricción dura 1.3).
  { to: "/ev", label: "Flota eléctrica" },
  { to: "/seguridad", label: "Seguridad", module: "SAFETY" },
  { to: "/analitica", label: "Analítica", module: "ANALYTICS_PRO" },
  { to: "/sostenibilidad", label: "Sostenibilidad", module: "ANALYTICS_PRO" },
  { to: "/modulos", label: "Módulos" },
];

/** Portal de clientes (rol CLIENT): navegación propia, sin plano operativo. */
const CLIENT_NAV: { to: string; label: string }[] = [
  { to: "/portal/resumen", label: "Resumen" },
  { to: "/portal/envios", label: "Mis envíos" },
  { to: "/portal/nuevo", label: "Nuevo envío" },
  { to: "/portal/verde", label: "Informe verde" },
];

function Shell() {
  const { session, loading, logout } = useAuth();

  if (loading) {
    return <Loading label="Cargando su sesión…" />;
  }
  if (!session) return <Login />;

  const isClient = session.user.role === "CLIENT";
  const visibleNav = isClient
    ? CLIENT_NAV
    : NAV_ITEMS.filter(
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
              {isClient ? "Portal de clientes" : session.tenant.name}
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
        {/* Sesión de soporte: visible siempre, para que nadie opere "como
            tenant" sin que se note. La emisión quedó en PlatformAuditLog. */}
        {getImpersonatedBy() && (
          <div
            role="status"
            className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          >
            <span>
              🛟 Sesión de soporte: actuando como <b>{session.user.email}</b>{" "}
              (operador: {getImpersonatedBy()}, expira en ≤30 min)
            </span>
            <button onClick={logout} className="shrink-0 font-bold underline">
              Salir
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}

/** Inicio según cuenta: portal para CLIENT, cockpit de excepciones para el equipo. */
function Home() {
  const { session } = useAuth();
  return (
    <Navigate
      to={session?.user.role === "CLIENT" ? "/portal/resumen" : "/excepciones"}
      replace
    />
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Rastreo público: sin login, fuera del shell autenticado. */}
        <Route path="/t/:token" element={<Track />} />
        {/* Dashboard autenticado: Shell es el layout (sidebar + Outlet). */}
        <Route
          element={
            <AuthProvider>
              <Shell />
            </AuthProvider>
          }
        >
          <Route path="/" element={<Home />} />
          <Route path="/excepciones" element={<Excepciones />} />
          <Route path="/direcciones" element={<Direcciones />} />
          <Route path="/copiloto" element={<Copilot />} />
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
          <Route path="/sostenibilidad" element={<Sostenibilidad />} />
          <Route path="/modulos" element={<Modulos />} />
          {/* Portal de clientes (rol CLIENT). */}
          <Route path="/portal/resumen" element={<PortalResumen />} />
          <Route path="/portal/envios" element={<PortalPedidos />} />
          <Route path="/portal/nuevo" element={<PortalNuevoEnvio />} />
          <Route path="/portal/verde" element={<PortalVerde />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
