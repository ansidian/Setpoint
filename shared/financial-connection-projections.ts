import type { FinancialConnection } from './types/financial-connections.ts';
import type { FinancialProfile } from './types/financial-profiles.ts';
import type { UtilityIdentity } from './types/finances.ts';
import type { UtilityPayLink } from './types/settings.ts';
import { FINANCIAL_PROVIDER_CATALOG } from './types/financial-parsers.ts';

export function connectionProfiles(connections: FinancialConnection[]): FinancialProfile[] {
  return connections.flatMap(connection => {
    if (connection.target.kind === 'schedule_link') return [];
    const {providerId,utility: _utility,payLink: _payLink,migrationWarning: _warning,...profile} = connection;
    const provider = FINANCIAL_PROVIDER_CATALOG.find(entry=>entry.id===providerId);
    return [{...profile,...(provider ? {providerId:provider.id} : {}),target:connection.target,enabled:profile.enabled && !!provider,
      senderAddresses:profile.senderAddresses}];
  });
}
export function connectionUtilities(connections: FinancialConnection[]): UtilityIdentity[] {
  return connections.flatMap(connection => connection.utility && 'scheduleId' in connection.target && connection.target.scheduleId
    ? [{...connection.utility,budgetId:connection.budgetId,scheduleIds:[connection.target.scheduleId]}] : []);
}
export function connectionPayLinks(connections: FinancialConnection[]): UtilityPayLink[] {
  return connections.flatMap(connection=>connection.payLink && 'scheduleId' in connection.target && connection.target.scheduleId
    ? [{scheduleId:connection.target.scheduleId,label:connection.utility?.label || connection.name,url:connection.payLink}] : []);
}
