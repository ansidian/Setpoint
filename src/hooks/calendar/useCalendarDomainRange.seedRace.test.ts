import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useCalendarDomainRange from "./useCalendarDomainRange";
import type { CalendarDomainDataShape, CalendarDomainItem } from "./useCalendarDomainRange";

type ResolveDomainData = (value: CalendarDomainDataShape | null) => void;

describe("useCalendarDomainRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T16:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("seeds month buckets for immediate deadline paint and refreshes them as stale", async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      upcoming: [
        { id: "todo-fresh", title: "Fresh task", due_date: "2026-05-12", source: "todoist" },
      ],
    });
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({
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

    expect(result.current.data!.upcoming!.map((item) => item.id)).toEqual(["todo-seeded"]);

    let ensured!: CalendarDomainDataShape | null;
    await act(async () => {
      ensured = await result.current.ensureRange("2026-05-01", "2026-05-31");
    });

    expect(ensured!.upcoming!.map((item) => item.id)).toEqual(["todo-seeded"]);
    expect(result.current.data!.upcoming!.map((item) => item.id)).toEqual(["todo-fresh"]);
    expect(fetchRange).toHaveBeenCalledWith("2026-05-01", "2026-05-31");
  });

  it("publishes the refreshed active month after a stale first-paint seed", async () => {
    let resolveRange!: ResolveDomainData;
    const fetchRange = vi.fn(() => new Promise<CalendarDomainDataShape | null>((resolve) => {
      resolveRange = resolve;
    }));
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({
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

    let ensured!: CalendarDomainDataShape | null;
    await act(async () => {
      ensured = await result.current.ensureRange("2026-05-01", "2026-05-31");
    });

    expect(ensured!.upcoming!.map((item) => item.id)).toEqual(["todo-open"]);
    expect(result.current.data!.upcoming!.map((item) => item.id)).toEqual(["todo-open"]);
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

    expect(result.current.data!.upcoming!.map((item) => item.id)).toEqual(["todo-open", "todo-complete"]);
  });

  it("refreshes stale seeded months even when adjacent visible months are missing", async () => {
    let resolveMay!: ResolveDomainData;
    const fetchRange = vi.fn((start: string) => {
      if (start === "2026-05-01") {
        return new Promise<CalendarDomainDataShape | null>((resolve) => {
          resolveMay = resolve;
        });
      }
      return Promise.resolve({ upcoming: [] });
    });
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({
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
    expect(result.current.data!.upcoming!.map((item) => item.id)).toEqual(["todo-open"]);

    await act(async () => {
      resolveMay({
        upcoming: [
          { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
          { id: "todo-complete", title: "Completed task", due_date: "2026-05-12", source: "todoist", status: "complete" },
        ],
      });
      await Promise.resolve();
    });

    expect(result.current.data!.upcoming!.map((item) => item.id)).toEqual(["todo-open", "todo-complete"]);
  });

  it("does not let stale live deadline seeds replace an existing range month", async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      upcoming: [
        { id: "todo-open", title: "Open task", due_date: "2026-05-12", source: "todoist" },
        { id: "todo-complete", title: "Completed task", due_date: "2026-05-12", source: "todoist", status: "complete" },
      ],
    });
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 0,
    }));

    await act(async () => {
      await result.current.ensureRange("2026-05-01", "2026-05-31");
    });

    expect(result.current.data!.upcoming!.map((item) => item.id)).toEqual(["todo-open", "todo-complete"]);

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

    expect(result.current.data!.upcoming!.map((item) => item.id)).toEqual(["todo-open", "todo-complete"]);
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
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({
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
        const existingIndex = updated.upcoming.findIndex((item: CalendarDomainItem) => item.id === "todo-move");
        const moved = {
          id: "todo-move",
          title: "Move me",
          due_date: "2026-05-05",
          source: "todoist",
        };
        if (existingIndex >= 0) updated.upcoming![existingIndex] = moved;
        else updated.upcoming.push(moved);
        return updated;
      });
    });

    expect(result.current.data!.upcoming).toEqual([]);

    fetchRange.mockClear();
    await act(async () => {
      await result.current.ensureRange("2026-05-01", "2026-05-31");
    });

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(fetchRange).not.toHaveBeenCalledWith("2026-05-01", "2026-05-31");
    expect(fetchRange).toHaveBeenLastCalledWith("2026-06-01", "2026-06-30");
    expect(result.current.data!.upcoming).toEqual([
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
      return useCalendarDomainRange<CalendarDomainDataShape | null>({
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
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({
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
    result.current.data!.upcoming![0]!.title = "MUTATED";

    // The month cache entry (the source of truth combine reads from) must be
    // untouched by the mutation above. Under a naive reference-sharing combine
    // (pushing the cached item by reference instead of copying it), this
    // would read back "MUTATED" too.
    const cached = result.current.getMonthData(2026, 4); // May is month index 4
    expect(cached!.upcoming![0]!.title).toBe("May task");
  });

  it("does not publish a stale month-range response after a newer active range wins", async () => {
    let resolveApril!: ResolveDomainData;
    let resolveMay!: ResolveDomainData;
    const fetchRange = vi.fn((start: string) => new Promise<CalendarDomainDataShape | null>((resolve) => {
      if (start === "2026-04-01") resolveApril = resolve;
      if (start === "2026-05-01") resolveMay = resolve;
    }));
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
    }));

    let aprilPromise!: Promise<CalendarDomainDataShape | null>;
    await act(async () => {
      aprilPromise = result.current.ensureRange("2026-04-01", "2026-04-30");
    });
    let mayPromise!: Promise<CalendarDomainDataShape | null>;
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

    expect(result.current.data!.upcoming!.map((item) => item.id)).toEqual(["todo-may"]);
    expect(result.current.dataRange).toMatchObject({ start: "2026-05-01", end: "2026-05-31" });

    await act(async () => {
      resolveApril({
        upcoming: [
          { id: "todo-april", title: "April task", due_date: "2026-04-05", source: "todoist" },
        ],
      });
      await aprilPromise;
    });

    expect(result.current.data!.upcoming!.map((item) => item.id)).toEqual(["todo-may"]);
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
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 0,
    }));

    await act(async () => {
      await result.current.ensureRange("2026-03-01", "2026-03-31");
    });

    expect(result.current.data!.stats!.dueThisWeek).toBe(1);
  });
});
