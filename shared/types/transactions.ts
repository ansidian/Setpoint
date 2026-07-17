export type TransactionDirection = "expense" | "income" | "all";
export type TransactionGroupBy = "category" | "payee" | "month";

export interface TransactionFilters {
  start: string;
  end: string;
  payee?: string;
  category?: string;
  account?: string;
  notes?: string;
  direction?: TransactionDirection;
  limit?: number;
  minAmount?: number;
  maxAmount?: number;
  min_amount?: number;
  max_amount?: number;
}

export interface TransactionRecord {
  id: string;
  date: string;
  amount: number;
  direction: Exclude<TransactionDirection, "all">;
  payee: string;
  category: string;
  account: string;
  notes: string;
}

export interface TransactionReadResult {
  transactions?: TransactionRecord[];
  truncated?: boolean;
  unknownFilter?: string;
}

export interface TransactionQueryResult {
  error?: string;
  total?: number;
  truncated?: boolean;
  transactions?: TransactionRecord[];
  unknown_filter?: string;
  sync_state?: string;
}

export interface TransactionSummaryBucket {
  label: string;
  amount: number;
  count: number;
}

export interface TransactionSummaryResult {
  error?: string;
  total?: number;
  period?: { start: string; end: string };
  group_by?: TransactionGroupBy;
  buckets?: TransactionSummaryBucket[];
  unknown_filter?: string;
  sync_state?: string;
}
