import type { FinancialActivityReference, FinancialOriginalReceipt, FinancialWriteEvidence } from './financial-activity.ts';

export interface FinancialCorrectionDraft {
  type: 'payment' | 'income' | 'transfer' | 'bill';
  amountCents: number;
  date: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  payeeId?: string | null;
  categoryId?: string | null;
  notes?: string;
  name?: string;
  targetScheduleId?: string;
  /** Required for a schedule-to-ledger conversion; never inferred from old outcomes. */
  scheduleTreatment?: 'keep' | 'retire' | 'restore';
  /** Explicit survivor when converting an existing transfer to an ordinary entry. */
  retainTransactionId?: string;
}
export type CorrectionRow = Record<string, unknown> & { id: string };
export interface CorrectionSnapshot {
  budgetId: string;
  transactions: CorrectionRow[];
  schedules: CorrectionRow[];
  rules: CorrectionRow[];
  dates: CorrectionRow[];
  accounts: CorrectionRow[];
  payees: CorrectionRow[];
  categories: CorrectionRow[];
  scheduleNames: CorrectionRow[];
}
export interface CorrectionTargets { transactionIds: string[]; scheduleIds: string[]; ruleIds: string[] }
export interface CorrectionStep {
  id: string;
  command: 'transactions-batch-update' | 'schedule/create' | 'schedule/update' | 'schedule/delete' | 'rule-delete' | 'schedule/rule-update';
  payload: unknown;
  targets: CorrectionTargets;
  before: CorrectionSnapshot;
  /** Exact intended raw fields; generated schedule children are verified separately. */
  after: { transactions?: CorrectionRow[]; schedule?: CorrectionRow; conditions?: unknown[]; scheduleActions?: unknown[]; nextDate?: number; removedScheduleId?: string; removedRuleId?: string; ruleActions?: { scheduleId: string; actions: unknown[] } };
}
export interface FinancialCorrectionPreview {
  id: string;
  reference: FinancialActivityReference;
  activityId: string;
  budgetId: string;
  sourceRevision: string;
  predecessorId: string | null;
  draft: FinancialCorrectionDraft;
  originalReceipts: FinancialOriginalReceipt[];
  evidence: FinancialWriteEvidence;
  snapshot: CorrectionSnapshot;
  targets: CorrectionTargets;
  steps: CorrectionStep[];
  createdAt: number;
}
export interface CorrectionStepStatus {
  step: CorrectionStep;
  attemptedAt: number | null;
  state: 'unattempted' | 'uncertain' | 'applied' | 'no_write' | 'partial' | 'conflict';
  observed: CorrectionSnapshot | null;
  error: string | null;
}
export interface FinancialCorrection {
  id: string;
  preview: FinancialCorrectionPreview;
  state: 'applying' | 'recovering' | 'attention' | 'completed' | 'superseded';
  executionStopped: boolean;
  steps: CorrectionStepStatus[];
  revision: number;
  effectiveResult: unknown;
  updatedAt: number;
}
