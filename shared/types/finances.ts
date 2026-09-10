import type { ActualBillOccurrence, ActualPayee, ActualSchedule } from './actual.ts';
import type { FinancialActivityReference } from './financial-activity.ts';

export interface JournalTransaction {
  id: string;
  date: string;
  amountCents: number;
  payee: string;
  payeeId: string | null;
  account: string;
  accountId: string;
  category: string;
  notes: string;
  scheduleId: string | null;
  transferId: string | null;
  /** Other account identified by the transfer payee, even without a paired transaction. */
  transferAccountId?: string | null;
  transferAccount?: string | null;
  parentId: string | null;
  isParent: boolean;
  isChild: boolean;
  cleared: boolean;
  reconciled: boolean;
}
export interface JournalRange {
  start: string;
  end: string;
  transactions: JournalTransaction[];
  relatives: JournalTransaction[];
  truncated: boolean;
}
export interface UtilityIdentity {
  id: string;
  label: string;
  provider: string;
  budgetId: string;
  payeeId: string;
  scheduleIds: string[];
  sourceSenders: string[];
  sourceIdentityText?: string;
}
export interface UtilityMappingSettings {
  budgetId: string | null;
  utilities: UtilityIdentity[];
  payees: ActualPayee[];
  schedules: ActualSchedule[];
  metadataAvailable: boolean;
}
export interface UtilityMappingUpdate {
  budgetId: string;
  payeeId: string;
  scheduleIds: string[];
}
export interface UtilityStatement {
  id: string;
  utilityId: string;
  emailUid: string;
  subject: string;
  receivedAt: string;
  statementDate: string | null;
  dueDate: string | null;
  amountCents: number | null;
  amountKind: string | null;
  originalStatement?: { amountCents: number | null; dueDate: string | null };
  nothingDue: boolean;
  creditCents: number | null;
  newChargesCents: number | null;
  carriedBalanceCents: number | null;
  providerReference: string | null;
  activity: FinancialActivityReference | null;
  paymentTransactionIds: string[];
  paymentRecorded?: boolean;
  paymentDate: string | null;
  recordedTotalCents: number | null;
  feeCents: number | null;
  issue: string | null;
}
export interface FinanceUtility {
  identity: UtilityIdentity;
  statements: UtilityStatement[];
  occurrences: ActualBillOccurrence[];
}
export interface FinanceWorkspace {
  budgetId: string | null;
  actualBudgetUrl?: string | null;
  /** Bounded Actual history independent of email statements; absent when unavailable. Preserve relatives and truncation when deriving payments. */
  recordedHistory?: JournalRange;
  utilities: FinanceUtility[];
  recurring: ActualBillOccurrence[];
  start: string;
  end: string;
  updatedAt: string | null;
  issues: string[];
  truncated: boolean;
}
