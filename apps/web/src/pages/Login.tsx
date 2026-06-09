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
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-2xl font-bold text-indigo-700">MoveOS</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">
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
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? "Ingresando…" : "Ingresar"}
          </Button>
        </div>
        <p className="mt-6 text-xs text-slate-400">
          Demo: admin@demo.moveos.co / moveos123
        </p>
      </form>
    </div>
  );
}
