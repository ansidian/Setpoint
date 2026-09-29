import db from "../db/connection.ts";
import { resolveManagedFinancialPlan } from "../financial-events/financial-event-status.ts";
import type { InStatement } from "@libsql/client";
import type { BillCandidate, BillEmailContext, BillPaySource, FinancialEmailPlan } from "../../shared/types/bills.ts";

interface FinancialPlanDb {
  execute(statement: InStatement): Promise<{
    rows: Array<Record<string, unknown>>;
    rowsAffected?: number;
  }>;
}

export interface FinancialEmailSeedOptions {
  emailId?: string | null;
  accountId?: string | null;
  email?: BillEmailContext;
  subject?: unknown;
  from?: unknown;
  body?: unknown;
  snippet?: unknown;
  candidate?: BillCandidate | null;
  source?: BillPaySource;
  providerMessageId?: string | null;
  candidateIdentityHint?: string | number | null;
  dbClient?: FinancialPlanDb;
}

function validStoredPlan(value: unknown): value is FinancialEmailPlan {
  const plan = value as FinancialEmailPlan | null;
  return plan?.version === 1
    && plan.identity?.version === 1
    && Boolean(plan.classification)
    && Boolean(plan.operation)
    && Boolean(plan.targets)
    && Boolean(plan.reconciliation);
}

async function loadStoredFinancialPlan(
  userId: string,
  { emailId, accountId }: Pick<FinancialEmailSeedOptions, "emailId" | "accountId">,
  dbClient: FinancialPlanDb,
): Promise<FinancialEmailPlan | null> {
  const accountFilter = accountId ? "AND account_id = ?" : "";
  const result = await dbClient.execute({
    sql: `SELECT financial_email_plan_json FROM ea_email_triage
          WHERE user_id = ? AND email_id = ? ${accountFilter}
          ORDER BY updated_at DESC LIMIT 1`,
    args: accountId ? [userId, emailId!, accountId] : [userId, emailId!],
  });
  const json = result.rows[0]?.financial_email_plan_json;
  if (typeof json !== "string" || !json.trim()) return null;
  try {
    const plan: unknown = JSON.parse(json);
    return validStoredPlan(plan) ? plan : null;
  } catch {
    return null;
  }
}

/**
 * Read-only reader resolution: the managed financial-event plan, otherwise a
 * historical plan saved before automatic planning was retired. Never plans,
 * calls AI, persists or stages work.
 */
export async function resolveFinancialEmailSeed(
  userId: string,
  payload: FinancialEmailSeedOptions = {},
): Promise<FinancialEmailPlan | null> {
  if (!payload.emailId) return null;
  const dbClient = payload.dbClient || db;
  return await resolveManagedFinancialPlan(userId, payload.emailId, { dbClient })
    || await loadStoredFinancialPlan(userId, payload, dbClient);
}
