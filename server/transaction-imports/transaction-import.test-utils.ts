import type { Client } from '@libsql/client';
import type { FinancialEmailPlan } from '../../shared/types/bills.ts';
import type { TransactionImportItemStatus, TransactionImportPlanShadow, TransactionImportSource } from '../../shared/types/transaction-imports.ts';

export interface SavedImportItemInput {
  id: string;
  runId: string;
  userId: string;
  gmailAccountId: string;
  gmailMessageId: string;
  emailUid: string;
  emailSubject?: string;
  internetMessageId?: string | null;
  candidateKey: string;
  source: TransactionImportSource;
  parserVersion: string;
  externalId?: string | null;
  importedId?: string | null;
  date: string | null;
  amountCents: number | null;
  currency: string | null;
  payee: string | null;
  notes?: string;
  actualAccountId?: string | null;
  actualCategoryId?: string | null;
  automationMode: 'observe' | 'automatic';
  automaticSafe: boolean;
  blockingWarnings: unknown[];
  evidence: unknown[];
  financialPlan?: FinancialEmailPlan | null;
  planShadow?: TransactionImportPlanShadow | null;
  status: TransactionImportItemStatus;
}

/** Seeds a retired import run as saved history; the product no longer creates runs. */
export async function seedSavedImportRun(db: Pick<Client, 'execute'>, { id, userId, trigger = 'arrival', createdAt = 1_000 }: {
  id: string; userId: string; trigger?: 'arrival' | 'historical_scan'; createdAt?: number;
}): Promise<void> {
  await db.execute({
    sql: `INSERT INTO ea_transaction_import_runs (id, user_id, trigger, options_key, gmail_account_ids_json, sources_json,
            start_date, end_date, status, cursor_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, '["gmail-1"]', '["amazon"]', ?, ?, 'completed', '{}', ?, ?)`,
    args: [id, userId, trigger, `saved:${id}`, trigger === 'historical_scan' ? '2026-01-01' : null,
      trigger === 'historical_scan' ? '2026-02-01' : null, createdAt, createdAt],
  });
}

/** Seeds one saved import item; database triggers still derive its activity occurrence. */
export async function seedSavedImportItem(db: Pick<Client, 'execute'>, input: SavedImportItemInput, timestamp = 1_000): Promise<void> {
  await db.execute({
    sql: `INSERT INTO ea_transaction_import_items
            (id, run_id, user_id, gmail_account_id, gmail_message_id, email_uid, email_subject,
             internet_message_id, candidate_key, source, parser_version, external_id,
             imported_id, transaction_date, amount_cents, currency, payee, notes,
             actual_account_id, actual_category_id, automation_mode, automatic_safe,
             blocking_warnings_json, evidence_json, financial_email_plan_json,
             financial_plan_shadow_json, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.id, input.runId, input.userId, input.gmailAccountId, input.gmailMessageId,
      input.emailUid, input.emailSubject ?? '', input.internetMessageId ?? null, input.candidateKey, input.source,
      input.parserVersion, input.externalId ?? null, input.importedId ?? null, input.date,
      input.amountCents, input.currency, input.payee, input.notes ?? '', input.actualAccountId ?? null,
      input.actualCategoryId ?? null, input.automationMode, input.automaticSafe ? 1 : 0,
      JSON.stringify(input.blockingWarnings), JSON.stringify(input.evidence),
      input.financialPlan ? JSON.stringify(input.financialPlan) : null,
      input.planShadow ? JSON.stringify(input.planShadow) : null, input.status,
      timestamp, timestamp,
    ],
  });
}

/** Captured legacy rows for history tests: parser behavior belongs to the provider registry. */
export function savedImportFixture(overrides: Partial<SavedImportItemInput> = {}): SavedImportItemInput {
  return {
    id: "fixture-item", runId: "fixture-run", userId: "owner-1",
    gmailAccountId: "gmail-personal", gmailMessageId: "msg-1", emailUid: "gmail-personal-msg-1",
    emailSubject: "Your Amazon.com order #111-2222222-3333333", internetMessageId: "<sanitized@example.test>",
    candidateKey: "amazon-111-2222222-3333333", source: "amazon", parserVersion: "amazon-v1",
    externalId: "111-2222222-3333333", importedId: "amazon-111-2222222-3333333",
    date: "2026-07-21", amountCents: -2704, currency: "USD", payee: "Amazon", notes: "",
    actualAccountId: null, actualCategoryId: null, automationMode: "automatic", automaticSafe: false,
    blockingWarnings: [], evidence: [], status: "needs_review", ...overrides,
  };
}
