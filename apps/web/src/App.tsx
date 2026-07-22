import { useCallback, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  BarChart3,
  BatteryCharging,
  ChevronRight,
  LifeBuoy,
  MapPin,
  Menu,
  Package,
  Route as RouteIcon,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { api } from "./api";
import { AuthProvider, getImpersonatedBy, useAuth } from "./auth";
import { ToastProvider } from "./toast";
import { Loading } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import ControlesShell from "./components/ControlesShell";
import { useRealtimeReload } from "./realtime";
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
  /** Insignia numérica en vivo (p. ej. excepciones abiertas). */
  badge?: "exceptions";
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
  /** Ícono Lucide del grupo (14px, trazo 1.75 — lineamiento del revamp). */
  icon: LucideIcon;
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
    icon: Package,
    step: 1,
    defaultOpen: true,
    items: [
      // Cabina de pendientes / recuperación de entregas fallidas: el home del equipo.
      { to: "/excepciones", label: "Excepciones", badge: "exceptions" },
      { to: "/pedidos", label: "Pedidos" },
      { to: "/direcciones", label: "Direcciones" },
      { to: "/clientes", label: "Clientes" },
    ],
  },
  {
    // 2) Armar las rutas del día.
    id: "planificacion",
    label: "Planificación",
    icon: RouteIcon,
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
    icon: MapPin,
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
    icon: BatteryCharging,
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
    icon: BarChart3,
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
    icon: SlidersHorizontal,
    defaultOpen: false,
    items: [
      // Revamp 6a: los 14 enlaces planos viven ahora en el shell de Controles
      // (sub-nav agrupada Operación / Comunicación / Plataforma). El sidebar
      // principal solo conserva la puerta de entrada.
      { to: "/controles", label: "Controles", roles: ["ADMIN"] },
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
  // /modulos vive dentro del shell de Controles (grupo Configuración).
  if (group.id === "configuracion" && pathname === "/modulos") return true;
  return group.items.some(
    (i) => pathname === i.to || pathname.startsWith(i.to + "/"),
  );
}

/** Clase compartida de los enlaces de navegación (activo = limón con navy). */
function navLinkClass(isActive: boolean): string {
  return `flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition duration-200 ease-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lima ${
    isActive
      ? "bg-lima font-semibold text-navy"
      : "font-medium text-cielo hover:bg-white/10 hover:text-white"
  }`;
}

/**
 * Conteo de excepciones abiertas para la insignia del sidebar (revamp 1b),
 * alimentado por el mismo SSE que la página de Excepciones.
 */
function useExceptionsCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await api<{ items: unknown[] }>("GET", "/exceptions");
      setCount(res.items.length);
    } catch {
      // sin conteo: la insignia simplemente no se muestra
    }
  }, []);
  useRealtimeReload(["order", "safety", "telemetry"], load, { fallbackMs: 60_000 });
  return count;
}

/** Iniciales para el avatar (2 letras, navy con limón — revamp 5c). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : (parts[0]?.[1] ?? "");
  return (a + b).toUpperCase();
}

/** Insignia de excepciones abiertas junto al ítem del sidebar (revamp 1b). */
function ExceptionsNavBadge({ active }: { active: boolean }) {
  const count = useExceptionsCount();
  if (!count) return null;
  return (
    <span
      className={`rounded-full px-1.5 py-px text-[11px] font-bold ${
        active ? "bg-navy text-lima" : "bg-white/10 text-cielo"
      }`}
    >
      {count}
    </span>
  );
}

/** Aviso de sesión de soporte (impersonación), común a ambos layouts. */
function ImpersonationNotice({
  email,
  onLogout,
}: {
  email: string;
  onLogout: () => void;
}) {
  if (!getImpersonatedBy()) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-bg px-4 py-2 text-sm text-warning"
    >
      <span className="flex items-center gap-2">
        <LifeBuoy aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span>
          Sesión de soporte: actuando como <b>{email}</b> (operador: {getImpersonatedBy()},
          expira en ≤30 min)
        </span>
      </span>
      <button onClick={onLogout} className="shrink-0 font-bold underline">
        Salir
      </button>
    </div>
  );
}

function Shell() {
  const { session, loading, logout } = useAuth();
  const location = useLocation();
  // Qué grupos están desplegados (la "cascada"); se recuerda entre sesiones.
  const [openGroups, setOpenGroups] =
    useState<Record<string, boolean>>(loadOpenGroups);
  // En móvil la barra lateral se oculta tras un botón de menú.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (loading) {
    return <Loading label="Cargando su sesión…" />;
  }
  if (!session) return <Login />;

  const isClient = session.user.role === "CLIENT";

  // Portal de clientes (revamp 5c): chrome propio — barra superior blanca con
  // la marca del operador y pestañas, sin el sidebar de módulos del operador.
  if (isClient) {
    return (
      <div className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-navy focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Saltar al contenido
        </a>
        <header className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-border bg-surface px-4 py-3 md:px-6">
          <img src="/move-navy.svg" alt="move" className="h-5 w-auto" />
          <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
          <span className="hidden truncate text-[13px] font-semibold text-navy sm:block">
            Portal de clientes · {session.tenant.name}
          </span>
          <nav
            aria-label="Secciones del portal"
            className="ml-auto flex items-center gap-4 overflow-x-auto"
          >
            {CLIENT_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `whitespace-nowrap border-b-2 pb-0.5 text-xs transition duration-200 ease-brand ${
                    isActive
                      ? "border-lima font-semibold text-navy"
                      : "border-transparent text-text-tertiary hover:text-navy"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <span
            aria-hidden="true"
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-navy text-[10px] font-bold text-lima"
          >
            {initials(session.user.name)}
          </span>
          <button
            onClick={logout}
            className="shrink-0 text-xs text-text-secondary underline-offset-2 hover:text-navy hover:underline"
          >
            Cerrar sesión
          </button>
        </header>
        <main id="main" className="min-w-0 flex-1 p-4 md:p-6">
          <ImpersonationNotice email={session.user.email} onLogout={logout} />
          <ErrorBoundary key={location.pathname} area={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    );
  }

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
              {session.tenant.name}
            </div>
          </div>
          <div className="flex items-center gap-3 md:hidden">
            <button
              onClick={() => setMobileNavOpen((o) => !o)}
              aria-expanded={mobileNavOpen}
              aria-controls="sidebar-nav"
              className="rounded-lg px-2 py-1 leading-none text-white hover:bg-white/10"
            >
              <Menu aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
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
          {visibleGroups.map((group) => {
            // Abierto si el usuario lo dejó así (o por default) o si la ruta
            // activa vive dentro (para que siempre se vea dónde estás).
            const open =
              (openGroups[group.id] ?? group.defaultOpen) ||
              groupHasActive(group, location.pathname);
            const GroupIcon = group.icon;
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
                  <GroupIcon
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0"
                    strokeWidth={1.75}
                  />
                  <span className="flex-1 truncate">{group.label}</span>
                  <ChevronRight
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 transition-transform duration-200 ease-brand ${open ? "rotate-90" : ""}`}
                    strokeWidth={2}
                  />
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
                        className={({ isActive }) =>
                          navLinkClass(
                            isActive ||
                              (item.to === "/controles" &&
                                location.pathname === "/modulos"),
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <span className="min-w-0 truncate">{item.label}</span>
                            {item.badge === "exceptions" && (
                              <ExceptionsNavBadge active={isActive} />
                            )}
                          </>
                        )}
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
        <ImpersonationNotice email={session.user.email} onLogout={logout} />
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
          {/* Controles (revamp 6a): shell con sub-nav propia; incluye Módulos. */}
          <Route element={<ControlesShell />}>
            <Route
              path="/controles"
              element={<Navigate to="/controles/primeros-pasos" replace />}
            />
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
          </Route>
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
