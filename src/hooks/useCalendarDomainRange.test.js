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

  it("caches deadline ranges by month buckets and prefetches adjacent months", async () => {
    const fetchRange = vi.fn(async (start, end) => {
      const months = [];
      const cursor = new Date(`${start}T12:00:00Z`);
      const last = new Date(`${end}T12:00:00Z`);
      while (cursor <= last) {
        months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      return {
        ctm: {
          upcoming: months.map((month) => ({
            id: `ctm-${month}`,
            title: `CTM ${month}`,
            due_date: `${month}-05`,
            source: "canvas",
          })),
        },
        todoist: {
          upcoming: months.map((month) => ({
            id: `todo-${month}`,
            title: `Todo ${month}`,
            due_date: `${month}-28`,
            source: "todoist",
          })),
        },
      };
    });
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 1,
    }));

    await act(async () => {
      await result.current.ensureRange("2026-04-26", "2026-06-06");
    });

    expect(fetchRange).toHaveBeenCalledTimes(4);
    expect(fetchRange).toHaveBeenNthCalledWith(1, "2026-04-01", "2026-05-31");
    expect(fetchRange).toHaveBeenNthCalledWith(2, "2026-06-01", "2026-06-30");
    expect(fetchRange).toHaveBeenNthCalledWith(3, "2026-03-01", "2026-03-31");
    expect(fetchRange).toHaveBeenNthCalledWith(4, "2026-07-01", "2026-07-31");
    expect(result.current.data.ctm.upcoming.map((item) => item.due_date)).toEqual(["2026-05-05", "2026-06-05"]);
    expect(result.current.data.todoist.upcoming.map((item) => item.due_date)).toEqual(["2026-04-28", "2026-05-28"]);

    fetchRange.mockClear();
    await act(async () => {
      await result.current.ensureRange("2026-05-31", "2026-07-11");
    });

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(fetchRange).toHaveBeenCalledWith("2026-08-01", "2026-08-31");
    expect(result.current.data.ctm.upcoming.map((item) => item.due_date)).toEqual(["2026-06-05", "2026-07-05"]);
    expect(result.current.data.todoist.upcoming.map((item) => item.due_date)).toEqual(["2026-06-28"]);
  });

  it("dedupes concurrent month-bucket fetches", async () => {
    const resolvers = [];
    const fetchRange = vi.fn(() => new Promise((resolve) => {
      resolvers.push(resolve);
    }));
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 1,
    }));

    act(() => {
      result.current.ensureRange("2026-04-26", "2026-06-06");
      result.current.ensureRange("2026-04-26", "2026-06-06");
    });

    expect(fetchRange).toHaveBeenCalledTimes(2);
    expect(fetchRange).toHaveBeenNthCalledWith(1, "2026-04-01", "2026-05-31");
    expect(fetchRange).toHaveBeenNthCalledWith(2, "2026-06-01", "2026-06-30");
    expect(result.current.loading).toBe(true);

    await act(async () => {
      for (const resolve of resolvers) {
        resolve({ ctm: { upcoming: [] }, todoist: { upcoming: [] } });
      }
    });

    expect(fetchRange).toHaveBeenCalledTimes(4);
    expect(fetchRange).toHaveBeenNthCalledWith(1, "2026-04-01", "2026-05-31");
    expect(fetchRange).toHaveBeenNthCalledWith(2, "2026-06-01", "2026-06-30");
    expect(fetchRange).toHaveBeenNthCalledWith(3, "2026-03-01", "2026-03-31");
    expect(fetchRange).toHaveBeenNthCalledWith(4, "2026-07-01", "2026-07-31");
  });

  it("keeps existing data visible while a cold unprefetched deadline month loads", async () => {
    let resolveColdRange;
    const fetchRange = vi
      .fn()
      .mockResolvedValueOnce({
        ctm: { upcoming: [] },
        todoist: {
          upcoming: [
            { id: "todo-april", title: "April task", due_date: "2026-04-15", source: "todoist" },
          ],
        },
      })
      .mockResolvedValueOnce({ ctm: { upcoming: [] }, todoist: { upcoming: [] } })
      .mockResolvedValueOnce({ ctm: { upcoming: [] }, todoist: { upcoming: [] } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveColdRange = resolve;
      }));
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 1,
    }));

    await act(async () => {
      await result.current.ensureRange("2026-04-01", "2026-04-30");
    });
    expect(result.current.data.todoist.upcoming.map((item) => item.id)).toEqual(["todo-april"]);

    act(() => {
      result.current.ensureRange("2026-09-01", "2026-09-30").catch(() => {});
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.data.todoist.upcoming.map((item) => item.id)).toEqual(["todo-april"]);

    await act(async () => {
      resolveColdRange({
        ctm: { upcoming: [] },
        todoist: {
          upcoming: [
            { id: "todo-september", title: "September task", due_date: "2026-09-15", source: "todoist" },
          ],
        },
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data.todoist.upcoming.map((item) => item.id)).toEqual(["todo-september"]);
  });

  it("applies updater mutations across every cached deadline month bucket", async () => {
    const fetchRange = vi.fn(async (start) => {
      if (start === "2026-04-01") {
        return {
          ctm: { upcoming: [] },
          todoist: {
            upcoming: [
              { id: "todo-move", title: "Move me", due_date: "2026-04-15", source: "todoist" },
            ],
          },
        };
      }
      return { ctm: { upcoming: [] }, todoist: { upcoming: [] } };
    });
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 1,
    }));

    await act(async () => {
      await result.current.ensureRange("2026-04-01", "2026-04-30");
    });

    act(() => {
      result.current.updateData((current) => {
        const updated = JSON.parse(JSON.stringify(current));
        const existingIndex = updated.todoist.upcoming.findIndex((item) => item.id === "todo-move");
        const moved = {
          id: "todo-move",
          title: "Move me",
          due_date: "2026-05-05",
          source: "todoist",
        };
        if (existingIndex >= 0) updated.todoist.upcoming[existingIndex] = moved;
        else updated.todoist.upcoming.push(moved);
        return updated;
      });
    });

    expect(result.current.data.todoist.upcoming).toEqual([]);

    fetchRange.mockClear();
    await act(async () => {
      await result.current.ensureRange("2026-05-01", "2026-05-31");
    });

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(fetchRange).not.toHaveBeenCalledWith("2026-05-01", "2026-05-31");
    expect(fetchRange).toHaveBeenLastCalledWith("2026-06-01", "2026-06-30");
    expect(result.current.data.todoist.upcoming).toEqual([
      { id: "todo-move", title: "Move me", due_date: "2026-05-05", source: "todoist" },
    ]);
  });
});
