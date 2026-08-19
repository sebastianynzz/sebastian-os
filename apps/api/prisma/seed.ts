import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { MODULE_CATALOG } from "@moveos/shared";
import { generateTrackingNumber, generateTrackingToken } from "../src/services/orderEvents.js";

/**
 * Datos demo: una operación de última milla en Bogotá con flota mixta
 * (motos, carro, van eléctrica) y todos los módulos
 * activos para explorar el producto completo.
 *
 * Credenciales demo:
 *   admin@demo.dalego.co    / dalego123  (ADMIN)
 *   despacho@demo.dalego.co / dalego123  (DISPATCHER)
 *   carlos@demo.dalego.co   / dalego123  (DRIVER, moto)
 *   maria@demo.dalego.co    / dalego123  (DRIVER, e-van)
 */
const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("dalego123", 10);

  // Operador de plataforma (idempotente).
  await prisma.platformAdmin.upsert({
    where: { email: "ops@dalego.co" },
    create: { email: "ops@dalego.co", passwordHash, name: "Operador daleGo" },
    update: {},
  });

  // El directorio público de carga (tenantId null) lo siembra la MIGRACIÓN
  // 20260612120000_ev_core_data — producción solo corre migrate deploy,
  // nunca este seed demo. Aquí no se duplica.

  // Segundo tenant demo (plan FREE, solo módulos por defecto) para que el
  // panel de plataforma tenga una lista con datos distintos.
  const medellin = await prisma.tenant.findFirst({
    where: { name: "Demo Express Medellín" },
  });
  if (!medellin) {
    const t2 = await prisma.tenant.create({
      data: {
        name: "Demo Express Medellín",
        nit: "900.111.222-3",
        city: "Medellín",
        plan: "FREE",
        // Cliente FaaS de demo: aprovisionado por daleGo con flota en sitio.
        operatorType: "SUB_OPERATOR",
        businessModel: "FAAS",
        entitlements: {
          create: MODULE_CATALOG.map((m) => ({
            moduleKey: m.key,
            enabled: m.defaultEnabled,
          })),
        },
      },
    });
    await prisma.user.create({
      data: {
        tenantId: t2.id,
        email: "admin@expressmed.co",
        passwordHash,
        name: "Admin Medellín",
        role: "ADMIN",
      },
    });
    const d2 = await prisma.driver.create({
      data: { tenantId: t2.id, name: "Luis Mejía", phone: "+573015550000", documentId: "71234567" },
    });
    for (let i = 0; i < 4; i++) {
      await prisma.order.create({
        data: {
          tenantId: t2.id,
          trackingNumber: generateTrackingNumber(),
          trackingToken: generateTrackingToken(),
          customerName: `Cliente Medellín ${i + 1}`,
          customerPhone: `+57301555000${i}`,
          addressRaw: `Cra ${30 + i} # 10-${20 + i}, El Poblado`,
          lat: 6.21 + i * 0.002,
          lng: -75.57,
          geocodeSource: "CLIENT",
          status: "GEOCODED",
        },
      });
    }
    void d2;
  }

  const existing = await prisma.tenant.findFirst({
    where: { name: "Demo Logística Bogotá" },
  });
  if (existing) {
    // Camino de upgrade para bases ya sembradas: la flota demo pasó a ser
    // 100% eléctrica (restricción dura 1) — convertir los vehículos viejos
    // y garantizar el cargador del depósito, sin duplicar nada más.
    await Promise.all([
      prisma.vehicle.updateMany({
        where: { tenantId: existing.id, plate: "ABC12D", isElectric: false },
        data: { isElectric: true, batteryKwh: 4, nominalRangeKm: 90, socPercent: 92 },
      }),
      prisma.vehicle.updateMany({
        where: { tenantId: existing.id, plate: "XYZ34E", isElectric: false },
        data: { isElectric: true, batteryKwh: 3.5, nominalRangeKm: 80, socPercent: 22 },
      }),
      prisma.vehicle.updateMany({
        where: { tenantId: existing.id, plate: "JDK457", isElectric: false },
        data: { isElectric: true, batteryKwh: 60, nominalRangeKm: 300, socPercent: 64 },
      }),
    ]);
    const depotCharger = await prisma.chargingStation.findFirst({
      where: { tenantId: existing.id, network: "DEPOSITO" },
    });
    if (!depotCharger) {
      await prisma.chargingStation.create({
        data: {
          tenantId: existing.id,
          name: "Depósito daleGo — Chapinero",
          network: "DEPOSITO",
          address: "Cl 57 # 10-32, Chapinero",
          city: "Bogotá",
          lat: 4.6486,
          lng: -74.0628,
          connectors: ["TYPE_2", "SCHUKO"],
          powerKw: 22,
          dcFast: false,
        },
      });
    }
    console.log("Tenant Bogotá ya existe; flota EV y cargador de depósito verificados.");
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: "Demo Logística Bogotá",
      nit: "901.234.567-8",
      city: "Bogotá",
      plan: "PRO",
      businessModel: "LOGISTICS_3PL",
      entitlements: {
        create: MODULE_CATALOG.map((m) => ({
          moduleKey: m.key,
          enabled: true, // demo: todo activo para explorar
        })),
      },
    },
  });

  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: "admin@demo.dalego.co",
      passwordHash,
      name: "Ana Admin",
      role: "ADMIN",
    },
  });
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: "despacho@demo.dalego.co",
      passwordHash,
      name: "Diego Despachador",
      role: "DISPATCHER",
    },
  });

  const carlos = await prisma.driver.create({
    data: {
      tenantId: tenant.id,
      name: "Carlos Rodríguez",
      phone: "+573001112233",
      documentId: "1023456789",
    },
  });
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: "carlos@demo.dalego.co",
      passwordHash,
      name: "Carlos Rodríguez",
      role: "DRIVER",
      driverId: carlos.id,
    },
  });

  const maria = await prisma.driver.create({
    data: {
      tenantId: tenant.id,
      name: "María Gómez",
      phone: "+573004445566",
      documentId: "1098765432",
    },
  });
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: "maria@demo.dalego.co",
      passwordHash,
      name: "María Gómez",
      role: "DRIVER",
      driverId: maria.id,
    },
  });

  await prisma.driver.create({
    data: {
      tenantId: tenant.id,
      name: "Julián Pérez",
      phone: "+573007778899",
      documentId: "1011121314",
    },
  });

  const in11Months = new Date(Date.now() + 330 * 24 * 3600 * 1000);
  const in20Days = new Date(Date.now() + 20 * 24 * 3600 * 1000);

  // Flota 100% eléctrica (daleGo es EV-only — restricción dura 1): catálogo de
  // 6 configuraciones (Rap Move + IONAx), con dos Cold Box para cadena de frío.
  // Capacidad/batería/autonomía alineadas con VEHICLE_TYPE_PROFILES.
  await prisma.vehicle.createMany({
    data: [
      {
        tenantId: tenant.id,
        plate: "ABC12D",
        type: "RAP_MOVE_LIGHT",
        capacityKg: 115,
        capacityM3: 0.5,
        isElectric: true,
        batteryKwh: 4.864,
        nominalRangeKm: 100,
        socPercent: 92,
        soatExpiresAt: in11Months,
        tecnoExpiresAt: in11Months,
      },
      {
        tenantId: tenant.id,
        plate: "XYZ34E",
        type: "RAP_MOVE_XL",
        capacityKg: 250,
        capacityM3: 1.6,
        isElectric: true,
        batteryKwh: 7.36,
        nominalRangeKm: 120,
        socPercent: 22, // batería baja: alerta del cockpit y presupuesto de autonomía corto
        soatExpiresAt: in20Days, // alerta de vencimiento próxima
        tecnoExpiresAt: in11Months,
      },
      {
        tenantId: tenant.id,
        plate: "JDK457",
        type: "IONAX",
        capacityKg: 530,
        capacityM3: 3.0,
        isElectric: true,
        batteryKwh: 11.52, // pack base → 130 km
        nominalRangeKm: 130,
        socPercent: 64,
        soatExpiresAt: in11Months,
        tecnoExpiresAt: in11Months,
      },
      {
        tenantId: tenant.id,
        plate: "EVB890",
        type: "IONAX",
        capacityKg: 530,
        capacityM3: 3.0,
        isElectric: true,
        batteryKwh: 23.04, // pack grande → 260 km
        nominalRangeKm: 260,
        socPercent: 86,
        soatExpiresAt: in11Months,
        tecnoExpiresAt: in11Months,
      },
      {
        tenantId: tenant.id,
        plate: "FRZ001",
        type: "RAP_MOVE_COLD_BOX", // congelador (-25°C): pedidos FROZEN
        capacityKg: 200,
        capacityM3: 1.0,
        isElectric: true,
        batteryKwh: 7.36,
        nominalRangeKm: 90, // reefer-on
        socPercent: 78,
        soatExpiresAt: in11Months,
        tecnoExpiresAt: in11Months,
      },
      {
        tenantId: tenant.id,
        plate: "CHL890",
        type: "IONAX_COLD_BOX", // refrigerado (-18…+10°C): pedidos CHILLED
        capacityKg: 530,
        capacityM3: 2.8,
        isElectric: true,
        batteryKwh: 11.52,
        nominalRangeKm: 130, // reefer-on
        socPercent: 81,
        soatExpiresAt: in11Months,
        tecnoExpiresAt: in11Months,
      },
    ],
  });

  // Cargador del depósito del tenant demo (la red pública se siembra aparte,
  // compartida entre tenants con tenantId null).
  await prisma.chargingStation.create({
    data: {
      tenantId: tenant.id,
      name: "Depósito daleGo — Chapinero",
      network: "DEPOSITO",
      address: "Cl 57 # 10-32, Chapinero",
      city: "Bogotá",
      lat: 4.6486,
      lng: -74.0628,
      connectors: ["TYPE_2", "SCHUKO"],
      powerKw: 22,
      dcFast: false,
    },
  });

  // Negocios cliente del tenant (B2B): originan los envíos y reciben las
  // confirmaciones de entrega por distintos canales.
  const tiendaModa = await prisma.client.create({
    data: {
      tenantId: tenant.id,
      name: "Tienda Moda Express",
      contactName: "Carolina Ríos",
      email: "logistica@modaexpress.co",
      notifyChannel: "EMAIL",
      // Dirección de recogida registrada: origen por defecto de los pedidos
      // que el negocio crea desde su portal.
      pickupAddressRaw: "Cra 9 # 60-15, Chapinero",
      pickupLat: 4.6463,
      pickupLng: -74.0628,
      pickupNotes: "Local 2, preguntar por bodega",
    },
  });
  // Usuario del portal de clientes (rol CLIENT) de Tienda Moda Express.
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: "cliente@demo.dalego.co",
      passwordHash,
      name: "Carolina Ríos (Moda Express)",
      role: "CLIENT",
      clientId: tiendaModa.id,
    },
  });
  const distribuidora = await prisma.client.create({
    data: {
      tenantId: tenant.id,
      name: "Distribuidora La 80",
      contactName: "Operaciones",
      webhookUrl: "https://webhook.site/demo-la80",
      notifyChannel: "WEBHOOK",
    },
  });
  const farmacia = await prisma.client.create({
    data: {
      tenantId: tenant.id,
      name: "Farmacia Salud Total",
      contactName: "Despacho",
      phone: "+573009990000",
      notifyChannel: "IN_APP",
    },
  });

  // Pedidos demo alrededor de Bogotá (coordenadas reales aproximadas).
  // customerName/customerPhone = destinatario final; client = negocio que envía.
  const clientIds = [tiendaModa.id, distribuidora.id, farmacia.id];
  const orders: Array<{
    customerName: string;
    customerPhone: string;
    addressRaw: string;
    addressNotes?: string;
    lat: number;
    lng: number;
    weightKg?: number;
    priority?: number;
    pickupAddressRaw?: string;
    pickupLat?: number;
    pickupLng?: number;
  }> = [
    // Pedido con recogida en origen: el conductor recoge en la bodega del
    // cliente (Cl 80) y entrega en Chapinero (flujo pickup→delivery).
    { customerName: "Laura Martínez", customerPhone: "+573101000001", addressRaw: "Cra 13 # 54-20, Chapinero", lat: 4.6416, lng: -74.0639, weightKg: 2, pickupAddressRaw: "Bodega Distribuidora, Cl 80 # 20-10", pickupLat: 4.6678, pickupLng: -74.0589 },
    { customerName: "Pedro Sánchez", customerPhone: "+573101000002", addressRaw: "Cl 72 # 10-34, Quinta Camacho", lat: 4.6585, lng: -74.0577, weightKg: 1.2 },
    { customerName: "Sofía Torres", customerPhone: "+573101000003", addressRaw: "Cl 116 # 15-08, Santa Bárbara", lat: 4.6957, lng: -74.0395, weightKg: 3.4 },
    { customerName: "Andrés Ruiz", customerPhone: "+573101000004", addressRaw: "Cra 7 # 32-16, Teusaquillo", lat: 4.6206, lng: -74.0689, weightKg: 0.8 },
    { customerName: "Camila Vargas", customerPhone: "+573101000005", addressRaw: "Frente al colegio San Bartolomé, La Candelaria", addressNotes: "Casa de portón verde, preguntar por la señora Camila", lat: 4.5972, lng: -74.0736, weightKg: 1.5 },
    { customerName: "Felipe Castro", customerPhone: "+573101000006", addressRaw: "Cl 26 # 68-35, Salitre", lat: 4.6486, lng: -74.0995, weightKg: 5.0 },
    { customerName: "Valentina López", customerPhone: "+573101000007", addressRaw: "Cra 15 # 93-60, Chicó", lat: 4.6766, lng: -74.0488, weightKg: 2.2, priority: 5 },
    { customerName: "Jorge Ramírez", customerPhone: "+573101000008", addressRaw: "Av Suba # 116-20, Suba", lat: 4.7196, lng: -74.0716, weightKg: 4.1 },
    { customerName: "Daniela Moreno", customerPhone: "+573101000009", addressRaw: "Cl 147 # 19-50, Cedritos", lat: 4.7266, lng: -74.0387, weightKg: 1.0 },
    { customerName: "Ricardo Herrera", customerPhone: "+573101000010", addressRaw: "Cra 80 # 43-20 Sur, Kennedy", lat: 4.6097, lng: -74.1564, weightKg: 8.3 },
    { customerName: "Paula Jiménez", customerPhone: "+573101000011", addressRaw: "Cl 63 # 28-10, Siete de Agosto", lat: 4.6553, lng: -74.0782, weightKg: 2.7 },
    { customerName: "Mateo Díaz", customerPhone: "+573101000012", addressRaw: "Cra 24 # 85-30, Polo Club", lat: 4.6705, lng: -74.0581, weightKg: 1.9 },
  ];

  for (const [i, o] of orders.entries()) {
    const trackingNumber = generateTrackingNumber();
    const created = await prisma.order.create({
      data: {
        tenantId: tenant.id,
        clientId: clientIds[i % clientIds.length],
        trackingNumber,
        trackingToken: generateTrackingToken(),
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        addressRaw: o.addressRaw,
        addressNotes: o.addressNotes,
        lat: o.lat,
        lng: o.lng,
        geocodeSource: "CLIENT",
        pickupAddressRaw: o.pickupAddressRaw,
        pickupLat: o.pickupLat,
        pickupLng: o.pickupLng,
        status: "GEOCODED",
        weightKg: o.weightKg ?? 1,
        priority: o.priority ?? 0,
      },
    });
    await prisma.orderEvent.createMany({
      data: [
        { orderId: created.id, type: "CREATED", details: `Guía ${trackingNumber}` },
        { orderId: created.id, type: "GEOCODED", details: "Fuente: CLIENT" },
      ],
    });
  }

  // Historial de 14 días: pedidos ya entregados (separados de los 12 activos
  // para no afectar el demo de planificación) para que las tendencias de
  // Analítica, el portal y el panel de plataforma rendericen con datos.
  const historicalNames = [
    "Hernán Quintero", "Lucía Ardila", "Tomás Pineda", "Isabela Franco",
    "Samuel Ortiz", "Mariana Cubillos", "Nicolás Rey", "Gabriela Niño",
    "Emilio Lara", "Antonia Vélez",
  ];
  for (const [i, name] of historicalNames.entries()) {
    const daysAgo = 14 - i; // distribuidos en las últimas 2 semanas
    const createdAt = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
    const deliveredAt = new Date(createdAt.getTime() + 6 * 3600 * 1000);
    const trackingNumber = generateTrackingNumber();
    const historical = await prisma.order.create({
      data: {
        tenantId: tenant.id,
        clientId: clientIds[i % clientIds.length],
        trackingNumber,
        trackingToken: generateTrackingToken(),
        customerName: name,
        customerPhone: `+57320100000${i}`,
        addressRaw: `Cl ${40 + i} # ${10 + i}-2${i}, Bogotá`,
        lat: 4.62 + i * 0.005,
        lng: -74.08 + i * 0.003,
        geocodeSource: "CLIENT",
        status: "DELIVERED",
        weightKg: 1 + (i % 4),
        createdAt,
        deliveredAt,
      },
    });
    await prisma.orderEvent.createMany({
      data: [
        { orderId: historical.id, type: "CREATED", details: `Guía ${trackingNumber}`, createdAt },
        { orderId: historical.id, type: "DELIVERED", details: "Entrega histórica demo", createdAt: deliveredAt },
      ],
    });
  }

  console.log("Seed aplicado:");
  console.log("  Tenant:", tenant.name);
  console.log("  admin@demo.dalego.co / dalego123 (ADMIN)");
  console.log("  despacho@demo.dalego.co / dalego123 (DISPATCHER)");
  console.log("  carlos@demo.dalego.co / dalego123 (DRIVER)");
  console.log("  maria@demo.dalego.co / dalego123 (DRIVER)");
  console.log("  cliente@demo.dalego.co / dalego123 (CLIENT, portal Tienda Moda Express)");
  console.log("  --- Panel de plataforma ---");
  console.log("  ops@dalego.co / dalego123 (OPERADOR)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
