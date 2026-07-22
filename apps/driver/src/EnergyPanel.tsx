import { useEffect, useState } from "react";
import {
  Check,
  PlugZap,
  TriangleAlert,
  Warehouse,
  X,
  Zap,
} from "lucide-react";
import { estimateUsableRangeKm } from "@moveos/optimizer";
import { haversineKm, URBAN_DETOUR_FACTOR } from "@moveos/shared";
import { api } from "./api";
import { navLinks } from "./nav";

/**
 * Energía del conductor (núcleo EV-only):
 *
 * D7 — "¿alcanza la batería?": SoC en vivo y comparación entre la autonomía
 * útil (estimateUsableRangeKm: SoC + margen de seguridad) y los kilómetros
 * que faltan de ruta. Un conductor jamás debe descubrir a mitad de ruta que
 * no llega.
 *
 * D8 — cargador más cercano: top 3 del directorio (red pública + depósito)
 * con deeplink a Waze/Google Maps. El último resultado se guarda en
 * localStorage para que el botón sirva incluso sin señal.
 */

const CHARGERS_CACHE_KEY = "moveos_driver_chargers";

export interface EnergyVehicle {
  plate: string;
  isElectric: boolean;
  batteryKwh: number | null;
  nominalRangeKm: number | null;
  socPercent: number | null;
}

interface ChargingStation {
  id: string;
  name: string;
  network: string;
  address: string | null;
  lat: number;
  lng: number;
  connectors: string[];
  powerKw: number | null;
  dcFast: boolean;
  isDepot: boolean;
  distanceKm: number | null;
}

/**
 * Km que faltan: posición actual → paradas pendientes en orden → depósito.
 * Usa el MISMO modelo vial que el optimizador (@moveos/shared:
 * haversine × URBAN_DETOUR_FACTOR) — si los factores divergieran, el
 * banner podría decir "alcanza" cuando el planificador dice que no.
 */
export function remainingRouteKm(
  from: { lat: number; lng: number } | null,
  pendingStops: { lat: number; lng: number }[],
  depot: { lat: number; lng: number } | null,
): number {
  const path = [...pendingStops];
  if (depot) path.push(depot);
  if (path.length === 0) return 0;
  let km = 0;
  let prev = from ?? path[0]!;
  for (const point of path) {
    km += haversineKm(prev, point);
    prev = point;
  }
  return km * URBAN_DETOUR_FACTOR;
}

export function RangeBanner({
  vehicle,
  remainingKm,
  onFindCharger,
}: {
  vehicle: EnergyVehicle;
  remainingKm: number;
  onFindCharger: () => void;
}) {
  if (!vehicle.isElectric || vehicle.nominalRangeKm === null) return null;

  const needKm = Math.max(1, Math.round(remainingKm));

  // Sin telemetría de SoC NO se asume batería llena: una falsa confianza
  // ("alcanza") es exactamente lo que D7 existe para evitar.
  if (vehicle.socPercent === null) {
    return (
      <div
        role="status"
        className="rounded-xl border border-warning/25 bg-warning-bg px-3.5 py-3 text-warning shadow-soft dark:border-[#e8b96a]/40 dark:bg-warning/20 dark:text-[#e8b96a]"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[13.5px] font-semibold">
            <TriangleAlert size={15} strokeWidth={2} aria-hidden />
            Batería sin telemetría
          </span>
          <button
            onClick={onFindCharger}
            className="-my-2 min-h-11 shrink-0 text-xs font-semibold underline underline-offset-[3px]"
          >
            Cargadores
          </button>
        </div>
        <div className="mt-1 text-xs">
          Confirma la carga del vehículo antes de salir — faltan ~{needKm} km de
          ruta.
        </div>
      </div>
    );
  }

  const soc = vehicle.socPercent;
  const usableKm = estimateUsableRangeKm({
    nominalRangeKm: vehicle.nominalRangeKm,
    socPercent: soc,
  });
  const enough = usableKm >= remainingKm;

  if (enough) {
    // Veredicto positivo (7a): tarjeta con tinte limón y "alcanza" explícito.
    return (
      <div
        role="status"
        className="rounded-xl border border-success/25 bg-success-bg px-3.5 py-3 shadow-soft dark:border-lima/40 dark:bg-lima/14"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-success dark:text-lima">
            <Zap size={15} fill="currentColor" strokeWidth={0} aria-hidden />
            Batería {Math.round(soc)}% · ~{Math.round(usableKm)} km útiles
          </span>
          <span className="shrink-0 text-[11.5px] text-text-secondary dark:text-sky">
            faltan ~{needKm} km
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-navy dark:text-[#dfe5ec]">
            <Check
              size={13}
              strokeWidth={2.5}
              aria-hidden
              className="text-success dark:text-lima"
            />
            Alcanza para terminar la ruta
          </span>
          <button
            onClick={onFindCharger}
            className="-my-2 min-h-11 shrink-0 text-xs font-semibold text-success underline underline-offset-[3px] dark:text-lima"
          >
            Cargadores
          </button>
        </div>
      </div>
    );
  }

  // Veredicto negativo (7c): el déficit toma la pantalla — barra de rango con
  // marcador de lo necesario y botón directo al cargador más cercano.
  const scale = Math.max(usableKm, remainingKm) * 1.15 || 1;
  const fillPct = Math.min(100, Math.round((usableKm / scale) * 100));
  const markerPct = Math.min(98, Math.round((remainingKm / scale) * 100));

  return (
    <div
      role="status"
      className="rounded-xl border border-danger/30 bg-danger-bg px-3.5 py-3 shadow-soft dark:border-[#c65454]/50 dark:bg-danger/16"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-danger dark:text-[#ff9d9d]">
          <Zap size={15} fill="currentColor" strokeWidth={0} aria-hidden />
          Batería {Math.round(soc)}% · ~{Math.round(usableKm)} km útiles
        </span>
        <span className="shrink-0 text-[11.5px] text-danger/80 dark:text-[#e8a8a8]">
          faltan ~{needKm} km
        </span>
      </div>
      <div
        aria-hidden
        className="relative mt-2 h-[7px] overflow-hidden rounded-full bg-navy/10 dark:bg-white/10"
      >
        <span
          className="block h-full bg-danger dark:bg-[#c65454]"
          style={{ width: `${fillPct}%` }}
        />
        <span
          title="necesario para terminar"
          className="absolute inset-y-0 w-0.5 bg-navy/60 dark:bg-niebla/60"
          style={{ left: `${markerPct}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-danger dark:text-[#ff9d9d]">
          Necesitas cargar antes de terminar
        </span>
        <button
          onClick={onFindCharger}
          className="min-h-11 shrink-0 rounded-[10px] bg-danger px-3 text-xs font-bold text-white dark:bg-[#c65454]"
        >
          Cargador más cercano
        </button>
      </div>
    </div>
  );
}

/**
 * Fichas de energía (7c, EV-only): kWh restantes en batería y lo que queda de
 * ruta (paradas + km + regreso). Nunca combustible — energía como unidad.
 */
export function EnergyTiles({
  vehicle,
  remainingKm,
  pendingStops,
}: {
  vehicle: EnergyVehicle;
  remainingKm: number;
  pendingStops: number;
}) {
  if (!vehicle.isElectric) return null;
  const kwhLeft =
    vehicle.batteryKwh !== null && vehicle.socPercent !== null
      ? (vehicle.batteryKwh * vehicle.socPercent) / 100
      : null;
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl border border-border bg-white p-3 shadow-soft dark:border-sky/18 dark:bg-navy-700">
        <div className="text-[10.5px] text-text-tertiary dark:text-sky/70">
          Energía en batería
        </div>
        <div className="text-lg font-semibold text-navy dark:text-niebla">
          {kwhLeft !== null ? kwhLeft.toFixed(1) : "—"}{" "}
          <span className="text-[11px] font-normal text-text-tertiary dark:text-sky/70">
            kWh
          </span>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-white p-3 shadow-soft dark:border-sky/18 dark:bg-navy-700">
        <div className="text-[10.5px] text-text-tertiary dark:text-sky/70">
          Paradas restantes
        </div>
        <div className="text-lg font-semibold text-navy dark:text-niebla">
          {pendingStops}{" "}
          <span className="text-[11px] font-normal text-text-tertiary dark:text-sky/70">
            · ~{Math.max(1, Math.round(remainingKm))} km + regreso
          </span>
        </div>
      </div>
    </div>
  );
}

export function ChargerSheet({
  geo,
  vehicle = null,
  onClose,
}: {
  geo: { lat: number; lng: number } | null;
  /** Vehículo EV para estimar el tiempo de carga rápida (SoC→80%). */
  vehicle?: EnergyVehicle | null;
  onClose: () => void;
}) {
  const [stations, setStations] = useState<ChargingStation[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    void (async () => {
      const origin = geo ?? { lat: 4.654, lng: -74.084 }; // Bogotá centro
      try {
        const result = await api<ChargingStation[]>(
          "GET",
          `/ev/charging-stations?lat=${origin.lat}&lng=${origin.lng}&limit=3`,
        );
        setStations(result);
        localStorage.setItem(CHARGERS_CACHE_KEY, JSON.stringify(result));
      } catch {
        // Sin señal: servir el último directorio consultado.
        try {
          const cached = localStorage.getItem(CHARGERS_CACHE_KEY);
          if (cached) {
            setStations(JSON.parse(cached) as ChargingStation[]);
            setOffline(true);
            return;
          }
        } catch {
          // caché corrupto: se ignora
        }
        setStations([]);
        setOffline(true);
      }
    })();
  }, [geo]);

  /** Estimación DC rápida: minutos para llevar el SoC actual a 80%. */
  function fastChargeEstimate(s: ChargingStation): string | null {
    if (!s.dcFast || s.powerKw === null || s.powerKw <= 0) return null;
    if (
      !vehicle ||
      vehicle.batteryKwh === null ||
      vehicle.socPercent === null ||
      vehicle.socPercent >= 80
    ) {
      return null;
    }
    const kwhNeeded = (vehicle.batteryKwh * (80 - vehicle.socPercent)) / 100;
    const minutes = Math.max(1, Math.round((kwhNeeded / s.powerKw) * 60));
    return `${Math.round(vehicle.socPercent)}→80% en ~${minutes} min`;
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Estaciones de carga cercanas"
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-white p-4 pb-[max(1.125rem,env(safe-area-inset-bottom))] shadow-[0_-12px_30px_rgba(0,0,0,.35)] dark:border-sky/25 dark:bg-navy-700"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          aria-hidden
          className="mx-auto mb-3 block h-1 w-[38px] rounded-full bg-border-strong dark:bg-sky/35"
        />
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-navy dark:text-niebla">
            <PlugZap
              size={15}
              strokeWidth={2}
              aria-hidden
              className="text-success dark:text-lima"
            />
            Cargadores cercanos
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-11 w-11 items-center justify-center rounded-lg bg-niebla text-navy dark:bg-sky/12 dark:text-sky"
          >
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>
        {offline && (
          <div className="mb-2.5 flex items-center gap-2 rounded-md bg-warning-bg px-2.5 py-1.5 dark:bg-warning/20">
            <TriangleAlert
              size={12}
              strokeWidth={2}
              aria-hidden
              className="shrink-0 text-warning dark:text-[#e8b96a]"
            />
            <span className="text-[11px] text-warning dark:text-[#e8b96a]">
              Sin señal: mostrando el último directorio consultado.
            </span>
          </div>
        )}
        {stations === null && (
          <p className="text-sm text-text-tertiary dark:text-sky/70">Buscando…</p>
        )}
        {stations !== null && stations.length === 0 && (
          <p className="text-sm text-text-tertiary dark:text-sky/70">
            No hay estaciones en el directorio todavía.
          </p>
        )}
        <div className="space-y-2">
          {stations?.map((s) => {
            const nav = navLinks(s.lat, s.lng);
            const estimate = fastChargeEstimate(s);
            return (
              <div
                key={s.id}
                className={`rounded-xl border px-3 py-2.5 ${
                  s.dcFast
                    ? "border-success/40 bg-lima/10 dark:border-lima/45 dark:bg-lima/8"
                    : "border-border dark:border-sky/25"
                }`}
              >
                <div className="flex items-center gap-2">
                  {s.isDepot ? (
                    <Warehouse
                      size={13}
                      strokeWidth={2}
                      aria-label="Depósito"
                      className="shrink-0 text-success dark:text-lima"
                    />
                  ) : s.dcFast ? (
                    <span className="shrink-0 rounded-full bg-lima px-1.5 py-px text-[10px] font-extrabold text-navy-900">
                      DC
                    </span>
                  ) : (
                    <PlugZap
                      size={13}
                      strokeWidth={2}
                      aria-hidden
                      className="shrink-0 text-text-tertiary dark:text-sky"
                    />
                  )}
                  <span className="min-w-0 truncate text-[13px] font-semibold text-navy dark:text-niebla">
                    {s.name}
                  </span>
                  {s.distanceKm !== null && (
                    <span className="ml-auto shrink-0 font-mono text-xs font-bold text-navy dark:text-niebla">
                      {s.distanceKm.toFixed(1)} km
                    </span>
                  )}
                </div>
                <div className="mb-2 ml-5 mt-0.5 text-[11px] text-text-tertiary dark:text-sky/70">
                  {s.network}
                  {s.address ? ` · ${s.address}` : ""}
                  {s.connectors.length > 0 ? ` · ${s.connectors.join("/")}` : ""}
                  {s.powerKw ? ` · ${s.powerKw} kW` : ""}
                  {s.dcFast ? " · rápida" : ""}
                  {estimate ? ` — ${estimate}` : ""}
                </div>
                <div className="flex gap-2">
                  <a
                    href={nav.waze}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 flex-1 items-center justify-center rounded-[9px] bg-sky-50 text-xs font-bold text-navy dark:bg-sky/15 dark:text-[#dfe5ec]"
                  >
                    Waze
                  </a>
                  <a
                    href={nav.gmaps}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 flex-1 items-center justify-center rounded-[9px] bg-success-bg text-xs font-bold text-success dark:bg-lima/18 dark:text-lima"
                  >
                    Maps
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
