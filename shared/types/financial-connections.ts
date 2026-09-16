import type { FinancialProfile, FinancialProfileTarget } from './financial-profiles.ts';
import type { UtilityIdentity } from './finances.ts';
import type { FinancialProviderId } from './financial-parsers.ts';

/** One owner configuration for parsing authority, utility identity, and payment links. */
export interface FinancialConnection extends Omit<FinancialProfile, 'target' | 'providerId'> {
  providerId: FinancialProviderId | null;
  target: FinancialProfileTarget | { kind: 'schedule_link'; scheduleId: string };
  utility?: Omit<UtilityIdentity, 'budgetId' | 'scheduleIds'>;
  payLink?: string;
  /** Preserved inactive legacy entries require repair before automation can be enabled. */
  migrationWarning?: string;
}
export interface FinancialConnectionConfiguration {
  budgetId: string | null;
  revision: number;
  connections: FinancialConnection[];
  migrated: boolean;
}
export interface FinancialConnectionSave {
  budgetId: string;
  revision: number;
  connections: FinancialConnection[];
}
