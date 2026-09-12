/** Stable display identity; assigning a group never changes Actual or automation targets. */
export interface PaymentItem {
  id: string;
  name: string;
  provider: string;
  kind: 'utility' | 'credit_card' | 'recurring';
  utilityId?: string;
  scheduleId?: string;
}

export interface PaymentGroup {
  id: string;
  name: string;
  /** Ordered stable utility:<id> / schedule:<id> identities, independent of monthly occurrences. */
  itemIds: string[];
}

export interface PaymentOrganization {
  budgetId: string;
  /** Optimistic concurrency version. Zero denotes an unsaved starter layout. */
  revision: number;
  groups: PaymentGroup[];
}
