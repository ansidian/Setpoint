import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../api", () => ({
  getCalendarRange: vi.fn(),
}));

const { getCalendarRange } = await import("../api");
const { default: useCalendarRange } = await import("./useCalendarRange");

describe("useCalendarRange", () => {
  beforeEach(() => {
    getCalendarRange.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when disabled", async () => {
    const { result } = renderHook(() => useCalendarRange({ disabled: true }));
    await act(async () => {
      const events = await result.current.ensureRange("2026-04-18", "2026-04-25");
      expect(events).toEqual([]);
    });
    expect(getCalendarRange).not.toHaveBeenCalled();
  });

  it("fetches a month range and caches by YYYY-MM", async () => {
    getCalendarRange.mockResolvedValue({
      events: [{ startMs: new Date("2026-04-20T18:00:00Z").getTime(), title: "E1", source: "s", color: "#1" }],
    });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-18", "2026-04-25");
    });
    expect(getCalendarRange).toHaveBeenCalledTimes(1);

    // Second call in same month → cached, no new fetch
    await act(async () => {
      await result.current.ensureRange("2026-04-20", "2026-04-22");
    });
    expect(getCalendarRange).toHaveBeenCalledTimes(1);
  });

  it("fetches each month separately when range spans multiple months", async () => {
    getCalendarRange.mockResolvedValue({ events: [] });
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    await act(async () => {
      await result.current.ensureRange("2026-04-28", "2026-05-03");
    });
    // Two months = two fetches
    expect(getCalendarRange).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent fetches for the same month", async () => {
    let resolve;
    getCalendarRange.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useCalendarRange({ disabled: false }));

    act(() => {
      result.current.ensureRange("2026-04-18", "2026-04-25");
      result.current.ensureRange("2026-04-18", "2026-04-25");
    });
    expect(getCalendarRange).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ events: [] });
    });
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
    expect(getCalendarRange).toHaveBeenCalledTimes(2);
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

    expect(getCalendarRange).toHaveBeenCalledTimes(2);
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
    expect(getCalendarRange).toHaveBeenCalledTimes(1);

    act(() => result.current.removeEvent("event-1"));
    expect(result.current.getEvents(2026, 3)).toEqual([]);
    expect(getCalendarRange).toHaveBeenCalledTimes(1);
  });
});
