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

// Panel de plataforma (un solo operador, sin gating por rol/módulo): pocas
// secciones, así que NO se usa una cascada colapsable como en el dashboard del
// despachador — solo iconos + orden por prioridad, agrupado en tres niveles:
//   1) Operación   — lo que se gestiona a diario (clientes + flota propia FaaS)
//   2) Inteligencia — los tableros de medición (salud + moat de datos)
//   3) Plataforma   — configuración y gobernanza (menos frecuente)
const NAV_SECTIONS: {
  label: string;
  items: { to: string; label: string; icon: string }[];
}[] = [
  {
    label: "Operación",
    items: [
      { to: "/tenants", label: "Tenants", icon: "🏢" },
      { to: "/flota", label: "Flota en sitio", icon: "🔋" },
    ],
  },
  {
    label: "Inteligencia",
    items: [
      { to: "/metricas", label: "Métricas", icon: "📊" },
      { to: "/flywheel", label: "Data flywheel", icon: "🔄" },
    ],
  },
  {
    label: "Plataforma",
    items: [
      { to: "/integraciones", label: "Integraciones", icon: "🔌" },
      { to: "/auditoria", label: "Auditoría", icon: "🛡️" },
    ],
  },
];

function Shell() {
  const { admin, loading, logout } = useAuth();

  if (loading) return <div className="p-10 text-center text-cielo">Cargando…</div>;
  if (!admin) return <Login />;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-white/10 bg-navy">
        <div className="border-b border-white/10 p-4">
          <div className="text-xl font-bold">
            <img src="/move-lime.svg" alt="move" className="h-6 w-auto" />
          </div>
          <div className="mt-1 text-xs text-cielo">Plataforma</div>
        </div>
        <nav aria-label="Secciones de la plataforma" className="flex flex-col gap-3 p-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="flex flex-col gap-0.5">
              <div className="px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-cielo/60">
                {section.label}
              </div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lima ${
                      isActive
                        ? "bg-lima text-navy"
                        : "text-cielo hover:bg-white/10 hover:text-white"
                    }`
                  }
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
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
