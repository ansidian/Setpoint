import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useCalendarModalSearch, {
  type CalendarSearchApi,
  type CalendarSearchPayload,
} from "./useCalendarModalSearch";

const apiMocks = vi.hoisted(() => ({
  getCalendarSearch: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- Calendar search HTTP is the outbound provider-backed API; the hook suite controls latency/errors while observing returned search state and race handling.
vi.mock("../../api", () => ({
  getCalendarSearch: apiMocks.getCalendarSearch,
}));

function deferred<T = CalendarSearchPayload>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function searchArgs(scope: "events", q: string) {
  return { scope, q, limit: 50, signal: expect.any(AbortSignal) };
}

describe("useCalendarModalSearch", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("keeps the default search API stable across pending-state renders", async () => {
    apiMocks.getCalendarSearch.mockResolvedValue({ results: [] });
    const { result } = renderHook(() => useCalendarModalSearch({
      modalOpen: true,
      debounceMs: 0,
    }));

    act(() => {
      result.current.openSearch();
      result.current.setQuery("final");
    });

    // test-architecture: allow-boundary-interaction -- Calendar search HTTP is outbound; pending-state rerenders must settle after admitting exactly one debounced request.
    await waitFor(() => expect(apiMocks.getCalendarSearch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pending).toBe(false));
    await flushPromises();
  });


  it("debounces typeahead, clears changed-query results, and ignores stale responses", async () => {
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const searchApi = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);

    const { result } = renderHook(() => useCalendarModalSearch({
      modalOpen: true,
      searchApi,
      debounceMs: 0,
    }));

    act(() => {
      result.current.openSearch();
      result.current.setQuery("fi");
    });

    // test-architecture: allow-boundary-interaction -- Calendar search HTTP is outbound; the first debounced request must carry the active scope, query, limit, and cancellation signal.
    await waitFor(() => expect(searchApi).toHaveBeenCalledWith(searchArgs("events", "fi")));
    await act(async () => {
      first.resolve({
        results: [{ id: "event:first", itemId: "first", title: "First" }],
        coverage: { sources: [{ key: "google_calendar" }] },
        truncated: false,
      });
      await first.promise;
      await flushPromises();
    });
    expect(result.current.results.map((item) => item.itemId)).toEqual(["first"]);

    act(() => {
      result.current.setQuery("fin");
    });

    // test-architecture: allow-boundary-interaction -- Calendar search HTTP is outbound; changing the query must issue the replacement payload for the same scope.
    await waitFor(() => expect(searchApi).toHaveBeenLastCalledWith(searchArgs("events", "fin")));
    expect(result.current.pending).toBe(true);
    expect(result.current.results).toEqual([]);

    act(() => {
      result.current.setQuery("final");
    });

    // test-architecture: allow-boundary-interaction -- Calendar search HTTP is outbound; the final query must replace the superseded request with its exact payload.
    await waitFor(() => expect(searchApi).toHaveBeenLastCalledWith(searchArgs("events", "final")));

    await act(async () => {
      third.resolve({
        results: [{ id: "event:third", itemId: "third", title: "Third" }],
        coverage: { sources: [{ key: "deadlines" }] },
        truncated: true,
      });
      await third.promise;
      second.resolve({
        results: [{ id: "event:stale", itemId: "stale", title: "Stale" }],
        coverage: { sources: [] },
        truncated: false,
      });
      await second.promise;
      await flushPromises();
    });

    await waitFor(() => {
      expect(result.current.pending).toBe(false);
      expect(result.current.results.map((item) => item.itemId)).toEqual(["third"]);
      expect(result.current.coverage!.sources!.map((source) => source.key)).toEqual(["deadlines"]);
      expect(result.current.truncated).toBe(true);
    });
  });

  it("aborts superseded search requests", async () => {
    const searchApi = vi.fn<CalendarSearchApi>(() => new Promise(() => {}));
    const { result } = renderHook(() => useCalendarModalSearch({
      modalOpen: true,
      searchApi,
      debounceMs: 0,
    }));

    act(() => {
      result.current.openSearch();
      result.current.setQuery("first event");
    });
    // test-architecture: allow-boundary-interaction -- Calendar search HTTP is outbound; the first request must exist before its abort signal can be inspected.
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(1));
    // test-architecture: allow-boundary-interaction -- Calendar search crosses the browser HTTP boundary; cancellation is observable only through the active request's AbortSignal.
    const firstSignal = searchApi.mock.calls[0]![0].signal!;

    act(() => result.current.setQuery("final event"));
    // test-architecture: allow-boundary-interaction -- Calendar search HTTP is outbound; the replacement request must start before inspecting both signals.
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(2));
    // test-architecture: allow-boundary-interaction -- Calendar search crosses the browser HTTP boundary; cancellation is observable only through the active request's AbortSignal.
    const secondSignal = searchApi.mock.calls[1]![0].signal!;

    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
  });

  it("rechecks an unchanged query after calendar invalidation and rejects the superseded result", async () => {
    const oldRead = deferred();
    const freshRead = deferred();
    const saved = [{ id: "event:saved", title: "Saved event" }];
    const searchApi = vi.fn<CalendarSearchApi>()
      .mockResolvedValueOnce({ results: saved })
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(freshRead.promise);
    const { result, rerender } = renderHook(({ revision }) => useCalendarModalSearch({
      modalOpen: true, eventsRevision: revision, searchApi, debounceMs: 0,
    }), { initialProps: { revision: 0 } });
    act(() => { result.current.openSearch(); result.current.setQuery("event"); });
    await waitFor(() => expect(result.current.results).toEqual(saved));
    rerender({ revision: 1 });
    await waitFor(() => expect(result.current.pending).toBe(true));
    rerender({ revision: 2 });
    expect(result.current.results).toEqual(saved);
    await act(async () => { oldRead.resolve({ results: [{ id: "event:stale", title: "Stale result" }] }); await flushPromises(); });
    expect(result.current.results).toEqual(saved);
    await act(async () => { freshRead.resolve({ results: [{ id: "event:updated", title: "External edit" }] }); await flushPromises(); });
    await waitFor(() => expect(result.current.results).toEqual([{ id: "event:updated", title: "External edit" }]));
    expect(result.current.query).toBe("event");
    expect(result.current.pending).toBe(false);
  });

  it("aborts the active request when search closes", async () => {
    const searchApi = vi.fn<CalendarSearchApi>(() => new Promise(() => {}));
    const { result } = renderHook(() => useCalendarModalSearch({
      modalOpen: true,
      searchApi,
      debounceMs: 0,
    }));

    act(() => {
      result.current.openSearch();
      result.current.setQuery("final");
    });
    // test-architecture: allow-boundary-interaction -- Calendar search HTTP is outbound; close-search cancellation is observable only after the active request exposes its signal.
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(1));
    // test-architecture: allow-boundary-interaction -- Calendar search crosses the browser HTTP boundary; cancellation is observable only through the active request's AbortSignal.
    const signal = searchApi.mock.calls[0]![0].signal!;

    act(() => result.current.closeSearch());

    expect(signal.aborted).toBe(true);
  });

  it("does not surface an AbortError as calendar search failure state", async () => {
    const searchApi = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const { result } = renderHook(() => useCalendarModalSearch({
      modalOpen: true,
      searchApi,
      debounceMs: 0,
    }));

    act(() => {
      result.current.openSearch();
      result.current.setQuery("final");
    });

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it("handles keyboard highlight, enter activation advance, and escape clear-close", () => {
    let activatedResult: { id: string; itemId: string } | null = null;
    const { result } = renderHook(() => useCalendarModalSearch({
      modalOpen: true,
      searchApi: vi.fn(),
      onActivateResult: (item) => { activatedResult = item as typeof activatedResult; },
    }));

    act(() => {
      result.current.openSearch();
      result.current.setQuery("fi");
    });

    act(() => {
      result.current.setImmediateResults([
        { id: "result-1", itemId: "one" },
        { id: "result-2", itemId: "two" },
      ]);
    });

    act(() => result.current.handleInputKeyDown({ key: "ArrowDown", preventDefault: vi.fn(), stopPropagation: vi.fn() }));
    expect(result.current.highlightedIndex).toBe(1);

    act(() => result.current.handleInputKeyDown({ key: "Enter", preventDefault: vi.fn(), stopPropagation: vi.fn() }));
    expect(activatedResult).toEqual({ id: "result-2", itemId: "two" });
    expect(result.current.open).toBe(true);
    expect(result.current.highlightedIndex).toBe(0);

    act(() => result.current.handleInputKeyDown({ key: "Enter", shiftKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() }));
    expect(activatedResult).toEqual({ id: "result-1", itemId: "one" });
    expect(result.current.highlightedIndex).toBe(1);

    act(() => result.current.handleInputKeyDown({ key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() }));
    expect(result.current.query).toBe("");
    expect(result.current.open).toBe(true);

    act(() => result.current.handleInputKeyDown({ key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() }));
    expect(result.current.open).toBe(false);
  });

  it("highlights the closest upcoming result when search results arrive", async () => {
    const response = deferred();
    const searchApi = vi.fn().mockReturnValueOnce(response.promise);
    const { result } = renderHook(() => useCalendarModalSearch({
      modalOpen: true,
      searchApi,
      debounceMs: 0,
    }));

    act(() => {
      result.current.openSearch();
      result.current.setQuery("work");
    });

    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(async () => {
      response.resolve({
        results: [
          { id: "event:old", itemId: "old", itemDate: "2021-06-20" },
          { id: "event:future", itemId: "future", itemDate: "2099-01-03" },
          { id: "event:first-future", itemId: "first-future", itemDate: "2099-01-01" },
        ],
      });
      await response.promise;
      await flushPromises();
    });

    expect(result.current.highlightedIndex).toBe(2);
  });

  it("treats Cmd/Ctrl+F open requests as select-all focus requests", () => {
    const { result } = renderHook(() => useCalendarModalSearch({
      modalOpen: true,
      searchApi: vi.fn(),
    }));

    act(() => {
      result.current.openSearch();
    });

    expect(result.current.open).toBe(true);
    expect(result.current.focusSelectAll).toBe(true);

    act(() => {
      result.current.openSearch({ selectAll: false });
    });

    expect(result.current.focusSelectAll).toBe(false);
  });

  it("preserves highlighted result by id and keeps prior results when a refetch fails", async () => {
    const first = deferred();
    const refresh = deferred();
    const failed = deferred();
    const searchApi = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(refresh.promise)
      .mockReturnValueOnce(failed.promise);

    const { result, rerender } = renderHook(
      ({ revision }) => useCalendarModalSearch({
        modalOpen: true,
        eventsRevision: revision,
        searchApi,
        debounceMs: 0,
      }),
      { initialProps: { revision: 0 } },
    );

    act(() => {
      result.current.openSearch();
      result.current.setQuery("final");
    });

    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(async () => {
      first.resolve({
        results: [
          { id: "event:1", itemId: "one" },
          { id: "event:2", itemId: "two" },
        ],
      });
      await first.promise;
      await flushPromises();
    });

    act(() => result.current.setHighlightedIndex(1));
    rerender({ revision: 1 });
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(async () => {
      refresh.resolve({
        results: [
          { id: "event:0", itemId: "zero" },
          { id: "event:2", itemId: "two" },
        ],
      });
      await refresh.promise;
      await flushPromises();
    });

    expect(result.current.highlightedIndex).toBe(1);

    rerender({ revision: 2 });
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(async () => {
      failed.reject(new Error("offline"));
      await failed.promise.catch(() => {});
      await flushPromises();
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.results.map((item) => item.itemId)).toEqual(["zero", "two"]);
  });
});
