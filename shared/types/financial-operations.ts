interface ActualFinancialOperationBase {
  identityKey: string;
  budgetId?: string;
}

/** Owner-confirmed USD entry; amounts are positive dollars for every kind. */
export interface FinancialEventCompletionEntry {
  kind: "expense" | "income" | "bill" | "transfer" | "transfer_schedule";
  amount: number;
  date: string;
  payee?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  categoryId?: string | null;
  notes?: string;
  scheduleName?: string;
}

export interface FinancialEventCompletionRequest {
  emailUid: string;
  documentRevision: number;
  eventRevision: number | null;
  entry: FinancialEventCompletionEntry;
}

export interface ActualCompletedTransferInput extends ActualFinancialOperationBase {
  kind: "completed_transfer";
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  date: string;
  notes: string;
}

export interface ActualUtilityScheduleInput extends ActualFinancialOperationBase {
  kind: "utility_schedule";
  accountId: string;
  payee: string;
  payeeId?: string | null;
  categoryId?: string | null;
  amountCents: number;
  date: string;
  name: string;
  scheduleId?: string;
  expectedScheduleFingerprint?: string;
}

export interface ActualFinancialTransactionInput extends ActualFinancialOperationBase {
  kind: "transaction";
  accountId: string;
  payee: string;
  payeeId?: string | null;
  categoryId?: string | null;
  amountCents: number;
  date: string;
  notes: string;
}

export type ActualFinancialOperationInput = ActualCompletedTransferInput | ActualUtilityScheduleInput | ActualFinancialTransactionInput;
export type ActualFinancialOperationMode = "preview" | "write_once" | "recover";

export interface ActualFinancialOperationResult {
  outcome: "would_add" | "would_update" | "added" | "updated" | "already_present" | "needs_review";
  reason: string;
  budgetId: string;
  transactionId?: string;
  scheduleId?: string;
  scheduleFingerprint?: string;
}
