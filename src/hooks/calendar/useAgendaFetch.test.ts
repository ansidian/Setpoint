import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgendaFetch } from "./useAgendaFetch";
import type { AgendaRangeController } from "./useAgendaFetch";

interface AgendaTestProps {
  topmostMonth: string | null;
  pendingTargetMonth?: string | null;
}

interface MockAgendaRange extends AgendaRangeController {
  ensureRange: Mock<(start: string, end: string) => Promise<void>>;
  hasMonth: Mock<(year: number, month: number) => boolean>;
  getMonthData: Mock<() => null>;
  data: null;
  loading: boolean;
  error: null;
  revision: number;
}

function mockDomainRange(): MockAgendaRange {
  return {
    ensureRange: vi.fn(() => Promise.resolve()),
    hasMonth: vi.fn(() => true),
    getMonthData: vi.fn(() => null),
    data: null,
    loading: false,
    error: null,
    revision: 0,
  };
}

describe("useAgendaFetch", () => {
  it("does not fetch when disabled", () => {
    const domainRange = mockDomainRange();

    const { result } = renderHook(() =>
      useAgendaFetch({
        topmostMonth: null,
        domainRange,
        deadlinesRange: null,
        todayKey: "2026-05-25",
        disabled: true,
      }),
    );

    expect(result.current).toMatchObject({ initialReady: false, loadedMonths: [] });
  });

  it("only records months the events cache actually has after a fetch resolves", async () => {
    const domainRange = mockDomainRange();
    // A pass that inherits an aborted shared fetch resolves without the
    // cache gaining its months; resolution alone is not proof of data.
    domainRange.hasMonth = vi.fn((year, month) => (
      `${year}-${String(month + 1).padStart(2, "0")}` !== "2026-06"
    ));

    const { result } = renderHook(() =>
      useAgendaFetch({
        topmostMonth: null,
        domainRange,
        deadlinesRange: null,
        todayKey: "2026-05-25",
        disabled: false,
      }),
    );

    await vi.waitFor(() => {
      expect(result.current.loadedMonths.length).toBeGreaterThan(0);
    });

    expect(result.current.loadedMonths).toContain("2026-05");
    expect(result.current.loadedMonths).not.toContain("2026-06");
  });

  it("still reports initial readiness when the initial fetch rejects", async () => {
    const domainRange = mockDomainRange();
    domainRange.ensureRange.mockRejectedValueOnce(new Error("transient"));

    const { result } = renderHook(() =>
      useAgendaFetch({
        topmostMonth: null,
        domainRange,
        deadlinesRange: null,
        todayKey: "2026-05-25",
        disabled: false,
      }),
    );

    // An empty rail that can retry beats an infinite skeleton.
    await vi.waitFor(() => {
      expect(result.current.initialReady).toBe(true);
    });
    expect(result.current.loadedMonths).toEqual([]);
  });

  it("keeps failed months out of the window and retries them on a later plan", async () => {
    const domainRange = mockDomainRange();
    const { result, rerender } = renderHook(
      ({ topmostMonth }: AgendaTestProps) =>
        useAgendaFetch({
          topmostMonth,
          domainRange,
          deadlinesRange: null,
          todayKey: "2026-05-25",
          disabled: false,
        }),
      { initialProps: { topmostMonth: null } as AgendaTestProps },
    );

    await vi.waitFor(() => {
      expect(result.current.loadedMonths.length).toBeGreaterThan(0);
    });
    const loadedAfterInitial = result.current.loadedMonths;

    let failedPlanSettled = false;
    domainRange.ensureRange.mockImplementationOnce(async () => {
      failedPlanSettled = true;
      throw new Error("transient");
    });
    rerender({ topmostMonth: "2026-06" });
    await vi.waitFor(() => {
      expect(failedPlanSettled).toBe(true);
    });
    expect(result.current.loadedMonths).toEqual(loadedAfterInitial);

    rerender({ topmostMonth: "2026-07" });
    await vi.waitFor(() => {
      expect(result.current.loadedMonths.length).toBeGreaterThan(loadedAfterInitial.length);
    });
  });

  it("prunes far months as topmost walks backward, keeping the window bounded", async () => {
    const domainRange = mockDomainRange();

    const { result, rerender } = renderHook(
      ({ topmostMonth }) =>
        useAgendaFetch({
          topmostMonth,
          domainRange,
          deadlinesRange: null,
          todayKey: "2026-05-25",
          disabled: false,
        }),
      { initialProps: { topmostMonth: null } as AgendaTestProps },
    );

    await vi.waitFor(() => {
      expect(result.current.loadedMonths.length).toBeGreaterThan(0);
    });
    expect(result.current.loadedMonths).toContain("2026-07");

    const walk = ["2026-04", "2026-02", "2025-12", "2025-10", "2025-08"];
    for (const topmostMonth of walk) {
      rerender({ topmostMonth });
      await vi.waitFor(() => {
        expect(result.current.loadedMonths).toContain(topmostMonth);
      });
    }

    const loaded = result.current.loadedMonths;
    expect(loaded.length).toBeLessThanOrEqual(11);
    expect(loaded).toContain("2025-08");
    expect(loaded).not.toContain("2026-07");
    expect(loaded).not.toContain("2026-06");
    expect(loaded).toEqual([...loaded].sort());
  });

  describe("pendingTargetMonth", () => {
    it("ignores stale edge-prefetch results that resolve after a reset", async () => {
      const domainRange = mockDomainRange();
      let releaseSlowFetch!: () => void;
      domainRange.ensureRange
        .mockImplementationOnce(() => Promise.resolve())
        .mockImplementationOnce(() => new Promise((resolve) => { releaseSlowFetch = resolve; }))
        .mockImplementation(() => Promise.resolve());

      const { result, rerender } = renderHook(
        ({ topmostMonth, pendingTargetMonth }: AgendaTestProps) =>
          useAgendaFetch({
            topmostMonth,
            pendingTargetMonth,
            domainRange,
            deadlinesRange: null,
            todayKey: "2026-05-25",
            disabled: false,
          }),
        { initialProps: { topmostMonth: null, pendingTargetMonth: null } as AgendaTestProps },
      );

      await vi.waitFor(() => {
        expect(result.current.loadedMonths.length).toBeGreaterThan(0);
      });

      // Slow edge prefetch starts (second ensureRange call hangs)...
      rerender({ topmostMonth: "2026-07", pendingTargetMonth: null });
      await vi.waitFor(() => {
        expect(releaseSlowFetch).toBeDefined();
      });

      // ...then a far jump resets the window before the prefetch resolves.
      rerender({ topmostMonth: "2026-07", pendingTargetMonth: "2027-03" });
      await vi.waitFor(() => {
        expect(result.current.loadedMonths).toEqual(["2027-02", "2027-03", "2027-04"]);
      });

      await act(async () => {
        releaseSlowFetch();
        await Promise.resolve();
      });
      expect(result.current.loadedMonths).toEqual(["2027-02", "2027-03", "2027-04"]);
    });
  });
});
