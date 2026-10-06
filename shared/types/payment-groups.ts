/** Stable display identity for one Actual schedule; assigning a group never changes Actual. */
export interface PaymentItem {
  id: string;
  name: string;
  provider: string;
  scheduleId: string;
}

export interface PaymentGroup {
  id: string;
  name: string;
  /** Ordered stable schedule:<id> identities, independent of monthly occurrences. */
  itemIds: string[];
}

export interface PaymentOrganization {
  budgetId: string;
  /** Optimistic concurrency version. Zero denotes an unsaved starter layout. */
  revision: number;
  groups: PaymentGroup[];
}
