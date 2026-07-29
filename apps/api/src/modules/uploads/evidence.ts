import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  POD_KEY_RE,
  pickStorage,
  verifyEvidenceSignature,
} from "../../services/storage.js";

/**
 * Servir evidencia POD (PII) por URL FIRMADA y de corta duración (MO-03). NO
 * lleva auth Bearer (una etiqueta `<img>`/`<a href>` no puede enviar el token):
 * la autorización es la firma HMAC + expiración de la URL. La API descarga el
 * objeto del bucket PRIVADO con la service-role y lo transmite con `no-store`,
 * en vez de exponer una URL pública permanente del bucket.
 */
const querySchema = z.object({
  key: z.string().min(1),
  exp: z.coerce.number(),
  sig: z.string().min(1),
});

export default async function evidenceRoutes(app: FastifyInstance) {
  app.get("/evidence", async (request, reply) => {
    const q = querySchema.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: "Parámetros inválidos" });
    const { key, exp, sig } = q.data;
    // Solo claves de evidencia con forma segura (evita path traversal / fugas).
    if (!POD_KEY_RE.test(key)) {
      return reply.code(400).send({ error: "Clave inválida" });
    }
    if (!verifyEvidenceSignature(key, exp, sig)) {
      return reply.code(403).send({ error: "Enlace inválido o expirado" });
    }
    const obj = await pickStorage().fetch(key);
    if (!obj) return reply.code(404).send({ error: "Evidencia no encontrada" });
    reply.header("Cache-Control", "private, no-store");
    reply.header("Content-Type", obj.contentType);
    return reply.send(obj.body);
  });
}
