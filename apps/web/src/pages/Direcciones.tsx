import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { Check, MapPin, PartyPopper, Sparkle, SquareCheck } from "lucide-react";
import { api } from "../api";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  StatusBadge,
  tableRowClass,
  theadRowClass,
} from "../components/ui";
import { AiOptimizeButton } from "../components/AiOptimizeButton";

/**
 * Cola de triage de direcciones: pedidos con geocodificación de baja
 * confianza que conviene corregir ANTES de planificar. Arrastrar el pin al
 * punto correcto y confirmar — cada confirmación enseña al grafo de
 * direcciones ("corregir 12 direcciones, no 12 entregas fallidas").
 */

interface TriageOrder {
  id: string;
  trackingNumber: string | null;
  customerName: string;
  addressRaw: string;
  addressNotes: string | null;
  lat: number | null;
  lng: number | null;
  geocodeSource: string | null;
  geoConfidence: number | null;
  status: string;
  client: { id: string; name: string } | null;
}

const SOURCE_LABELS: Record<string, string> = {
  MOCK: "Geocodificador de prueba",
  GOOGLE: "Google (aprox.)",
  LUPAP: "Lupap",
  ADDRESS_PIN: "Grafo aprendido",
  CLIENT: "Integración",
};

function pinIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid #F2F5F3"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function FlyTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lng], Math.max(map.getZoom(), 15));
  }, [map, lat, lng]);
  return null;
}

/** Confianza como barra pequeña + porcentaje (rojo <50%, ámbar el resto). */
function ConfidenceBar({ value }: { value: number | null }) {
  const pct = value === null ? 0 : Math.round(value * 100);
  const low = value === null || value < 0.5;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="h-[5px] w-11 overflow-hidden rounded-full bg-canvas"
      >
        <span
          className={`block h-full ${low ? "bg-danger" : "bg-warning"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className={`text-[11.5px] font-bold ${low ? "text-danger" : "text-warning"}`}>
        {value === null ? "?" : `${pct}%`}
      </span>
    </span>
  );
}

/** Chip de fila que exige fijar el pin a mano (no confirmable en lote). */
function ManualPinChip() {
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-info-bg px-2 py-0.5 text-[10.5px] font-semibold text-info">
      Pin manual
    </span>
  );
}

export default function Direcciones() {
  const [orders, setOrders] = useState<TriageOrder[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Selección para confirmación en lote (triage rápido).
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ orders: TriageOrder[] }>("GET", "/addresses/triage");
    setOrders(res.orders);
    setChecked(new Set());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => orders?.find((o) => o.id === selectedId) ?? null,
    [orders, selectedId],
  );

  function select(order: TriageOrder) {
    setSelectedId(order.id);
    setDraft(order.lat !== null && order.lng !== null ? { lat: order.lat, lng: order.lng } : null);
  }

  // Una fila es confirmable en lote solo si ya tiene un pin real: con
  // coordenadas y de una fuente que NO sea el geocodificador de prueba (MOCK).
  // Confirmar en lote un pin MOCK/ausente envenenaría el grafo — esos van al
  // mapa para fijar el pin a mano.
  const confirmable = (o: TriageOrder) =>
    o.lat !== null && o.lng !== null && o.geocodeSource !== "MOCK";

  const confirmableIds = useMemo(
    () => (orders ?? []).filter(confirmable).map((o) => o.id),
    [orders],
  );
  const allConfirmableSelected =
    confirmableIds.length > 0 && confirmableIds.every((id) => checked.has(id));

  function toggleCheck(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllConfirmable() {
    setChecked(allConfirmableSelected ? new Set() : new Set(confirmableIds));
  }

  async function confirmBatch() {
    if (checked.size === 0) return;
    setBatchBusy(true);
    setBanner(null);
    try {
      const res = await api<{ confirmed: number; skipped: { id: string; reason: string }[] }>(
        "POST",
        "/addresses/triage/confirm",
        { orderIds: [...checked] },
      );
      const parts = [`${res.confirmed} confirmada(s) y aprendida(s) por el grafo`];
      if (res.skipped.length > 0) {
        parts.push(`${res.skipped.length} omitida(s): requieren pin manual`);
      }
      setBanner({ kind: res.confirmed > 0 ? "success" : "error", text: parts.join(" · ") });
      if (selectedId && checked.has(selectedId)) {
        setSelectedId(null);
        setDraft(null);
      }
      await load();
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBatchBusy(false);
    }
  }

  async function confirmPin() {
    if (!selected || !draft) return;
    setBusy(true);
    setBanner(null);
    try {
      await api("PATCH", `/addresses/orders/${selected.id}/location`, {
        lat: draft.lat,
        lng: draft.lng,
      });
      setBanner({
        kind: "success",
        text: `Pin de ${selected.trackingNumber ?? selected.customerName} confirmado y aprendido por el grafo`,
      });
      setSelectedId(null);
      setDraft(null);
      await load();
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  if (!orders) return <Loading label="Cargando cola de triage…" />;

  const n = orders.length;
  const subtitle =
    n > 0
      ? n === 1
        ? "Corrige 1 dirección hoy, no 1 entrega fallida mañana. Cada pin confirmado entrena el grafo."
        : `Corrige ${n} direcciones hoy, no ${n} entregas fallidas mañana. Cada pin confirmado entrena el grafo.`
      : "Direcciones de baja confianza por confirmar antes de planificar. Cada pin confirmado entrena el grafo.";

  return (
    <div className="space-y-4">
      <PageHeader title="Triage de direcciones" subtitle={subtitle} />

      {/* Resolución asistida por IA: re-resuelve la cola con el grafo + la
          cascada de proveedores; al aplicar fija y aprende los pines de alta
          confianza, dejando para revisión manual los dudosos. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2">
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-asfalto">
          <Sparkle aria-hidden="true" className="h-3.5 w-3.5 text-asfalto" strokeWidth={2} />
          Copiloto
        </span>
        <AiOptimizeButton
          variant="chip"
          actionId="resolve_addresses"
          context={orders ? { orderIds: orders.map((o) => o.id) } : {}}
          disabled={!orders || orders.length === 0}
          onApplied={() => {
            void load();
          }}
        />
        <span className="ml-auto hidden shrink-0 text-[11px] text-text-tertiary lg:inline">
          fija las de alta confianza; deja las dudosas para revisión manual
        </span>
      </div>

      {banner && (
        <Banner kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Banner>
      )}

      {orders.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PartyPopper aria-hidden="true" className="h-8 w-8" strokeWidth={1.75} />}
          >
            No hay direcciones pendientes de revisión: todas las direcciones
            activas tienen pin confiable.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title={`Por revisar · ${orders.length}`}
            actions={
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  icon={<SquareCheck />}
                  onClick={toggleAllConfirmable}
                  disabled={confirmableIds.length === 0}
                >
                  {allConfirmableSelected ? "Quitar selección" : "Seleccionar confirmables"}
                </Button>
                <Button
                  icon={<Check />}
                  onClick={confirmBatch}
                  disabled={checked.size === 0 || batchBusy}
                >
                  {batchBusy
                    ? "Confirmando…"
                    : `Confirmar ${checked.size} ${checked.size === 1 ? "seleccionada" : "seleccionadas"}`}
                </Button>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={theadRowClass}>
                    <th className="py-2 pr-2">
                      <input
                        type="checkbox"
                        className="accent-asfalto"
                        aria-label="Seleccionar todas las confirmables"
                        checked={allConfirmableSelected}
                        onChange={toggleAllConfirmable}
                        disabled={confirmableIds.length === 0}
                      />
                    </th>
                    <th className="py-2 pr-3">Guía</th>
                    <th className="py-2 pr-3">Dirección</th>
                    <th className="py-2 pr-3">Fuente</th>
                    <th className="py-2 pr-3">Confianza</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const isSel = o.id === selectedId;
                    return (
                      <tr
                        key={o.id}
                        className={`${tableRowClass} ${
                          isSel ? "border-l-[3px] border-l-asfalto bg-info-bg/50" : ""
                        }`}
                      >
                        <td className={`py-2 pr-2 ${isSel ? "pl-1" : ""}`}>
                          {confirmable(o) ? (
                            <input
                              type="checkbox"
                              className="accent-asfalto"
                              aria-label={`Seleccionar ${o.trackingNumber ?? o.customerName}`}
                              checked={checked.has(o.id)}
                              onChange={() => toggleCheck(o.id)}
                            />
                          ) : (
                            <span
                              title="Requiere pin manual en el mapa"
                              className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${
                                isSel ? "bg-asfalto" : "bg-info-bg"
                              }`}
                            >
                              <MapPin
                                aria-hidden="true"
                                className={`h-2.5 w-2.5 ${isSel ? "text-verde" : "text-info"}`}
                                strokeWidth={2.5}
                              />
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs font-semibold">
                          {o.trackingNumber}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="font-medium">{o.customerName}</div>
                          <div className="text-xs text-text-tertiary">
                            {o.addressRaw}
                            {o.client ? ` · ${o.client.name}` : ""}
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-xs text-text-secondary">
                          {confirmable(o) ? (
                            SOURCE_LABELS[o.geocodeSource ?? ""] ?? o.geocodeSource ?? "—"
                          ) : (
                            <ManualPinChip />
                          )}
                          <div className="mt-1">
                            <StatusBadge status={o.status} />
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <ConfidenceBar value={o.geoConfidence} />
                        </td>
                        <td className="py-2 text-right">
                          {isSel ? (
                            <span className="inline-block whitespace-nowrap rounded-full bg-verde px-2.5 py-1 text-xs font-semibold text-asfalto">
                              Revisando
                            </span>
                          ) : (
                            <Button variant="secondary" onClick={() => select(o)}>
                              Revisar
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-text-tertiary">
              <SquareCheck aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>confirmables en lote (pin real de fuente confiable) ·</span>
              <ManualPinChip />
              <span>
                requieren fijar el punto en el mapa — confirmarlas a ciegas envenenaría el grafo.
              </span>
            </p>
          </Card>

          <Card
            title={
              selected
                ? `Corregir pin — ${selected.trackingNumber ?? selected.customerName}`
                : "Mapa"
            }
            actions={
              selected ? (
                <span className="text-[11px] text-text-tertiary">{selected.customerName}</span>
              ) : undefined
            }
          >
            {selected && draft ? (
              <div className="space-y-3">
                <p className="text-[12.5px] text-text-secondary">
                  Arrastra el pin al punto real de{" "}
                  <strong className="font-semibold text-asfalto">"{selected.addressRaw}"</strong>
                  {selected.addressNotes ? ` (${selected.addressNotes})` : ""} y confirma.
                </p>
                <div className="h-80 overflow-hidden rounded-md">
                  <MapContainer
                    center={[draft.lat, draft.lng]}
                    zoom={15}
                    style={{ height: "100%", width: "100%" }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <FlyTo lat={draft.lat} lng={draft.lng} />
                    <Marker
                      position={[draft.lat, draft.lng]}
                      draggable
                      icon={pinIcon("#CE2C32")}
                      eventHandlers={{
                        dragend: (e) => {
                          const m = e.target as L.Marker;
                          const p = m.getLatLng();
                          setDraft({ lat: p.lat, lng: p.lng });
                        },
                      }}
                    >
                      <Popup>Arrástrame al punto correcto</Popup>
                    </Marker>
                  </MapContainer>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[11.5px] text-text-tertiary">
                    {draft.lat.toFixed(6)}, {draft.lng.toFixed(6)}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setSelectedId(null)}>
                      Cancelar
                    </Button>
                    <Button variant="cta" icon={<Check />} onClick={confirmPin} disabled={busy}>
                      {busy ? "Guardando…" : "Confirmar pin"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<MapPin aria-hidden="true" className="h-8 w-8" strokeWidth={1.75} />}
              >
                Selecciona un pedido de la lista para corregir su pin.
              </EmptyState>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
