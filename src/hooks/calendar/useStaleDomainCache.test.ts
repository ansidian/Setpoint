import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useStaleDomainCache from "./useStaleDomainCache";

describe("useStaleDomainCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T16:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("loads domain data once and reuses the fresh cache within the ttl", async () => {
    const fetchDomain = vi.fn().mockResolvedValue({ upcoming: [{ id: "todo-1" }] });
    const { result } = renderHook(() => useStaleDomainCache({ fetchDomain }));

    expect(result.current.data).toBeUndefined();

    await act(async () => {
      result.current.load();
    });
    expect(fetchDomain).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual({ upcoming: [{ id: "todo-1" }] });

    await act(async () => {
      result.current.load();
    });
    expect(fetchDomain).toHaveBeenCalledTimes(1);
  });

  it("refetches when forced or when the ttl has expired", async () => {
    const fetchDomain = vi
      .fn()
      .mockResolvedValueOnce({ value: "first" })
      .mockResolvedValueOnce({ value: "second" })
      .mockResolvedValueOnce({ value: "third" });
    const { result } = renderHook(() => useStaleDomainCache({ fetchDomain }));

    await act(async () => {
      result.current.load();
    });
    await act(async () => {
      result.current.load({ force: true });
    });
    expect(fetchDomain).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({ value: "second" });

    vi.setSystemTime(new Date("2026-05-02T16:31:00.000Z"));
    await act(async () => {
      result.current.load();
    });
    expect(fetchDomain).toHaveBeenCalledTimes(3);
    expect(result.current.data).toEqual({ value: "third" });
  });

  it("exposes loading while a fetch is in flight and skips duplicate loads", async () => {
    let resolveFetch!: (value: { value: string }) => void;
    const fetchDomain = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const { result } = renderHook(() => useStaleDomainCache({ fetchDomain }));

    act(() => {
      result.current.load();
      result.current.load();
    });
    expect(fetchDomain).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveFetch({ value: "loaded" });
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({ value: "loaded" });
  });

  it("flags errors, keeps the last data, and clears the flag on the next load", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchDomain = vi
      .fn()
      .mockResolvedValueOnce({ value: "first" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ value: "recovered" });
    const { result } = renderHook(() => useStaleDomainCache({ fetchDomain }));

    await act(async () => {
      result.current.load();
    });
    await act(async () => {
      result.current.load({ force: true });
    });
    expect(result.current.error).toBe(true);
    expect(result.current.data).toEqual({ value: "first" });

    await act(async () => {
      result.current.load({ force: true });
    });
    expect(result.current.error).toBe(false);
    expect(result.current.data).toEqual({ value: "recovered" });
    consoleError.mockRestore();
  });

  it("applies synchronous snapshots immediately and forwards load options to fetchDomain", () => {
    const fetchDomain = vi.fn((opts) => ({ schedules: [], refreshLive: !!opts?.refreshLive }));
    const { result } = renderHook(() => useStaleDomainCache({ fetchDomain, initialData: null }));

    expect(result.current.data).toBeNull();

    act(() => {
      result.current.load({ refreshLive: true });
    });
    expect(fetchDomain).toHaveBeenCalledWith({ refreshLive: true });
    expect(result.current.data).toEqual({ schedules: [], refreshLive: true });
    expect(result.current.loading).toBe(false);

    // fresh cache: a plain reload is a no-op until forced
    act(() => {
      result.current.load();
    });
    expect(fetchDomain).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.load({ force: true });
    });
    expect(fetchDomain).toHaveBeenCalledTimes(2);
  });

  it("applies update() to the domain snapshot and the range cache together", async () => {
    type TaskData = { upcoming: Array<{ id: string; title: string; status: string; due_date: string }> };
    const task = { id: "todo-1", title: "Open", status: "incomplete", due_date: "2026-05-04" };
    const fetchDomain = vi.fn().mockResolvedValue({ upcoming: [task] });
    const fetchRange = vi.fn().mockResolvedValue({ upcoming: [task] });
    const { result } = renderHook(() => useStaleDomainCache({
      fetchDomain,
      fetchRange,
      emptyData: null,
    }));

    await act(async () => {
      result.current.load();
      await result.current.range.ensureRange("2026-05-01", "2026-05-31");
    });

    const complete = (current: TaskData | null | undefined): TaskData | null | undefined => current && ({
      ...current,
      upcoming: current.upcoming.map((item: TaskData["upcoming"][number]) => (
        item.id === "todo-1" ? { ...item, status: "complete" } : item
      )),
    });
    act(() => {
      result.current.update(complete);
    });

    expect(result.current.data!.upcoming[0]!.status).toBe("complete");
    expect(result.current.range.data!.upcoming[0]!.status).toBe("complete");
  });

  it("seeds the range cache once per seed identity", () => {
    const fetchRange = vi.fn();
    const firstSeed = { upcoming: [{ id: "todo-1", due_date: "2026-05-04" }] };
    type SeedData = typeof firstSeed;
    const { result, rerender } = renderHook(({ seed }: { seed: SeedData | null }) => useStaleDomainCache<SeedData | null>({
      fetchDomain: vi.fn(() => null),
      fetchRange,
      emptyData: null,
      cacheMode: "month",
      seed,
    }), { initialProps: { seed: null as SeedData | null } });

    expect(result.current.range.data).toBeNull();

    rerender({ seed: firstSeed });
    expect(result.current.range.data).toEqual(firstSeed);
    const revisionAfterSeed = result.current.range.revision;

    rerender({ seed: firstSeed });
    expect(result.current.range.revision).toBe(revisionAfterSeed);

    const secondSeed = { upcoming: [{ id: "todo-2", due_date: "2026-05-06" }] };
    rerender({ seed: secondSeed });
    expect(result.current.range.revision).toBe(revisionAfterSeed + 1);
  });
});
