import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
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
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>`,
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Triage de direcciones"
        subtitle="Direcciones de baja confianza por confirmar antes de planificar. Cada pin corregido entrena el grafo de direcciones."
      />

      {/* Resolución asistida por IA: re-resuelve la cola con el grafo + la
          cascada de proveedores; al aplicar fija y aprende los pines de alta
          confianza, dejando para revisión manual los dudosos. */}
      <AiOptimizeButton
        actionId="resolve_addresses"
        context={orders ? { orderIds: orders.map((o) => o.id) } : {}}
        disabled={!orders || orders.length === 0}
        onApplied={() => {
          void load();
        }}
      />

      {banner && (
        <Banner kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Banner>
      )}

      {orders.length === 0 ? (
        <Card>
          <EmptyState>
            🎉 No hay direcciones pendientes de revisión: todas las direcciones
            activas tienen pin confiable.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title={`Por revisar (${orders.length})`}
            actions={
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={toggleAllConfirmable} disabled={confirmableIds.length === 0}>
                  {allConfirmableSelected ? "Quitar selección" : "Seleccionar confirmables"}
                </Button>
                <Button onClick={confirmBatch} disabled={checked.size === 0 || batchBusy}>
                  {batchBusy ? "Confirmando…" : `Confirmar ${checked.size} sel.`}
                </Button>
              </div>
            }
          >
            <p className="mb-2 text-xs text-navy/50">
              Confirma en lote las que ya tienen un pin razonable; las de
              geocodificador de prueba o sin coordenadas requieren pin manual en el mapa.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={theadRowClass}>
                    <th className="py-2 pr-2">
                      <input
                        type="checkbox"
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
                  {orders.map((o) => (
                    <tr
                      key={o.id}
                      className={`${tableRowClass} ${o.id === selectedId ? "bg-cielo/20" : ""}`}
                    >
                      <td className="py-2 pr-2">
                        {confirmable(o) ? (
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar ${o.trackingNumber ?? o.customerName}`}
                            checked={checked.has(o.id)}
                            onChange={() => toggleCheck(o.id)}
                          />
                        ) : (
                          <span title="Requiere pin manual en el mapa" className="text-xs text-navy/30">
                            ✎
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{o.trackingNumber}</td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{o.customerName}</div>
                        <div className="text-xs text-navy/60">{o.addressRaw}</div>
                        {o.client && (
                          <div className="text-xs text-navy/40">{o.client.name}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {SOURCE_LABELS[o.geocodeSource ?? ""] ?? o.geocodeSource ?? "—"}
                        <div className="mt-1">
                          <StatusBadge status={o.status} />
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                            (o.geoConfidence ?? 0) < 0.5
                              ? "bg-danger-bg text-danger"
                              : "bg-warning-bg text-warning"
                          }`}
                        >
                          {o.geoConfidence === null ? "?" : `${Math.round(o.geoConfidence * 100)}%`}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <Button variant="secondary" onClick={() => select(o)}>
                          Revisar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title={
              selected
                ? `Corregir pin — ${selected.trackingNumber ?? selected.customerName}`
                : "Mapa"
            }
          >
            {selected && draft ? (
              <div className="space-y-3">
                <p className="text-sm text-navy/70">
                  Arrastra el pin al punto real de "{selected.addressRaw}"
                  {selected.addressNotes ? ` (${selected.addressNotes})` : ""} y confirma.
                </p>
                <div className="h-80 overflow-hidden rounded-lg">
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
                      icon={pinIcon("#a32d2d")}
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
                  <span className="font-mono text-xs text-navy/50">
                    {draft.lat.toFixed(6)}, {draft.lng.toFixed(6)}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setSelectedId(null)}>
                      Cancelar
                    </Button>
                    <Button onClick={confirmPin} disabled={busy}>
                      {busy ? "Guardando…" : "Confirmar pin"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState>Selecciona un pedido de la lista para corregir su pin.</EmptyState>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
