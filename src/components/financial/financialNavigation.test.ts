import { describe, expect, it } from 'vitest';
import { financialHref, financialReference, financialSearch, legacyFinancialHref } from './financialNavigation';

const legacy = (href: string) => legacyFinancialHref(new URL(href, 'http://localhost'));

describe('financial entry routing', () => {
  it('keeps a selected import distinct from the filtered batch in the dedicated home', () => {
    const href = financialHref({ view:'completed', runId:'batch/one', offset:20 }, { owner:'import', id:'item two', runId:'batch/other' }, true);
    const url = new URL(href, 'http://localhost');
    expect(url.pathname).toBe('/finance');
    expect(url.searchParams.get('runId')).toBe('batch/one');
    expect(url.searchParams.get('offset')).toBe('20');
    expect(url.searchParams.get('financial')).toBe('list');
    expect(financialReference(url.searchParams)).toEqual({ owner:'import', id:'item two', runId:'batch/other' });
  });

  it('defaults bare Finance to the activity list without overriding explicit record or backfill views', () => {
    expect(financialSearch('')).toBe('?financial=list&view=needs_attention');
    expect(financialSearch('?financial=record&view=completed')).toBe('?financial=record&view=completed');
    expect(financialSearch('?financial=backfill')).toBe('?financial=backfill&view=needs_attention');
  });

  it('preserves exact record identity and list state from saved Settings links', () => {
    const source = '/settings?financial=record&view=completed&source=amazon&runId=batch-1&owner=import&record=item-2&recordRun=batch-2&offset=20&showList=1';
    expect(legacy(source)).toBe(source.replace('/settings', '/finance'));
  });

  it('normalizes historical review, selected batches, and the backfill entrance', () => {
    const pending = new URL(legacy('/settings?tab=finance&reviewPending=1&importRun=batch%2F1#email-transaction-imports')!, 'http://localhost');
    expect(Object.fromEntries(pending.searchParams)).toEqual({ financial:'list', runId:'batch/1', view:'needs_attention' });
    // Legacy import runs also include arrival-triggered imports; never infer a scan-only filter.
    expect(pending.searchParams.has('context')).toBe(false);
    expect(legacy('/settings?tab=finance#email-transaction-imports')).toBe('/finance?financial=backfill&view=needs_attention');
    expect(legacy('/settings?tab=finance#transaction-import-review')).toBe('/finance?financial=list&view=needs_attention');
  });

  it('retains notification email resolution and leaves connection repair and preferences in Settings', () => {
    const url = new URL(legacy('/settings?tab=finance&financialEmail=gmail-1%2Fmessage%201#financial-event-review')!, 'http://localhost');
    expect(url.pathname).toBe('/finance');
    expect(url.searchParams.get('financialEmail')).toBe('gmail-1/message 1');
    expect(url.searchParams.get('source')).toBe('managed');
    expect(url.searchParams.has('tab')).toBe(false);
    expect(legacy('/settings?tab=connections#actual-budget')).toBeNull();
    expect(legacy('/settings?tab=finance')).toBeNull();
    expect(legacy('/finance?financial=list')).toBeNull();
  });
});
