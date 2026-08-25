import { createHash } from "crypto";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { join, resolve } from "path";

export const TLDRAW_ASSET_MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_MEDIA_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

type AssetMetadata = {
  hash: string;
  mimeType: string;
  size: number;
  originalName: string | null;
};

export class InvalidTldrawAssetError extends Error {
  readonly code = "INVALID_TLDRAW_ASSET";
  readonly status = 400;

  constructor(message = "The media file is invalid or unsupported") {
    super(message);
  }
}

export class TldrawAssetNotFoundError extends Error {
  readonly code = "TLDRAW_ASSET_NOT_FOUND";
  readonly status = 404;

  constructor() {
    super("The media file was not found");
  }
}

function safeHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function sanitizeOriginalName(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 240);
  return cleaned || null;
}

function storageRoot(environment: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  return resolve(environment.EA_TLDRAW_ASSET_DIR || "server/db/tldraw-assets");
}

export function createTldrawAssetService({
  environment = process.env,
}: {
  environment?: NodeJS.ProcessEnv | Record<string, string | undefined>;
} = {}) {
  const root = storageRoot(environment);

  function dataPath(hash: string): string {
    return join(root, `${hash}.bin`);
  }

  function metadataPath(hash: string): string {
    return join(root, `${hash}.json`);
  }

  async function exists(hash: string): Promise<boolean> {
    try {
      await Promise.all([stat(dataPath(hash)), stat(metadataPath(hash))]);
      return true;
    } catch {
      return false;
    }
  }

  async function putAsset({
    hash,
    mimeType,
    bytes,
    originalName,
  }: {
    hash: string;
    mimeType: string;
    bytes: Buffer;
    originalName?: string;
  }): Promise<{ metadata: AssetMetadata; deduplicated: boolean }> {
    if (!safeHash(hash) || !ALLOWED_MEDIA_TYPES.has(mimeType)) {
      throw new InvalidTldrawAssetError();
    }
    if (!bytes.length || bytes.length > TLDRAW_ASSET_MAX_BYTES) {
      throw new InvalidTldrawAssetError("Media must be between 1 byte and 10 MB");
    }
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== hash) throw new InvalidTldrawAssetError("Media checksum did not match");

    await mkdir(root, { recursive: true });
    const metadata: AssetMetadata = {
      hash,
      mimeType,
      size: bytes.length,
      originalName: sanitizeOriginalName(originalName),
    };
    if (await exists(hash)) return { metadata, deduplicated: true };

    await writeFile(dataPath(hash), bytes, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    await writeFile(metadataPath(hash), JSON.stringify(metadata), { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    return { metadata, deduplicated: false };
  }

  async function getAsset(hash: string): Promise<{ metadata: AssetMetadata; bytes: Buffer }> {
    if (!safeHash(hash)) throw new TldrawAssetNotFoundError();
    try {
      const [metadataJson, bytes] = await Promise.all([
        readFile(metadataPath(hash), "utf8"),
        readFile(dataPath(hash)),
      ]);
      const metadata = JSON.parse(metadataJson) as AssetMetadata;
      if (metadata.hash !== hash || !ALLOWED_MEDIA_TYPES.has(metadata.mimeType)) {
        throw new TldrawAssetNotFoundError();
      }
      return { metadata, bytes };
    } catch (error) {
      if (error instanceof TldrawAssetNotFoundError) throw error;
      throw new TldrawAssetNotFoundError();
    }
  }

  return { putAsset, getAsset };
}

export type TldrawAssetService = ReturnType<typeof createTldrawAssetService>;
export const tldrawAssetService = createTldrawAssetService();
