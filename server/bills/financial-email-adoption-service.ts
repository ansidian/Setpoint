import db from "../db/connection.ts";
import { withAiUsageContext } from "../platform/ai-usage.ts";
import { planFinancialEmail } from "./financial-email-planner.ts";
import { financialEmailSourceIdentity } from "./financialEmailSourceIdentity.ts";
import { shouldAttemptFinancialEmailTypeVerification } from "./financialEmailClassificationPolicy.ts";
import { FINANCIAL_TARGET_INFERENCE_VERSION } from "./financialEmailTargetInference.ts";
import { FINANCIAL_CANDIDATE_SEMANTICS_VERSION } from "./bill-semantic-prompt.ts";
import { stageFinancialEmailPreflight } from "../transaction-imports/financial-email-preflight.ts";
import type { InStatement } from "@libsql/client";
import type {
  BillCandidate,
  BillEmailContext,
  BillPaySource,
  FinancialEmailPlan,
  FinancialEmailSourceIdentity,
} from "../../shared/types/bills.ts";

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

interface StoredFinancialContext {
  candidate: BillCandidate | null;
  plan: FinancialEmailPlan | null;
  candidateJson: string | null;
  planJson: string | null;
  accountId: string;
  emailId: string;
  email: BillEmailContext;
  sourceIdentity: FinancialEmailSourceIdentity;
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function validStoredPlan(value: FinancialEmailPlan | null): value is FinancialEmailPlan {
  return value?.version === 1
    && value.identity?.version === 1
    && Boolean(value.classification)
    && Boolean(value.operation)
    && Boolean(value.targets)
    && Boolean(value.reconciliation);
}

function shouldRefreshAuthentication(
  plan: FinancialEmailPlan,
  sourceIdentity: FinancialEmailSourceIdentity,
): boolean {
  if (sourceIdentity.senderAuthentication !== "pass") return false;
  return !plan.automation.gates.some((gate) => gate.gate === "authenticity" && gate.status === "pass");
}

function shouldRefreshTargetInference(plan: FinancialEmailPlan): boolean {
  return plan.targetInferenceVersion !== FINANCIAL_TARGET_INFERENCE_VERSION
    && plan.operation.intended === "create_transaction"
    && plan.targets.payee?.status === "unresolved"
    && Boolean(plan.candidate?.payee || plan.candidate?.payee_hint || plan.candidate?.payee_label);
}

const SEMANTIC_REFRESH_REASON_CODES = new Set([
  "semantic_event_missing",
  "semantic_event_ambiguous",
  "canonical_amount_missing",
  "due_date_missing",
  "due_date_invalid",
  "account_target_unresolved",
  "payee_target_unresolved",
  "category_target_unresolved",
  "from_account_target_unresolved",
  "to_account_target_unresolved",
  "schedule_target_unresolved",
]);

function shouldRefreshCandidateSemantics(plan: FinancialEmailPlan): boolean {
  return plan.candidateSemanticsVersion !== FINANCIAL_CANDIDATE_SEMANTICS_VERSION
    && ((plan.operation.kind === "review"
      && (plan.reviewReasons || []).some((reason) => SEMANTIC_REFRESH_REASON_CODES.has(reason.code)))
      || ["account_transfer_pending", "account_transfer_completed", "reward"].includes(String(plan.candidate.event_kind || "")));
}

async function loadStoredFinancialContext(
  userId: string,
  { emailId, accountId }: Pick<FinancialEmailSeedOptions, "emailId" | "accountId">,
  dbClient: FinancialPlanDb,
): Promise<StoredFinancialContext | null> {
  if (!emailId) return null;
  const accountFilter = accountId ? "AND t.account_id = ?" : "";
  const args = accountId ? [userId, emailId, accountId] : [userId, emailId];
  const result = await dbClient.execute({
    sql: `SELECT t.bill_candidate_json,
                 t.financial_email_plan_json,
                 t.account_id,
                 t.email_id,
                 i.from_name,
                 i.from_address,
                 i.subject,
                 i.body_snippet,
                 i.body_text,
                 i.sender_authentication_json
          FROM ea_email_triage t
          LEFT JOIN ea_email_index i
            ON i.user_id = t.user_id
           AND i.account_id = t.account_id
           AND i.uid = t.email_id
          WHERE t.user_id = ?
            AND t.email_id = ?
            ${accountFilter}
          ORDER BY t.updated_at DESC
          LIMIT 1`,
    args,
  });
  const row = result.rows[0];
  if (!row) return null;
  const plan = parseJson<FinancialEmailPlan>(row.financial_email_plan_json);
  return {
    candidate: parseJson<BillCandidate>(row.bill_candidate_json),
    plan: validStoredPlan(plan) ? plan : null,
    candidateJson: typeof row.bill_candidate_json === "string" ? row.bill_candidate_json : null,
    planJson: typeof row.financial_email_plan_json === "string" ? row.financial_email_plan_json : null,
    accountId: String(row.account_id),
    emailId: String(row.email_id),
    email: {
      from: [row.from_name, row.from_address].filter(Boolean).join(" "),
      from_address: row.from_address || "",
      subject: row.subject || "",
      snippet: row.body_snippet || "",
      body: row.body_text || "",
    },
    sourceIdentity: financialEmailSourceIdentity(row as {
      account_id: string;
      from_address?: string | null;
      sender_authentication_json?: unknown;
    }),
  };
}

async function persistPlanCompareAndSwap(
  userId: string,
  context: StoredFinancialContext,
  plan: FinancialEmailPlan,
  dbClient: FinancialPlanDb,
): Promise<boolean> {
  const result = await dbClient.execute({
    sql: `UPDATE ea_email_triage
          SET bill_candidate_json = ?,
              financial_email_plan_json = ?,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?
            AND bill_candidate_json IS ?
            AND financial_email_plan_json IS ?`,
    args: [
      JSON.stringify(plan.candidate),
      JSON.stringify(plan),
      userId,
      context.accountId,
      context.emailId,
      context.candidateJson,
      context.planJson,
    ],
  });
  return Number(result.rowsAffected || 0) === 1;
}

export async function resolveFinancialEmailSeed(
  userId: string,
  payload: FinancialEmailSeedOptions = {},
  {
    planner = planFinancialEmail,
    stagePreflight = stageFinancialEmailPreflight,
  }: {
    planner?: typeof planFinancialEmail;
    stagePreflight?: typeof stageFinancialEmailPreflight;
  } = {},
): Promise<FinancialEmailPlan> {
  return withAiUsageContext({
    userId, origin: "reader_adoption", accountId: payload.accountId, emailId: payload.emailId,
  }, async () => {
    const dbClient = payload.dbClient || db;
    const stored = await loadStoredFinancialContext(userId, payload, dbClient);
    const stage = async (plan: FinancialEmailPlan): Promise<void> => {
      if (!stored) return;
      await stagePreflight(userId, {
        accountId: stored.accountId,
        emailId: stored.emailId,
        emailSubject: String(stored.email.subject || ""),
        emailFrom: String(stored.email.from_address || stored.email.from || ""),
        emailBody: String(stored.email.body || ""),
      }, plan).catch(() => undefined);
    };
    const missingType = stored?.plan && shouldAttemptFinancialEmailTypeVerification(stored.plan.candidate);
    const refreshCandidateSemantics = Boolean(stored?.plan && shouldRefreshCandidateSemantics(stored.plan));
    if (
      stored?.plan
      && !missingType
      && !refreshCandidateSemantics
      && !shouldRefreshAuthentication(stored.plan, stored.sourceIdentity)
      && !shouldRefreshTargetInference(stored.plan)
    ) {
      await stage(stored.plan);
      return stored.plan;
    }

    const requestEmail: BillEmailContext = {
      ...(stored?.email || {}),
      ...(payload.email || {}),
      ...(payload.subject !== undefined ? { subject: payload.subject } : {}),
      ...(payload.from !== undefined ? { from: payload.from } : {}),
      ...(payload.body !== undefined ? { body: payload.body } : {}),
      ...(payload.snippet !== undefined ? { snippet: payload.snippet } : {}),
    };
    const plan = await planner(userId, {
      email: requestEmail,
      candidate: refreshCandidateSemantics ? null : stored?.candidate || payload.candidate || null,
      source: payload.source || "triage",
      providerMessageId: payload.providerMessageId || stored?.emailId || payload.emailId || null,
      candidateIdentityHint: payload.candidateIdentityHint,
      sourceIdentity: stored?.sourceIdentity || {
        accountId: payload.accountId || null,
        senderAddress: typeof requestEmail.from_address === "string" ? requestEmail.from_address : null,
        senderAuthentication: "unavailable",
      },
    });
    if (!stored) return plan;
    if (refreshCandidateSemantics
      && plan.reviewReasons.some((reason) => reason.code === "provider_unavailable")) {
      await stage(stored.plan || plan);
      return stored.plan || plan;
    }

    const persisted = await persistPlanCompareAndSwap(userId, stored, plan, dbClient);
    if (persisted) {
      await stage(plan);
      return plan;
    }
    const winner = await loadStoredFinancialContext(userId, {
      emailId: stored.emailId,
      accountId: stored.accountId,
    }, dbClient);
    const result = winner?.plan || plan;
    await stage(result);
    return result;
  });
}
