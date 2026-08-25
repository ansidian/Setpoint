import { createHash } from "crypto";
import { promisify } from "util";
import { gzip, gunzip } from "zlib";
import type { Client, Row } from "@libsql/client";
import db from "../db/connection.ts";
import type {
  TldrawDocumentEnvelope,
  TldrawDocumentJson,
  SaveTldrawDocumentResponse,
} from "../../shared/types/tldraw.ts";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

type TldrawDocumentDb = Pick<Client, "execute">;

export class TldrawDocumentConflictError extends Error {
  readonly code = "TLDRAW_DOCUMENT_CONFLICT";
  readonly status = 409;

  constructor() {
    super("This canvas changed on another device. Reload the latest version before editing again.");
  }
}

export class InvalidTldrawDocumentError extends Error {
  readonly code = "INVALID_TLDRAW_DOCUMENT";
  readonly status = 400;

  constructor() {
    super("The tldraw document is invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isTldrawDocumentJson(value: unknown): value is TldrawDocumentJson {
  return isRecord(value) && isRecord(value.store) && isRecord(value.schema);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function blobBuffer(value: unknown): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("Stored tldraw document is not a binary snapshot");
}

function documentHash(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex");
}

async function decodeDocument(row: Row): Promise<TldrawDocumentJson> {
  const serialized = (await gunzipAsync(blobBuffer(row.document_gzip))).toString("utf8");
  const parsed: unknown = JSON.parse(serialized);
  if (!isTldrawDocumentJson(parsed)) throw new Error("Stored tldraw document is invalid");
  return parsed;
}

export function createTldrawDocumentService(dbClient: TldrawDocumentDb = db) {
  async function getDocument(userId: string): Promise<TldrawDocumentEnvelope> {
    const result = await dbClient.execute({
      sql: `SELECT document_gzip, revision, updated_at
              FROM ea_tldraw_documents
             WHERE user_id = ?`,
      args: [userId],
    });
    const row = result.rows[0];
    if (!row) return { document: null, revision: 0, updatedAt: null };
    return {
      document: await decodeDocument(row),
      revision: Number(row.revision),
      updatedAt: stringValue(row.updated_at),
    };
  }

  async function saveDocument(
    userId: string,
    document: unknown,
    baseRevision: number,
    now = new Date(),
  ): Promise<SaveTldrawDocumentResponse> {
    if (!isTldrawDocumentJson(document)
      || !Number.isSafeInteger(baseRevision)
      || baseRevision < 0) {
      throw new InvalidTldrawDocumentError();
    }

    const serialized = JSON.stringify(document);
    const hash = documentHash(serialized);
    const compressed = await gzipAsync(serialized, { level: 9 });
    const updatedAt = now.toISOString();

    if (baseRevision === 0) {
      const inserted = await dbClient.execute({
        sql: `INSERT OR IGNORE INTO ea_tldraw_documents
                (user_id, document_gzip, content_hash, revision, updated_at)
              VALUES (?, ?, ?, 1, ?)`,
        args: [userId, compressed, hash, updatedAt],
      });
      if (inserted.rowsAffected === 1) {
        return { revision: 1, updatedAt, unchanged: false };
      }
    } else {
      const updated = await dbClient.execute({
        sql: `UPDATE ea_tldraw_documents
                 SET document_gzip = ?,
                     content_hash = ?,
                     revision = revision + 1,
                     updated_at = ?
               WHERE user_id = ?
                 AND revision = ?
                 AND content_hash <> ?`,
        args: [compressed, hash, updatedAt, userId, baseRevision, hash],
      });
      if (updated.rowsAffected === 1) {
        return { revision: baseRevision + 1, updatedAt, unchanged: false };
      }
    }

    // Only ambiguous zero-row results need a read: either an identical no-op or
    // a stale/missing revision. Changed saves stay one database request.
    const existing = await dbClient.execute({
      sql: `SELECT content_hash, revision, updated_at
              FROM ea_tldraw_documents
             WHERE user_id = ?`,
      args: [userId],
    });
    const row = existing.rows[0];
    if (!row) throw new TldrawDocumentConflictError();
    const currentRevision = Number(row.revision);
    if (currentRevision !== baseRevision) throw new TldrawDocumentConflictError();
    const currentUpdatedAt = stringValue(row.updated_at) ?? now.toISOString();
    if (stringValue(row.content_hash) === hash) {
      return { revision: currentRevision, updatedAt: currentUpdatedAt, unchanged: true };
    }
    throw new TldrawDocumentConflictError();
  }

  return { getDocument, saveDocument };
}

export type TldrawDocumentService = ReturnType<typeof createTldrawDocumentService>;
export const tldrawDocumentService = createTldrawDocumentService();
