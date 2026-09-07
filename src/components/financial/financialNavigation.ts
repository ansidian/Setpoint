import type { FinancialActivityQuery, FinancialActivityReference } from '../../../shared/types/financial-activity';

export function financialHref(query: FinancialActivityQuery = {}, reference?: FinancialActivityReference, list = !reference): string {
  const params = new URLSearchParams({ financial: list ? 'list' : 'record', view: query.view || 'needs_attention' });
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  if (reference) {
    params.set('owner', reference.owner); params.set('record', reference.id);
    if (reference.owner === 'import') params.set('recordRun', reference.runId);
  }
  return `/finance?${params}`;
}

/** Bare Finance links open the activity list, with the same defaults as generated links. */
export function financialSearch(search: string): string {
  const params = new URLSearchParams(search);
  if (!params.has('financial')) params.set('financial', 'list');
  if (!params.has('view')) params.set('view', 'needs_attention');
  return `?${params}`;
}

/** Old saved links retain their exact record, source, batch, and email targets. */
export function legacyFinancialHref(location: { pathname: string; search: string; hash: string }): string | null {
  if (location.pathname !== '/settings') return null;
  const params = new URLSearchParams(location.search);
  const legacyRun = params.get('importRun');
  const pending = params.get('reviewPending') === '1';
  const managed = location.hash === '#financial-event-review';
  const imports = location.hash === '#transaction-import-review';
  const backfill = location.hash === '#email-transaction-imports';
  if (!params.has('financial') && !params.has('financialEmail') && !legacyRun && !pending && !managed && !imports && !backfill) return null;
  if (!params.has('financial')) params.set('financial', backfill && !legacyRun && !pending ? 'backfill' : 'list');
  if (legacyRun) params.set('runId', legacyRun);
  if (managed && !params.has('source')) params.set('source', 'managed');
  if (pending) params.set('view', 'needs_attention');
  params.delete('tab'); params.delete('importRun'); params.delete('reviewPending');
  return `/finance${financialSearch(params.toString())}`;
}
export function financialReference(params: URLSearchParams): FinancialActivityReference | undefined {
  const owner = params.get('owner'); const id = params.get('record');
  if (!id) return;
  if (owner === 'event' || owner === 'document') return { owner, id };
  if (owner === 'import' && (params.get('recordRun') || params.get('runId'))) return { owner, id, runId: (params.get('recordRun') || params.get('runId'))! };
}
