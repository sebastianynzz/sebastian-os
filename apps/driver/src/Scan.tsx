import { useEffect, useRef, useState } from "react";
import { apiOrQueue } from "./api";

/**
 * Escaneo de paquete (D3): vincula el bulto a la parada con la cámara que la
 * app ya usa para el POD. La validación es LOCAL (la guía viene en la ruta,
 * sirve sin señal); el evento de cadena de custodia viaja por la cola
 * offline y el servidor re-verifica al registrarlo.
 *
 * Usa BarcodeDetector (Chrome/Android — el teléfono real del mensajero);
 * donde no exista hay entrada manual de la guía como respaldo.
 */

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

function getBarcodeDetector(): BarcodeDetectorLike | null {
  const Ctor = (window as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({
      formats: ["qr_code", "code_128", "code_39", "ean_13"],
    });
  } catch {
    return null;
  }
}

export type ScanResult = { match: boolean; code: string };

export default function ScanSheet({
  stopId,
  expected,
  onResult,
  onClose,
}: {
  stopId: string;
  /** Guía esperada (MV-XXXXXXXX) — la trae la ruta, disponible offline. */
  expected: string | null;
  onResult: (result: ScanResult) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState(false);
  const [manual, setManual] = useState("");
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const doneRef = useRef(false);

  async function handleCode(code: string) {
    if (doneRef.current) return;
    doneRef.current = true;
    const normalized = code.trim().toUpperCase();
    const match =
      expected !== null && normalized === expected.trim().toUpperCase();
    // Cadena de custodia: el servidor re-verifica y escribe la bitácora;
    // sin señal queda en la cola offline.
    void apiOrQueue(`/routes/stops/${stopId}/scan`, { code: normalized });
    onResult({ match, code: normalized });
  }

  useEffect(() => {
    detectorRef.current = getBarcodeDetector();
    let stream: MediaStream | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    // Si el conductor cierra la hoja mientras getUserMedia sigue en vuelo,
    // el cleanup corre con stream=null: la bandera apaga la cámara recién
    // adquirida en vez de dejarla encendida el resto del turno.
    let cancelled = false;

    void (async () => {
      if (!detectorRef.current || !navigator.mediaDevices?.getUserMedia) {
        setCameraError(true);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        const video = videoRef.current;
        if (cancelled || !video) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        interval = setInterval(() => {
          const detector = detectorRef.current;
          const v = videoRef.current;
          if (!detector || !v || v.readyState < 2) return;
          detector
            .detect(v)
            .then((codes) => {
              const first = codes[0];
              if (first?.rawValue) void handleCode(first.rawValue);
            })
            .catch(() => {});
        }, 400);
      } catch {
        setCameraError(true);
      }
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Escanear paquete"
        className="w-full rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">📷 Escanear paquete</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg bg-niebla px-3 py-1.5 text-sm font-bold text-navy"
          >
            ✕
          </button>
        </div>
        {expected && (
          <p className="mb-2 text-xs text-slate-500">
            Guía esperada: <span className="font-mono font-bold">{expected}</span>
          </p>
        )}
        {!cameraError ? (
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-56 w-full rounded-xl bg-black object-cover"
          />
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Este dispositivo no soporta escaneo con cámara — ingresa la guía
            del paquete manualmente.
          </p>
        )}
        {/* Respaldo manual: siempre disponible (etiqueta dañada, cámara sin permiso). */}
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim().length >= 3) void handleCode(manual);
          }}
        >
          <input
            className="flex-1 rounded-lg border border-cielo px-3 py-2.5 font-mono text-sm uppercase focus:border-navy focus:outline-none"
            placeholder="MV-XXXXXXXX"
            aria-label="Guía del paquete"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-lg bg-navy px-4 py-2.5 text-sm font-bold text-white"
          >
            Verificar
          </button>
        </form>
      </div>
    </div>
  );
}
