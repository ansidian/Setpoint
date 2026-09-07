import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDashboardFinance } from './useDashboardFinance';

// A settled change arriving during an older read must not leave stale spending
// until focus or the next timer. Exercise the HTTP boundary and returned data.
describe('dashboard finance settlement refresh', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('retains a financial invalidation arriving during an in-flight read', async () => {
    let finish!: (value: Response) => void;
    let first = true;
    vi.stubGlobal('fetch', () => {
      if (first) { first = false; return new Promise<Response>(resolve => { finish = resolve; }); }
      return Promise.resolve(new Response(JSON.stringify({ fetchedAt: 'settled', spending: { current: { total: 42 } } })));
    });
    const { result, unmount } = renderHook(() => useDashboardFinance());
    await act(async () => { window.dispatchEvent(new Event('ea-actual-metadata-invalidated')); });
    await act(async () => { finish(new Response(JSON.stringify({ fetchedAt: 'old', spending: { current: { total: 100 } } }))); });
    expect(result.current.data?.spending.current.total).toBe(42);
    expect(result.current.loading).toBe(false);
    unmount();
  });
  it('refreshes activity on settlement and keeps its last result through a failed refresh', async () => {
    let payload = { fetchedAt: 'before', activity: { reviewCount: 1 } };
    let fail = false;
    vi.stubGlobal('fetch', () => fail ? Promise.reject(new Error('offline')) : Promise.resolve(new Response(JSON.stringify(payload))));
    const { result, unmount } = renderHook(() => useDashboardFinance());
    await act(async () => {});
    payload = { fetchedAt: 'after', activity: { reviewCount: 0 } };
    await act(async () => { window.dispatchEvent(new Event('ea-financial-event-changed')); });
    expect(result.current.data?.fetchedAt).toBe('after');
    fail = true;
    await act(async () => { window.dispatchEvent(new Event('ea-actual-metadata-invalidated')); });
    expect(result.current.data?.fetchedAt).toBe('after');
    expect(result.current.error).toBe(true);
    unmount();
  });
});
