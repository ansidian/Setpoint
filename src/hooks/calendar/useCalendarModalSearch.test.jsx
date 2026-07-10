import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useCalendarModalSearch from "./useCalendarModalSearch.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function searchArgs(scope, q) {
  return { scope, q, limit: 50, signal: expect.any(AbortSignal) };
}

describe("useCalendarModalSearch", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
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

    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(1));
    expect(searchApi).toHaveBeenCalledWith(searchArgs("events", "fi"));
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

    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(2));
    expect(result.current.pending).toBe(true);
    expect(result.current.results).toEqual([]);
    expect(searchApi).toHaveBeenLastCalledWith(searchArgs("events", "fin"));

    act(() => {
      result.current.setQuery("final");
    });

    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(3));
    expect(searchApi).toHaveBeenLastCalledWith(searchArgs("events", "final"));

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
      expect(result.current.coverage.sources.map((source) => source.key)).toEqual(["deadlines"]);
      expect(result.current.truncated).toBe(true);
    });
  });

  it("aborts superseded requests in the active search scope", async () => {
    const searchApi = vi.fn(() => new Promise(() => {}));
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
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(1));
    const firstEventSignal = searchApi.mock.calls[0][0].signal;

    rerender({ view: "bills" });
    act(() => result.current.setQuery("rent"));
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(2));
    const billSignal = searchApi.mock.calls[1][0].signal;

    rerender({ view: "events" });
    act(() => result.current.setQuery("final event"));
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(3));
    const secondEventSignal = searchApi.mock.calls[2][0].signal;

    expect(firstEventSignal.aborted).toBe(true);
    expect(billSignal.aborted).toBe(true);
    expect(secondEventSignal.aborted).toBe(false);
  });

  it("aborts the active request when search closes", async () => {
    const searchApi = vi.fn(() => new Promise(() => {}));
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
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(1));
    const signal = searchApi.mock.calls[0][0].signal;

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

    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it("handles keyboard highlight, enter activation advance, and escape clear-close", () => {
    const onActivateResult = vi.fn();
    const { result } = renderHook(() => useCalendarModalSearch({
      modalOpen: true,
      view: "events",
      searchApi: vi.fn(),
      onActivateResult,
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
    expect(onActivateResult).toHaveBeenCalledWith({ id: "result-2", itemId: "two" });
    expect(result.current.open).toBe(true);
    expect(result.current.highlightedIndex).toBe(0);

    act(() => result.current.handleInputKeyDown({ key: "Enter", shiftKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() }));
    expect(onActivateResult).toHaveBeenLastCalledWith({ id: "result-1", itemId: "one" });
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

    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(1));

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

    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(1));
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
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(2));
    expect(searchApi).toHaveBeenLastCalledWith(searchArgs("bills", "rent"));
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
    expect(searchApi).toHaveBeenCalledTimes(3);
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

    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(1));
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
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(2));

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
    await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(3));

    await act(async () => {
      failed.reject(new Error("offline"));
      await failed.promise.catch(() => {});
      await flushPromises();
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.results.map((item) => item.itemId)).toEqual(["zero", "two"]);
  });
});
