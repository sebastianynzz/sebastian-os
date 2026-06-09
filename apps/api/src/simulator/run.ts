import "dotenv/config";

/**
 * Simulador de dispositivos telemáticos. Reemplaza al hardware real (Teltonika
 * / Queclink / dongle OBD por BLE) para poder demostrar de punta a punta el
 * GPS, los datos CAN y la inmovilización de motor sin comprar dispositivos.
 *
 * Cada "dispositivo" virtual conduce un vehículo por una trayectoria alrededor
 * de Bogotá, emite pings GPS+CAN a /telematics/ingest, y consulta/confirma los
 * comandos de motor pendientes. Cuando un comando ENGINE_OFF es aceptado, el
 * vehículo se detiene (velocidad 0, motor apagado).
 *
 * Uso: pnpm --filter @moveos/api sim
 * Variables: API_URL (def http://localhost:3000), SIM_EMAIL/SIM_PASSWORD
 *            (def admin demo), SIM_TICK_MS (def 2000).
 */

const API = process.env.API_URL ?? "http://localhost:3000";
const EMAIL = process.env.SIM_EMAIL ?? "admin@demo.moveos.co";
const PASSWORD = process.env.SIM_PASSWORD ?? "moveos123";
const TICK_MS = Number(process.env.SIM_TICK_MS ?? 2000);

interface SimVehicle {
  id: string;
  plate: string;
  type: string;
  isElectric: boolean;
  lat: number;
  lng: number;
  heading: number;
  speedKmh: number;
  engineOn: boolean;
  socPercent: number;
  odometerKm: number;
}

const DEPOT = { lat: 4.6486, lng: -74.0628 }; // Chapinero

let token = "";

async function api<T = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({})) as Promise<T>;
}

async function login() {
  const res = await api<{ token: string }>("POST", "/auth/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  token = res.token;
}

function jitter(deg: number): number {
  return (Math.random() - 0.5) * deg;
}

async function loadVehicles(): Promise<SimVehicle[]> {
  const vehicles = await api<
    {
      id: string;
      plate: string;
      type: string;
      isElectric: boolean;
      socPercent: number | null;
    }[]
  >("GET", "/vehicles");
  return vehicles.map((v, i) => ({
    id: v.id,
    plate: v.plate,
    type: v.type,
    isElectric: v.isElectric,
    lat: DEPOT.lat + jitter(0.04) + i * 0.005,
    lng: DEPOT.lng + jitter(0.04),
    heading: Math.random() * 360,
    speedKmh: 20 + Math.random() * 15,
    engineOn: true,
    socPercent: v.socPercent ?? 90,
    odometerKm: 10000 + Math.random() * 40000,
  }));
}

/** Avanza un vehículo un paso y emite su ping. */
async function step(v: SimVehicle) {
  if (v.engineOn && v.speedKmh > 0) {
    // Giro suave y avance; rebote hacia el depósito si se aleja demasiado.
    v.heading += jitter(40);
    const distKm = (v.speedKmh * (TICK_MS / 1000)) / 3600;
    const rad = (v.heading * Math.PI) / 180;
    v.lat += (distKm / 111) * Math.cos(rad);
    v.lng += (distKm / 111) * Math.sin(rad);
    const dLat = v.lat - DEPOT.lat;
    const dLng = v.lng - DEPOT.lng;
    if (Math.hypot(dLat, dLng) > 0.08) {
      v.heading = (Math.atan2(-dLng, -dLat) * 180) / Math.PI;
    }
    v.odometerKm += distKm;
    if (v.isElectric) v.socPercent = Math.max(5, v.socPercent - distKm * 0.4);
  }

  const movingFuelRpm = v.engineOn && v.speedKmh > 0;
  await api("POST", "/telematics/ingest", {
    plate: v.plate,
    lat: v.lat,
    lng: v.lng,
    speedKmh: v.engineOn ? v.speedKmh : 0,
    heading: v.heading,
    source: "SIMULATOR",
    engineOn: v.engineOn,
    batterySoc: v.isElectric ? Number(v.socPercent.toFixed(1)) : undefined,
    rpm: movingFuelRpm && !v.isElectric ? 1500 + v.speedKmh * 40 : 0,
    odometerKm: Number(v.odometerKm.toFixed(1)),
    fuelLevelPct: v.isElectric ? undefined : 40 + (v.odometerKm % 50),
    coolantTempC: v.engineOn ? 88 + jitter(6) : 30,
  });
}

/** Reclama y ejecuta comandos de motor pendientes para un vehículo. */
async function handleCommands(v: SimVehicle) {
  const pending = await api<{ id: string; type: string }[]>(
    "POST",
    `/telematics/vehicles/${v.id}/commands/poll`,
  );
  for (const cmd of pending) {
    if (cmd.type === "ENGINE_OFF") {
      v.engineOn = false;
      v.speedKmh = 0;
    } else if (cmd.type === "ENGINE_ON") {
      v.engineOn = true;
      v.speedKmh = 20 + Math.random() * 15;
    }
    await api("POST", `/telematics/commands/${cmd.id}/ack`, { accepted: true });
    console.log(`  [${v.plate}] comando ${cmd.type} ejecutado y confirmado`);
  }
}

async function main() {
  console.log(`Simulador telemático → ${API}`);
  await login();
  const vehicles = await loadVehicles();
  console.log(`Conduciendo ${vehicles.length} vehículos. Ctrl-C para detener.`);

  // Bucle principal.
  for (;;) {
    for (const v of vehicles) {
      try {
        await handleCommands(v);
        await step(v);
      } catch (err) {
        console.error(`[${v.plate}]`, err instanceof Error ? err.message : err);
      }
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
