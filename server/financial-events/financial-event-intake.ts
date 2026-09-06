import { randomUUID } from "node:crypto";
import type { Client, InStatement, Row } from "@libsql/client";
import db from "../db/connection.ts";
import { fetchFinancialReceivedEmailPage, indexFinancialReceivedEmails, type ConfiguredEmailAccount } from "../email/financial-email-intake.ts";
import { canonicalizeConfiguredAccounts } from "../platform/account-canonical.ts";

const POLL_MS = 5 * 60_000;
const WINDOW_MS = 24 * 60 * 60_000;
const CLAIM_LEASE_MS = 15 * 60_000;
type IntakeDb = Pick<Client, "execute" | "batch">;

/** Durable forward capture from the deployment cutoff, independent of Inbox triage. */
export function createFinancialEventIntake({
  dbClient = db,
  fetchPage = fetchFinancialReceivedEmailPage,
  now = Date.now,
}: { dbClient?: IntakeDb; fetchPage?: typeof fetchFinancialReceivedEmailPage; now?: () => number } = {}) {
  async function refreshConfiguredAccounts(): Promise<void> {
    const result = await dbClient.execute("SELECT * FROM ea_accounts WHERE type = 'gmail'");
    const byOwner = new Map<string, Row[]>();
    for (const row of result.rows) {
      const owner = String(row.user_id);
      byOwner.set(owner, [...(byOwner.get(owner) || []), row]);
    }
    const statements: InStatement[] = [{ sql: "UPDATE ea_financial_intake_state SET enabled = 0", args: [] }];
    for (const [owner, accounts] of byOwner) {
      for (const account of canonicalizeConfiguredAccounts(accounts)) {
        statements.push({
          sql: `INSERT INTO ea_financial_intake_state (user_id, account_id, completed_through, updated_at)
                SELECT ?, ?, cutover_at, ? FROM ea_financial_workflow_state WHERE singleton_id = 1
                ON CONFLICT(user_id, account_id) DO UPDATE SET enabled = 1`,
          args: [owner, account.id!, now()],
        });
      }
    }
    await dbClient.batch(statements, "write");
  }

  async function recoverStaleClaims(): Promise<number> {
    await refreshConfiguredAccounts();
    const timestamp = now();
    const result = await dbClient.execute({
      sql: `UPDATE ea_financial_intake_state SET status = 'retry', claim_token = NULL, claimed_at = NULL,
              next_attempt_at = ?, last_error = 'Received-email capture was interrupted', updated_at = ?
            WHERE status = 'processing' AND claimed_at <= ?`,
      args: [timestamp, timestamp, timestamp - CLAIM_LEASE_MS],
    });
    return result.rowsAffected;
  }

  async function processNextPage(): Promise<boolean> {
    const timestamp = now();
    const token = randomUUID();
    const claimed = await dbClient.execute({
      sql: `UPDATE ea_financial_intake_state SET status = 'processing', claim_token = ?, claimed_at = ?,
              attempts = attempts + 1, updated_at = ?
            WHERE id = (SELECT id FROM ea_financial_intake_state WHERE enabled = 1
              AND status IN ('pending', 'waiting', 'retry') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
              ORDER BY updated_at, id LIMIT 1) RETURNING *`,
      args: [token, timestamp, timestamp, timestamp],
    });
    const claim = claimed.rows[0];
    if (!claim) return false;
    const userId = String(claim.user_id);
    const accountId = String(claim.account_id);
    try {
      const accountResult = await dbClient.execute({
        sql: "SELECT * FROM ea_accounts WHERE user_id = ? AND id = ? AND type = 'gmail'",
        args: [userId, accountId],
      });
      const account = accountResult.rows[0] as unknown as ConfiguredEmailAccount | undefined;
      if (!account) {
        await dbClient.execute({
          sql: `UPDATE ea_financial_intake_state SET enabled = 0, status = 'waiting', claim_token = NULL,
                  claimed_at = NULL, updated_at = ? WHERE id = ? AND claim_token = ?`,
          args: [now(), claim.id!, token],
        });
        return true;
      }
      const cutoff = await dbClient.execute("SELECT cutover_at FROM ea_financial_workflow_state WHERE singleton_id = 1");
      const cutoffAt = Date.parse(String(cutoff.rows[0]?.cutover_at));
      const completedThrough = Date.parse(String(claim.completed_through));
      const windowEnd = claim.window_end ? Date.parse(String(claim.window_end)) : Math.min(completedThrough + WINDOW_MS, timestamp);
      const start = Math.max(cutoffAt, completedThrough - POLL_MS);
      const end = Math.max(start, windowEnd);
      // Persist the fixed window before provider paging. A restart resumes the
      // exact query, and an expired page token only restarts this same window.
      await dbClient.execute({
        sql: "UPDATE ea_financial_intake_state SET window_end = ? WHERE id = ? AND claim_token = ?",
        args: [new Date(end).toISOString(), claim.id!, token],
      });
      const page = end > start ? await fetchPage(account, {
        start: new Date(start).toISOString(), end: new Date(end).toISOString(),
        pageToken: claim.page_token ? String(claim.page_token) : null, maxResults: 100,
      }) : { emails: [], nextPageToken: null, unavailableMessageCount: 0 };
      const arrivals = page.emails.filter((email) => Date.parse(email.date || "") >= cutoffAt);
      // Index + document admission are atomic in the index trigger. If the
      // process stops before cursor settlement, replay only repeats that upsert.
      await indexFinancialReceivedEmails(userId, arrivals, { dbClient, now: new Date(now()) });
      const more = Boolean(page.nextPageToken) || end < timestamp;
      await dbClient.execute({
        sql: `UPDATE ea_financial_intake_state SET completed_through = ?, window_end = ?, page_token = ?,
                status = ?, next_attempt_at = ?, attempts = 0, unavailable_count = unavailable_count + ?,
                last_error = NULL, claim_token = NULL, claimed_at = NULL, updated_at = ?
              WHERE id = ? AND claim_token = ? AND status = 'processing'`,
        args: [page.nextPageToken ? claim.completed_through! : new Date(end).toISOString(),
          page.nextPageToken ? new Date(end).toISOString() : null, page.nextPageToken,
          more ? "pending" : "waiting", more ? null : now() + POLL_MS,
          page.unavailableMessageCount, now(), claim.id!, token],
      });
    } catch (error) {
      const failure = error as { message?: string; pageTokenExpired?: boolean };
      const retryAt = now() + Math.min(30_000 * 2 ** Math.min(Number(claim.attempts), 7), 60 * 60_000);
      await dbClient.execute({
        sql: `UPDATE ea_financial_intake_state SET status = 'retry', next_attempt_at = ?, last_error = ?,
                page_token = CASE WHEN ? THEN NULL ELSE page_token END,
                claim_token = NULL, claimed_at = NULL, updated_at = ?
              WHERE id = ? AND claim_token = ? AND status = 'processing'`,
        args: [retryAt, (failure.message || String(error)).slice(0, 300), failure.pageTokenExpired ? 1 : 0,
          now(), claim.id!, token],
      });
    }
    return true;
  }

  async function getNextWakeAt(): Promise<number | null> {
    const result = await dbClient.execute({
      sql: `SELECT MIN(COALESCE(next_attempt_at, ?)) AS wake_at FROM ea_financial_intake_state
            WHERE enabled = 1 AND status IN ('pending', 'waiting', 'retry')`,
      args: [now()],
    });
    return result.rows[0]?.wake_at == null ? null : Number(result.rows[0].wake_at);
  }

  return { processNextPage, recoverStaleClaims, getNextWakeAt };
}

export const financialEventIntake = createFinancialEventIntake();
