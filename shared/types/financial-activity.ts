import type { FinancialCorrection } from './financial-corrections.ts';
import type { FinancialEmailPlan } from "./bills.ts";
import type { TransactionImportItem, TransactionImportRunSummary, TransactionImportSource } from "./transaction-imports.ts";

/** Owner is supplied by authentication, never by a request parameter. */
export type FinancialActivityReference =
  | { owner: "event"; id: string }
  | { owner: "document"; id: string }
  | { owner: "import"; id: string; runId: string };

export interface FinancialObjectEvidence {
  kind: "transaction" | "schedule" | "rule" | "schedule_next_date";
  id: string;
  role: "primary" | "counterpart" | "split_child" | "schedule_rule" | "next_date";
  provenance: "created" | "updated" | "matched" | "unknown";
  /** Null means unknown. An absent object before creation is an explicit absent snapshot. */
  beforeState: "captured" | "confirmed_absent" | "unknown";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface FinancialWriteEvidence {
  budgetId: string;
  objects: FinancialObjectEvidence[];
}

export interface FinancialOriginalReceipt {
  reference: FinancialActivityReference;
  revision: number | null;
  capturedAt: number;
  captureKind: "settlement" | "historical";
  outcome: string;
  input: unknown;
  result: unknown;
  evidence: FinancialWriteEvidence | null;
}

export interface FinancialActivity {
  id: string;
  reference: FinancialActivityReference;
  occurrences: FinancialActivityReference[];
  source: "managed" | TransactionImportSource;
  contexts: Array<"arrival" | "historical_scan">;
  emailUids: string[];
  subject: string;
  payee: string | null;
  amountCents: number | null;
  currency: string | null;
  createdAt: number;
  updatedAt: number;
  status: "needs_attention" | "processing" | "completed" | "dismissed";
  reason: string;
  identityConflict?: true;
  actions: { complete: boolean; retry: boolean; inspect: true; correct: boolean };
  originalReceipts: FinancialOriginalReceipt[];
  sourceEvidence: unknown[];
  targetBindings: FinancialWriteEvidence[];
  /** Saved evidence only; a read of history does not query or synchronize Actual. */
  liveState: "not_checked";
  effectiveResult: unknown;
  correction?: { id: string; state: FinancialCorrection['state']; revision: number };
  completionPlan: FinancialEmailPlan | null;
  importItem: TransactionImportItem | null;
  runs: TransactionImportRunSummary[];
}

export interface FinancialActivityQuery {
  view?: "needs_attention" | "completed" | "all";
  source?: FinancialActivity["source"];
  context?: "arrival" | "historical_scan";
  runId?: string;
  offset?: number;
}

export interface FinancialActivityPage {
  items: FinancialActivity[];
  total: number;
  offset: number;
  limit: 20;
}

export interface FinancialBindingInspection {
  status: "resolved" | "missing" | "ambiguous" | "wrong_budget" | "unavailable";
  evidence: FinancialWriteEvidence | null;
}
