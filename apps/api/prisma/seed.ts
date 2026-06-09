import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { MODULE_CATALOG } from "@moveos/shared";
import { generateTrackingNumber } from "../src/services/orderEvents.js";

/**
 * Datos demo: una operación de última milla en Bogotá con flota mixta
 * (motos, carro, van eléctrica) y todos los módulos
 * activos para explorar el producto completo.
 *
 * Credenciales demo:
 *   admin@demo.moveos.co    / moveos123  (ADMIN)
 *   despacho@demo.moveos.co / moveos123  (DISPATCHER)
 *   carlos@demo.moveos.co   / moveos123  (DRIVER, moto)
 *   maria@demo.moveos.co    / moveos123  (DRIVER, e-van)
 */
const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.tenant.findFirst({
    where: { name: "Demo Logística Bogotá" },
  });
  if (existing) {
    console.log("Seed ya aplicado, nada que hacer.");
    return;
  }

  const passwordHash = await bcrypt.hash("moveos123", 10);

  const tenant = await prisma.tenant.create({
    data: {
      name: "Demo Logística Bogotá",
      nit: "901.234.567-8",
      city: "Bogotá",
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
      email: "admin@demo.moveos.co",
      passwordHash,
      name: "Ana Admin",
      role: "ADMIN",
    },
  });
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: "despacho@demo.moveos.co",
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
      email: "carlos@demo.moveos.co",
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
      email: "maria@demo.moveos.co",
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

  await prisma.vehicle.createMany({
    data: [
      {
        tenantId: tenant.id,
        plate: "ABC12D",
        type: "MOTO",
        capacityKg: 15,
        soatExpiresAt: in11Months,
        tecnoExpiresAt: in11Months,
      },
      {
        tenantId: tenant.id,
        plate: "XYZ34E",
        type: "MOTO",
        capacityKg: 18,
        soatExpiresAt: in20Days, // alerta de vencimiento próxima
        tecnoExpiresAt: in11Months,
      },
      {
        tenantId: tenant.id,
        plate: "JDK457",
        type: "CARRO",
        capacityKg: 350,
        capacityM3: 1.5,
        soatExpiresAt: in11Months,
        tecnoExpiresAt: in11Months,
      },
      {
        tenantId: tenant.id,
        plate: "EVB890",
        type: "VAN",
        capacityKg: 700,
        capacityM3: 5,
        isElectric: true,
        batteryKwh: 42,
        nominalRangeKm: 230,
        socPercent: 86,
        soatExpiresAt: in11Months,
        tecnoExpiresAt: in11Months,
      },
    ],
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
  }> = [
    { customerName: "Laura Martínez", customerPhone: "+573101000001", addressRaw: "Cra 13 # 54-20, Chapinero", lat: 4.6416, lng: -74.0639, weightKg: 2 },
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
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        addressRaw: o.addressRaw,
        addressNotes: o.addressNotes,
        lat: o.lat,
        lng: o.lng,
        geocodeSource: "CLIENT",
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

  console.log("Seed aplicado:");
  console.log("  Tenant:", tenant.name);
  console.log("  admin@demo.moveos.co / moveos123 (ADMIN)");
  console.log("  despacho@demo.moveos.co / moveos123 (DISPATCHER)");
  console.log("  carlos@demo.moveos.co / moveos123 (DRIVER)");
  console.log("  maria@demo.moveos.co / moveos123 (DRIVER)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
