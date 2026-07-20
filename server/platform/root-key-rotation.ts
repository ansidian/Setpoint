import type { InStatement } from "@libsql/client";
import { createEncryption, getRootKeyHealth } from "./encryption.ts";
import {
  readEncryptedCredentialInventory,
  type EncryptedCredentialRecord,
} from "./encrypted-credential-inventory.ts";

type RotationExecuteResult = {
  rows: Array<Record<string, unknown>>;
  rowsAffected?: number;
};

type RotationExecutor = {
  execute(statement: string | InStatement): Promise<RotationExecuteResult>;
};

type RotationTransaction = RotationExecutor & {
  commit(): Promise<void>;
  rollback(): Promise<void>;
};

export type RootKeyRotationDb = RotationExecutor & {
  transaction(mode: "write"): Promise<RotationTransaction>;
};

export type RootKeyRotationResult = Readonly<{
  applied: boolean;
  credentialCount: number;
  targetCounts: Readonly<Record<string, number>>;
  oldKeyFingerprint: string;
  newKeyFingerprint: string;
}>;

function fingerprint(key: string): string {
  const health = getRootKeyHealth(key);
  if (!health.valid || !health.fingerprint) {
    throw new Error("Root encryption key is invalid");
  }
  return health.fingerprint;
}

function targetCounts(records: readonly EncryptedCredentialRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    counts[record.target.name] = (counts[record.target.name] ?? 0) + 1;
  }
  return counts;
}

async function prepareRotation(
  executor: RotationExecutor,
  oldKey: string,
  newKey: string,
) {
  const oldEncryption = createEncryption(() => oldKey);
  const newEncryption = createEncryption(() => newKey);
  const records = await readEncryptedCredentialInventory(executor as never);
  const prepared = records.map((record) => {
    const plaintext = oldEncryption.decrypt(record.ciphertext, record.context);
    const ciphertext = newEncryption.encrypt(plaintext, record.context);
    if (newEncryption.decrypt(ciphertext, record.context) !== plaintext) {
      throw new Error("Rotated credential verification failed");
    }
    return { record, ciphertext };
  });
  return { records, prepared, newEncryption };
}

export async function rotateRootEncryptionKey({
  dbClient,
  oldKey,
  newKey,
  apply = false,
}: {
  dbClient: RootKeyRotationDb;
  oldKey: string;
  newKey: string;
  apply?: boolean;
}): Promise<RootKeyRotationResult> {
  const oldKeyFingerprint = fingerprint(oldKey);
  const newKeyFingerprint = fingerprint(newKey);
  if (oldKeyFingerprint === newKeyFingerprint) {
    throw new Error("Old and new root encryption keys must be different");
  }

  if (!apply) {
    const { records } = await prepareRotation(dbClient, oldKey, newKey);
    return {
      applied: false,
      credentialCount: records.length,
      targetCounts: targetCounts(records),
      oldKeyFingerprint,
      newKeyFingerprint,
    };
  }

  const tx = await dbClient.transaction("write");
  try {
    const { records, prepared, newEncryption } = await prepareRotation(tx, oldKey, newKey);
    for (const item of prepared) {
      const result = await tx.execute({
        sql: item.record.target.updateSql,
        args: [item.ciphertext, item.record.recordId, item.record.ciphertext],
      });
      if (result.rowsAffected !== 1) {
        throw new Error("Credential changed during root key rotation");
      }
    }

    const verified = await readEncryptedCredentialInventory(tx as never);
    if (verified.length !== records.length) {
      throw new Error("Credential inventory changed during root key rotation");
    }
    for (const record of verified) {
      newEncryption.decrypt(record.ciphertext, record.context);
    }
    await tx.commit();
    return {
      applied: true,
      credentialCount: records.length,
      targetCounts: targetCounts(records),
      oldKeyFingerprint,
      newKeyFingerprint,
    };
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
}
