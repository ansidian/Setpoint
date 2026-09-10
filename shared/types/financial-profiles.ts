/** Stable owner context. Amounts and operation dates always come from the source. */
export type FinancialProfileTarget =
  | { kind: "utility"; scheduleId: string }
  | { kind: "card_payment"; fromAccountId: string; toAccountId: string; scheduleId?: string }
  | { kind: "expense" | "income"; accountId: string; payeeId: string; categoryId?: string | null };

export interface FinancialProfile {
  id: string;
  name: string;
  enabled: boolean;
  budgetId: string;
  senderAddresses: string[];
  /** Exact extracted merchant identity, useful for shared payment senders. */
  merchantName?: string;
  /** Source-grounded card suffix, useful when one issuer emails about several cards. */
  accountLast4?: string;
  target: FinancialProfileTarget;
}

/** Reviewable inference only; the owner assigns identity and enablement on save. */
export type FinancialProfileDraft = Omit<FinancialProfile, "id" | "enabled">;

export interface FinancialProfileConfiguration {
  budgetId: string | null;
  revision: number;
  profiles: FinancialProfile[];
}

export interface FinancialProfileResolution {
  status: "matched" | "missing" | "ambiguous" | "invalid";
  revision: number;
  budgetId: string | null;
  profileId?: string;
  profileName?: string;
  /** Saved operation authority, independent of inferred candidate type. */
  targetKind?: FinancialProfileTarget["kind"];
  /** Permanent schedule-cycle identity, independent of editable profile IDs. */
  cycleKey?: string;
  reason: string;
}
