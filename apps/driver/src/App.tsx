import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  apiOrQueue,
  compressImage,
  flushQueue,
  getToken,
  queueSize,
  setToken,
  uploadPodPhoto,
} from "./api";

interface Stop {
  id: string;
  kind: "PICKUP" | "DELIVERY";
  sequence: number;
  etaMin: number;
  status: string;
  order: {
    id: string;
    customerName: string;
    customerPhone: string;
    addressRaw: string;
    addressNotes: string | null;
    lat: number | null;
    lng: number | null;
    pickupAddressRaw: string | null;
    pickupNotes: string | null;
    pickupLat: number | null;
    pickupLng: number | null;
  };
  pod: unknown | null;
}
interface DriverRoute {
  id: string;
  status: string;
  vehicle: { plate: string; type: string; isElectric: boolean };
  stops: Stop[];
}

const FAIL_REASONS = [
  ["CLIENTE_AUSENTE", "Cliente ausente"],
  ["DIRECCION_ERRADA", "Dirección errada"],
  ["RECHAZO_PRODUCTO", "Rechazó el producto"],
  ["ZONA_INSEGURA", "Zona insegura"],
  ["OTRO", "Otro"],
] as const;

function formatEta(etaMin: number): string {
  const h = Math.floor(etaMin / 60);
  const m = etaMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function useGeo() {
  const pos = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        pos.current = { lat: p.coords.latitude, lng: p.coords.longitude };
      },
      () => {},
      { enableHighAccuracy: true },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return pos;
}

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [route, setRoute] = useState<DriverRoute | null>(null);
  const [activeStop, setActiveStop] = useState<Stop | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(queueSize());
  const geo = useGeo();

  const load = useCallback(async () => {
    if (!getToken()) return;
    try {
      setRoute(await api<DriverRoute | null>("GET", "/routes/driver/today"));
    } catch {
      // sin red: se mantiene la última vista
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, authed]);

  // Cola offline: reintentar al volver la señal y refrescar contador.
  useEffect(() => {
    const flush = async () => {
      const n = await flushQueue();
      setPending(queueSize());
      if (n > 0) {
        setMessage(`${n} acciones sincronizadas`);
        await load();
      }
    };
    window.addEventListener("online", flush);
    const interval = setInterval(flush, 20000);
    return () => {
      window.removeEventListener("online", flush);
      clearInterval(interval);
    };
  }, [load]);

  // Telemetría: ping de posición cada 30 s con la ruta activa.
  useEffect(() => {
    if (!route || route.status !== "IN_PROGRESS") return;
    const interval = setInterval(() => {
      if (!geo.current) return;
      void apiOrQueue("/tracking/pings", {
        lat: geo.current.lat,
        lng: geo.current.lng,
        routeId: route.id,
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [route, geo]);

  if (!authed) {
    return <Login onLogin={() => setAuthed(true)} />;
  }

  async function startRoute() {
    if (!route) return;
    await api("POST", `/routes/${route.id}/start`);
    await load();
  }

  async function panic() {
    if (!route) return;
    await apiOrQueue("/safety/panic", {
      routeId: route.id,
      lat: geo.current?.lat,
      lng: geo.current?.lng,
    });
    setMessage("🚨 Alerta de pánico enviada a la central");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-navy px-4 py-3 text-white">
        <div>
          <div className="font-bold">
            move<span className="text-lima">.</span> conductor
          </div>
          {route && (
            <div className="text-xs opacity-80">
              {route.vehicle.plate} {route.vehicle.isElectric && "⚡"}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pending > 0 && (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold">
              {pending} sin sync
            </span>
          )}
          <button
            onClick={panic}
            aria-label="Enviar alerta de pánico a la central"
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold active:bg-red-700"
          >
            SOS
          </button>
          <button
            onClick={() => {
              setToken(null);
              setAuthed(false);
            }}
            className="text-xs underline opacity-80"
          >
            Salir
          </button>
        </div>
      </header>

      {message && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 bg-emerald-100 px-4 py-2 text-sm text-emerald-800"
        >
          <span>{message}</span>
          <button
            onClick={() => setMessage(null)}
            aria-label="Cerrar aviso"
            className="shrink-0 font-bold opacity-60"
          >
            ✕
          </button>
        </div>
      )}

      <main className="flex-1 space-y-3 p-4">
        {!route && (
          <div className="rounded-xl bg-white p-6 text-center text-slate-500 shadow-sm">
            No tiene ruta asignada hoy.
            <button onClick={load} className="mt-3 block w-full rounded-lg bg-slate-100 py-2 text-sm font-medium">
              Actualizar
            </button>
          </div>
        )}

        {route?.status === "DISPATCHED" && (
          <button
            onClick={startRoute}
            className="w-full rounded-xl bg-lima py-4 text-lg font-bold text-navy active:brightness-95"
          >
            Iniciar ruta ({route.stops.length} paradas)
          </button>
        )}

        {route?.stops.map((stop) => (
          <StopCard
            key={stop.id}
            stop={stop}
            routeActive={route.status === "IN_PROGRESS"}
            onAction={() => setActiveStop(stop)}
            onArrive={async () => {
              await apiOrQueue(`/routes/stops/${stop.id}/arrive`);
              setPending(queueSize());
              await load();
            }}
          />
        ))}
      </main>

      {activeStop && (
        <StopActionSheet
          stop={activeStop}
          geo={geo.current}
          onClose={() => setActiveStop(null)}
          onDone={async (queued) => {
            setActiveStop(null);
            setPending(queueSize());
            if (queued) setMessage("Sin señal: la entrega se sincronizará automáticamente");
            await load();
          }}
        />
      )}
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("carlos@demo.moveos.co");
  const [password, setPassword] = useState("moveos123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ token: string }>("POST", "/auth/login", {
        email,
        password,
      });
      setToken(res.token);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-navy">move<span className="text-lima">.</span> conductor</h1>
        <input
          className="w-full rounded-lg border border-cielo px-3 py-3 text-base focus:border-navy focus:outline-none"
          type="email"
          placeholder="Correo"
          aria-label="Correo electrónico"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-cielo px-3 py-3 text-base focus:border-navy focus:outline-none"
          type="password"
          placeholder="Contraseña"
          aria-label="Contraseña"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-navy py-3 font-bold text-white disabled:opacity-60"
        >
          {busy ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}

function StopCard({
  stop,
  routeActive,
  onAction,
  onArrive,
}: {
  stop: Stop;
  routeActive: boolean;
  onAction: () => void;
  onArrive: () => void;
}) {
  const done = stop.status === "COMPLETED" || stop.status === "FAILED";
  const isPickup = stop.kind === "PICKUP";
  // En recogida se muestra la dirección de origen; en entrega, la del destino.
  const address = isPickup
    ? stop.order.pickupAddressRaw ?? stop.order.addressRaw
    : stop.order.addressRaw;
  const notes = isPickup ? stop.order.pickupNotes : stop.order.addressNotes;
  return (
    <div
      className={`rounded-xl bg-white p-4 shadow-sm ${done ? "opacity-60" : ""} ${
        isPickup && !done ? "border-l-4 border-cielo" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold">
            <span
              className={`rounded px-1.5 py-0.5 ${
                isPickup ? "bg-cielo/40 text-navy" : "bg-lima/50 text-navy"
              }`}
            >
              {isPickup ? "📦 RECOGER" : "📍 ENTREGAR"}
            </span>
            <span className="text-navy/60">
              Parada {stop.sequence} · ETA {formatEta(stop.etaMin)}
            </span>
          </div>
          <div className="mt-1 font-semibold">{stop.order.customerName}</div>
          <div className="text-sm text-slate-600">{address}</div>
          {notes && (
            <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
              📍 {notes}
            </div>
          )}
        </div>
        <a
          href={`tel:${stop.order.customerPhone}`}
          className="rounded-lg bg-slate-100 px-3 py-2 text-sm"
        >
          📞
        </a>
      </div>

      {routeActive && !done && (
        <div className="mt-3 flex gap-2">
          {stop.status === "PENDING" && (
            <button
              onClick={onArrive}
              className="flex-1 rounded-lg border border-navy py-2.5 text-sm font-bold text-navy"
            >
              Llegué
            </button>
          )}
          <button
            onClick={onAction}
            className="flex-1 rounded-lg bg-navy py-2.5 text-sm font-bold text-white"
          >
            {isPickup ? "Confirmar recogida" : "Gestionar entrega"}
          </button>
        </div>
      )}
      {done && (
        <div className="mt-2 text-sm font-medium">
          {stop.status === "COMPLETED"
            ? isPickup
              ? "✅ Recogido"
              : "✅ Entregado"
            : "❌ No completado"}
        </div>
      )}
    </div>
  );
}

function StopActionSheet({
  stop,
  geo,
  onClose,
  onDone,
}: {
  stop: Stop;
  geo: { lat: number; lng: number } | null;
  onClose: () => void;
  onDone: (queued: boolean) => void;
}) {
  const [mode, setMode] = useState<"deliver" | "fail">("deliver");
  const [receivedBy, setReceivedBy] = useState("");
  const [failReason, setFailReason] = useState("CLIENTE_AUSENTE");
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const isPickup = stop.kind === "PICKUP";
  const refLat = isPickup ? stop.order.pickupLat : stop.order.lat;
  const refLng = isPickup ? stop.order.pickupLng : stop.order.lng;
  const sheetAddress = isPickup
    ? stop.order.pickupAddressRaw ?? stop.order.addressRaw
    : stop.order.addressRaw;
  // Fallback demo: si el navegador no da GPS, usar la coordenada de la parada.
  const lat = geo?.lat ?? refLat ?? undefined;
  const lng = geo?.lng ?? refLng ?? undefined;

  async function onPickPhoto(file: File) {
    setError(null);
    setBusy(true);
    try {
      const blob = await compressImage(file);
      setPhoto((prev) => {
        if (prev) URL.revokeObjectURL(prev.preview);
        return { blob, preview: URL.createObjectURL(blob) };
      });
    } catch {
      setError("No se pudo procesar la foto");
    }
  }

  async function deliver() {
    setError(null);
    setBusy(true);
    try {
      // Subir la foto primero; si no hay señal se entrega sin foto.
      let photoUrl: string | undefined;
      let photoSkipped = false;
      if (photo) {
        const url = await uploadPodPhoto(photo.blob);
        if (url) photoUrl = url;
        else photoSkipped = true;
      }

      const types: string[] = [];
      if (photoUrl) types.push("PHOTO");
      if (lat !== undefined) types.push("GEOFENCE");
      if (types.length === 0) types.push("PHOTO");

      const { queued } = await apiOrQueue(`/routes/stops/${stop.id}/complete`, {
        types,
        photoUrl,
        receivedBy: receivedBy || undefined,
        lat,
        lng,
      });
      if (photoSkipped) {
        console.warn("Foto no subida (sin señal): entrega registrada sin foto");
      }
      onDone(queued);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function fail() {
    setError(null);
    setBusy(true);
    try {
      const { queued } = await apiOrQueue(`/routes/stops/${stop.id}/fail`, {
        reason: failReason,
        lat,
        lng,
      });
      onDone(queued);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Gestionar entrega de la parada ${stop.sequence}`}
        className="w-full rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Contexto de la parada: evita confirmar la entrega equivocada. */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold text-navy/70">
              Parada {stop.sequence}
            </div>
            <div className="truncate font-semibold">{stop.order.customerName}</div>
            <div className="truncate text-sm text-slate-600">{sheetAddress}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 rounded-lg bg-niebla px-3 py-1.5 text-sm font-bold text-navy"
          >
            ✕
          </button>
        </div>
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setMode("deliver")}
            className={`flex-1 rounded-lg py-2 text-sm font-bold ${mode === "deliver" ? "bg-lima text-navy" : "bg-niebla"}`}
          >
            {isPickup ? "Recoger" : "Entregar"}
          </button>
          <button
            onClick={() => setMode("fail")}
            className={`flex-1 rounded-lg py-2 text-sm font-bold ${mode === "fail" ? "bg-red-600 text-white" : "bg-niebla"}`}
          >
            No se pudo
          </button>
        </div>

        {mode === "deliver" ? (
          <div className="space-y-3">
            {!isPickup && (
              <input
                className="w-full rounded-lg border border-cielo px-3 py-3 focus:border-navy focus:outline-none"
                placeholder="¿Quién recibe?"
                aria-label="Nombre de quien recibe"
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
              />
            )}
            {/* Evidencia fotográfica del POD */}
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              aria-label="Foto de evidencia de entrega"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPickPhoto(f);
                e.target.value = "";
              }}
            />
            {photo ? (
              <div className="flex items-center gap-3">
                <img
                  src={photo.preview}
                  alt="Evidencia de entrega"
                  className="h-20 w-20 rounded-lg border border-cielo/60 object-cover"
                />
                <button
                  onClick={() => photoRef.current?.click()}
                  className="rounded-lg border border-navy px-3 py-2 text-sm font-medium text-navy"
                >
                  Cambiar foto
                </button>
              </div>
            ) : (
              <button
                onClick={() => photoRef.current?.click()}
                className="w-full rounded-lg border border-dashed border-navy/40 py-3 text-sm font-medium text-navy/70"
              >
                📷 Tomar foto de evidencia
              </button>
            )}

            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button
              onClick={deliver}
              disabled={busy}
              className="w-full rounded-xl bg-lima py-4 text-lg font-bold text-navy active:brightness-95 disabled:opacity-60"
            >
              {busy
                ? "Enviando…"
                : isPickup
                  ? "Confirmar recogida"
                  : "Confirmar entrega"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {FAIL_REASONS.map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFailReason(value)}
                  className={`rounded-lg border py-2.5 text-sm font-medium ${failReason === value ? "border-red-600 bg-red-50 text-red-700" : "border-slate-200"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button
              onClick={fail}
              disabled={busy}
              className="w-full rounded-xl bg-red-600 py-4 text-lg font-bold text-white active:bg-red-700 disabled:opacity-60"
            >
              {busy ? "Registrando…" : "Registrar fallo"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
