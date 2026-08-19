import { useState, type FormEvent } from "react";
import { Info } from "lucide-react";
import { useAuth } from "../auth";
import { Button } from "../components/ui";
import { BrandDescriptor, LuzVerde, Wordmark } from "../components/brand";

/* Credenciales de la cuenta demo: pre-llenan el formulario y se muestran en la
 * fila copiable inferior. Una sola fuente para no divergir. */
const DEMO_EMAIL = "admin@demo.dalego.co";
const DEMO_PASSWORD = "dalego123";

/* Input del login (mock 5a): 13.5px, borde fuerte, foco navy con anillo suave
 * de 3px (rgba navy al 12%). */
const loginInputClass =
  "w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-[13.5px] text-navy placeholder:text-text-tertiary transition duration-200 ease-brand focus:border-navy focus:outline-none focus:ring-[3px] focus:ring-navy/12";

/**
 * Login — propuesta 5a del revamp: marca protagonista sobre navy profundo con
 * glow limón sutil, tarjeta blanca elevada y CTA limón (combinación firma).
 */
export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de autenticación");
    } finally {
      setBusy(false);
    }
  }

  async function copyDemo() {
    try {
      await navigator.clipboard.writeText(`${DEMO_EMAIL}\n${DEMO_PASSWORD}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Portapapeles no disponible (permiso denegado): sin efecto.
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-navy-900 p-6 sm:p-10"
      // Lavados radiales de marca (solo gradientes, tokens de :root):
      // limón 14% arriba-derecha, cielo 12% abajo-izquierda.
      style={{
        backgroundImage:
          "radial-gradient(420px 300px at 85% 0%, color-mix(in srgb, var(--verde) 12%, transparent), transparent), radial-gradient(360px 260px at 0% 100%, color-mix(in srgb, var(--verde-profundo) 22%, transparent), transparent)",
      }}
    >
      <div className="flex w-[340px] max-w-full flex-col gap-[18px]">
        <div>
          <Wordmark size={34} className="text-humo" />
          {/* El descriptor institucional va SOLO aquí (manual de marca). */}
          <BrandDescriptor className="mt-3" />
          <p className="mt-2 text-[13.5px] leading-relaxed text-gris-senal">
            La luz verde de tu última milla <LuzVerde className="ml-0.5" />
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-3 rounded-[14px] bg-surface p-[22px] border border-border"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-text-secondary">
              Correo electrónico
            </span>
            <input
              className={loginInputClass}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-text-secondary">
              Contraseña
            </span>
            <input
              className={loginInputClass}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="cta"
            disabled={busy}
            className="w-full py-2.5 text-sm"
          >
            {busy ? "Ingresando…" : "Ingresar"}
          </Button>
        </form>

        {/* Credenciales demo: fila "vidrio" copiable sobre el lienzo navy. */}
        <div className="flex items-center gap-2 rounded-[10px] border border-white/14 bg-white/6 px-3 py-[9px] text-[11.5px] text-cielo">
          <Info
            aria-hidden="true"
            className="h-[13px] w-[13px] shrink-0 text-lima"
            strokeWidth={2}
          />
          <span className="min-w-0">
            Demo: <span className="font-mono text-sky-50">{DEMO_EMAIL}</span> ·{" "}
            <span className="font-mono text-sky-50">{DEMO_PASSWORD}</span>
          </span>
          <button
            type="button"
            onClick={copyDemo}
            className="ml-auto shrink-0 font-semibold text-lima transition duration-200 ease-brand hover:text-lima-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lima"
          >
            {copied ? "Copiado ✓" : "Copiar"}
          </button>
        </div>
      </div>
    </div>
  );
}
