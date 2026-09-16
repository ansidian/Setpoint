import type { FinancialConnection, FinancialConnectionConfiguration } from '../../shared/types/financial-connections';
import { FINANCIAL_PROVIDER_CATALOG } from '../../shared/types/financial-parsers';
import type { DemoSeed } from './store';
import { connectionProfiles, connectionPayLinks } from '../../shared/financial-connection-projections';
import { demoNotFound } from './apiHandler';

/** Fictional unified setup; every saved change lives only in the rolling demo seed. */
export function demoFinancialConnections(): FinancialConnectionConfiguration {
  const connections: FinancialConnection[] = [
    { id: 'demo-profile-electric', name: 'Demo Electric bill', enabled: true, budgetId: 'demo-budget',
      providerId: 'sce', senderAddresses: ['billing@electric.example.test'],
      target: { kind: 'utility', scheduleId: 'demo-shared-schedule' },
      utility: { id: 'electricity', label: 'Electricity', provider: 'Fictional Electric', payeeId: 'demo-shared-schedule', sourceSenders: ['billing@electric.example.test'] } },
    { id: 'demo-profile-card', name: 'Everyday Card payment', enabled: true, budgetId: 'demo-budget',
      providerId: 'chase', senderAddresses: ['payments@everyday-card.example.test'], accountLast4: '2048',
      target: { kind: 'card_payment', fromAccountId: 'demo-savings', toAccountId: 'demo-credit', scheduleId: 'demo-card' } },
  ];
  for (const [id, label, provider, scheduleId] of [
    ['water', 'Water', 'Northstar Water', 'demo-water'], ['internet', 'Internet', 'Fiber Co-op', 'demo-internet'],
    ['gas', 'Gas', 'County Gas', 'demo-gas'], ['trash', 'Trash', 'Valley Collection', 'demo-trash'],
  ]) connections.push({ id: `demo-utility-${id}`, name: label!, budgetId: 'demo-budget', enabled: false, providerId: null,
    senderAddresses: [`billing@${id}.example.test`], target: { kind: 'schedule_link', scheduleId: scheduleId! },
    utility: { id: id!, label: label!, provider: provider!, payeeId: scheduleId!, sourceSenders: [`billing@${id}.example.test`] } });
  return { budgetId: 'demo-budget', revision: 1, migrated: true, connections };
}

export function demoFinancialSettings(configuration: FinancialConnectionConfiguration) {
  return {
    financial_profiles: connectionProfiles(configuration.connections),
    financial_profiles_revision: configuration.revision,
    utility_pay_links: connectionPayLinks(configuration.connections),
  };
}

export function handleDemoFinancialConnections(method: string, seed: DemoSeed, body: Record<string, unknown>) {
  const current = seed.financialConnections;
  if (method === 'GET') return { ...structuredClone(current), catalog: FINANCIAL_PROVIDER_CATALOG };
  if (method !== 'PUT') throw demoNotFound('Financial providers');
  if (body.budgetId !== current.budgetId || body.revision !== current.revision) {
    throw Object.assign(new Error('Financial providers changed. Reload saved providers before saving.'), { status: 409 });
  }
  if (!Array.isArray(body.connections) || body.connections.length > 100) throw new Error('Provide a list of financial providers.');
  const connections = structuredClone(body.connections) as FinancialConnection[];
  const ids = new Set<string>();
  for (const connection of connections) {
    if (!connection.id || ids.has(connection.id) || !connection.name?.trim() || connection.budgetId !== current.budgetId || !connection.target) throw new Error('Choose a name and the current budget for each provider.');
    ids.add(connection.id);
    if (connection.enabled && (!FINANCIAL_PROVIDER_CATALOG.some(provider => provider.id === connection.providerId) || connection.target.kind === 'schedule_link')) throw new Error('Choose a supported provider before enabling automatic processing.');
    if (connection.payLink) {
      const url = new URL(connection.payLink);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !('scheduleId' in connection.target) || !connection.target.scheduleId) throw new Error('Choose an exact schedule and a valid payment URL.');
    }
  }
  seed.financialConnections = { ...current, revision: current.revision + 1, connections };
  Object.assign(seed.settings, demoFinancialSettings(seed.financialConnections));
  return structuredClone(seed.financialConnections);
}
