import {
  BrowserRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AuthProvider, getImpersonatedBy, useAuth } from "./auth";
import { ToastProvider } from "./toast";import { Loading } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
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
import ControlesPod from "./pages/ControlesPod";
import ControlesServicios from "./pages/ControlesServicios";
import ControlesDepots from "./pages/ControlesDepots";
import ControlesZonas from "./pages/ControlesZonas";
import ControlesCostos from "./pages/ControlesCostos";
import ControlesSeguimiento from "./pages/ControlesSeguimiento";
import ControlesNotificaciones from "./pages/ControlesNotificaciones";
import ControlesIntegraciones from "./pages/ControlesIntegraciones";
import ControlesCampos from "./pages/ControlesCampos";
import ControlesPermisos from "./pages/ControlesPermisos";
import PortalResumen from "./pages/PortalResumen";
import PortalPedidos from "./pages/PortalPedidos";
import PortalNuevoEnvio from "./pages/PortalNuevoEnvio";
import PortalVerde from "./pages/PortalVerde";

// `module` oculta tras una entitlement de pago; `roles` restringe por rol
// (refleja la autorización real del API — p. ej. activar/desactivar módulos es
// solo de ADMIN, así que el DISPATCHER no debe ver esa sección).
const NAV_ITEMS: {
  to: string;
  label: string;
  module?: string;
  roles?: string[];
}[] = [
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
  // Servicios (promesas de entrega + SLA): catálogo de tenant, solo ADMIN.
  { to: "/controles/servicios", label: "Servicios", roles: ["ADMIN"] },
  // Depósitos (multi-depot): centros de salida/regreso de rutas, solo ADMIN.
  { to: "/controles/depositos", label: "Depósitos", roles: ["ADMIN"] },
  // Zonas de entrega: polígonos + conductores asignados, solo ADMIN.
  { to: "/controles/zonas", label: "Zonas", roles: ["ADMIN"] },
  // Costos (energía-nativo): parámetros del costo por entrega, solo ADMIN.
  { to: "/controles/costos", label: "Costos", roles: ["ADMIN"] },
  // Seguimiento público (privacidad del rastreo B2B), solo ADMIN.
  { to: "/controles/seguimiento", label: "Seguimiento", roles: ["ADMIN"] },
  // Notificaciones B2B por evento (motor de notificaciones), solo ADMIN.
  { to: "/controles/notificaciones", label: "Notificaciones", roles: ["ADMIN"] },
  // Integraciones (webhooks + API keys, plataforma de desarrolladores), solo ADMIN.
  { to: "/controles/integraciones", label: "Integraciones", roles: ["ADMIN"] },
  // Campos personalizados de parada (Tier 2 §9): datos extra por pedido, solo ADMIN.
  { to: "/controles/campos", label: "Campos personalizados", roles: ["ADMIN"] },
  // Permisos de la app del conductor (Tier 2 §10): navegación + edición de rutas, solo ADMIN.
  { to: "/controles/permisos-conductor", label: "Permisos de conductor", roles: ["ADMIN"] },
  // Prueba de entrega (POD por tipo): configuración de tenant, solo ADMIN.
  { to: "/controles/prueba-entrega", label: "Prueba de entrega", roles: ["ADMIN"] },
  // Módulos = entitlements/facturación: el API exige ADMIN para alternarlos.
  { to: "/modulos", label: "Módulos", roles: ["ADMIN"] },
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
  const location = useLocation();

  if (loading) {
    return <Loading label="Cargando su sesión…" />;
  }
  if (!session) return <Login />;

  const isClient = session.user.role === "CLIENT";
  const visibleNav = isClient
    ? CLIENT_NAV
    : NAV_ITEMS.filter(
        (item) =>
          (!item.module || session.modules.includes(item.module)) &&
          (!item.roles || item.roles.includes(session.user.role)),
      );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* a11y: saltar el nav e ir directo al contenido (visible al enfocar con teclado). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-navy focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Saltar al contenido
      </a>
      {/* En pantallas pequeñas la barra lateral se vuelve barra superior. */}
      <aside className="flex shrink-0 flex-col bg-navy md:w-56">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4 md:block">
          <div className="min-w-0">
            <div className="text-xl font-bold text-white">
              <img src="/move-lime.svg" alt="move" className="h-6 w-auto" />
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
      <main id="main" className="min-w-0 flex-1 p-4 md:p-6">
        {/* Sesión de soporte: visible siempre, para que nadie opere "como
            tenant" sin que se note. La emisión quedó en PlatformAuditLog. */}
        {getImpersonatedBy() && (
          <div
            role="status"
            className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-bg px-4 py-2 text-sm text-warning"
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
        {/* Límite de error por ruta: una vista que falle no tumba el shell, y
            se reinicia al navegar (key por ruta). */}
        <ErrorBoundary key={location.pathname} area={location.pathname}>
          <Outlet />
        </ErrorBoundary>
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
      <ToastProvider>
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
          <Route path="/controles/servicios" element={<ControlesServicios />} />
          <Route path="/controles/depositos" element={<ControlesDepots />} />
          <Route path="/controles/zonas" element={<ControlesZonas />} />
          <Route path="/controles/costos" element={<ControlesCostos />} />
          <Route path="/controles/seguimiento" element={<ControlesSeguimiento />} />
          <Route path="/controles/notificaciones" element={<ControlesNotificaciones />} />
          <Route path="/controles/integraciones" element={<ControlesIntegraciones />} />
          <Route path="/controles/campos" element={<ControlesCampos />} />
          <Route path="/controles/permisos-conductor" element={<ControlesPermisos />} />
          <Route path="/controles/prueba-entrega" element={<ControlesPod />} />
          {/* Portal de clientes (rol CLIENT). */}
          <Route path="/portal/resumen" element={<PortalResumen />} />
          <Route path="/portal/envios" element={<PortalPedidos />} />
          <Route path="/portal/nuevo" element={<PortalNuevoEnvio />} />
          <Route path="/portal/verde" element={<PortalVerde />} />
        </Route>
      </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
