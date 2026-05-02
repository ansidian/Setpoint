import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useCalendarDomainRange from "./useCalendarDomainRange.js";

describe("useCalendarDomainRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T16:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("fetches exact visible ranges and reuses fresh memory cache entries", async () => {
    const fetchRange = vi.fn().mockResolvedValue({ value: "range-data" });
    const { result } = renderHook(() => useCalendarDomainRange({ fetchRange, emptyData: { value: "empty" } }));

    await act(async () => {
      await result.current.ensureRange("2026-04-26", "2026-06-06");
    });
    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(fetchRange).toHaveBeenCalledWith("2026-04-26", "2026-06-06");
    expect(result.current.data).toEqual({ value: "range-data" });

    await act(async () => {
      await result.current.ensureRange("2026-04-26", "2026-06-06");
    });
    expect(fetchRange).toHaveBeenCalledTimes(1);
  });

  it("refetches stale cached ranges after the calendar-domain ttl", async () => {
    const fetchRange = vi
      .fn()
      .mockResolvedValueOnce({ value: "first" })
      .mockResolvedValueOnce({ value: "second" });
    const { result } = renderHook(() => useCalendarDomainRange({ fetchRange, emptyData: { value: "empty" } }));

    await act(async () => {
      await result.current.ensureRange("2026-04-26", "2026-06-06");
    });
    vi.setSystemTime(new Date("2026-05-02T16:31:00.000Z"));

    await act(async () => {
      await result.current.ensureRange("2026-04-26", "2026-06-06");
    });

    expect(fetchRange).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({ value: "second" });
  });

  it("locally updates the active range data and cache", async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      todoist: {
        upcoming: [{ id: "todo-1", title: "Open", status: "incomplete", source: "todoist" }],
      },
    });
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
    }));

    await act(async () => {
      await result.current.ensureRange("2026-04-01", "2026-04-30");
    });

    act(() => {
      result.current.updateData((current) => ({
        ...current,
        todoist: {
          ...current.todoist,
          upcoming: current.todoist.upcoming.map((task) => (
            task.id === "todo-1" ? { ...task, status: "complete" } : task
          )),
        },
      }));
    });

    expect(result.current.data.todoist.upcoming[0].status).toBe("complete");

    await act(async () => {
      await result.current.ensureRange("2026-04-01", "2026-04-30");
    });

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(result.current.data.todoist.upcoming[0].status).toBe("complete");
  });
});
