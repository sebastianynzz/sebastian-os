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
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await api<{ orders: TriageOrder[] }>("GET", "/addresses/triage");
    setOrders(res.orders);
    return res.orders;
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

  function toggleCheck(id: string) {
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      // Triage rápido: avanza automáticamente a la siguiente dirección de la
      // cola (la recién confirmada ya salió de ella).
      const remaining = await load();
      const next = remaining[0] ?? null;
      if (next) select(next);
      else {
        setSelectedId(null);
        setDraft(null);
      }
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmBatch() {
    if (checked.size === 0) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await api<{ confirmed: number; skipped: string[] }>(
        "POST",
        "/addresses/triage/confirm",
        { orderIds: [...checked] },
      );
      const skippedNote =
        res.skipped.length > 0 ? ` (${res.skipped.length} sin coordenadas, omitidas)` : "";
      setBanner({
        kind: "success",
        text: `${res.confirmed} dirección(es) confirmadas en su pin actual y aprendidas por el grafo${skippedNote}`,
      });
      setChecked(new Set());
      await load();
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  if (!orders) return <Loading label="Cargando cola de triage…" />;

  const allChecked = orders.length > 0 && orders.every((o) => checked.has(o.id));

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
          <Card title={`Por revisar (${orders.length})`}>
            {/* Confirmación en lote: acepta el pin geocodificado actual de las
                seleccionadas y lo aprende (para confianza media que se valida
                de un vistazo). Lo dudoso se corrige arrastrando el pin. */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-navy/60">
                {checked.size > 0
                  ? `${checked.size} seleccionadas`
                  : "Selecciona filas para confirmar en lote"}
              </span>
              <Button onClick={confirmBatch} disabled={busy || checked.size === 0}>
                {busy
                  ? "Confirmando…"
                  : `Confirmar ${checked.size || ""} en su pin actual`}
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={theadRowClass}>
                    <th className="py-2 pr-2">
                      <input
                        type="checkbox"
                        aria-label="Seleccionar todas"
                        checked={allChecked}
                        onChange={(e) =>
                          setChecked(
                            e.target.checked
                              ? new Set(orders.map((o) => o.id))
                              : new Set(),
                          )
                        }
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
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${o.trackingNumber ?? o.customerName}`}
                          checked={checked.has(o.id)}
                          onChange={() => toggleCheck(o.id)}
                        />
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
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-700"
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
                      icon={pinIcon("#e11d48")}
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
