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

  it("fetches exact visible ranges and reuses fresh memory cache entries", async () => {
    const fetchRange = vi.fn().mockResolvedValue({ value: "range-data" });
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({ fetchRange, emptyData: { value: "empty" } }));

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
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({ fetchRange, emptyData: { value: "empty" } }));

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
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({
      fetchRange,
      emptyData: null,
    }));

    await act(async () => {
      await result.current.ensureRange("2026-04-01", "2026-04-30");
    });

    act(() => {
      result.current.updateData((current) => current && ({
        ...current,
        upcoming: current.upcoming!.map((task: CalendarDomainItem) => (
          task.id === "todo-1" ? { ...task, status: "complete" } : task
        )),
      }));
    });

    expect(result.current.data!.upcoming![0]!.status).toBe("complete");

    await act(async () => {
      await result.current.ensureRange("2026-04-01", "2026-04-30");
    });

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(result.current.data!.upcoming![0]!.status).toBe("complete");
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
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({
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
    expect(result.current.data!.upcoming!.map((item) => item.due_date)).toEqual([
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
    expect(result.current.data!.upcoming!.map((item) => item.due_date)).toEqual([
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
        transactions: months.flatMap((month) => ([
          { id: `income-${month}`, date: `${month}-08`, amount: 5000, direction: "income", payee: "Employer" },
          { id: `expense-${month}`, date: `${month}-20`, amount: 42, direction: "expense", payee: "Market" },
        ])),
      };
    });
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({
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
    expect(result.current.data!.payeeMap).toEqual({ p1: "Narwhal" });
    expect(result.current.data!.schedules!.map((occurrence) => occurrence.next_date)).toEqual([
      "2026-04-15",
      "2026-05-15",
      "2026-06-15",
    ]);
    expect(result.current.data!.transactions!.map((transaction) => transaction.date)).toEqual([
      "2026-04-08",
      "2026-04-20",
      "2026-05-08",
      "2026-05-20",
      "2026-06-08",
      "2026-06-20",
    ]);

    // Scrolling forward reuses cached months; only the new trailing edge is fetched.
    fetchRange.mockClear();
    await act(async () => {
      await result.current.ensureRange("2026-05-01", "2026-07-31");
    });
    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(fetchRange).toHaveBeenCalledWith("2026-08-01", "2026-08-31");
    expect(result.current.data!.schedules!.map((occurrence) => occurrence.next_date)).toEqual([
      "2026-05-15",
      "2026-06-15",
      "2026-07-15",
    ]);
    expect(result.current.data!.transactions!.map((transaction) => transaction.date)).toEqual([
      "2026-05-08",
      "2026-05-20",
      "2026-06-08",
      "2026-06-20",
      "2026-07-08",
      "2026-07-20",
    ]);
  });

  it("dedupes concurrent month-bucket fetches", async () => {
    const resolvers: ResolveDomainData[] = [];
    const fetchRange = vi.fn(() => new Promise<CalendarDomainDataShape | null>((resolve) => {
      resolvers.push(resolve);
    }));
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({
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
    let resolveColdRange!: ResolveDomainData;
    const fetchRange = vi
      .fn()
      .mockResolvedValueOnce({
        upcoming: [
          { id: "todo-april", title: "April task", due_date: "2026-04-15", source: "todoist" },
        ],
      })
      .mockResolvedValueOnce({ upcoming: [] })
      .mockResolvedValueOnce({ upcoming: [] })
      .mockImplementationOnce(() => new Promise<CalendarDomainDataShape | null>((resolve) => {
        resolveColdRange = resolve;
      }));
    const { result } = renderHook(() => useCalendarDomainRange<CalendarDomainDataShape | null>({
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      prefetchMonthRadius: 1,
    }));

    await act(async () => {
      await result.current.ensureRange("2026-04-01", "2026-04-30");
    });
    expect(result.current.data!.upcoming!.map((item) => item.id)).toEqual(["todo-april"]);

    act(() => {
      result.current.ensureRange("2026-09-01", "2026-09-30").catch(() => {});
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.data!.upcoming!.map((item) => item.id)).toEqual(["todo-april"]);

    await act(async () => {
      resolveColdRange({
        upcoming: [
          { id: "todo-september", title: "September task", due_date: "2026-09-15", source: "todoist" },
        ],
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data!.upcoming!.map((item) => item.id)).toEqual(["todo-september"]);
  });
});
