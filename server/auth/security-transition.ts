import db from "../db/connection.ts";
import type { Client, Transaction } from "@libsql/client";

type SecurityTransitionDb = Pick<Client, "transaction">;

type SecurityTransitionInput = {
  userId: string;
  expectedGeneration: number;
  mutate: (tx: Transaction, nextGeneration: number) => Promise<void>;
  revokeApiTokens?: boolean;
};

export function createOwnerSecurityTransitionService(database: SecurityTransitionDb = db) {
  async function transition({
    userId,
    expectedGeneration,
    mutate,
    revokeApiTokens = false,
  }: SecurityTransitionInput): Promise<number | null> {
    const tx = await database.transaction("write");
    try {
      const bumped = await tx.execute({
        sql: `UPDATE ea_owner
                 SET security_generation = security_generation + 1
               WHERE singleton_id = 1
                 AND user_id = ?
                 AND security_generation = ?
             RETURNING security_generation`,
        args: [userId, expectedGeneration],
      });
      const nextGeneration = Number(bumped.rows[0]?.security_generation || 0);
      if (!nextGeneration) {
        await tx.rollback();
        return null;
      }

      await mutate(tx, nextGeneration);
      await tx.execute({ sql: "DELETE FROM ea_sessions", args: [] });
      await tx.execute({ sql: "DELETE FROM ea_pending_auth WHERE user_id = ?", args: [userId] });
      await tx.execute({ sql: "DELETE FROM ea_webauthn_challenges WHERE user_id = ?", args: [userId] });
      if (revokeApiTokens) {
        await tx.execute({ sql: "DELETE FROM ea_api_tokens", args: [] });
      }
      await tx.commit();
      return nextGeneration;
    } catch (error) {
      if (!tx.closed) await tx.rollback().catch(() => {});
      throw error;
    } finally {
      tx.close();
    }
  }

  return { transition };
}

export const ownerSecurityTransitionService = createOwnerSecurityTransitionService();
