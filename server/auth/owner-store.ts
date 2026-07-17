import db from "../db/connection.ts";
import type { Client } from "@libsql/client";

const OWNER_SINGLETON_ID = 1;

export interface OwnerRecord {
  singletonId: 1;
  userId: string;
  passwordHash: string;
  claimedAt: number;
}

export interface OwnerClaimInput {
  userId: string;
  passwordHash: string;
  claimedAt: number;
}

type OwnerStoreDb = Pick<Client, "execute">;

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

export function createOwnerStore(dbClient: OwnerStoreDb = db) {
  async function getOwner(): Promise<OwnerRecord | null> {
    const result = await dbClient.execute({
      sql: `SELECT singleton_id, user_id, password_hash, claimed_at
              FROM ea_owner
             WHERE singleton_id = ?`,
      args: [OWNER_SINGLETON_ID],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      singletonId: 1,
      userId: stringValue(row.user_id),
      passwordHash: stringValue(row.password_hash),
      claimedAt: numberValue(row.claimed_at),
    };
  }

  async function claimOwner(input: OwnerClaimInput): Promise<{ claimed: boolean }> {
    const result = await dbClient.execute({
      sql: `INSERT OR IGNORE INTO ea_owner
              (singleton_id, user_id, password_hash, claimed_at)
            VALUES (?, ?, ?, ?)`,
      args: [OWNER_SINGLETON_ID, input.userId, input.passwordHash, input.claimedAt],
    });
    return { claimed: result.rowsAffected === 1 };
  }

  return { getOwner, claimOwner };
}

export const ownerStore = createOwnerStore();
export const getOwner = ownerStore.getOwner;
export const claimOwner = ownerStore.claimOwner;
