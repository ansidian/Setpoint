import db from "../db/connection.ts";
import type { Client } from "@libsql/client";
import type { RootKeyHealthMetadata } from "../../shared/types/instance-credentials.ts";
import { createEncryption, getRootKeyHealth } from "./encryption.ts";
import { readEncryptedCredentialInventory } from "./encrypted-credential-inventory.ts";

type RootKeyHealthDb = Pick<Client, "execute">;

export function createRootKeyHealthService({
  dbClient = db,
  environment = process.env,
  encryption = createEncryption(),
}: {
  dbClient?: RootKeyHealthDb;
  environment?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  encryption?: ReturnType<typeof createEncryption>;
} = {}) {
  async function getMetadata(): Promise<RootKeyHealthMetadata> {
    const health = getRootKeyHealth(environment.EA_ENCRYPTION_KEY);
    if (!health.valid) return { ...health, decryptability: "unavailable" };
    try {
      for (const record of await readEncryptedCredentialInventory(dbClient)) {
        encryption.decrypt(record.ciphertext, record.context);
      }
      return { ...health, decryptability: "ok" };
    } catch {
      return { ...health, decryptability: "failed" };
    }
  }

  async function assertDecryptable(): Promise<void> {
    const metadata = await getMetadata();
    if (metadata.decryptability === "failed") {
      throw new Error("Stored credentials cannot be decrypted with EA_ENCRYPTION_KEY");
    }
  }

  return { getMetadata, assertDecryptable };
}

export const rootKeyHealthService = createRootKeyHealthService();
