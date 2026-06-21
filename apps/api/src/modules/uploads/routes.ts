import type { FastifyInstance } from "fastify";
import {
  buildPodKey,
  isAllowedImage,
  pickStorage,
  sniffImageType,
} from "../../services/storage.js";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB: foto de cámara comprimida

/**
 * Subida de evidencias (núcleo): la app del conductor sube la foto del POD
 * ANTES de completar la parada y envía la URL resultante en el payload de
 * entrega. Multipart, solo imágenes, limitado por tamaño y por rate-limit.
 */
export default async function uploadsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post(
    "/pod",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: MAX_FILE_BYTES } });
      if (!file) {
        return reply.code(400).send({ error: "Falta el archivo (campo multipart)" });
      }
      if (!isAllowedImage(file.mimetype)) {
        return reply
          .code(415)
          .send({ error: `Tipo no permitido: ${file.mimetype}. Use JPEG/PNG/WebP.` });
      }

      let buffer: Buffer;
      try {
        buffer = await file.toBuffer();
      } catch {
        return reply
          .code(413)
          .send({ error: `Archivo demasiado grande (máx ${MAX_FILE_BYTES / 1024 / 1024} MB)` });
      }

      // Validar por CONTENIDO (magic bytes), no solo por el Content-Type
      // declarado: bloquea un HTML/SVG/polyglot etiquetado como image/*.
      const realType = sniffImageType(buffer);
      if (!realType || realType !== file.mimetype) {
        return reply.code(415).send({
          error: "El archivo no es una imagen JPEG/PNG/WebP válida.",
        });
      }

      const storage = pickStorage();
      const key = buildPodKey(request.user.tenantId, realType);
      const stored = await storage.save(buffer, realType, key);
      return reply.code(201).send({ url: stored.url, storage: storage.name });
    },
  );
}
