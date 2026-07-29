import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { config } from "../config.js";

/**
 * Almacenamiento de evidencias (fotos de POD, firmas).
 *
 * - Desarrollo: disco local (`uploads/`).
 * - Producción: Supabase Storage (bucket PRIVADO), vía la API REST con la
 *   service-role key.
 *
 * En la BD se guarda solo la CLAVE del objeto (`pod/<tenant>/<rand>.jpg`), nunca
 * una URL pública permanente. La evidencia se sirve por la API a través de una
 * URL FIRMADA y de corta duración (`/evidence?...`, ver `signEvidencePath`), que
 * la API resuelve haciendo el fetch del objeto privado con la service-role. Así
 * la PII (fotos de entrega) no queda accesible de forma pública/permanente.
 *
 * Se elige el adaptador por entorno: si SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
 * están definidos, se usa Supabase; si no, disco local.
 */

export interface StoredFile {
  /** Clave del objeto en el almacenamiento (lo que se persiste en la BD). */
  key: string;
}

export interface FetchedObject {
  body: Buffer;
  contentType: string;
}

export interface StorageAdapter {
  name: string;
  save(buffer: Buffer, contentType: string, key: string): Promise<StoredFile>;
  /** Descarga el objeto por clave (para servirlo firmado). null si no existe. */
  fetch(key: string): Promise<FetchedObject | null>;
}

export const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Patrón seguro de clave de evidencia: pod/<tenant>/<hex>.<ext>. */
export const POD_KEY_RE = /^pod\/[A-Za-z0-9_-]+\/[a-f0-9]{16,}\.(jpg|png|webp)$/;

export function isAllowedImage(contentType: string): boolean {
  return contentType in EXT_BY_MIME;
}

function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Detecta el tipo real de imagen por sus magic bytes (no por el Content-Type
 * declarado por el cliente, que se puede falsificar). Devuelve el MIME o null si
 * no es una imagen permitida. Evita guardar un HTML/SVG/polyglot etiquetado como
 * image/png (XSS almacenado / contenido malicioso).
 */
export function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Genera una clave única por tenant: pod/<tenantId>/<aleatorio>.<ext> */
export function buildPodKey(tenantId: string, contentType: string): string {
  const ext = EXT_BY_MIME[contentType] ?? "bin";
  return `pod/${tenantId}/${randomBytes(16).toString("hex")}.${ext}`;
}

// --- URL firmada de corta duración para servir evidencia privada ---------

const EVIDENCE_TTL_MS = 60 * 60 * 1000; // 1 hora: suficiente para ver/auditar

function evidenceSignature(key: string, exp: number): string {
  return createHmac("sha256", config.jwtSecret).update(`${key}.${exp}`).digest("hex");
}

/**
 * URL firmada (ABSOLUTA) para servir una evidencia por clave. Debe ser absoluta
 * y apuntar al origen de la API: las SPA viven en otro origen, así que un href
 * relativo cargaría contra el dominio del frontend, no contra la API.
 */
export function signEvidencePath(key: string): string {
  const exp = Date.now() + EVIDENCE_TTL_MS;
  const sig = evidenceSignature(key, exp);
  const base = (process.env.PUBLIC_API_URL ?? `http://localhost:${config.port}`).replace(/\/$/, "");
  return `${base}/evidence?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
}

/** Verifica la firma + expiración de una URL de evidencia (tiempo-constante). */
export function verifyEvidenceSignature(key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = evidenceSignature(key, exp);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Resuelve la referencia guardada en la BD a una URL servible por el cliente:
 * - clave de objeto (`pod/...`) → URL firmada de corta duración (nuevo formato);
 * - URL/ruta ya absoluta (datos legados) → se devuelve tal cual.
 * Síncrono (HMAC), sin llamadas externas.
 */
export function resolveEvidenceRef(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (POD_KEY_RE.test(stored)) return signEvidencePath(stored);
  return stored;
}

/**
 * Devuelve el POD con sus URLs de evidencia ya firmadas (clave → URL firmada;
 * datos legados se devuelven tal cual). Aplicar en cada endpoint que SIRVE un
 * POD al cliente, para que la foto/firma sea cargable sin exponer el bucket.
 */
export function signPodEvidence<
  T extends { photoUrl: string | null; signatureUrl: string | null },
>(pod: T | null): T | null {
  if (!pod) return pod;
  return {
    ...pod,
    photoUrl: resolveEvidenceRef(pod.photoUrl),
    signatureUrl: resolveEvidenceRef(pod.signatureUrl),
  };
}

class LocalDiskAdapter implements StorageAdapter {
  name = "local";
  async save(buffer: Buffer, _contentType: string, key: string): Promise<StoredFile> {
    const filePath = path.join(UPLOADS_DIR, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
    return { key };
  }
  async fetch(key: string): Promise<FetchedObject | null> {
    // `key` ya viene validado contra POD_KEY_RE por el endpoint; resolver dentro
    // de UPLOADS_DIR y rechazar cualquier salida del directorio (defensa extra).
    const filePath = path.resolve(UPLOADS_DIR, key);
    if (!filePath.startsWith(UPLOADS_DIR + path.sep)) return null;
    try {
      const body = await readFile(filePath);
      return { body, contentType: contentTypeForKey(key) };
    } catch {
      return null;
    }
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
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Supabase Storage ${res.status}: ${text}`);
    }
    return { key };
  }

  async fetch(key: string): Promise<FetchedObject | null> {
    // Fetch autenticado del objeto (funciona con bucket PRIVADO).
    const res = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${key}`,
      { headers: { Authorization: `Bearer ${this.serviceRoleKey}` } },
    );
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return {
      body: Buffer.from(arrayBuf),
      contentType: res.headers.get("content-type") ?? contentTypeForKey(key),
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
