import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Pipeline de evidencias POD: subida multipart → URL servida por la API
 * (adaptador local en dev; Supabase Storage en producción).
 */

const runId = Date.now();
const adminEmail = `up-admin+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

// PNG válido de 1x1 píxel.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function multipartBody(field: string, filename: string, contentType: string, data: Buffer) {
  const boundary = `----moveostest${runId}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      tenantName: "Test Uploads",
      adminName: "Admin",
      city: "Bogotá",
      email: adminEmail,
      password: "moveos123",
    },
  });
  const body = reg.json();
  tenantId = body.tenant.id;
  adminToken = body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("subida de evidencias POD", () => {
  it("sube una imagen y la URL queda servible", async () => {
    const { payload, headers } = multipartBody("file", "pod.png", "image/png", PNG_1PX);
    const res = await app.inject({
      method: "POST",
      url: "/uploads/pod",
      headers: { ...headers, authorization: `Bearer ${adminToken}` },
      payload,
    });
    expect(res.statusCode).toBe(201);
    const { key, url, storage } = res.json();
    expect(storage).toBe("local"); // en tests no hay credenciales Supabase
    // Se persiste la CLAVE del objeto (no una URL pública permanente).
    expect(key).toMatch(new RegExp(`^pod/${tenantId}/[a-f0-9]{16,}\\.png$`));
    // `url` es una ruta firmada de corta duración que sirve la evidencia.
    expect(url).toContain("/evidence?key=");

    // El archivo es servible por la URL firmada (sin auth Bearer).
    const fetched = await app.inject({ method: "GET", url });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers["cache-control"]).toContain("no-store");
    expect(fetched.rawPayload.equals(PNG_1PX)).toBe(true);
  });

  it("rechaza una URL de evidencia con firma inválida (403)", async () => {
    const bad = await app.inject({
      method: "GET",
      url: `/evidence?key=pod/${tenantId}/${"a".repeat(32)}.png&exp=${Date.now() + 100000}&sig=deadbeef`,
    });
    expect(bad.statusCode).toBe(403);
  });

  it("rechaza tipos de archivo no permitidos (415)", async () => {
    const { payload, headers } = multipartBody(
      "file",
      "malicioso.html",
      "text/html",
      Buffer.from("<script>alert(1)</script>"),
    );
    const res = await app.inject({
      method: "POST",
      url: "/uploads/pod",
      headers: { ...headers, authorization: `Bearer ${adminToken}` },
      payload,
    });
    expect(res.statusCode).toBe(415);
  });

  it("exige autenticación (401)", async () => {
    const { payload, headers } = multipartBody("file", "pod.png", "image/png", PNG_1PX);
    const res = await app.inject({
      method: "POST",
      url: "/uploads/pod",
      headers,
      payload,
    });
    expect(res.statusCode).toBe(401);
  });
});
