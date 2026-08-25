import { createHash } from "crypto";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createTldrawAssetService, InvalidTldrawAssetError } from "./tldraw-asset-service.ts";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

describe("tldraw asset service", () => {
  it("stores media by content hash and deduplicates the second upload", async () => {
    root = await mkdtemp(join(tmpdir(), "setpoint-tldraw-assets-"));
    const service = createTldrawAssetService({ environment: { EA_TLDRAW_ASSET_DIR: root } });
    const bytes = Buffer.from("small-png-payload");
    const hash = createHash("sha256").update(bytes).digest("hex");

    const first = await service.putAsset({ hash, mimeType: "image/png", bytes, originalName: "idea.png" });
    const second = await service.putAsset({ hash, mimeType: "image/png", bytes, originalName: "idea.png" });

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    await expect(service.getAsset(hash)).resolves.toMatchObject({ bytes, metadata: { hash, mimeType: "image/png" } });
  });

  it("rejects unsupported files", async () => {
    root = await mkdtemp(join(tmpdir(), "setpoint-tldraw-assets-"));
    const service = createTldrawAssetService({ environment: { EA_TLDRAW_ASSET_DIR: root } });
    const bytes = Buffer.from("pdf");
    const hash = createHash("sha256").update(bytes).digest("hex");

    await expect(service.putAsset({ hash, mimeType: "application/pdf", bytes })).rejects.toBeInstanceOf(InvalidTldrawAssetError);
  });
});
