import { useState } from "react";
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
import ControlesUso from "./pages/ControlesUso";
import ControlesFacturacion from "./pages/ControlesFacturacion";
import ControlesOnboarding from "./pages/ControlesOnboarding";
import PortalResumen from "./pages/PortalResumen";
import PortalPedidos from "./pages/PortalPedidos";
import PortalNuevoEnvio from "./pages/PortalNuevoEnvio";
import PortalVerde from "./pages/PortalVerde";

// `module` oculta tras una entitlement de pago; `roles` restringe por rol
// (refleja la autorización real del API — p. ej. la configuración del tenant es
// solo de ADMIN, así que el DISPATCHER no debe ver esa sección).
type NavItem = {
  to: string;
  label: string;
  module?: string;
  roles?: string[];
};

// La navegación del equipo se organiza como una "cascada": grupos colapsables
// ordenados según el flujo real del día de un despachador —
//   1) Pedidos que entran → 2) Planificación de rutas → 3) Operación en vivo →
//   4) Flota → 5) Análisis— y, al final y colapsada, la Configuración (solo
// ADMIN), que no es trabajo del día a día. Cada grupo reúne solo lo que se usa
// junto, así la barra lateral queda corta y fácil de recorrer. Un grupo que se
// queda sin ítems visibles (por rol o módulo) no se dibuja: el DISPATCHER, por
// ejemplo, solo ve los 5 grupos operativos, nunca "Configuración".
type NavGroup = {
  id: string;
  label: string;
  icon: string;
  /** Número de etapa (refuerza el orden de la operación). Sin número = ajustes. */
  step?: number;
  /** Estado inicial de expansión antes de que el usuario lo cambie. */
  defaultOpen: boolean;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    // 1) Lo que entra: pedidos por procesar + el contexto para hacerlo bien.
    id: "pedidos",
    label: "Pedidos",
    icon: "📦",
    step: 1,
    defaultOpen: true,
    items: [
      // Cabina de pendientes / recuperación de entregas fallidas: el home del equipo.
      { to: "/excepciones", label: "Excepciones" },
      { to: "/pedidos", label: "Pedidos" },
      { to: "/direcciones", label: "Direcciones" },
      { to: "/clientes", label: "Clientes" },
    ],
  },
  {
    // 2) Armar las rutas del día.
    id: "planificacion",
    label: "Planificación",
    icon: "🗺️",
    step: 2,
    defaultOpen: true,
    items: [
      { to: "/planificacion", label: "Planificación", module: "ROUTE_OPTIMIZATION" },
      { to: "/rutas", label: "Rutas" },
    ],
  },
  {
    // 3) La operación en la calle: seguir, vigilar y pedir ayuda al copiloto.
    id: "en-vivo",
    label: "En vivo",
    icon: "📍",
    step: 3,
    defaultOpen: true,
    items: [
      { to: "/mapa", label: "Mapa en vivo", module: "TELEMATICS" },
      { to: "/seguridad", label: "Seguridad", module: "SAFETY" },
      { to: "/copiloto", label: "Copiloto IA", module: "AI_ADDONS" },
    ],
  },
  {
    // 4) Los recursos de la operación: quién y con qué se entrega.
    id: "flota",
    label: "Flota",
    icon: "🔋",
    step: 4,
    defaultOpen: true,
    items: [
      { to: "/conductores", label: "Conductores" },
      { to: "/vehiculos", label: "Vehículos" },
      // Flota eléctrica: núcleo EV-only, siempre visible (restricción dura 1.3).
      { to: "/ev", label: "Flota eléctrica" },
    ],
  },
  {
    // 5) Resultados: qué pasó y cuánto se ahorró.
    id: "analisis",
    label: "Análisis",
    icon: "📊",
    step: 5,
    defaultOpen: false,
    items: [
      { to: "/analitica", label: "Analítica", module: "ANALYTICS_PRO" },
      { to: "/sostenibilidad", label: "Sostenibilidad", module: "ANALYTICS_PRO" },
    ],
  },
  {
    // Ajustes del tenant (solo ADMIN): setup que no es del día a día. Va al final
    // y colapsado para no estorbar a quien despacha.
    id: "configuracion",
    label: "Configuración",
    icon: "⚙️",
    defaultOpen: false,
    items: [
      // Primeros pasos (onboarding guiado): checklist del tenant.
      { to: "/controles/primeros-pasos", label: "Primeros pasos", roles: ["ADMIN"] },
      // Servicios (promesas de entrega + SLA): catálogo de tenant.
      { to: "/controles/servicios", label: "Servicios", roles: ["ADMIN"] },
      // Depósitos (multi-depot): centros de salida/regreso de rutas.
      { to: "/controles/depositos", label: "Depósitos", roles: ["ADMIN"] },
      // Zonas de entrega: polígonos + conductores asignados.
      { to: "/controles/zonas", label: "Zonas", roles: ["ADMIN"] },
      // Costos (energía-nativo): parámetros del costo por entrega.
      { to: "/controles/costos", label: "Costos", roles: ["ADMIN"] },
      // Seguimiento público (privacidad del rastreo B2B).
      { to: "/controles/seguimiento", label: "Seguimiento", roles: ["ADMIN"] },
      // Notificaciones B2B por evento (motor de notificaciones).
      { to: "/controles/notificaciones", label: "Notificaciones", roles: ["ADMIN"] },
      // Prueba de entrega (POD por tipo): configuración de tenant.
      { to: "/controles/prueba-entrega", label: "Prueba de entrega", roles: ["ADMIN"] },
      // Campos personalizados de parada (Tier 2 §9): datos extra por pedido.
      { to: "/controles/campos", label: "Campos personalizados", roles: ["ADMIN"] },
      // Permisos de la app del conductor (Tier 2 §10): navegación + edición de rutas.
      { to: "/controles/permisos-conductor", label: "Permisos de conductor", roles: ["ADMIN"] },
      // Integraciones (webhooks + API keys, plataforma de desarrolladores).
      { to: "/controles/integraciones", label: "Integraciones", roles: ["ADMIN"] },
      // Uso y plan (Tier 3 §12): consumo del mes vs límites del plan + upsell.
      { to: "/controles/uso", label: "Uso y plan", roles: ["ADMIN"] },
      // Facturación (Tier 3 §13): datos fiscales + historial de facturas.
      { to: "/controles/facturacion", label: "Facturación", roles: ["ADMIN"] },
      // Módulos = entitlements/facturación: el API exige ADMIN para alternarlos.
      { to: "/modulos", label: "Módulos", roles: ["ADMIN"] },
    ],
  },
];

/** Portal de clientes (rol CLIENT): navegación propia, sin plano operativo. */
const CLIENT_NAV: NavItem[] = [
  { to: "/portal/resumen", label: "Resumen" },
  { to: "/portal/envios", label: "Mis envíos" },
  { to: "/portal/nuevo", label: "Nuevo envío" },
  { to: "/portal/verde", label: "Informe verde" },
];

const NAV_STORAGE_KEY = "moveos.nav.openGroups";

/** Estado inicial de expansión: lo persistido por el usuario o el default del grupo. */
function loadOpenGroups(): Record<string, boolean> {
  const base = Object.fromEntries(NAV_GROUPS.map((g) => [g.id, g.defaultOpen]));
  try {
    const raw = localStorage.getItem(NAV_STORAGE_KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Record<string, boolean>) };
  } catch {
    /* localStorage no disponible: usar defaults */
  }
  return base;
}

/** ¿La ruta activa vive dentro de este grupo? (para forzarlo abierto). */
function groupHasActive(group: NavGroup, pathname: string): boolean {
  return group.items.some(
    (i) => pathname === i.to || pathname.startsWith(i.to + "/"),
  );
}

/** Clase compartida de los enlaces de navegación (activo = limón sobre navy). */
function navLinkClass(isActive: boolean): string {
  return `block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lima ${
    isActive
      ? "bg-lima text-navy"
      : "text-cielo hover:bg-white/10 hover:text-white"
  }`;
}

function Shell() {
  const { session, loading, logout } = useAuth();
  const location = useLocation();
  // Qué grupos están desplegados (la "cascada"); se recuerda entre sesiones.
  const [openGroups, setOpenGroups] =
    useState<Record<string, boolean>>(loadOpenGroups);
  // En móvil la barra lateral se oculta tras un botón de menú (☰).
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (loading) {
    return <Loading label="Cargando su sesión…" />;
  }
  if (!session) return <Login />;

  const isClient = session.user.role === "CLIENT";
  // Filtra ítems por módulo + rol y descarta grupos que quedan vacíos, de modo
  // que cada cuenta ve solo su pipeline (el DISPATCHER no ve "Configuración").
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.module || session.modules.includes(item.module)) &&
        (!item.roles || item.roles.includes(session.user.role)),
    ),
  })).filter((group) => group.items.length > 0);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const fallback = NAV_GROUPS.find((g) => g.id === id)?.defaultOpen ?? true;
      const next = { ...prev, [id]: !(prev[id] ?? fallback) };
      try {
        localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* sin persistencia si localStorage no está disponible */
      }
      return next;
    });
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* a11y: saltar el nav e ir directo al contenido (visible al enfocar con teclado). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-navy focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Saltar al contenido
      </a>
      {/* En pantallas pequeñas la barra lateral se vuelve barra superior con menú. */}
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
          <div className="flex items-center gap-3 md:hidden">
            <button
              onClick={() => setMobileNavOpen((o) => !o)}
              aria-expanded={mobileNavOpen}
              aria-controls="sidebar-nav"
              className="rounded-lg px-2 py-1 text-lg leading-none text-white hover:bg-white/10"
            >
              <span aria-hidden="true">☰</span>
              <span className="sr-only">Menú de navegación</span>
            </button>
            <button
              onClick={logout}
              className="text-xs text-white underline-offset-2 hover:underline"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
        <nav
          id="sidebar-nav"
          aria-label="Secciones de la plataforma"
          className={`${mobileNavOpen ? "flex" : "hidden"} flex-col gap-1 p-2 md:flex`}
        >
          {isClient
            ? CLIENT_NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  {item.label}
                </NavLink>
              ))
            : visibleGroups.map((group) => {
                // Abierto si el usuario lo dejó así (o por default) o si la ruta
                // activa vive dentro (para que siempre se vea dónde estás).
                const open =
                  (openGroups[group.id] ?? group.defaultOpen) ||
                  groupHasActive(group, location.pathname);
                return (
                  <div key={group.id} className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      aria-expanded={open}
                      aria-controls={`navgroup-${group.id}`}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-cielo/80 transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lima"
                    >
                      {group.step != null && (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-cielo">
                          {group.step}
                        </span>
                      )}
                      <span aria-hidden="true">{group.icon}</span>
                      <span className="flex-1 truncate">{group.label}</span>
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                      >
                        <path
                          fillRule="evenodd"
                          d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                    {open && (
                      <div
                        id={`navgroup-${group.id}`}
                        className="mb-1 ml-3 flex flex-col gap-0.5 border-l border-white/10 pl-2"
                      >
                        {group.items.map((item) => (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            onClick={() => setMobileNavOpen(false)}
                            className={({ isActive }) => navLinkClass(isActive)}
                          >
                            {item.label}
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
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
          <Route path="/controles/uso" element={<ControlesUso />} />
          <Route path="/controles/facturacion" element={<ControlesFacturacion />} />
          <Route path="/controles/primeros-pasos" element={<ControlesOnboarding />} />
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
