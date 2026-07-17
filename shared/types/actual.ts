export type ActualScheduleType = "bill" | "income" | "transfer";

export interface ActualAmountRange {
  num1?: number;
  num2?: number;
}

export interface ActualRecurrenceValue extends ActualAmountRange {
  frequency?: string;
  interval?: number;
  start?: string;
  [key: string]: unknown;
}

export type ActualConditionValue = string | number | ActualRecurrenceValue | null;

export interface ActualScheduleCondition {
  op?: string;
  field?: string;
  value?: ActualConditionValue;
  [key: string]: unknown;
}

export interface ActualSchedule {
  id?: string;
  name?: string | null;
  rule?: string | null;
  next_date?: string | null;
  completed?: boolean;
  type?: ActualScheduleType;
  conditions?: ActualScheduleCondition[];
  [key: string]: unknown;
}

export interface ActualAccount {
  id: string;
  name: string;
  type?: string;
  closed?: boolean;
  [key: string]: unknown;
}

export interface ActualPayee {
  id: string;
  name: string;
  transfer_acct?: string | null;
  [key: string]: unknown;
}

export interface ActualCategory {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface ActualCategoryGroup {
  id?: string;
  name?: string;
  group_name?: string;
  categories: ActualCategory[];
  [key: string]: unknown;
}

export interface ActualRecentTransaction {
  id?: string;
  payee?: string;
  payeeId?: string | null;
  amount?: number;
  date: string;
  scheduleId?: string | null;
  [key: string]: unknown;
}

export interface ActualBillOccurrence {
  id: string;
  scheduleId: string;
  name: string;
  payee: string;
  amount: number;
  next_date: string;
  paid: boolean;
  type: ActualScheduleType;
  openActionDisabled: boolean;
}

export interface ActualMetadata {
  accounts: ActualAccount[];
  payees: ActualPayee[];
  payeeMap: Record<string, string>;
  categories: ActualCategoryGroup[];
  schedules: ActualSchedule[];
  recentTransactions: ActualRecentTransaction[];
  actualBudgetUrl?: string | null;
}

export interface ActualDateRange {
  start: string;
  end: string;
  recentTransactions?: ActualRecentTransaction[];
}

export interface ActualConfig {
  serverURL: string;
  password?: string | null;
  syncId: string;
  dataDir?: string;
  localBudgetId?: string | null;
}
