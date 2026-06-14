import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../api", () => ({
  getCalendarRange: vi.fn(),
}));

const { getCalendarRange } = await import("../../api");
const { default: useCalendarRange } = await import("./useCalendarRange");

describe("useCalendarRange", () => {
  beforeEach(() => {
    getCalendarRange.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns empty array when disabled", async () => {
    const { result } = renderHook(() => useCalendarRange({ disabled: true }));
    await act(async () => {
      const events = await result.current.ensureRange("2026-04-18", "2026-04-25");
      expect(events).toEqual([]);
    });
    expect(getCalendarRange).not.toHaveBeenCalled();
  });

  it("resolves visible month readiness before adjacent-month prefetch completes", async () => {
    let resolveVisible;
    const visibleEvent = {
      id: "visible-event",
      startMs: new Date("2026-04-20T18:00:00Z").getTime(),
      title: "Visible",
      source: "s",
      color: "#1",
    };
    getCalendarRange.mockImplementation((start, end) => {
      if (start === "2026-04-01" && end === "2026-04-30") {
        return new Promise((resolve) => {
          resolveVisible = resolve;
        });
      }
      return new Promise(() => {});
    });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    let ensurePromise;
    act(() => {
      ensurePromise = result.current.ensureRange("2026-04-18", "2026-04-25");
    });
    expect(getCalendarRange).toHaveBeenCalledTimes(1);
    expect(getCalendarRange).toHaveBeenNthCalledWith(1, "2026-04-01", "2026-04-30");

    await act(async () => {
      resolveVisible({ events: [visibleEvent] });
    });

    await expect(ensurePromise).resolves.toEqual([visibleEvent]);
    expect(getCalendarRange).toHaveBeenCalledTimes(5);
    expect(getCalendarRange).toHaveBeenNthCalledWith(1, "2026-04-01", "2026-04-30");
    expect(getCalendarRange).toHaveBeenNthCalledWith(2, "2026-01-01", "2026-02-28");
    expect(getCalendarRange).toHaveBeenNthCalledWith(3, "2026-03-01", "2026-03-31");
    expect(getCalendarRange).toHaveBeenNthCalledWith(4, "2026-05-01", "2026-06-30");
    expect(getCalendarRange).toHaveBeenNthCalledWith(5, "2026-07-01", "2026-07-31");
    expect(result.current.loading).toBe(false);
  });

  it("bumps cacheStamp when cache content changes and holds it stable otherwise", async () => {
    getCalendarRange.mockResolvedValue({ events: [] });
    const { result, rerender } = renderHook(() => useCalendarRange({ disabled: false }));
    const initialStamp = result.current.cacheStamp;

    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25");
    });
    const afterFetch = result.current.cacheStamp;
    expect(afterFetch).not.toBe(initialStamp);

    rerender();
    expect(result.current.cacheStamp).toBe(afterFetch);

    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25");
    });
    expect(result.current.cacheStamp).toBe(afterFetch);

    act(() => {
      result.current.upsertEvents({
        id: "stamp-event",
        startMs: new Date("2026-04-20T18:00:00Z").getTime(),
        endMs: new Date("2026-04-20T19:00:00Z").getTime(),
        title: "Stamp",
      });
    });
    expect(result.current.cacheStamp).not.toBe(afterFetch);
  });

  it("fetches a month range with a three-month warm buffer and caches by YYYY-MM", async () => {
    getCalendarRange.mockResolvedValue({
      events: [{ startMs: new Date("2026-04-20T18:00:00Z").getTime(), title: "E1", source: "s", color: "#1" }],
    });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25");
    });
    expect(getCalendarRange).toHaveBeenCalledTimes(5);
    expect(getCalendarRange).toHaveBeenNthCalledWith(1, "2026-04-01", "2026-04-30");
    expect(getCalendarRange).toHaveBeenNthCalledWith(2, "2026-01-01", "2026-02-28");
    expect(getCalendarRange).toHaveBeenNthCalledWith(3, "2026-03-01", "2026-03-31");
    expect(getCalendarRange).toHaveBeenNthCalledWith(4, "2026-05-01", "2026-06-30");
    expect(getCalendarRange).toHaveBeenNthCalledWith(5, "2026-07-01", "2026-07-31");

    // Second call in same month → cached, no new fetch
    await act(async () => {
      await result.current.ensureRange("2026-04-20", "2026-04-22");
    });
    expect(getCalendarRange).toHaveBeenCalledTimes(5);
  });

  it("batches contiguous missing months when range spans multiple months", async () => {
    getCalendarRange.mockResolvedValue({ events: [] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-28", "2026-05-03");
    });
    expect(getCalendarRange).toHaveBeenCalledTimes(5);
    expect(getCalendarRange).toHaveBeenNthCalledWith(1, "2026-04-01", "2026-05-31");
    expect(getCalendarRange).toHaveBeenNthCalledWith(2, "2026-01-01", "2026-02-28");
    expect(getCalendarRange).toHaveBeenNthCalledWith(3, "2026-03-01", "2026-03-31");
    expect(getCalendarRange).toHaveBeenNthCalledWith(4, "2026-06-01", "2026-07-31");
    expect(getCalendarRange).toHaveBeenNthCalledWith(5, "2026-08-01", "2026-08-31");
  });

  it("dedupes concurrent visible fetches before warming the month buffer", async () => {
    let resolve;
    getCalendarRange.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    act(() => {
      result.current.ensureRange("2026-04-18", "2026-04-25");
      result.current.ensureRange("2026-04-18", "2026-04-25");
    });
    expect(getCalendarRange).toHaveBeenCalledTimes(1);
    expect(getCalendarRange).toHaveBeenNthCalledWith(1, "2026-04-01", "2026-04-30");

    await act(async () => {
      resolve({ events: [] });
    });
    expect(getCalendarRange).toHaveBeenCalledTimes(5);
  });

  it("invalidate() clears the cache", async () => {
    getCalendarRange.mockResolvedValue({ events: [] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25");
    });
    act(() => result.current.invalidate());
    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25");
    });
    expect(getCalendarRange).toHaveBeenCalledTimes(10);
  });

  it("refreshRange() refetches cached months and increments revision", async () => {
    getCalendarRange.mockResolvedValue({ events: [] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25");
    });
    expect(result.current.revision).toBe(0);

    await act(async () => {
      await result.current.refreshRange("2026-04-18", "2026-04-25");
    });

    expect(getCalendarRange).toHaveBeenCalledTimes(10);
    expect(result.current.revision).toBe(1);
  });

  it("reports per-month cache and loading state", async () => {
    let resolve;
    getCalendarRange.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    expect(result.current.hasMonth(2026, 3)).toBe(false);
    expect(result.current.isMonthLoading(2026, 3)).toBe(false);

    act(() => {
      result.current.ensureRange("2026-04-18", "2026-04-25");
    });

    expect(result.current.isMonthLoading(2026, 3)).toBe(true);
    expect(result.current.hasMonth(2026, 3)).toBe(false);

    await act(async () => {
      resolve({ events: [] });
    });

    expect(result.current.isMonthLoading(2026, 3)).toBe(false);
    expect(result.current.hasMonth(2026, 3)).toBe(true);
  });

  it("returns cached events while stale months refresh quietly in the background", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T12:00:00.000Z"));
    const cached = { id: "event-1", startMs: new Date("2026-04-20T18:00:00Z").getTime(), title: "Cached" };
    getCalendarRange.mockResolvedValue({ events: [cached] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25");
    });

    getCalendarRange.mockClear();
    getCalendarRange.mockReturnValue(new Promise(() => {}));
    vi.setSystemTime(new Date("2026-04-01T12:31:00.000Z"));

    const events = await act(async () =>
      result.current.ensureRange("2026-04-18", "2026-04-25"),
    );

    expect(events).toEqual([cached]);
    expect(result.current.getEvents(2026, 3)).toEqual([cached]);
    expect(result.current.isMonthLoading(2026, 3)).toBe(false);
    expect(result.current.staleRefreshPending).toBe(true);
    expect(getCalendarRange).toHaveBeenCalledTimes(4);
  });

  it("applies stale background refreshes without clearing cached visible events first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T12:00:00.000Z"));
    const cached = { id: "event-1", startMs: new Date("2026-04-20T18:00:00Z").getTime(), title: "Cached" };
    const updated = { ...cached, title: "Updated" };
    getCalendarRange.mockResolvedValue({ events: [cached] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25");
    });
    expect(result.current.revision).toBe(0);

    getCalendarRange.mockClear();
    getCalendarRange.mockResolvedValue({ events: [updated] });
    vi.setSystemTime(new Date("2026-04-01T12:31:00.000Z"));

    const events = await act(async () =>
      result.current.ensureRange("2026-04-18", "2026-04-25"),
    );
    expect(events).toEqual([cached]);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.getEvents(2026, 3)).toEqual([updated]);
    expect(result.current.revision).toBe(1);
    expect(result.current.staleRefreshPending).toBe(false);
  });

  it("markStale() preserves cached events and refreshes them on the next ensure", async () => {
    const cached = { id: "event-1", startMs: new Date("2026-04-20T18:00:00Z").getTime(), title: "Cached" };
    getCalendarRange.mockResolvedValue({ events: [cached] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25");
    });

    act(() => result.current.markStale());

    expect(result.current.getEvents(2026, 3)).toEqual([cached]);
    expect(result.current.revision).toBe(1);

    getCalendarRange.mockClear();
    getCalendarRange.mockReturnValue(new Promise(() => {}));

    const events = await act(async () =>
      result.current.ensureRange("2026-04-18", "2026-04-25"),
    );

    expect(events).toEqual([cached]);
    expect(result.current.isMonthLoading(2026, 3)).toBe(false);
    expect(result.current.staleRefreshPending).toBe(true);
    expect(getCalendarRange).toHaveBeenCalledTimes(4);
  });

  it("refreshRangeInPlace() refetches cached months without clearing visible events", async () => {
    const cached = { id: "event-1", startMs: new Date("2026-04-20T18:00:00Z").getTime(), title: "Cached" };
    const updated = { ...cached, title: "Updated" };
    getCalendarRange.mockResolvedValue({ events: [cached] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25");
    });

    getCalendarRange.mockClear();
    getCalendarRange.mockResolvedValue({ events: [updated] });

    const events = await act(async () =>
      result.current.refreshRangeInPlace("2026-04-18", "2026-04-25"),
    );

    expect(events).toEqual([updated]);
    expect(result.current.getEvents(2026, 3)).toEqual([updated]);
    expect(result.current.isMonthLoading(2026, 3)).toBe(false);
    expect(result.current.staleRefreshPending).toBe(false);
    expect(getCalendarRange).toHaveBeenCalledTimes(4);
  });

  it("refetches months whose inherited in-flight fetch was aborted by a previous pass", async () => {
    const event = { id: "april-event", startMs: new Date("2026-04-20T18:00:00Z").getTime(), title: "April" };
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    getCalendarRange.mockImplementation((start, end, opts) => {
      if (opts?.signal === controllerA.signal) {
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      return Promise.resolve({ events: [event] });
    });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    let passA;
    act(() => {
      passA = result.current.ensureRange("2026-04-18", "2026-04-25", { signal: controllerA.signal });
    });
    expect(getCalendarRange).toHaveBeenCalledTimes(1);

    // The controller's scroll-driven pattern: the next pass aborts the
    // previous one, then synchronously re-ensures the same range while the
    // aborted months are still registered as in flight.
    let passB;
    await act(async () => {
      controllerA.abort();
      passB = result.current.ensureRange("2026-04-18", "2026-04-25", { signal: controllerB.signal });
      await passA;
      await passB;
    });

    expect(result.current.hasMonth(2026, 3)).toBe(true);
    expect(result.current.getEvents(2026, 3)).toEqual([event]);
    await expect(passB).resolves.toEqual([event]);
  });

  it("returns cached-only data when its own signal aborted", async () => {
    const controller = new AbortController();
    getCalendarRange.mockImplementation((start, end, opts) => (
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      })
    ));
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    let pass;
    act(() => {
      pass = result.current.ensureRange("2026-04-18", "2026-04-25", { signal: controller.signal });
    });
    await act(async () => {
      controller.abort();
      await pass;
    });

    // A genuinely aborted pass must not refetch on its own behalf.
    expect(getCalendarRange).toHaveBeenCalledTimes(1);
    expect(result.current.hasMonth(2026, 3)).toBe(false);
    await expect(pass).resolves.toEqual([]);
  });

  it("returns trimmed events via ensureRange's resolved value", async () => {
    const before = { startMs: new Date("2026-04-17T18:00:00Z").getTime(), title: "before", source: "s", color: "#1" };
    const within = { startMs: new Date("2026-04-20T18:00:00Z").getTime(), title: "within", source: "s", color: "#1" };
    const after = { startMs: new Date("2026-04-28T18:00:00Z").getTime(), title: "after", source: "s", color: "#1" };
    getCalendarRange.mockResolvedValue({ events: [before, within, after] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    const events = await act(async () =>
      result.current.ensureRange("2026-04-18", "2026-04-25"),
    );
    expect(events.map((e) => e.title)).toEqual(["within"]);
  });

  it("locally upserts and removes events in cached months", async () => {
    const original = { id: "event-1", startMs: new Date("2026-04-20T18:00:00Z").getTime(), title: "Original" };
    const updated = { id: "event-1", startMs: new Date("2026-04-21T18:00:00Z").getTime(), title: "Updated" };
    getCalendarRange.mockResolvedValue({ events: [original] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-01", "2026-04-30");
    });

    act(() => result.current.upsertEvents(updated));
    expect(result.current.getEvents(2026, 3)).toEqual([updated]);
    expect(getCalendarRange).toHaveBeenCalledTimes(5);

    act(() => result.current.removeEvent("event-1"));
    expect(result.current.getEvents(2026, 3)).toEqual([]);
    expect(getCalendarRange).toHaveBeenCalledTimes(5);
  });

  it("caches spanning events into every touched month and trims by visual overlap", async () => {
    const spanning = {
      id: "span-1",
      title: "Month bridge",
      allDay: true,
      startMs: new Date("2026-04-30T07:00:00Z").getTime(),
      endMs: new Date("2026-05-03T07:00:00Z").getTime(),
    };
    getCalendarRange.mockResolvedValue({ events: [spanning] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    const aprilEvents = await act(async () =>
      result.current.ensureRange("2026-04-01", "2026-04-30"),
    );

    expect(aprilEvents).toEqual([spanning]);
    expect(result.current.getEvents(2026, 3)).toEqual([spanning]);
    expect(result.current.getEvents(2026, 4)).toEqual([spanning]);

    const unrelated = await act(async () =>
      result.current.ensureRange("2026-04-01", "2026-04-10"),
    );
    expect(unrelated).toEqual([]);
  });

  it("upserts spanning events into all touched cached months", async () => {
    const original = {
      id: "span-2",
      title: "Original bridge",
      allDay: true,
      startMs: new Date("2026-04-30T07:00:00Z").getTime(),
      endMs: new Date("2026-05-02T07:00:00Z").getTime(),
    };
    const updated = {
      ...original,
      title: "Updated bridge",
      endMs: new Date("2026-05-03T07:00:00Z").getTime(),
    };
    getCalendarRange.mockResolvedValue({ events: [original] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-01", "2026-04-30");
    });

    act(() => result.current.upsertEvents(updated));

    expect(result.current.getEvents(2026, 3)).toEqual([updated]);
    expect(result.current.getEvents(2026, 4)).toEqual([updated]);
  });
});
