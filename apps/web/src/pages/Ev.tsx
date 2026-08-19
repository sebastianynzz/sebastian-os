import { useEffect, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import { BadgeCheck, Snowflake, Sparkles, Warehouse, Zap } from "lucide-react";
import { VEHICLE_TYPE_PROFILES } from "@moveos/shared";
import type { ActionCatalogEntry, Proposal } from "@moveos/shared";
import { api, ApiError } from "../api";
import { formatCop } from "../format";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Loading,
  ModuleDisabled,
  PageHeader,
  inputClass,
} from "../components/ui";
import { useRealtimeReload } from "../realtime";

interface EvVehicle {
  id: string;
  plate: string;
  type: string;
  batteryKwh: number | null;
  nominalRangeKm: number | null;
  socPercent: number | null;
  usableRangeKm: number | null;
  lowBattery: boolean;
}
interface Station {
  id: string;
  name: string;
  network: string;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  connectors: string[];
  powerKw: number | null;
  dcFast: boolean;
  isDepot: boolean;
  distanceKm: number | null;
}
interface RangeEstimate {
  vehicleId: string;
  plate: string;
  socPercent: number;
  usableRangeKm: number;
}

const DEPOT = { lat: 4.6486, lng: -74.0628 }; // referencia Bogotá

/**
 * Estación de carga (Paleta Circuito, sección Mapas): círculo Verde Eléctrico
 * con borde Asfalto, mismo tratamiento que Mapa en vivo y Planificación. Antes
 * era el PNG azul por defecto de Leaflet, ajeno a la paleta.
 */
const stationIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:999px;background:var(--verde);border:2px solid var(--asfalto)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

/** Consumo del reefer (kW): puede venir como rango [min,max] o valor único. */
function coolingDrawLabel(draw: number | [number, number]): string {
  return Array.isArray(draw) ? `${draw[0]}–${draw[1]} kW` : `${draw} kW`;
}
function typeProfileOf(type: string) {
  return VEHICLE_TYPE_PROFILES[type as keyof typeof VEHICLE_TYPE_PROFILES] ?? null;
}

/* ---------- Anillo de SoC (donut SVG 62px, mock 2c) ---------- */

const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

function SocRing({ soc, danger }: { soc: number | null; danger: boolean }) {
  const pct = Math.max(0, Math.min(100, soc ?? 0));
  const dash = (pct / 100) * RING_C;
  return (
    <svg
      width="62"
      height="62"
      viewBox="0 0 62 62"
      role="img"
      aria-label={`Estado de carga ${soc != null ? `${soc}%` : "sin dato"}`}
      className="shrink-0"
    >
      <circle cx="31" cy="31" r={RING_R} fill="none" strokeWidth="7" className="stroke-canvas" />
      <circle
        cx="31"
        cy="31"
        r={RING_R}
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${RING_C}`}
        transform="rotate(-90 31 31)"
        className={danger ? "stroke-danger" : "stroke-verde"}
      />
      <text
        x="31"
        y="35"
        textAnchor="middle"
        className={`text-[14px] font-bold ${danger ? "fill-danger" : "fill-asfalto"}`}
      >
        {soc != null ? `${soc}%` : "—"}
      </text>
    </svg>
  );
}

/* ---------- Barra del Copiloto (patrón 1d): propone; tú confirmas ---------- */

/**
 * Chip "Programar carga al menor costo" cableado a la acción optimize_charging
 * (mismo contrato que el Copiloto: POST run → propuesta → confirmación antes de
 * aplicar; el solver hace la matemática, el LLM solo explica). Igual que antes,
 * solo se muestra si la acción aparece en GET /ai/actions para el tenant/rol.
 */
function CopilotoBar() {
  const [action, setAction] = useState<ActionCatalogEntry | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "applying">("idle");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ actions: ActionCatalogEntry[] }>("GET", "/ai/actions")
      .then((r) => {
        if (alive) setAction(r.actions.find((a) => a.id === "optimize_charging") ?? null);
      })
      .catch(() => {
        // Módulo AI_ADDONS inactivo (403) u otro error → sin barra de Copiloto.
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!action) return null;

  async function run() {
    setPhase("running");
    setError(null);
    setProposal(null);
    try {
      setProposal(await api<Proposal>("POST", "/ai/actions/optimize_charging/run", {}));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo generar la propuesta");
    } finally {
      setPhase("idle");
    }
  }

  async function apply() {
    if (!proposal) return;
    setPhase("applying");
    setError(null);
    try {
      await api("POST", "/ai/actions/optimize_charging/apply", {
        proposalId: proposal.proposalId,
      });
      setProposal(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo aplicar la propuesta");
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-asfalto">
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-asfalto" strokeWidth={2} />
          Copiloto
        </span>
        <button
          type="button"
          onClick={() => void run()}
          disabled={phase !== "idle"}
          className="whitespace-nowrap rounded-full border border-asfalto/30 bg-surface px-3 py-1 text-xs font-medium text-asfalto transition duration-200 ease-brand hover:bg-verde/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asfalto disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === "running" ? "Analizando…" : "Programar carga al menor costo"}
        </button>
        <span className="ml-auto text-[11px] text-text-tertiary">
          El copiloto propone; tú confirmas antes de aplicar.
        </span>
      </div>

      {error && !proposal && (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {proposal && (
        <Card title="Programar carga al menor costo">
          <div className="space-y-3">
            <p className="text-sm text-asfalto">{proposal.summaryEs}</p>
            <ProposalImpactRows proposal={proposal} />
            {error && (
              <Banner kind="error" onDismiss={() => setError(null)}>
                {error}
              </Banner>
            )}
            {!proposal.feasible && (
              <Banner kind="info">La propuesta no es aplicable con la selección actual.</Banner>
            )}
            <div className="flex flex-wrap gap-2">
              {proposal.mutates && (
                <Button onClick={() => void apply()} disabled={phase !== "idle" || !proposal.feasible}>
                  {phase === "applying" ? "Aplicando…" : "Aplicar"}
                </Button>
              )}
              <Button variant="secondary" onClick={() => void run()} disabled={phase !== "idle"}>
                Ajustar
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setProposal(null);
                  setError(null);
                }}
                disabled={phase !== "idle"}
              >
                Descartar
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function pct(n: number | undefined): string | null {
  return n == null ? null : `${Math.round(n)}%`;
}

function ProposalImpactRows({ proposal }: { proposal: Proposal }) {
  const i = proposal.impact;
  const rows: { label: string; value: string }[] = [];
  if (i.distanceKm != null) rows.push({ label: "Distancia", value: `${i.distanceKm} km` });
  if (i.distanceDeltaKm != null)
    rows.push({ label: "Δ distancia", value: `${i.distanceDeltaKm} km` });
  if (i.vehiclesUsed != null) rows.push({ label: "Vehículos", value: String(i.vehiclesUsed) });
  if (i.energyKwh != null) rows.push({ label: "Energía", value: `${i.energyKwh} kWh` });
  if (pct(i.utilizationPct)) rows.push({ label: "Utilización", value: pct(i.utilizationPct)! });
  if (pct(i.timeInBandPct)) rows.push({ label: "En banda (frío)", value: pct(i.timeInBandPct)! });
  if (i.costEstimateCop != null)
    rows.push({ label: "Costo est.", value: formatCop(i.costEstimateCop) });

  return (
    <div className="space-y-2 text-sm">
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {rows.map((r) => (
            <span key={r.label}>
              <span className="text-text-secondary">{r.label}: </span>
              <span className="font-medium text-asfalto">{r.value}</span>
            </span>
          ))}
        </div>
      )}
      {i.notesEs && i.notesEs.length > 0 && (
        <ul className="list-disc pl-5 text-asfalto/70">
          {i.notesEs.map((n, k) => (
            <li key={k}>{n}</li>
          ))}
        </ul>
      )}
      {i.unassigned && i.unassigned.length > 0 && (
        <div>
          <p className="font-medium text-warning">Sin asignar ({i.unassigned.length})</p>
          <ul className="list-disc pl-5 text-asfalto/70">
            {i.unassigned.slice(0, 6).map((u) => (
              <li key={u.orderId}>{u.reasonEs}</li>
            ))}
            {i.unassigned.length > 6 && <li>…</li>}
          </ul>
        </div>
      )}
      {i.excluded && i.excluded.length > 0 && (
        <div>
          <p className="font-medium text-warning">Vehículos excluidos ({i.excluded.length})</p>
          <ul className="list-disc pl-5 text-asfalto/70">
            {i.excluded.slice(0, 6).map((e) => (
              <li key={e.vehicleId}>{e.reasonEs}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------- Página ---------- */

export default function Ev() {
  const [fleet, setFleet] = useState<EvVehicle[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleOff, setModuleOff] = useState(false);
  const [stationQuery, setStationQuery] = useState("");

  // Calculadora de autonomía (surface del backend /ev/range-estimate).
  const [calcVehicle, setCalcVehicle] = useState("");
  const [temp, setTemp] = useState("");
  const [payload, setPayload] = useState("");
  const [elev, setElev] = useState("");
  const [calc, setCalc] = useState<RangeEstimate | null>(null);
  const [calcBusy, setCalcBusy] = useState(false);
  const [calcErr, setCalcErr] = useState<string | null>(null);

  async function load() {
    try {
      const [f, s] = await Promise.all([
        api<EvVehicle[]>("GET", "/ev/overview"),
        // Con origen (depósito) el backend ordena por cercanía y llena distanceKm.
        api<Station[]>("GET", `/ev/charging-stations?lat=${DEPOT.lat}&lng=${DEPOT.lng}`),
      ]);
      setFleet(f);
      setStations(s);
      // No pisar la selección de la calculadora en recargas en vivo.
      setCalcVehicle((prev) => prev || (f[0]?.id ?? ""));
    } catch (err) {
      if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
        setModuleOff(true);
      }
    } finally {
      setLoading(false);
    }
  }

  // El SoC llega por telemetría → la flota se refresca en vivo (SSE + respaldo).
  useRealtimeReload(["telemetry"], () => void load(), { throttleMs: 5_000 });

  async function runCalc() {
    if (!calcVehicle) return;
    setCalcBusy(true);
    setCalcErr(null);
    const p = new URLSearchParams({ vehicleId: calcVehicle });
    if (temp) p.set("temperatureC", temp);
    if (payload) p.set("payloadKg", payload);
    if (elev) p.set("elevationGainM", elev);
    try {
      setCalc(await api<RangeEstimate>("GET", `/ev/range-estimate?${p.toString()}`));
    } catch (err) {
      setCalc(null);
      setCalcErr(err instanceof Error ? err.message : "No se pudo estimar la autonomía");
    } finally {
      setCalcBusy(false);
    }
  }

  if (moduleOff) {
    return <ModuleDisabled title="Flota eléctrica" moduleName="de gestión EV" />;
  }
  if (loading) {
    return <Loading label="Cargando flota eléctrica…" />;
  }

  const q = stationQuery.trim().toLowerCase();
  const filteredStations = q
    ? stations.filter((s) =>
        [s.name, s.network, s.city ?? "", s.address ?? ""].join(" ").toLowerCase().includes(q),
      )
    : stations;
  const lowCount = fleet.filter((v) => v.lowBattery).length;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Flota eléctrica"
        subtitle="Autonomía útil estimada según estado de carga, con margen de seguridad."
        actions={
          <>
            {/* Exención nacional de pico y placa: beneficio visible, no nota al pie. */}
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-verde/45 px-3 py-1 text-xs font-semibold text-asfalto">
              <BadgeCheck aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
              EVs exentos de pico y placa (Ley 1964)
            </span>
            {lowCount > 0 && (
              <span className="whitespace-nowrap rounded-full bg-danger-bg px-3 py-1 text-xs font-semibold text-danger">
                {lowCount} con batería baja
              </span>
            )}
          </>
        }
      />

      {/* Programación de carga al menor costo (asesor): el solver calcula la
          energía y la ventana tarifaria; el LLM solo explica. */}
      <CopilotoBar />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {fleet.map((v) => {
          const profile = typeProfileOf(v.type);
          const reefer = profile?.reefer ?? null;
          const ringDanger = v.lowBattery || (v.socPercent != null && v.socPercent < 30);
          return (
            <div
              key={v.id}
              className={`flex items-center gap-3 rounded-xl border bg-surface p-3.5 shadow-soft transition duration-200 ease-brand hover:-translate-y-[2px] hover:shadow-soft-lg ${
                v.lowBattery ? "border-danger/40" : "border-border"
              }`}
            >
              <SocRing soc={v.socPercent} danger={ringDanger} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-sm font-bold text-asfalto">{v.plate}</span>
                  <span className="whitespace-nowrap rounded-full bg-info-bg px-2 py-px text-[10.5px] font-semibold text-info">
                    {profile?.labelEs ?? v.type}
                  </span>
                  {v.lowBattery && (
                    <span className="whitespace-nowrap rounded-full bg-danger-bg px-2 py-px text-[10.5px] font-semibold text-danger">
                      Batería baja
                    </span>
                  )}
                </div>
                <div
                  className={`mt-0.5 text-[20px] font-semibold leading-tight ${
                    v.lowBattery ? "text-danger" : "text-asfalto"
                  }`}
                >
                  {v.usableRangeKm ?? "—"}{" "}
                  <span className="text-[11px] font-medium text-text-tertiary">km útiles</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-text-tertiary">
                  <span>
                    {v.batteryKwh ?? "—"} kWh
                    {v.lowBattery && " · cargar antes de despachar"}
                  </span>
                  {/* Consumo del reefer (Cold Box): la autonomía publicada ya es
                      reefer-ON, así que esto es informativo (energía/costo), no se
                      resta de nuevo. Solo configuraciones refrigeradas lo muestran. */}
                  {reefer && (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-info-bg px-2 py-px text-[10.5px] font-semibold text-info">
                      <Snowflake aria-hidden="true" className="h-2.5 w-2.5" strokeWidth={2} />
                      Cold Box {coolingDrawLabel(reefer.coolingDrawKw)} · {reefer.tempMinC}…
                      {reefer.tempMaxC}°C
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {fleet.length === 0 && (
          <Card>
            <EmptyState>
              No hay vehículos eléctricos registrados. Márquelos como eléctricos al crearlos en
              Vehículos.
            </EmptyState>
          </Card>
        )}
      </div>

      {fleet.length > 0 && (
        <Card title="Calculadora de autonomía">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="text-xs text-text-secondary">
              Vehículo
              <select
                value={calcVehicle}
                onChange={(e) => setCalcVehicle(e.target.value)}
                className={inputClass}
              >
                {fleet.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-text-secondary">
              Temperatura °C
              <input
                type="number"
                value={temp}
                onChange={(e) => setTemp(e.target.value)}
                placeholder="ej. 12"
                className={inputClass}
              />
            </label>
            <label className="text-xs text-text-secondary">
              Carga kg
              <input
                type="number"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                placeholder="ej. 150"
                className={inputClass}
              />
            </label>
            <label className="text-xs text-text-secondary">
              Desnivel m
              <input
                type="number"
                value={elev}
                onChange={(e) => setElev(e.target.value)}
                placeholder="ej. 300"
                className={inputClass}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={() => void runCalc()} disabled={calcBusy || !calcVehicle}>
              {calcBusy ? "Calculando…" : "Calcular"}
            </Button>
            {calc && (
              <span className="text-[13px] text-text-secondary">
                <span className="font-mono font-bold text-asfalto">{calc.plate}</span> · SoC{" "}
                {calc.socPercent}% →{" "}
                <span className="text-[22px] font-bold text-warning">{calc.usableRangeKm} km</span>{" "}
                útiles
              </span>
            )}
            {calcErr && <span className="text-sm text-danger">{calcErr}</span>}
          </div>
        </Card>
      )}

      <Card
        title="Red de carga (Bogotá)"
        actions={
          <span className="text-[11px] text-text-tertiary">ordenada por distancia al depósito</span>
        }
      >
        <input
          type="search"
          value={stationQuery}
          onChange={(e) => setStationQuery(e.target.value)}
          placeholder="Buscar por estación, red, ciudad o dirección…"
          aria-label="Buscar estación de carga"
          className={`${inputClass} mb-3 sm:max-w-sm`}
        />

        <div className="mb-3 overflow-hidden rounded-lg">
          <MapContainer center={[DEPOT.lat, DEPOT.lng]} zoom={12} style={{ height: 280 }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {filteredStations.map((s) => (
              <Marker key={s.id} position={[s.lat, s.lng]} icon={stationIcon}>
                <Popup>
                  <strong className="inline-flex items-center gap-1">
                    {s.isDepot && (
                      <Warehouse aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
                    )}
                    {s.name}
                  </strong>
                  <br />
                  {s.network} · {s.dcFast ? "DC rápida" : "AC"}
                  {s.powerKw ? ` · ${s.powerKw} kW` : ""}
                  {s.address ? (
                    <>
                      <br />
                      {s.address}
                    </>
                  ) : null}
                  {s.distanceKm !== null ? (
                    <>
                      <br />a {s.distanceKm} km del depósito
                    </>
                  ) : null}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        <div className="flex flex-col">
          {filteredStations.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 border-b border-border/70 py-1.5 last:border-b-0"
            >
              {s.isDepot ? (
                <Warehouse
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 text-asfalto"
                  strokeWidth={2}
                />
              ) : s.dcFast ? (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-verde px-2 py-px text-[10.5px] font-bold text-asfalto">
                  <Zap
                    aria-hidden="true"
                    className="h-2.5 w-2.5"
                    fill="currentColor"
                    strokeWidth={1}
                  />
                  DC
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-info-bg px-2 py-px text-[10.5px] font-semibold text-info">
                  AC
                </span>
              )}
              <span className="truncate text-[12.5px] font-semibold text-asfalto">{s.name}</span>
              <span className="truncate text-[11px] text-text-tertiary">
                {s.network}
                {s.powerKw ? ` · ${s.powerKw} kW` : ""}
                {s.connectors.length > 0 ? ` · ${s.connectors.join("/")}` : ""}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-text-secondary">
                {s.distanceKm !== null ? `${s.distanceKm} km` : "—"}
              </span>
            </div>
          ))}
          {filteredStations.length === 0 && (
            <p className="py-6 text-center text-sm text-text-tertiary">
              {stations.length === 0
                ? "Sin estaciones registradas."
                : "Ninguna estación coincide con la búsqueda."}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
