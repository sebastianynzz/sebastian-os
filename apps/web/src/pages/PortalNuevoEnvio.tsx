import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import {
  Banner,
  Button,
  Card,
  Field,
  PageHeader,
  inputClass,
} from "../components/ui";

/**
 * Portal de clientes — "Nuevo envío": el negocio registra un envío con
 * recogida en su dirección registrada (o una puntual) y recibe de inmediato
 * la guía y el enlace de rastreo para su consumidor final.
 */

interface PortalMe {
  name: string;
  pickupAddressRaw: string | null;
  pickupNotes: string | null;
  tenant: { name: string; city: string };
}

interface CreatedOrder {
  trackingNumber: string | null;
  trackingUrl: string | null;
}

export default function PortalNuevoEnvio() {
  const [me, setMe] = useState<PortalMe | null>(null);
  const [pickupMode, setPickupMode] = useState<"REGISTERED" | "CUSTOM" | "NONE">("REGISTERED");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<PortalMe>("GET", "/portal/me").then((m) => {
      setMe(m);
      if (!m.pickupAddressRaw) setPickupMode("CUSTOM");
    });
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setBusy(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    try {
      const order = await api<CreatedOrder>("POST", "/portal/orders", {
        customerName: data.get("customerName"),
        customerPhone: data.get("customerPhone"),
        addressRaw: data.get("addressRaw"),
        addressNotes: data.get("addressNotes") || undefined,
        externalRef: data.get("externalRef") || undefined,
        weightKg: data.get("weightKg") ? Number(data.get("weightKg")) : undefined,
        pickupMode,
        pickupAddressRaw:
          pickupMode === "CUSTOM" ? data.get("pickupAddressRaw") : undefined,
        pickupNotes:
          pickupMode === "CUSTOM" ? data.get("pickupNotes") || undefined : undefined,
      });
      setCreated(order);
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Nuevo envío"
        subtitle={
          me
            ? `Tu operador ${me.tenant.name} recoge y entrega. La guía y el enlace de rastreo salen al instante.`
            : undefined
        }
      />

      {created && (
        <Banner kind="success" onDismiss={() => setCreated(null)}>
          Envío creado con guía <strong>{created.trackingNumber}</strong>.{" "}
          {created.trackingUrl && (
            <>
              Enlace de rastreo para tu cliente:{" "}
              <a
                href={created.trackingUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline"
              >
                {created.trackingUrl}
              </a>
            </>
          )}
        </Banner>
      )}

      <Card title="Datos del destinatario">
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nombre de quien recibe">
            <input name="customerName" className={inputClass} required minLength={2} />
          </Field>
          <Field label="Celular de quien recibe">
            <input name="customerPhone" className={inputClass} required placeholder="+57..." />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Dirección de entrega">
              <input
                name="addressRaw"
                className={inputClass}
                required
                placeholder="Cra 13 # 54-20, Chapinero"
              />
            </Field>
          </div>
          <Field label="Indicaciones (opcional)">
            <input
              name="addressNotes"
              className={inputClass}
              placeholder="Portón verde, preguntar por…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Peso (kg)">
              <input
                name="weightKg"
                type="number"
                step="0.1"
                min="0.1"
                className={inputClass}
                placeholder="1"
              />
            </Field>
            <Field label="Tu referencia (opcional)">
              <input name="externalRef" className={inputClass} placeholder="# pedido interno" />
            </Field>
          </div>

          <div className="sm:col-span-2 space-y-2 rounded-lg border border-niebla p-3">
            <div className="text-xs font-semibold uppercase text-navy/50">
              ¿Dónde recogemos el paquete?
            </div>
            {me?.pickupAddressRaw && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="pickupMode"
                  checked={pickupMode === "REGISTERED"}
                  onChange={() => setPickupMode("REGISTERED")}
                />
                <span>
                  En mi dirección registrada:{" "}
                  <strong>{me.pickupAddressRaw}</strong>
                  {me.pickupNotes && (
                    <span className="text-navy/50"> · {me.pickupNotes}</span>
                  )}
                </span>
              </label>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="pickupMode"
                checked={pickupMode === "CUSTOM"}
                onChange={() => setPickupMode("CUSTOM")}
              />
              <span>En otra dirección puntual</span>
            </label>
            {pickupMode === "CUSTOM" && (
              <div className="grid grid-cols-1 gap-3 pl-6 sm:grid-cols-2">
                <Field label="Dirección de recogida">
                  <input name="pickupAddressRaw" className={inputClass} required />
                </Field>
                <Field label="Indicaciones de recogida">
                  <input name="pickupNotes" className={inputClass} />
                </Field>
              </div>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="pickupMode"
                checked={pickupMode === "NONE"}
                onChange={() => setPickupMode("NONE")}
              />
              <span className="text-navy/70">
                Ya está en el depósito del operador (sin recogida)
              </span>
            </label>
          </div>

          {error && (
            <div className="sm:col-span-2">
              <Banner kind="error" onDismiss={() => setError(null)}>
                {error}
              </Banner>
            </div>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Creando…" : "Crear envío"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
