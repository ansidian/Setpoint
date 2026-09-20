import type { InStatement } from "@libsql/client";
import db from "../db/connection.ts";
import { canonicalizeConfiguredAccounts } from "../platform/account-canonical.ts";
import type { CurrentDashboardHealthState, CurrentDashboardSeverity } from "../../shared/types/dashboard.ts";

const GMAIL_STALE_MS = 60 * 60_000;
const ICLOUD_STALE_MS = 20 * 60_000;
const REFRESH_ACTIVE_MS = 20 * 60_000;
interface HealthDb {
  execute(statement: string | InStatement): Promise<{ rows: Record<string, unknown>[] }>;
}
interface HealthOptions {
  dbClient?: HealthDb;
  now?: Date;
}
export interface EmailSyncHealth {
  accountId: string;
  email: string;
  type: "gmail" | "icloud";
  state: CurrentDashboardHealthState;
  severity: CurrentDashboardSeverity;
  lastSuccessAt: string | null;
  expiresAt: string | null;
  refreshStartedAt: string | null;
  message: string | null;
}

/** Only the ingestion sweep calls this after fetch, indexing and queue admission. */
export async function recordEmailInboxCheck(
  userId: string,
  accountId: string,
  outcome: "started" | "success" | "failed",
  { dbClient = db, now = new Date() }: HealthOptions = {},
): Promise<void> {
  const timestamp = now.toISOString();
  const column = outcome === "started" ? "refresh_started_at" : outcome === "success" ? "last_success_at" : "last_failed_at";
  const settled = outcome === "started" ? "" : ", refresh_started_at = NULL";
  const recovered = outcome === "success" ? ", last_failed_at = NULL" : "";
  await dbClient.execute({
    sql: `INSERT INTO ea_email_sync_health (user_id, account_id, ${column})
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, account_id) DO UPDATE SET ${column} = excluded.${column}${settled}${recovered}`,
    args: [userId, accountId, timestamp],
  });
}

function timestamp(value: unknown): string | null {
  if (!value) return null;
  // SQLite's default datetime is UTC; make its timezone explicit.
  const raw = String(value);
  const parsed = Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(raw) ? `${raw.replace(" ", "T")}Z` : raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Read-only projection. Provider/DB failures must never masquerade as no accounts. */
export async function getEmailSyncHealth(
  userId: string,
  { dbClient = db, now = new Date() }: HealthOptions = {},
): Promise<EmailSyncHealth[]> {
  const accountsResult = await dbClient.execute({
    sql: `SELECT id, type, email, needs_reauth, sort_order, created_at, updated_at
          FROM ea_accounts WHERE user_id = ? AND type IN ('gmail', 'icloud')`,
    args: [userId],
  });
  const accounts = canonicalizeConfiguredAccounts(accountsResult.rows);
  if (!accounts.length) return [];
  const [checks, jobs] = await Promise.all([
    dbClient.execute({ sql: "SELECT * FROM ea_email_sync_health WHERE user_id = ?", args: [userId] }),
    dbClient.execute({
      sql: `SELECT account_id, status, last_error, locked_at FROM ea_triage_jobs
            WHERE user_id = ? AND job_type = 'gmail_history_sync' AND status IN ('queued', 'running', 'failed')`,
      args: [userId],
    }),
  ]);
  return accounts.map((account): EmailSyncHealth => {
    const check = checks.rows.find((row) => row.account_id === account.id);
    // Watch renewal and first-notification seeding can advance Gmail's cursor
    // without ingesting mail. Only completed jobs settle known history work;
    // a later inbox sweep cannot erase queued or terminally failed history.
    // Explicit operator acknowledgment retains failure evidence under its own
    // terminal status; it is excluded here without inventing successful ingestion.
    const outstanding = jobs.rows.filter((job) => job.account_id === account.id);
    const terminalFailure = outstanding.some((job) => job.status === "failed");
    const failed = Boolean(check?.last_failed_at) || outstanding.some((job) => job.status === "failed" || Boolean(job.last_error));
    const lastSuccessAt = timestamp(check?.last_success_at);
    const staleMs = account.type === "gmail" ? GMAIL_STALE_MS : ICLOUD_STALE_MS;
    const expiresAt = lastSuccessAt ? new Date(Date.parse(lastSuccessAt) + staleMs).toISOString() : null;
    const refreshStartedAt = timestamp(check?.refresh_started_at)
      || timestamp(outstanding.find((job) => job.status === "running")?.locked_at);
    const base = {
      accountId: String(account.id), email: String(account.email), type: account.type as "gmail" | "icloud",
      lastSuccessAt, expiresAt, refreshStartedAt,
    };
    if (Number(account.needs_reauth) === 1) return { ...base, state: "needs_reauth", severity: "error", message: "Reconnect this email account to resume inbox checks." };
    if (failed) return { ...base, state: lastSuccessAt ? "degraded" : "unavailable", severity: lastSuccessAt ? "warning" : "error", message: terminalFailure ? "An earlier inbox sync failed and needs attention." : "The latest inbox sync failed. Setpoint will retry automatically." };
    const overdue = !expiresAt || now.getTime() >= Date.parse(expiresAt);
    if (overdue && lastSuccessAt) return { ...base, state: "needs_sync", severity: "info", message: `No successful inbox check in the last ${staleMs / 60_000} minutes.` };
    if (refreshStartedAt && now.getTime() - Date.parse(refreshStartedAt) < REFRESH_ACTIVE_MS) return { ...base, state: "refreshing", severity: "info", message: "Checking this inbox for updates." };
    if (!lastSuccessAt) return { ...base, state: "unavailable", severity: "error", message: "Waiting for the first successful inbox check." };
    if (outstanding.length) return { ...base, state: "needs_sync", severity: "info", message: "An inbox change is waiting to sync." };
    return { ...base, state: "current", severity: "none", message: null };
  });
}
