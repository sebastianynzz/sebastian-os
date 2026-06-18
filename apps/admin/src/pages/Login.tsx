import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { Button, inputClass } from "../components/ui";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("ops@moveos.co");
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
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8"
      >
        <h1 className="text-3xl font-bold text-niebla">
          <img src="/move-lime.svg" alt="move" className="h-6 w-auto" />
        </h1>
        <p className="mb-6 mt-1 text-sm text-cielo">Panel de plataforma</p>
        <div className="space-y-4">
          <input
            className={inputClass}
            type="email"
            placeholder="Correo del operador"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className={inputClass}
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? "Ingresando…" : "Ingresar"}
          </Button>
        </div>
        <p className="mt-6 text-xs text-white/30">Demo: ops@moveos.co / moveos123</p>
      </form>
    </div>
  );
}
