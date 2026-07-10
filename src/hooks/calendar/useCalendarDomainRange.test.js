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
      upcoming: [{ id: "todo-1", title: "Open", status: "incomplete", source: "todoist" }],
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
        upcoming: current.upcoming.map((task) => (
          task.id === "todo-1" ? { ...task, status: "complete" } : task
        )),
      }));
    });

    expect(result.current.data.upcoming[0].status).toBe("complete");

    await act(async () => {
      await result.current.ensureRange("2026-04-01", "2026-04-30");
    });

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(result.current.data.upcoming[0].status).toBe("complete");
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
        upcoming: months.flatMap((month) => ([
          {
            id: `todo-${month}-05`,
            title: `Todo ${month} early`,
            due_date: `${month}-05`,
            source: "todoist",
          },
          {
            id: `todo-${month}-28`,
            title: `Todo ${month} late`,
            due_date: `${month}-28`,
            source: "todoist",
          },
        ])),
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
    expect(result.current.data.upcoming.map((item) => item.due_date)).toEqual([
      "2026-04-28",
      "2026-05-05",
      "2026-05-28",
      "2026-06-05",
    ]);

    fetchRange.mockClear();
    await act(async () => {
      await result.current.ensureRange("2026-05-31", "2026-07-11");
    });

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(fetchRange).toHaveBeenCalledWith("2026-08-01", "2026-08-31");
    expect(result.current.data.upcoming.map((item) => item.due_date)).toEqual([
      "2026-06-05",
      "2026-06-28",
      "2026-07-05",
    ]);
  });

  it("caches bill ranges by month buckets and merges schedules across the visible range", async () => {
    const fetchRange = vi.fn(async (start, end) => {
      const months = [];
      const cursor = new Date(`${start}T12:00:00Z`);
      const last = new Date(`${end}T12:00:00Z`);
      while (cursor <= last) {
        months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      return {
        payeeMap: { p1: "Narwhal" },
        schedules: months.map((month) => ({
          id: `sched-1:${month}-15`,
          scheduleId: "sched-1",
          name: "Narwhal",
          next_date: `${month}-15`,
          paid: false,
        })),
      };
    });
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 1,
    }));

    await act(async () => {
      await result.current.ensureRange("2026-04-01", "2026-06-30");
    });

    // Occurrences from every visible month are merged, and non-schedule fields
    // (payeeMap) survive the combine — proving the schedules shape is handled,
    // not collapsed to a single month's bucket.
    expect(result.current.data.payeeMap).toEqual({ p1: "Narwhal" });
    expect(result.current.data.schedules.map((occurrence) => occurrence.next_date)).toEqual([
      "2026-04-15",
      "2026-05-15",
      "2026-06-15",
    ]);

    // Scrolling forward reuses cached months; only the new trailing edge is fetched.
    fetchRange.mockClear();
    await act(async () => {
      await result.current.ensureRange("2026-05-01", "2026-07-31");
    });
    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(fetchRange).toHaveBeenCalledWith("2026-08-01", "2026-08-31");
    expect(result.current.data.schedules.map((occurrence) => occurrence.next_date)).toEqual([
      "2026-05-15",
      "2026-06-15",
      "2026-07-15",
    ]);
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
        resolve({ upcoming: [] });
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
        upcoming: [
          { id: "todo-april", title: "April task", due_date: "2026-04-15", source: "todoist" },
        ],
      })
      .mockResolvedValueOnce({ upcoming: [] })
      .mockResolvedValueOnce({ upcoming: [] })
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
    expect(result.current.data.upcoming.map((item) => item.id)).toEqual(["todo-april"]);

    act(() => {
      result.current.ensureRange("2026-09-01", "2026-09-30").catch(() => {});
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.data.upcoming.map((item) => item.id)).toEqual(["todo-april"]);

    await act(async () => {
      resolveColdRange({
        upcoming: [
          { id: "todo-september", title: "September task", due_date: "2026-09-15", source: "todoist" },
        ],
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data.upcoming.map((item) => item.id)).toEqual(["todo-september"]);
  });

  it("seeds month buckets for immediate deadline paint and refreshes them as stale", async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      upcoming: [
        { id: "todo-fresh", title: "Fresh task", due_date: "2026-05-12", source: "todoist" },
      ],
    });
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 0,
    }));

    act(() => {
      result.current.seedData({
        upcoming: [
          { id: "todo-seeded", title: "Seeded task", due_date: "2026-05-10", source: "todoist" },
        ],
      });
    });

    expect(result.current.data.upcoming.map((item) => item.id)).toEqual(["todo-seeded"]);

    let ensured;
    await act(async () => {
      ensured = await result.current.ensureRange("2026-05-01", "2026-05-31");
    });

    expect(ensured.upcoming.map((item) => item.id)).toEqual(["todo-seeded"]);
    expect(result.current.data.upcoming.map((item) => item.id)).toEqual(["todo-fresh"]);
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
        upcoming: [
          { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
        ],
      });
    });

    let ensured;
    await act(async () => {
      ensured = await result.current.ensureRange("2026-05-01", "2026-05-31");
    });

    expect(ensured.upcoming.map((item) => item.id)).toEqual(["todo-open"]);
    expect(result.current.data.upcoming.map((item) => item.id)).toEqual(["todo-open"]);
    expect(fetchRange).toHaveBeenCalledWith("2026-05-01", "2026-05-31");

    await act(async () => {
      resolveRange({
        upcoming: [
          { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
          { id: "todo-complete", title: "Completed task", due_date: "2026-05-12", source: "todoist", status: "complete" },
        ],
      });
      await Promise.resolve();
    });

    expect(result.current.data.upcoming.map((item) => item.id)).toEqual(["todo-open", "todo-complete"]);
  });

  it("refreshes stale seeded months even when adjacent visible months are missing", async () => {
    let resolveMay;
    const fetchRange = vi.fn((start) => {
      if (start === "2026-05-01") {
        return new Promise((resolve) => {
          resolveMay = resolve;
        });
      }
      return Promise.resolve({ upcoming: [] });
    });
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 0,
    }));

    act(() => {
      result.current.seedData({
        upcoming: [
          { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
        ],
      });
    });

    await act(async () => {
      await result.current.ensureRange("2026-04-26", "2026-06-06");
    });

    expect(fetchRange).toHaveBeenCalledWith("2026-04-01", "2026-04-30");
    expect(fetchRange).toHaveBeenCalledWith("2026-06-01", "2026-06-30");
    expect(fetchRange).toHaveBeenCalledWith("2026-05-01", "2026-05-31");
    expect(result.current.data.upcoming.map((item) => item.id)).toEqual(["todo-open"]);

    await act(async () => {
      resolveMay({
        upcoming: [
          { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
          { id: "todo-complete", title: "Completed task", due_date: "2026-05-12", source: "todoist", status: "complete" },
        ],
      });
      await Promise.resolve();
    });

    expect(result.current.data.upcoming.map((item) => item.id)).toEqual(["todo-open", "todo-complete"]);
  });

  it("does not let stale live deadline seeds replace an existing range month", async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      upcoming: [
        { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
        { id: "todo-complete", title: "Completed task", due_date: "2026-05-12", source: "todoist", status: "complete" },
      ],
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

    expect(result.current.data.upcoming.map((item) => item.id)).toEqual(["todo-open", "todo-complete"]);

    act(() => {
      result.current.markStale();
    });

    act(() => {
      result.current.seedData({
        upcoming: [
          { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
        ],
      });
    });

    expect(result.current.data.upcoming.map((item) => item.id)).toEqual(["todo-open", "todo-complete"]);
  });

  it("applies updater mutations across every cached deadline month bucket", async () => {
    const fetchRange = vi.fn(async (start) => {
      if (start === "2026-04-01") {
        return {
          upcoming: [
            { id: "todo-move", title: "Move me", due_date: "2026-04-15", source: "todoist" },
          ],
        };
      }
      return { upcoming: [] };
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
        const existingIndex = updated.upcoming.findIndex((item) => item.id === "todo-move");
        const moved = {
          id: "todo-move",
          title: "Move me",
          due_date: "2026-05-05",
          source: "todoist",
        };
        if (existingIndex >= 0) updated.upcoming[existingIndex] = moved;
        else updated.upcoming.push(moved);
        return updated;
      });
    });

    expect(result.current.data.upcoming).toEqual([]);

    fetchRange.mockClear();
    await act(async () => {
      await result.current.ensureRange("2026-05-01", "2026-05-31");
    });

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(fetchRange).not.toHaveBeenCalledWith("2026-05-01", "2026-05-31");
    expect(fetchRange).toHaveBeenLastCalledWith("2026-06-01", "2026-06-30");
    expect(result.current.data.upcoming).toEqual([
      { id: "todo-move", title: "Move me", due_date: "2026-05-05", source: "todoist" },
    ]);
  });

  it("keeps deadline data identity stable when re-ensuring an unchanged cached range", async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      upcoming: [
        { id: "todo-may", title: "May task", due_date: "2026-05-12", source: "todoist" },
      ],
    });
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useCalendarDomainRange({
        fetchRange,
        emptyData: null,
        cacheMode: "month",
        prefetchMonthRadius: 0,
      });
    });

    await act(async () => {
      await result.current.ensureRange("2026-05-01", "2026-05-31");
    });
    const firstData = result.current.data;
    const firstRange = result.current.dataRange;
    const rendersAfterFirst = renders;

    let ensured;
    await act(async () => {
      ensured = await result.current.ensureRange("2026-05-01", "2026-05-31");
    });

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(ensured).toBe(firstData);
    expect(result.current.data).toBe(firstData);
    expect(result.current.dataRange).toBe(firstRange);
    expect(renders).toBe(rendersAfterFirst);
  });

  it("severs item identity between the published data and the month cache (mutation isolation)", async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      upcoming: [
        { id: "todo-may", title: "May task", due_date: "2026-05-12", source: "todoist" },
      ],
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

    // Mutate a property directly on the published item — this is exactly the
    // aliasing hazard clone() exists to prevent: if the combine loop handed
    // back a shared reference into the cache, this write would corrupt the
    // cached month entry too.
    result.current.data.upcoming[0].title = "MUTATED";

    // The month cache entry (the source of truth combine reads from) must be
    // untouched by the mutation above. Under a naive reference-sharing combine
    // (pushing the cached item by reference instead of copying it), this
    // would read back "MUTATED" too.
    const cached = result.current.getMonthData(2026, 4); // May is month index 4
    expect(cached.upcoming[0].title).toBe("May task");
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
        upcoming: [
          { id: "todo-may", title: "May task", due_date: "2026-05-05", source: "todoist" },
        ],
      });
      await mayPromise;
    });

    expect(result.current.data.upcoming.map((item) => item.id)).toEqual(["todo-may"]);
    expect(result.current.dataRange).toMatchObject({ start: "2026-05-01", end: "2026-05-31" });

    await act(async () => {
      resolveApril({
        upcoming: [
          { id: "todo-april", title: "April task", due_date: "2026-04-05", source: "todoist" },
        ],
      });
      await aprilPromise;
    });

    expect(result.current.data.upcoming.map((item) => item.id)).toEqual(["todo-may"]);
    expect(result.current.dataRange).toMatchObject({ start: "2026-05-01", end: "2026-05-31" });
  });

  it("computes a DST-safe due-this-week window via calendar-day math, not now+168h", async () => {
    // 2026-03-07 23:30 PST (the night before spring-forward). now + 7*86400000ms
    // lands at 2026-03-15 00:30 PDT, so a fixed-ms shift would wrongly include
    // 2026-03-15 (an 8-day window). Calendar-day math must exclude it.
    vi.setSystemTime(new Date("2026-03-08T07:30:00.000Z"));
    const fetchRange = vi.fn().mockResolvedValue({
      upcoming: [
        { id: "in", due_date: "2026-03-14", status: "incomplete", source: "todoist" },
        { id: "out", due_date: "2026-03-15", status: "incomplete", source: "todoist" },
      ],
    });
    const { result } = renderHook(() => useCalendarDomainRange({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 0,
    }));

    await act(async () => {
      await result.current.ensureRange("2026-03-01", "2026-03-31");
    });

    expect(result.current.data.stats.dueThisWeek).toBe(1);
  });
});
