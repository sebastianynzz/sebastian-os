import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { config } from "../config.js";

/**
 * Almacenamiento de evidencias (fotos de POD, firmas).
 *
 * - Desarrollo: disco local (`uploads/`), servido por la API en `/files/*`.
 * - Producción: Supabase Storage (bucket público de solo-lectura), vía la API
 *   REST con la service-role key. La URL pública resultante se guarda en el
 *   ProofOfDelivery.
 *
 * Se elige el adaptador por entorno: si SUPABASE_URL y
 * SUPABASE_SERVICE_ROLE_KEY están definidos, se usa Supabase.
 */

export interface StoredFile {
  url: string;
}

export interface StorageAdapter {
  name: string;
  save(buffer: Buffer, contentType: string, key: string): Promise<StoredFile>;
}

export const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isAllowedImage(contentType: string): boolean {
  return contentType in EXT_BY_MIME;
}

/** Genera una clave única por tenant: pod/<tenantId>/<aleatorio>.<ext> */
export function buildPodKey(tenantId: string, contentType: string): string {
  const ext = EXT_BY_MIME[contentType] ?? "bin";
  return `pod/${tenantId}/${randomBytes(12).toString("hex")}.${ext}`;
}

class LocalDiskAdapter implements StorageAdapter {
  name = "local";
  async save(buffer: Buffer, _contentType: string, key: string): Promise<StoredFile> {
    const filePath = path.join(UPLOADS_DIR, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
    const base = process.env.PUBLIC_API_URL ?? `http://localhost:${config.port}`;
    return { url: `${base}/files/${key}` };
  }
}

class SupabaseStorageAdapter implements StorageAdapter {
  name = "supabase";
  constructor(
    private supabaseUrl: string,
    private serviceRoleKey: string,
    private bucket: string,
  ) {}

  async save(buffer: Buffer, contentType: string, key: string): Promise<StoredFile> {
    const res = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${key}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          "Content-Type": contentType,
          "x-upsert": "false",
        },
        body: new Uint8Array(buffer),
        // Acotado: si Storage se cuelga, el conductor recibe un error claro y
        // reintenta, en vez de dejar la petición (y la conexión) colgada.
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Supabase Storage ${res.status}: ${text}`);
    }
    return {
      url: `${this.supabaseUrl}/storage/v1/object/public/${this.bucket}/${key}`,
    };
  }
}

export function pickStorage(): StorageAdapter {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    return new SupabaseStorageAdapter(
      url,
      key,
      process.env.SUPABASE_STORAGE_BUCKET ?? "pod-photos",
    );
  }
  return new LocalDiskAdapter();
}
