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

  it("seeds month buckets for immediate deadline paint and refreshes them as stale", async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      ctm: { upcoming: [] },
      todoist: {
        upcoming: [
          { id: "todo-fresh", title: "Fresh task", due_date: "2026-05-12", source: "todoist" },
        ],
      },
    });
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 0,
    }));

    act(() => {
      result.current.seedData({
        ctm: { upcoming: [] },
        todoist: {
          upcoming: [
            { id: "todo-seeded", title: "Seeded task", due_date: "2026-05-10", source: "todoist" },
          ],
        },
      });
    });

    expect(result.current.data.todoist.upcoming.map((item) => item.id)).toEqual(["todo-seeded"]);

    let ensured;
    await act(async () => {
      ensured = await result.current.ensureRange("2026-05-01", "2026-05-31");
    });

    expect(ensured.todoist.upcoming.map((item) => item.id)).toEqual(["todo-seeded"]);
    expect(result.current.data.todoist.upcoming.map((item) => item.id)).toEqual(["todo-fresh"]);
    expect(fetchRange).toHaveBeenCalledWith("2026-05-01", "2026-05-31");
  });

  it("publishes the refreshed active month after a stale first-paint seed", async () => {
    let resolveRange;
    const fetchRange = vi.fn(() => new Promise((resolve) => {
      resolveRange = resolve;
    }));
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 0,
    }));

    act(() => {
      result.current.seedData({
        ctm: { upcoming: [] },
        todoist: {
          upcoming: [
            { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
          ],
        },
      });
    });

    let ensured;
    await act(async () => {
      ensured = await result.current.ensureRange("2026-05-01", "2026-05-31");
    });

    expect(ensured.todoist.upcoming.map((item) => item.id)).toEqual(["todo-open"]);
    expect(result.current.data.todoist.upcoming.map((item) => item.id)).toEqual(["todo-open"]);
    expect(fetchRange).toHaveBeenCalledWith("2026-05-01", "2026-05-31");

    await act(async () => {
      resolveRange({
        ctm: { upcoming: [] },
        todoist: {
          upcoming: [
            { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
            { id: "todo-complete", title: "Completed task", due_date: "2026-05-12", source: "todoist", status: "complete" },
          ],
        },
      });
      await Promise.resolve();
    });

    expect(result.current.data.todoist.upcoming.map((item) => item.id)).toEqual(["todo-open", "todo-complete"]);
  });

  it("refreshes stale seeded months even when adjacent visible months are missing", async () => {
    let resolveMay;
    const fetchRange = vi.fn((start) => {
      if (start === "2026-05-01") {
        return new Promise((resolve) => {
          resolveMay = resolve;
        });
      }
      return Promise.resolve({ ctm: { upcoming: [] }, todoist: { upcoming: [] } });
    });
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 0,
    }));

    act(() => {
      result.current.seedData({
        ctm: { upcoming: [] },
        todoist: {
          upcoming: [
            { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
          ],
        },
      });
    });

    await act(async () => {
      await result.current.ensureRange("2026-04-26", "2026-06-06");
    });

    expect(fetchRange).toHaveBeenCalledWith("2026-04-01", "2026-04-30");
    expect(fetchRange).toHaveBeenCalledWith("2026-06-01", "2026-06-30");
    expect(fetchRange).toHaveBeenCalledWith("2026-05-01", "2026-05-31");
    expect(result.current.data.todoist.upcoming.map((item) => item.id)).toEqual(["todo-open"]);

    await act(async () => {
      resolveMay({
        ctm: { upcoming: [] },
        todoist: {
          upcoming: [
            { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
            { id: "todo-complete", title: "Completed task", due_date: "2026-05-12", source: "todoist", status: "complete" },
          ],
        },
      });
      await Promise.resolve();
    });

    expect(result.current.data.todoist.upcoming.map((item) => item.id)).toEqual(["todo-open", "todo-complete"]);
  });

  it("does not let stale live deadline seeds replace an existing range month", async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      ctm: { upcoming: [] },
      todoist: {
        upcoming: [
          { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
          { id: "todo-complete", title: "Completed task", due_date: "2026-05-12", source: "todoist", status: "complete" },
        ],
      },
    });
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 0,
    }));

    await act(async () => {
      await result.current.ensureRange("2026-05-01", "2026-05-31");
    });

    expect(result.current.data.todoist.upcoming.map((item) => item.id)).toEqual(["todo-open", "todo-complete"]);

    act(() => {
      result.current.markStale();
    });

    act(() => {
      result.current.seedData({
        ctm: { upcoming: [] },
        todoist: {
          upcoming: [
            { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
          ],
        },
      });
    });

    expect(result.current.data.todoist.upcoming.map((item) => item.id)).toEqual(["todo-open", "todo-complete"]);
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

  it("does not publish a stale month-range response after a newer active range wins", async () => {
    let resolveApril;
    let resolveMay;
    const fetchRange = vi.fn((start) => new Promise((resolve) => {
      if (start === "2026-04-01") resolveApril = resolve;
      if (start === "2026-05-01") resolveMay = resolve;
    }));
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
    }));

    let aprilPromise;
    await act(async () => {
      aprilPromise = result.current.ensureRange("2026-04-01", "2026-04-30");
    });
    let mayPromise;
    await act(async () => {
      mayPromise = result.current.ensureRange("2026-05-01", "2026-05-31");
    });

    await act(async () => {
      resolveMay({
        ctm: { upcoming: [] },
        todoist: {
          upcoming: [
            { id: "todo-may", title: "May task", due_date: "2026-05-05", source: "todoist" },
          ],
        },
      });
      await mayPromise;
    });

    expect(result.current.data.todoist.upcoming.map((item) => item.id)).toEqual(["todo-may"]);
    expect(result.current.dataRange).toMatchObject({ start: "2026-05-01", end: "2026-05-31" });

    await act(async () => {
      resolveApril({
        ctm: { upcoming: [] },
        todoist: {
          upcoming: [
            { id: "todo-april", title: "April task", due_date: "2026-04-05", source: "todoist" },
          ],
        },
      });
      await aprilPromise;
    });

    expect(result.current.data.todoist.upcoming.map((item) => item.id)).toEqual(["todo-may"]);
    expect(result.current.dataRange).toMatchObject({ start: "2026-05-01", end: "2026-05-31" });
  });
});
