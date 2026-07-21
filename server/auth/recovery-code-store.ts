import crypto from "crypto";
import db from "../db/connection.ts";
import type { Client } from "@libsql/client";

export const RECOVERY_CODE_COUNT = 8;

function normalizeRecoveryCode(value: unknown): string {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashRecoveryCode(code: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex")}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const groups = crypto.randomBytes(16).toString("hex").toUpperCase().match(/.{4}/g) || [];
    return `SP-${groups.join("-")}`;
  });
}

export function createRecoveryCodeStore(database: Client = db) {
  async function replaceRecoveryCodes(userId: string, codes: string[], generatedAt = Date.now()) {
    await database.batch([
      { sql: "DELETE FROM ea_owner_recovery_codes WHERE user_id = ?", args: [userId] },
      ...codes.map((code) => ({
        sql: `INSERT INTO ea_owner_recovery_codes
                (user_id, code_hash, generated_at)
              VALUES (?, ?, ?)`,
        args: [userId, hashRecoveryCode(code), generatedAt],
      })),
    ], "write");
  }

  async function consumeRecoveryCode(userId: string, code: unknown, usedAt = Date.now()) {
    if (!normalizeRecoveryCode(code)) return false;
    const result = await database.execute({
      sql: `UPDATE ea_owner_recovery_codes
               SET used_at = ?
             WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
      args: [usedAt, userId, hashRecoveryCode(code)],
    });
    return result.rowsAffected === 1;
  }

  async function getRecoveryCodeStatus(userId: string) {
    const result = await database.execute({
      sql: `SELECT COUNT(CASE WHEN used_at IS NULL THEN 1 END) AS remaining,
                   MAX(generated_at) AS generated_at
              FROM ea_owner_recovery_codes
             WHERE user_id = ?`,
      args: [userId],
    });
    const row = result.rows[0];
    return {
      remaining: Number(row?.remaining || 0),
      generatedAt: row?.generated_at == null ? null : Number(row.generated_at),
    };
  }

  return { replaceRecoveryCodes, consumeRecoveryCode, getRecoveryCodeStatus };
}

const recoveryCodeStore = createRecoveryCodeStore();
export const getRecoveryCodeStatus = recoveryCodeStore.getRecoveryCodeStatus;
