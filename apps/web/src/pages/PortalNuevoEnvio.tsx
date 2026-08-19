import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { api } from "../api";
import { useToast } from "../toast";
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

interface ServiceOption {
  id: string;
  name: string;
  identifier: string;
  completionDeadlineMin: number;
}

interface CustomPropOption {
  id: string;
  name: string;
}

interface CreatedOrder {
  trackingNumber: string | null;
  trackingUrl: string | null;
}

interface AddressCheck {
  confidence: number;
  ambiguous: boolean;
  knownAddress: boolean;
  source: string;
  hasZones: boolean;
  serviceable: boolean;
  coverageZones: string[];
}

/** Aviso de validación en vivo bajo el campo de dirección (limón = conocida). */
function AddressHint({
  tone,
  icon,
  children,
}: {
  tone: "lima" | "warning";
  icon: ReactNode;
  children: ReactNode;
}) {
  const tones = {
    lima: "bg-verde/30 text-asfalto",
    warning: "bg-warning-bg text-warning",
  };
  return (
    <p
      className={`mt-1.5 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ${tones[tone]}`}
    >
      <span aria-hidden="true" className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
        {icon}
      </span>
      {children}
    </p>
  );
}

export default function PortalNuevoEnvio() {
  const [me, setMe] = useState<PortalMe | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  // Campos personalizados del operador (Tier 2 §9) que el negocio rellena.
  const [customProps, setCustomProps] = useState<CustomPropOption[]>([]);
  const [pickupMode, setPickupMode] = useState<"REGISTERED" | "CUSTOM" | "NONE">("REGISTERED");
  const toast = useToast();
  const [created, setCreated] = useState<CreatedOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [addressCheck, setAddressCheck] = useState<AddressCheck | null>(null);
  const [checkingAddress, setCheckingAddress] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  /**
   * Validación de dirección al salir del campo (el moat como feature del
   * cliente): avisa "dirección ambigua" ANTES de que el paquete salga.
   */
  async function validateAddress(addressRaw: string) {
    if (addressRaw.trim().length < 5) {
      setAddressCheck(null);
      return;
    }
    setCheckingAddress(true);
    try {
      setAddressCheck(
        await api<AddressCheck>("POST", "/portal/address/validate", { addressRaw }),
      );
    } catch {
      setAddressCheck(null);
    } finally {
      setCheckingAddress(false);
    }
  }

  useEffect(() => {
    void api<PortalMe>("GET", "/portal/me").then((m) => {
      setMe(m);
      if (!m.pickupAddressRaw) setPickupMode("CUSTOM");
    });
    void api<ServiceOption[]>("GET", "/portal/services")
      .then(setServices)
      .catch(() => {});
    void api<CustomPropOption[]>("GET", "/portal/custom-properties")
      .then(setCustomProps)
      .catch(() => {});
  }, []);

  async function copyTrackingLink(url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1500);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreated(null);
    setBusy(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    // Campos personalizados (Tier 2 §9): inputs nombrados cf:<id>.
    const customFields: Record<string, string> = {};
    for (const p of customProps) {
      const v = data.get(`cf:${p.id}`);
      if (typeof v === "string" && v.trim() !== "") customFields[p.id] = v.trim();
    }
    try {
      const order = await api<CreatedOrder>("POST", "/portal/orders", {
        customerName: data.get("customerName"),
        customerPhone: data.get("customerPhone"),
        addressRaw: data.get("addressRaw"),
        addressNotes: data.get("addressNotes") || undefined,
        externalRef: data.get("externalRef") || undefined,
        serviceId: data.get("serviceId") || undefined,
        weightKg: data.get("weightKg") ? Number(data.get("weightKg")) : undefined,
        ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
        pickupMode,
        pickupAddressRaw:
          pickupMode === "CUSTOM" ? data.get("pickupAddressRaw") : undefined,
        pickupNotes:
          pickupMode === "CUSTOM" ? data.get("pickupNotes") || undefined : undefined,
      });
      setCreated(order);
      form.reset();
      setAddressCheck(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
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
          Envío creado con guía{" "}
          <strong className="font-mono">{created.trackingNumber}</strong>.{" "}
          {created.trackingUrl && (
            <>
              Enlace de rastreo para tu cliente:{" "}
              <a
                href={created.trackingUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline underline-offset-2"
              >
                {created.trackingUrl}
              </a>{" "}
              <Button
                variant="secondary"
                icon={copiedLink ? <Check strokeWidth={2} /> : <Copy strokeWidth={2} />}
                onClick={() => {
                  if (created.trackingUrl) void copyTrackingLink(created.trackingUrl);
                }}
                className="ml-1 align-middle"
              >
                {copiedLink ? "¡Copiado!" : "Copiar rastreo"}
              </Button>
            </>
          )}
        </Banner>
      )}

      <Card>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Quien recibe">
            <input name="customerName" className={inputClass} required minLength={2} />
          </Field>
          <Field label="Celular">
            <input name="customerPhone" className={inputClass} required placeholder="+57..." />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Dirección de entrega">
              <input
                name="addressRaw"
                className={inputClass}
                required
                placeholder="Cra 13 # 54-20, Chapinero"
                onBlur={(e) => void validateAddress(e.target.value)}
              />
            </Field>
            {checkingAddress && (
              <p className="mt-1.5 text-xs text-text-tertiary">Verificando dirección…</p>
            )}
            {addressCheck && !checkingAddress && (
              addressCheck.knownAddress ? (
                <AddressHint tone="lima" icon={<Check strokeWidth={2.5} />}>
                  Dirección conocida — confirmada en entregas anteriores
                </AddressHint>
              ) : addressCheck.ambiguous ? (
                <AddressHint tone="warning" icon={<AlertTriangle strokeWidth={2} />}>
                  Esta dirección es ambigua. Revisa la nomenclatura o agrega una
                  referencia (ej: «frente al colegio…») para evitar una entrega
                  fallida.
                </AddressHint>
              ) : (
                <AddressHint tone="lima" icon={<Check strokeWidth={2.5} />}>
                  Dirección verificada.
                </AddressHint>
              )
            )}
            {/* Cobertura por zona (D5): aviso B2B cuando el destino cae fuera de
                las zonas del operador. No bloquea el envío. */}
            {addressCheck && !checkingAddress && addressCheck.hasZones && !addressCheck.serviceable && (
              <AddressHint tone="warning" icon={<AlertTriangle strokeWidth={2} />}>
                Este destino está fuera de las zonas de cobertura de tu operador.
                Puedes crear el envío, pero confírmalo con ellos.
              </AddressHint>
            )}
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
            <Field label="Tu referencia">
              <input name="externalRef" className={inputClass} placeholder="# pedido interno" />
            </Field>
          </div>

          {services.length > 0 && (
            <div className="sm:col-span-2">
              <Field label="Servicio (opcional)">
                <select name="serviceId" className={inputClass} defaultValue="">
                  <option value="">— El operador asigna —</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.identifier})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {customProps.length > 0 && (
            <div className="sm:col-span-2 grid grid-cols-1 gap-4 rounded-lg border border-border p-3 sm:grid-cols-2">
              <div className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                Datos adicionales
              </div>
              {customProps.map((p) => (
                <Field key={p.id} label={p.name}>
                  <input name={`cf:${p.id}`} className={inputClass} />
                </Field>
              ))}
            </div>
          )}

          <div className="sm:col-span-2 space-y-2 rounded-lg border border-border p-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary">
              ¿Dónde recogemos?
            </div>
            {me?.pickupAddressRaw && (
              <label
                className={`flex items-start gap-2 text-sm ${
                  pickupMode === "REGISTERED" ? "text-asfalto" : "text-text-secondary"
                }`}
              >
                <input
                  type="radio"
                  name="pickupMode"
                  className="mt-1 accent-asfalto"
                  checked={pickupMode === "REGISTERED"}
                  onChange={() => setPickupMode("REGISTERED")}
                />
                <span>
                  Mi dirección registrada: <strong>{me.pickupAddressRaw}</strong>
                  {me.pickupNotes && (
                    <span className="text-text-secondary"> · {me.pickupNotes}</span>
                  )}
                </span>
              </label>
            )}
            <label
              className={`flex items-start gap-2 text-sm ${
                pickupMode === "CUSTOM" ? "text-asfalto" : "text-text-secondary"
              }`}
            >
              <input
                type="radio"
                name="pickupMode"
                className="mt-1 accent-asfalto"
                checked={pickupMode === "CUSTOM"}
                onChange={() => setPickupMode("CUSTOM")}
              />
              <span>Otra dirección puntual</span>
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
            <label
              className={`flex items-start gap-2 text-sm ${
                pickupMode === "NONE" ? "text-asfalto" : "text-text-secondary"
              }`}
            >
              <input
                type="radio"
                name="pickupMode"
                className="mt-1 accent-asfalto"
                checked={pickupMode === "NONE"}
                onChange={() => setPickupMode("NONE")}
              />
              <span>Ya está en el depósito del operador</span>
            </label>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="cta" disabled={busy} className="w-full">
              {busy ? "Creando…" : "Crear envío — guía y rastreo al instante"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
