import { readFile, readdir } from "fs/promises";
import { crc32 } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsCredentialContext } from "../platform/credential-encryption-context.ts";
import { encrypt } from "../platform/encryption.ts";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import { hydrateLocalActualCache } from "./actual-local-metadata.ts";

const originalFetch = global.fetch;
const originalEncryptionKey = process.env.EA_ENCRYPTION_KEY;
let tempDir: string | null = null;

function storedZip(entries: Array<{ name: string; data: Buffer; checksum?: number }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const checksum = entry.checksum ?? crc32(entry.data);
    const local = Buffer.alloc(30 + name.length + entry.data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    entry.data.copy(local, 30 + name.length);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    localParts.push(local);
    centralParts.push(central);
    localOffset += local.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

afterEach(async () => {
  global.fetch = originalFetch;
  if (originalEncryptionKey === undefined) delete process.env.EA_ENCRYPTION_KEY;
  else process.env.EA_ENCRYPTION_KEY = originalEncryptionKey;
  if (tempDir) await removeTempDir(tempDir);
  tempDir = null;
});

describe("Actual hydration archive security", () => {
  it.each([
    { valid: false, label: "rejects a corrupt archive before writing files" },
    { valid: true, label: "downloads the bounded archive without a custom sync request" },
  ])("$label", async ({ valid }) => {
    tempDir = await createTestTempDir("actual-hydration-security-");
    process.env.EA_ENCRYPTION_KEY = "11".repeat(32);
    const encryptedPassword = encrypt(
      "password-1",
      settingsCredentialContext("u1", "actual_budget_password_encrypted"),
    );
    const archive = storedZip([
      { name: "db.sqlite", data: Buffer.from("budget-data"), ...(valid ? {} : { checksum: 123 }) },
      { name: "metadata.json", data: Buffer.from('{"id":"Budget-Remote"}') },
    ]);
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/account/login")) return Response.json({ data: { token: "token-1" } });
      if (url.endsWith("/sync/list-user-files")) {
        return Response.json({ data: [{ groupId: "sync-123", fileId: "file-1" }] });
      }
      if (url.endsWith("/sync/get-user-file-info")) {
        return Response.json({ status: "ok", data: { encryptMeta: false } });
      }
      if (url.endsWith("/sync/download-user-file")) return new Response(archive);
      throw new Error(`Unexpected Actual request: ${url}`);
    }) as typeof fetch;

    const hydration = hydrateLocalActualCache("u1", {
      dbClient: {
        execute: async () => ({
          rows: [{
            actual_budget_url: "https://actual.example.test",
            actual_budget_password_encrypted: encryptedPassword,
            actual_budget_sync_id: "sync-123",
          }],
        }),
      },
      dataDir: tempDir,
      forceDownload: true,
    });

    if (valid) {
      await expect(hydration).resolves.toMatchObject({ success: true, hydrated: true, budgetId: "Budget-Remote" });
      await expect(readFile(`${tempDir}/Budget-Remote/db.sqlite`, "utf8")).resolves.toBe("budget-data");
      const metadata = JSON.parse(await readFile(`${tempDir}/Budget-Remote/metadata.json`, "utf8"));
      expect(metadata).toMatchObject({ id: "Budget-Remote", groupId: "sync-123", cloudFileId: "file-1" });
    } else {
      await expect(hydration).rejects.toThrow(/CRC/);
      await expect(readdir(tempDir)).resolves.toEqual([]);
    }
  });
});
