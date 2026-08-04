import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { CalendarRangeEvent } from "./useCalendarRange";

vi.mock("../../api", () => ({
  getCalendarRange: vi.fn(),
}));

const { getCalendarRange: getCalendarRangeApi } = await import("../../api");
const { default: useCalendarRange } = await import("./useCalendarRange");

type CalendarRangeTestResponse = { events: CalendarRangeEvent[] };
const getCalendarRange = vi.mocked(getCalendarRangeApi) as unknown as Mock<(
  start: string,
  end: string,
  options?: { signal?: AbortSignal },
) => Promise<CalendarRangeTestResponse>>;

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
    let resolveVisible!: (value: CalendarRangeTestResponse) => void;
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

    let ensurePromise!: Promise<CalendarRangeEvent[]>;
    act(() => {
      ensurePromise = result.current.ensureRange("2026-04-18", "2026-04-25");
    });

    await act(async () => {
      resolveVisible({ events: [visibleEvent] });
    });

    await expect(ensurePromise).resolves.toEqual([visibleEvent]);
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

  it("dedupes concurrent visible fetches before warming the month buffer", async () => {
    let resolve!: (value: CalendarRangeTestResponse) => void;
    getCalendarRange.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    let first!: Promise<CalendarRangeEvent[]>;
    let second!: Promise<CalendarRangeEvent[]>;
    act(() => {
      first = result.current.ensureRange("2026-04-18", "2026-04-25");
      second = result.current.ensureRange("2026-04-18", "2026-04-25");
    });
    expect(getCalendarRange).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ events: [] });
      await Promise.all([first, second]);
    });
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([]);
  });

  it("invalidate() clears the cache", async () => {
    const original = { id: "event-1", startMs: new Date("2026-04-20T18:00:00Z").getTime(), title: "Original" };
    const refreshed = { ...original, title: "Refreshed" };
    getCalendarRange
      .mockResolvedValueOnce({ events: [original] })
      .mockResolvedValue({ events: [refreshed] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25", { prefetchKeys: ["2026-04"] });
    });
    expect(result.current.getEvents(2026, 3)).toEqual([original]);

    act(() => result.current.invalidate());
    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25", { prefetchKeys: ["2026-04"] });
    });
    expect(result.current.getEvents(2026, 3)).toEqual([refreshed]);
  });

  it("refreshRange() refetches cached months and increments revision", async () => {
    const original = { id: "event-1", startMs: new Date("2026-04-20T18:00:00Z").getTime(), title: "Original" };
    const refreshed = { ...original, title: "Refreshed" };
    getCalendarRange
      .mockResolvedValueOnce({ events: [original] })
      .mockResolvedValue({ events: [refreshed] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25");
    });
    expect(result.current.revision).toBe(0);

    let refreshedEvents!: CalendarRangeEvent[];
    await act(async () => {
      refreshedEvents = await result.current.refreshRange("2026-04-18", "2026-04-25");
    });

    expect(refreshedEvents).toEqual([refreshed]);
    expect(result.current.revision).toBe(1);
    expect(result.current.getEvents(2026, 3)).toEqual([refreshed]);
  });

  it("reports per-month cache and loading state", async () => {
    let resolve!: (value: CalendarRangeTestResponse) => void;
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
  });

  it("refetches months whose inherited in-flight fetch was aborted by a previous pass", async () => {
    const event = { id: "april-event", startMs: new Date("2026-04-20T18:00:00Z").getTime(), title: "April" };
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    getCalendarRange.mockImplementation((_start, _end, opts) => {
      const signal = opts?.signal;
      if (signal === controllerA.signal) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      return Promise.resolve({ events: [event] });
    });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    let passA!: Promise<CalendarRangeEvent[]>;
    act(() => {
      passA = result.current.ensureRange("2026-04-18", "2026-04-25", { signal: controllerA.signal });
    });
    expect(getCalendarRange).toHaveBeenCalledTimes(1);

    // The controller's scroll-driven pattern: the next pass aborts the
    // previous one, then synchronously re-ensures the same range while the
    // aborted months are still registered as in flight.
    let passB!: Promise<CalendarRangeEvent[]>;
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
    getCalendarRange.mockImplementation((_start, _end, opts) => (
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      })
    ));
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    let pass!: Promise<CalendarRangeEvent[]>;
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

    act(() => result.current.removeEvent("event-1"));
    expect(result.current.getEvents(2026, 3)).toEqual([]);
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
