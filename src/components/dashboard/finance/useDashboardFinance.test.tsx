import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDashboardFinance } from './useDashboardFinance';

// A settled change arriving during an older read must not leave stale spending
// until focus or the next timer. Exercise the HTTP boundary and returned data.
describe('dashboard finance settlement refresh', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
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
  it('publishes healthy spending and reviews before a stalled completed-history read settles', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch', (url: string) => {
      if (url.includes('view=completed')) return new Promise<Response>(resolve => { finish = resolve; });
      const payload = url.includes('/dashboard/finance')
        ? { spending: { current: { total: 42 } } }
        : { total: 7, items: [] };
      return Promise.resolve(new Response(JSON.stringify(payload)));
    });
    const { result, unmount } = renderHook(() => useDashboardFinance());
    try {
      await act(async () => {});
      expect(result.current.data?.spending.current.total).toBe(42);
      expect(result.current.review?.total).toBe(7);
      expect(result.current.completed).toBeNull();
      await act(async () => { finish(new Response(JSON.stringify({ total: 2, items: [] }))); });
      expect(result.current.completed?.total).toBe(2);
      expect(result.current.loading).toBe(false);
    } finally { unmount(); }
  });
  it('bounds stalled reads and recovers on polling without a manual dashboard refresh', async () => {
    vi.useFakeTimers();
    let stalled = true;
    vi.stubGlobal('fetch', (url: string, options?: RequestInit) => {
      if (stalled) return new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Read aborted', 'AbortError')), { once: true });
      });
      return Promise.resolve(new Response(JSON.stringify(url.includes('/dashboard/finance')
        ? { spending: { current: { total: 42 } } } : { total: 7, items: [] })));
    });
    const { result, unmount } = renderHook(() => useDashboardFinance());
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(true);
      expect(result.current.reviewError).toBe(true);
      expect(result.current.completedError).toBe(true);
      stalled = false;
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(result.current.data?.spending.current.total).toBe(42);
      expect(result.current.review?.total).toBe(7);
      expect(result.current.completed?.total).toBe(7);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(false);
      expect(result.current.reviewError).toBe(false);
      expect(result.current.completedError).toBe(false);
    } finally { unmount(); }
  });
});
