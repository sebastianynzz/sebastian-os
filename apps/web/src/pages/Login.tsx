import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { Button, Field, inputClass } from "../components/ui";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("admin@demo.moveos.co");
  const [password, setPassword] = useState("moveos123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg"
      >
        <h1 className="text-3xl font-bold text-navy">
          move<span className="text-lima">.</span>
        </h1>
        <p className="mb-6 mt-1 text-sm text-navy/60">
          Plataforma modular de última milla
        </p>
        <div className="space-y-4">
          <Field label="Correo electrónico">
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Contraseña">
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full py-2.5">
            {busy ? "Ingresando…" : "Ingresar"}
          </Button>
        </div>
        <p className="mt-6 rounded-lg bg-niebla px-3 py-2 text-xs text-navy/60">
          Cuenta demo: <span className="font-mono">admin@demo.moveos.co</span> ·{" "}
          <span className="font-mono">moveos123</span>
        </p>
      </form>
    </div>
  );
}
