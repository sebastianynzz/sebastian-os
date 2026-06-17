import { useEffect, useState } from "react";
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

  // Sin telemetría de SoC NO se asume batería llena: una falsa confianza
  // ("alcanza") es exactamente lo que D7 existe para evitar.
  if (vehicle.socPercent === null) {
    return (
      <div
        role="status"
        className="rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning shadow-sm"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold">⚡ Batería sin telemetría</span>
          <button
            onClick={onFindCharger}
            className="shrink-0 font-bold underline opacity-70"
          >
            🔌 Cargadores
          </button>
        </div>
        <div className="mt-1 text-xs">
          Confirma la carga del vehículo antes de salir — faltan ~
          {Math.max(1, Math.round(remainingKm))} km de ruta.
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

  return (
    <div
      role="status"
      className={`rounded-xl px-4 py-3 text-sm shadow-sm ${
        enough ? "bg-success-bg text-success" : "bg-danger-bg text-danger"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">
          ⚡ Batería {Math.round(soc)}% · ~{Math.round(usableKm)} km útiles
        </span>
        <span className="text-xs opacity-80">
          faltan ~{Math.max(1, Math.round(remainingKm))} km
        </span>
      </div>
      {enough ? (
        <div className="mt-1 flex items-center justify-between gap-2 text-xs">
          <span>✅ Alcanza para terminar la ruta</span>
          <button
            onClick={onFindCharger}
            className="shrink-0 font-bold underline opacity-70"
          >
            🔌 Cargadores
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs font-bold">
            ⚠️ Necesitas cargar antes de terminar
          </span>
          <button
            onClick={onFindCharger}
            className="shrink-0 rounded-lg bg-danger px-3 py-1.5 text-xs font-bold text-white"
          >
            🔌 Cargador más cercano
          </button>
        </div>
      )}
    </div>
  );
}

export function ChargerSheet({
  geo,
  onClose,
}: {
  geo: { lat: number; lng: number } | null;
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

  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Estaciones de carga cercanas"
        className="w-full rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">🔌 Cargadores cercanos</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg bg-niebla px-3 py-1.5 text-sm font-bold text-navy"
          >
            ✕
          </button>
        </div>
        {offline && (
          <p className="mb-2 rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning">
            Sin señal: mostrando el último directorio consultado.
          </p>
        )}
        {stations === null && <p className="text-sm text-text-tertiary">Buscando…</p>}
        {stations !== null && stations.length === 0 && (
          <p className="text-sm text-text-tertiary">
            No hay estaciones en el directorio todavía.
          </p>
        )}
        <div className="space-y-3">
          {stations?.map((s) => {
            const nav = navLinks(s.lat, s.lng);
            return (
              <div key={s.id} className="rounded-xl border border-cielo/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">
                      {s.isDepot ? "🏠 " : ""}
                      {s.name}
                    </div>
                    <div className="text-xs text-text-tertiary">
                      {s.network}
                      {s.address ? ` · ${s.address}` : ""}
                    </div>
                  </div>
                  {s.distanceKm !== null && (
                    <span className="shrink-0 text-sm font-bold text-navy">
                      {s.distanceKm.toFixed(1)} km
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-text-secondary">
                  {s.connectors.join(" · ")}
                  {s.powerKw ? ` · ${s.powerKw} kW` : ""}
                  {s.dcFast ? " · ⚡ DC rápida" : ""}
                </div>
                <div className="mt-2 flex gap-2">
                  <a
                    href={nav.waze}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded-lg bg-sky-50 py-2 text-center text-xs font-bold text-info"
                  >
                    🧭 Waze
                  </a>
                  <a
                    href={nav.gmaps}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded-lg bg-success-bg py-2 text-center text-xs font-bold text-success"
                  >
                    🗺️ Maps
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
