import db from "../db/connection.ts";
import type { Client } from "@libsql/client";
import { isOwnerAuthMode, type OwnerAuthMode } from "./auth-mode.ts";

const OWNER_SINGLETON_ID = 1;

export interface OwnerRecord {
  singletonId: 1;
  userId: string;
  passwordHash: string;
  authMode: OwnerAuthMode;
  securityGeneration: number;
  claimedAt: number;
}

export interface OwnerClaimInput {
  userId: string;
  passwordHash: string;
  claimedAt: number;
  recoveryCodeHashes?: string[];
  canonicalOrigin?: string;
}

type OwnerStoreDb = Pick<Client, "execute" | "batch">;

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

export function createOwnerStore(dbClient: OwnerStoreDb = db) {
  async function getOwner(): Promise<OwnerRecord | null> {
    const result = await dbClient.execute({
      sql: `SELECT singleton_id, user_id, password_hash, auth_mode, security_generation, claimed_at
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
      authMode: isOwnerAuthMode(row.auth_mode) ? row.auth_mode : "password_or_passkey",
      securityGeneration: numberValue(row.security_generation),
      claimedAt: numberValue(row.claimed_at),
    };
  }

  async function claimOwner(input: OwnerClaimInput): Promise<{ claimed: boolean }> {
    if (input.recoveryCodeHashes?.length || input.canonicalOrigin) {
      const results = await dbClient.batch([
        {
          sql: `INSERT OR IGNORE INTO ea_owner
                  (singleton_id, user_id, password_hash, claimed_at)
                VALUES (?, ?, ?, ?)`,
          args: [OWNER_SINGLETON_ID, input.userId, input.passwordHash, input.claimedAt],
        },
        ...(input.canonicalOrigin ? [{
          sql: `INSERT INTO ea_instance_metadata
                  (singleton_id, canonical_origin, source, confirmed_at, updated_at)
                SELECT 1, ?, 'owner_confirmed', ?, ?
                 WHERE EXISTS (SELECT 1 FROM ea_owner WHERE singleton_id = ? AND user_id = ?)
                ON CONFLICT(singleton_id) DO UPDATE SET
                  canonical_origin = excluded.canonical_origin,
                  source = excluded.source,
                  confirmed_at = excluded.confirmed_at,
                  updated_at = excluded.updated_at`,
          args: [input.canonicalOrigin, input.claimedAt, input.claimedAt, OWNER_SINGLETON_ID, input.userId],
        }] : []),
        ...(input.recoveryCodeHashes || []).map((codeHash) => ({
          sql: `INSERT INTO ea_owner_recovery_codes (user_id, code_hash, generated_at)
                SELECT ?, ?, ?
                 WHERE EXISTS (SELECT 1 FROM ea_owner WHERE singleton_id = ? AND user_id = ?)`,
          args: [input.userId, codeHash, input.claimedAt, OWNER_SINGLETON_ID, input.userId],
        })),
      ], "write");
      return { claimed: results[0]?.rowsAffected === 1 };
    }
    const result = await dbClient.execute({
      sql: `INSERT OR IGNORE INTO ea_owner
              (singleton_id, user_id, password_hash, claimed_at)
            VALUES (?, ?, ?, ?)`,
      args: [OWNER_SINGLETON_ID, input.userId, input.passwordHash, input.claimedAt],
    });
    return { claimed: result.rowsAffected === 1 };
  }

  async function setAuthMode(userId: string, authMode: OwnerAuthMode): Promise<boolean> {
    const result = await dbClient.execute({
      sql: "UPDATE ea_owner SET auth_mode = ? WHERE singleton_id = ? AND user_id = ?",
      args: [authMode, OWNER_SINGLETON_ID, userId],
    });
    return result.rowsAffected === 1;
  }

  async function updatePasswordHash(userId: string, passwordHash: string): Promise<boolean> {
    const result = await dbClient.execute({
      sql: "UPDATE ea_owner SET password_hash = ? WHERE singleton_id = ? AND user_id = ?",
      args: [passwordHash, OWNER_SINGLETON_ID, userId],
    });
    return result.rowsAffected === 1;
  }

  return { getOwner, claimOwner, setAuthMode, updatePasswordHash };
}

export const ownerStore = createOwnerStore();
export const getOwner = ownerStore.getOwner;
