import type { PaymentItem, PaymentOrganization } from './payment-groups.ts';
import type { ActualBillOccurrence } from './actual.ts';

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
export interface FinanceWorkspace {
  budgetId: string | null;
  actualBudgetUrl?: string | null;
  /** Bounded Actual history; absent when unavailable. Preserve relatives and truncation when deriving payments. */
  recordedHistory?: JournalRange;
  recurring: ActualBillOccurrence[];
  paymentItems?: PaymentItem[];
  paymentOrganization?: PaymentOrganization;
  start: string;
  end: string;
  updatedAt: string | null;
  issues: string[];
  truncated: boolean;
}
