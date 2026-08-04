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

function searchArgs(scope: "events" | "bills", q: string) {
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
      view: "events",
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
      view: "events",
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

  it("aborts superseded requests in the active search scope", async () => {
    const searchApi = vi.fn<CalendarSearchApi>(() => new Promise(() => {}));
    const { result, rerender } = renderHook(
      ({ view }) => useCalendarModalSearch({
        modalOpen: true,
        view,
        searchApi,
        debounceMs: 0,
      }),
      { initialProps: { view: "events" } },
    );

    act(() => {
      result.current.openSearch();
      result.current.setQuery("first event");
    });
    // test-architecture: allow-boundary-interaction -- Calendar search HTTP is outbound; the first active-scope request must exist before its abort signal can be inspected.
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(1));
    const firstEventSignal = searchApi.mock.calls[0]![0].signal!;

    rerender({ view: "bills" });
    act(() => result.current.setQuery("rent"));
    // test-architecture: allow-boundary-interaction -- Calendar search HTTP is outbound; switching scopes must start the bills request before inspecting cross-scope cancellation.
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(2));
    const billSignal = searchApi.mock.calls[1]![0].signal!;

    rerender({ view: "events" });
    act(() => result.current.setQuery("final event"));
    // test-architecture: allow-boundary-interaction -- Calendar search HTTP is outbound; restoring events must start one replacement request before inspecting all three signals.
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(3));
    const secondEventSignal = searchApi.mock.calls[2]![0].signal!;

    expect(firstEventSignal.aborted).toBe(true);
    expect(billSignal.aborted).toBe(true);
    expect(secondEventSignal.aborted).toBe(false);
  });

  it("aborts the active request when search closes", async () => {
    const searchApi = vi.fn<CalendarSearchApi>(() => new Promise(() => {}));
    const { result } = renderHook(() => useCalendarModalSearch({
      modalOpen: true,
      view: "events",
      searchApi,
      debounceMs: 0,
    }));

    act(() => {
      result.current.openSearch();
      result.current.setQuery("final");
    });
    // test-architecture: allow-boundary-interaction -- Calendar search HTTP is outbound; close-search cancellation is observable only after the active request exposes its signal.
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(1));
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
      view: "events",
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
      view: "events",
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
      view: "events",
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
      view: "events",
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

  it("keeps scope-local query snapshots and refetches a restored scope without blanking cached results", async () => {
    const eventsFirst = deferred();
    const billsFirst = deferred();
    const eventsRefresh = deferred();
    const searchApi = vi.fn()
      .mockReturnValueOnce(eventsFirst.promise)
      .mockReturnValueOnce(billsFirst.promise)
      .mockReturnValueOnce(eventsRefresh.promise);

    const { result, rerender } = renderHook(
      ({ view }) => useCalendarModalSearch({
        modalOpen: true,
        view,
        searchApi,
        debounceMs: 0,
      }),
      { initialProps: { view: "events" } },
    );

    act(() => {
      result.current.openSearch();
      result.current.setQuery("final");
    });

    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(async () => {
      eventsFirst.resolve({
        results: [{ id: "event:final", itemId: "event-final", title: "Final" }],
        coverage: { sources: [{ key: "google_calendar" }] },
      });
      await eventsFirst.promise;
      await flushPromises();
    });
    expect(result.current.scope).toBe("events");
    expect(result.current.query).toBe("final");
    expect(result.current.results.map((item) => item.itemId)).toEqual(["event-final"]);

    rerender({ view: "bills" });
    await waitFor(() => {
      expect(result.current.scope).toBe("bills");
      expect(result.current.query).toBe("");
      expect(result.current.results).toEqual([]);
    });

    act(() => {
      result.current.setQuery("rent");
    });
    // test-architecture: allow-boundary-interaction -- Calendar search HTTP is outbound; the bills scope must send its own restored query snapshot and cancellation signal.
    await waitFor(() => expect(searchApi).toHaveBeenLastCalledWith(searchArgs("bills", "rent")));
    await act(async () => {
      billsFirst.resolve({
        results: [{ id: "bill:rent", itemId: "bill-rent", title: "Rent" }],
        coverage: { sources: [{ key: "bills_mirror" }] },
      });
      await billsFirst.promise;
      await flushPromises();
    });

    rerender({ view: "events" });

    await waitFor(() => {
      expect(result.current.scope).toBe("events");
      expect(result.current.query).toBe("final");
      expect(result.current.results.map((item) => item.itemId)).toEqual(["event-final"]);
      expect(result.current.pending).toBe(true);
    });
    // test-architecture: allow-boundary-interaction -- Calendar search HTTP is outbound; restoring events must refetch the cached query without blanking its prior results.
    expect(searchApi).toHaveBeenLastCalledWith(searchArgs("events", "final"));

    await act(async () => {
      eventsRefresh.resolve({
        results: [{ id: "event:final-2", itemId: "event-final-2", title: "Final review" }],
        coverage: { sources: [{ key: "deadlines" }] },
      });
      await eventsRefresh.promise;
      await flushPromises();
    });

    expect(result.current.results.map((item) => item.itemId)).toEqual(["event-final-2"]);
  });

  it("preserves highlight and scroll per scope while clearing active-scope snapshots explicitly", async () => {
    const searchApi = vi.fn().mockResolvedValue({ results: [] });
    const { result, rerender } = renderHook(
      ({ view }) => useCalendarModalSearch({
        modalOpen: true,
        view,
        searchApi,
        debounceMs: 0,
      }),
      { initialProps: { view: "events" } },
    );

    act(() => {
      result.current.openSearch();
      result.current.setQuery("final");
      result.current.setImmediateResults([
        { id: "event:1", itemId: "event-1" },
        { id: "event:2", itemId: "event-2" },
      ]);
      result.current.setHighlightedIndex(1);
      result.current.setScrollTop(144);
    });

    rerender({ view: "bills" });
    act(() => {
      result.current.setQuery("rent");
      result.current.setImmediateResults([{ id: "bill:1", itemId: "bill-1" }]);
      result.current.setScrollTop(24);
    });

    rerender({ view: "events" });
    expect(result.current.query).toBe("final");
    expect(result.current.highlightedIndex).toBe(1);
    expect(result.current.scrollTop).toBe(144);

    act(() => {
      result.current.clearQuery();
    });

    expect(result.current.query).toBe("");
    expect(result.current.results).toEqual([]);
    expect(result.current.highlightedIndex).toBe(-1);
    expect(result.current.scrollTop).toBe(0);

    rerender({ view: "bills" });
    expect(result.current.query).toBe("rent");
    expect(result.current.results.map((item) => item.itemId)).toEqual(["bill-1"]);
    expect(result.current.scrollTop).toBe(24);
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
      ({ view }) => useCalendarModalSearch({
        modalOpen: true,
        view,
        searchApi,
        debounceMs: 0,
      }),
      { initialProps: { view: "events" } },
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
    rerender({ view: "bills" });
    rerender({ view: "events" });
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

    rerender({ view: "bills" });
    rerender({ view: "events" });
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
