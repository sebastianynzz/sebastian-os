import { useEffect, useState } from "react";
import { ReceiptText, Save } from "lucide-react";
import {
  INVOICE_STATUS_LABELS,
  billingProfileSchema,
  type InvoiceStatus,
} from "@moveos/shared";
import { api } from "../api";
import { useToast } from "../toast";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  PageHeader,
  inputClass,
  tableRowClass,
  theadRowClass,
} from "../components/ui";
import { formatDateTimeBogota } from "../format";

/**
 * Controles › Facturación (Tier 3 §13): datos fiscales de la suscripción SaaS +
 * historial de facturas (las emite la plataforma). daleGo no procesa pagos en la
 * app (sin COD): es una vista de cuenta. Perfil editable por ADMIN.
 */

interface Profile {
  legalName: string | null;
  nit: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
  plan: string;
}
interface Invoice {
  id: string;
  number: string;
  periodMonth: string;
  amountCop: number;
  status: string;
  issuedAt: string;
  dueAt: string | null;
}
interface BillingData {
  profile: Profile;
  invoices: Invoice[];
}

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const STATUS_TONE: Record<string, "success" | "info" | "warning" | "neutral"> = {
  PAID: "success",
  ISSUED: "info",
  DRAFT: "neutral",
  VOID: "warning",
};

type FormState = {
  legalName: string;
  nit: string;
  billingEmail: string;
  billingAddress: string;
};

export default function ControlesFacturacion() {
  const toast = useToast();
  const [data, setData] = useState<BillingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      const d = await api<BillingData>("GET", "/controls/billing");
      setData(d);
      setForm({
        legalName: d.profile.legalName ?? "",
        nit: d.profile.nit ?? "",
        billingEmail: d.profile.billingEmail ?? "",
        billingAddress: d.profile.billingAddress ?? "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la facturación.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!form) return;
    const payload = {
      legalName: form.legalName.trim() || null,
      nit: form.nit.trim() || null,
      billingEmail: form.billingEmail.trim() || null,
      billingAddress: form.billingAddress.trim() || null,
    };
    const parsed = billingProfileSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(new Error(parsed.error.issues[0]?.message ?? "Datos inválidos"));
      return;
    }
    setSaving(true);
    try {
      await api("PATCH", "/controls/billing", parsed.data);
      toast.success("Datos de facturación guardados.");
      await load();
    } catch (err) {
      toast.error(err, { retry: () => void save() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Facturación"
        subtitle="Tus datos fiscales y el historial de facturas de tu suscripción. daleGo no cobra pagos en la app: las facturas las emite el operador de plataforma."
      />

      {error && (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      )}

      {form === null || data === null ? (
        <Card>
          <Loading label="Cargando facturación…" />
        </Card>
      ) : (
        <>
          <Card title={`Datos fiscales · Plan ${data.profile.plan}`}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Razón social">
                <input
                  className={inputClass}
                  value={form.legalName}
                  onChange={(e) => setForm((f) => f && { ...f, legalName: e.target.value })}
                  maxLength={160}
                />
              </Field>
              <Field label="NIT / ID fiscal">
                <input
                  className={inputClass}
                  value={form.nit}
                  onChange={(e) => setForm((f) => f && { ...f, nit: e.target.value })}
                  maxLength={40}
                />
              </Field>
              <Field label="Correo de facturación">
                <input
                  type="email"
                  className={inputClass}
                  value={form.billingEmail}
                  onChange={(e) => setForm((f) => f && { ...f, billingEmail: e.target.value })}
                />
              </Field>
              <Field label="Dirección de facturación">
                <input
                  className={inputClass}
                  value={form.billingAddress}
                  onChange={(e) =>
                    setForm((f) => f && { ...f, billingAddress: e.target.value })
                  }
                  maxLength={200}
                />
              </Field>
              <div className="sm:col-span-2">
                <Button
                  variant="cta"
                  icon={<Save strokeWidth={2} />}
                  onClick={save}
                  disabled={saving}
                >
                  {saving ? "Guardando…" : "Guardar datos"}
                </Button>
              </div>
            </div>
          </Card>

          <Card title="Historial de facturas">
            {data.invoices.length === 0 ? (
              <EmptyState
                icon={<ReceiptText aria-hidden="true" className="h-8 w-8" strokeWidth={1.75} />}
                phrase="Tu operación, siempre en orden."
              >
                Aún no hay facturas. Aparecerán aquí cuando el operador las emita.
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={theadRowClass}>
                      <th className="py-2 pr-4 font-medium">Factura</th>
                      <th className="py-2 pr-4 font-medium">Periodo</th>
                      <th className="py-2 pr-4 font-medium">Monto</th>
                      <th className="py-2 pr-4 font-medium">Emitida</th>
                      <th className="py-2 pr-4 font-medium">Vence</th>
                      <th className="py-2 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invoices.map((inv) => (
                      <tr key={inv.id} className={tableRowClass}>
                        <td className="py-2 pr-4 font-mono text-xs font-semibold text-asfalto">
                          {inv.number}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs text-text-secondary">
                          {inv.periodMonth}
                        </td>
                        <td className="py-2 pr-4 text-asfalto">{COP.format(inv.amountCop)}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-text-secondary">
                          {formatDateTimeBogota(inv.issuedAt)}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs text-text-secondary">
                          {inv.dueAt ? formatDateTimeBogota(inv.dueAt) : "—"}
                        </td>
                        <td className="py-2">
                          <Badge tone={STATUS_TONE[inv.status] ?? "neutral"}>
                            {INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] ?? inv.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
