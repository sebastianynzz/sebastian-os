# MoveOS — Target Architecture

How MoveOS is built today and where it is going. The guiding principle: the
**telemetry/IoT plane is separate from the web plane** — different protocols,
scaling, and hosting — which is why MoveOS is not a single serverless app.

## Four tiers

```mermaid
flowchart TB
    subgraph CLIENTS["1 · Clients"]
        WEB["Tenant dashboard<br/>(React web)"]
        ADMIN["Platform admin<br/>(React web — Round 2)"]
        DRV["Driver app<br/>(web/PWA now → Capacitor Android)"]
        TRACK["Customer tracking<br/>(public web) + WhatsApp"]
        DEV["Vehicle devices<br/>GPS · CAN bus · relay (engine on/off)"]
    end

    subgraph EDGE["2 · Edge / API"]
        API["Fastify API<br/>REST (+ WebSocket — Next)"]
        TELE["Telemetry ingestion<br/>/telematics/ingest"]
        CMD["Command service<br/>engine on/off · speed=0 interlock · audit"]
        WORK["Background workers<br/>notifications · geocoding (Next: pg-boss)"]
    end

    subgraph DATA["3 · Data"]
        PG[("PostgreSQL<br/>operational + telemetry")]
        OBJ[("Object storage<br/>POD photos — R2/S3")]
        REDIS[("Redis — Next<br/>cache · ws fanout")]
    end

    subgraph EXT["4 · External"]
        AGG["Telematics aggregator<br/>Flespi / Wialon"]
        WA["WhatsApp BSP"]
        GEO["Geocoding<br/>Google / Lupap"]
        MAP["Maps / routing<br/>Mapbox / OSRM"]
    end

    WEB --> API
    ADMIN --> API
    DRV --> API
    TRACK --> API
    DEV -->|"cellular"| AGG --> TELE
    DRV -.->|"phone-as-gateway BLE OBD"| TELE
    API --> PG
    TELE --> PG
    CMD --> PG
    API --> OBJ
    WORK --> WA & GEO
    API --> MAP
    style EDGE fill:#f2f3f4,stroke:#1b365d
    style TELE fill:#d0de81,stroke:#1b365d
    style CMD fill:#d0de81,stroke:#1b365d
```

## The telemetry plane (why it's separate)

A delivery REST request is short and user-driven. A fleet of vehicles emits a
**continuous high-frequency stream** of GPS + CAN pings that must be ingested,
normalized, rule-checked (geofence, deviation, speeding, low battery), stored,
and pushed to the live map. That workload:

- needs a **persistent process** (can't run on short-lived serverless
  functions) — so the API + telemetry live on a container host, not Vercel;
- scales on a **different axis** (pings/sec, not page views);
- is **transport-agnostic** in MoveOS: the simulator, the driver's phone, or a
  hardware aggregator all POST normalized pings to the same
  `/telematics/ingest`. Swapping the simulator for real devices changes
  nothing upstream.

## GPS / CAN / engine on-off — the hardware reality

```mermaid
flowchart LR
    subgraph Vehicle["Moto / camión liviano"]
        CAN["CAN bus<br/>RPM · odómetro · combustible · temp"]
        RELAY["Relé de inmovilización<br/>(arranque / combustible)"]
    end
    subgraph Options["Ingestion options"]
        PHONE["Phone-as-gateway<br/>BLE OBD dongle"]
        HW["Hardwired device<br/>Teltonika/Queclink + SIM"]
    end
    CAN --> PHONE
    CAN --> HW
    RELAY --- HW
    PHONE -->|"read only"| TELE["/telematics/ingest"]
    HW -->|"read + actuate"| AGG["Aggregator"] --> TELE
    HW --- CMD["Command + ACK"]
```

Two honest constraints baked into the design:

1. **Reading telemetry** (GPS + CAN) works via either a cheap **phone-gateway
   BLE OBD dongle** (start here, no per-vehicle cost) or a **hardwired
   device** (reliable, works without the phone). Start cheap, upgrade when a
   pilot proves value.
2. **Engine on/off is a relay, not a CAN write.** Real immobilization is a
   relay on the starter/fuel circuit on a **hardwired device** — it cannot be
   done through a phone OBD dongle. MoveOS models it as a **command + device
   acknowledgement** (`VehicleCommand`), never a raw CAN write.
3. **Safety interlock:** the API **refuses `ENGINE_OFF` unless last known
   speed = 0**. Cutting a moving vehicle is dangerous and, in many places,
   illegal. Every command is audit-logged (who, when, why, ack). See the
   legal/safety section in `MASTER_ROADMAP.md`.

## Hosting topology

```mermaid
flowchart LR
    subgraph Vercel
        W["app.moveos.co"]
        D["conductor.moveos.co"]
    end
    subgraph Container["Railway / Render / Fly"]
        A["api.moveos.co<br/>Fastify + telemetry"]
    end
    subgraph Managed
        S[("Supabase / Neon<br/>Postgres")]
        R[("R2 / S3<br/>POD photos")]
    end
    W --> A
    D --> A
    A --> S
    A --> R
```

- **Frontends → Vercel/Cloudflare Pages**: static, cheap, global.
- **API + telemetry → container host**: persistent server, holds
  WebSocket + ingestion. *Not* Vercel.
- **Postgres → Supabase/Neon**: managed, provisioned for this project.
- **Object storage → R2/S3**: signed-URL POD upload (pending).

See `DEPLOYMENT.md` for the step-by-step.

## Current vs target (delta)

| Concern | Today | Target |
|---|---|---|
| API | Fastify modular monolith ✓ | + WebSocket, + workers (pg-boss) |
| Telemetry | ingestion + simulator ✓ | + aggregator adapter, partition/retention |
| Realtime | polling (3 s map) | SSE/WebSocket |
| Auth | JWT 12 h, rate-limit, CORS allowlist, helmet ✓ | + refresh-token rotation |
| DB | Postgres, app-level tenant scoping ✓ | + RLS defense-in-depth |
| Storage | external POD URLs | signed-URL uploads (R2/S3) |
| Driver app | web/PWA ✓ | Capacitor Android (bg GPS, BLE, push) |
| Migrations | `prisma db push` | versioned `prisma migrate` |
