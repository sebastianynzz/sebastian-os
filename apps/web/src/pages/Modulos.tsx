import { useEffect, useState } from "react";
import {
  BarChart3,
  BatteryCharging,
  FileCheck2,
  Lock,
  MapPin,
  MessageSquare,
  Puzzle,
  Route,
  Shield,
  ShieldCheck,
  Snowflake,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { moduleName } from "@moveos/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Banner, Loading, PageHeader } from "../components/ui";

interface ModuleInfo {
  key: string;
  nombre: string;
  descripcion: string;
  enabled: boolean;
  /** Módulo de núcleo (p. ej. flota eléctrica): siempre activo, no togglable. */
  core?: boolean;
  /** Otros módulos que este requiere (se activan en cascada). */
  requires?: string[];
}

/**
 * Capacidades del núcleo que no son módulos del catálogo: siempre incluidas.
 * Los módulos `core: true` (p. ej. gestión de flota eléctrica — EV-only, la
 * autonomía y la carga jamás se venden aparte) se añaden desde los datos.
 */
const CORE_CAPABILITIES = [
  "Pedidos",
  "Despacho",
  "App conductor",
  "Tracking público",
  "POD",
  "Notificaciones",
];

/** Ícono Lucide por módulo del catálogo (emoji prohibido en el revamp). */
const MODULE_ICONS: Record<string, LucideIcon> = {
  ROUTE_OPTIMIZATION: Route,
  TELEMATICS: MapPin,
  EV_MANAGEMENT: BatteryCharging,
  SAFETY: ShieldCheck,
  COMPLIANCE_RNDC: FileCheck2,
  CUSTOMER_EXPERIENCE_PRO: MessageSquare,
  ANALYTICS_PRO: BarChart3,
  AI_ADDONS: Sparkles,
  COLD_CHAIN: Snowflake,
};

/**
 * Interruptor limón estilo iOS del mock 5b: pista 34×19 (limón encendido),
 * perilla blanca de 15px, anillo de foco navy.
 */
function LimeSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-[19px] w-[34px] shrink-0 rounded-full transition duration-200 ease-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-lima" : "bg-border"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-[2px] top-[2px] h-[15px] w-[15px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-200 ease-brand ${
          checked ? "translate-x-[15px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/**
 * La pantalla insignia del producto: módulos que se activan y desactivan
 * como interruptores. El menú lateral y las APIs reaccionan al instante.
 * Revamp 5b: banda de núcleo (sin switches) + grilla de addons con
 * dependencias legibles. Activar enciende dependencias en cascada (contrato
 * del backend); solo el apagado con dependientes se bloquea (409 de respaldo).
 */
export default function Modulos() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const { refresh, session } = useAuth();
  const isAdmin = session?.user.role === "ADMIN";

  async function load() {
    try {
      setModules(await api<ModuleInfo[]>("GET", "/modules"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function toggle(key: string, enabled: boolean) {
    try {
      await api("PATCH", `/modules/${key}`, { enabled });
      await load();
      await refresh(); // el menú lateral se actualiza
    } catch (err) {
      // Respaldo: si aun así llega un bloqueo por dependencia (409), el toast
      // lo explica. No reintentamos — reactivar el switch es trivial.
      toast.error(err);
    }
  }

  const enabledByKey = new Map(modules.map((m) => [m.key, m.enabled]));
  const coreModules = modules.filter((m) => m.core === true);
  const addons = modules.filter((m) => m.core !== true);
  const coreList = [...CORE_CAPABILITIES, ...coreModules.map((m) => m.nombre)];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Módulos de la plataforma"
        subtitle="Activa solo lo que tu operación necesita · cada módulo se factura por separado"
      />
      {!isAdmin && (
        <Banner kind="info">Solo el rol ADMIN puede cambiar módulos.</Banner>
      )}
      {loading && <Loading label="Cargando módulos…" />}

      {!loading && (
        <>
          {/* Banda de núcleo: siempre incluido, sin switches. */}
          <div className="flex items-center gap-3 rounded-lg bg-navy px-4 py-3.5">
            <Shield
              aria-hidden="true"
              className="h-[18px] w-[18px] shrink-0 text-lima"
              strokeWidth={2}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-white">
                Núcleo — siempre incluido
              </div>
              <div className="text-xs text-cielo">{coreList.join(" · ")}</div>
            </div>
            <span className="shrink-0 rounded-full bg-lima/90 px-3 py-[3px] text-[11.5px] font-bold text-navy">
              Incluido
            </span>
          </div>

          {/* Grilla de addons. */}
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {addons.map((m) => {
              const Icon = MODULE_ICONS[m.key] ?? Puzzle;
              const requires = m.requires ?? [];
              // Dependencia apagada: el backend la enciende EN CASCADA al
              // activar este módulo (contrato de PATCH /modules/:key), así que
              // el switch queda operable y la dependencia se explica en línea.
              const missingDeps = requires.filter(
                (dep) => !(enabledByKey.get(dep) ?? false),
              );
              const lockedOff = !m.enabled && missingDeps.length > 0;
              // Al revés: otro módulo encendido depende de este → tampoco se
              // puede apagar (el 409 del backend queda como respaldo).
              const dependents = addons
                .filter((o) => o.enabled && (o.requires ?? []).includes(m.key))
                .map((o) => o.nombre);
              const lockedOn = m.enabled && dependents.length > 0;
              return (
                <div
                  key={m.key}
                  className={`flex flex-col gap-2 rounded-lg bg-surface p-3.5 ${
                    lockedOff
                      ? "border border-dashed border-border-strong"
                      : "border border-border"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      aria-hidden="true"
                      className={`h-4 w-4 shrink-0 ${
                        lockedOff ? "text-text-tertiary" : "text-navy"
                      }`}
                      strokeWidth={2}
                    />
                    <span
                      className={`flex-1 text-[13.5px] font-semibold ${
                        lockedOff ? "text-text-tertiary" : "text-navy"
                      }`}
                    >
                      {m.nombre}
                    </span>
                    <LimeSwitch
                      checked={m.enabled}
                      disabled={!isAdmin || lockedOn}
                      label={`${m.enabled ? "Desactivar" : "Activar"} ${m.nombre}`}
                      onChange={() => toggle(m.key, !m.enabled)}
                    />
                  </div>
                  <p
                    className={`text-xs leading-normal ${
                      lockedOff ? "text-text-tertiary" : "text-text-secondary"
                    }`}
                  >
                    {m.descripcion}
                  </p>
                  {requires.length > 0 && (
                    <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-tertiary">
                      Requiere
                      {requires.map((dep) => (
                        <span
                          key={dep}
                          className="rounded-full bg-sky-50 px-2 py-px font-semibold text-info"
                        >
                          {moduleName(dep)}
                          {(enabledByKey.get(dep) ?? false) ? " ✓" : ""}
                        </span>
                      ))}
                    </span>
                  )}
                  {lockedOff && (
                    <span className="text-[11px] text-text-tertiary">
                      Al activarlo se activará también{" "}
                      {missingDeps.map(moduleName).join(" y ")} (en cascada)
                    </span>
                  )}
                  {lockedOn && (
                    <span className="text-[11px] text-text-tertiary">
                      Requerido por {dependents.join(" y ")} — desactívalo
                      primero
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <p className="flex items-center gap-1.5 text-[11.5px] text-text-tertiary">
            <Lock aria-hidden="true" className="h-3 w-3 shrink-0" strokeWidth={2} />
            Solo el rol ADMIN cambia módulos · el menú lateral y las APIs
            reaccionan al instante.
          </p>
        </>
      )}
    </div>
  );
}
