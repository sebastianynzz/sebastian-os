import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { issueInvoiceSchema } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";

/**
 * Facturación desde el plano de plataforma (Tier 3 §13): el operador EMITE las
 * facturas de suscripción de un tenant y consulta su historial. daleGo no
 * procesa pagos en la app — `status` es informativo y la liquidación es externa.
 * Montado bajo /platform/tenants/:id/invoices (exige operador de plataforma).
 */
export default async function platformBillingRoutes(app: FastifyInstance) {
  app.get("/", async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return prisma.invoice.findMany({
      where: { tenantId: id },
      orderBy: { issuedAt: "desc" },
    });
  });

  app.post("/", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const input = issueInvoiceSchema.parse(request.body);
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!tenant) return reply.code(404).send({ error: "Tenant no encontrado" });
    try {
      const invoice = await prisma.invoice.create({
        data: {
          tenantId: id,
          number: input.number,
          periodMonth: input.periodMonth,
          amountCop: input.amountCop,
          status: input.status,
          dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
          notes: input.notes ?? undefined,
        },
      });
      return reply.code(201).send(invoice);
    } catch {
      return reply
        .code(409)
        .send({ error: "Ya existe una factura con ese número para el tenant" });
    }
  });
}
