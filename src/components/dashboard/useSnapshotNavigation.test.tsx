import { useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSnapshotById, getSnapshotHistory } from "../../api";
import type { SnapshotHistoryEntry, SnapshotRecord, SnapshotView } from "../../../shared/types/snapshots";
import useSnapshotNavigation from "./useSnapshotNavigation";

// test-architecture: allow-boundary-mock -- this hook's contract is choosing the adjacent authenticated snapshot HTTP boundary and restoring the active controller without a detail request.
vi.mock("../../api", () => ({
  getSnapshotById: vi.fn(),
  getSnapshotHistory: vi.fn(),
}));

function record(id: number, status: "active" | "frozen"): SnapshotRecord {
  return {
    id,
    snapshot_item_id: id,
    status,
    start_at: "2026-08-26T07:00:00.000Z",
    end_at: "2026-08-26T19:00:00.000Z",
    timezone: "America/Los_Angeles",
  };
}

function historyEntry(id: number, status: "active" | "frozen"): SnapshotHistoryEntry {
  return {
    ...record(id, status),
    readOnly: status === "frozen",
    laneCounts: {} as SnapshotHistoryEntry["laneCounts"],
    item_count: 0,
  };
}

describe("useSnapshotNavigation", () => {
  beforeEach(() => {
    vi.mocked(getSnapshotHistory).mockReset().mockResolvedValue({
      snapshots: [historyEntry(30, "active"), historyEntry(20, "frozen"), historyEntry(10, "frozen")],
    });
    vi.mocked(getSnapshotById).mockReset();
  });

  it("loads the adjacent frozen snapshot when moving older", async () => {
    const frozenView = { snapshot: record(20, "frozen"), readOnly: true } as SnapshotView;
    vi.mocked(getSnapshotById).mockResolvedValue(frozenView);
    const onSelectSnapshot = vi.fn();
    const { result } = renderHook(() => useSnapshotNavigation({
      enabled: true,
      activeSnapshotId: 30,
      currentSnapshot: record(30, "active"),
      onSelectSnapshot,
    }));

    await waitFor(() => expect(result.current.canOlder).toBe(true));
    await act(async () => result.current.onNavigate("older"));

    // test-architecture: allow-boundary-interaction -- frozen snapshot detail is an authenticated HTTP boundary; its exact adjacent ID is not observable until the mocked response returns.
    expect(getSnapshotById).toHaveBeenCalledWith(20);
    // test-architecture: allow-boundary-interaction -- selection is the hook's outward owner-state boundary; the hook cannot render the dashboard shell's resulting historical view itself.
    expect(onSelectSnapshot).toHaveBeenCalledWith(frozenView, { readOnly: true });
  });

  it("restores the active snapshot without fetching detail when moving newer", async () => {
    const onSelectSnapshot = vi.fn();
    const { result } = renderHook(() => useSnapshotNavigation({
      enabled: true,
      activeSnapshotId: 30,
      currentSnapshot: record(20, "frozen"),
      onSelectSnapshot,
    }));

    await waitFor(() => expect(result.current.canNewer).toBe(true));
    expect(result.current.newerIsCurrent).toBe(true);
    await act(async () => result.current.onNavigate("newer"));

    // test-architecture: allow-boundary-interaction -- returning to active must avoid the authenticated detail HTTP boundary because the live controller already owns that view.
    expect(getSnapshotById).not.toHaveBeenCalled();
    // test-architecture: allow-boundary-interaction -- selection is the hook's outward owner-state boundary; only the dashboard shell can render the restored active controller.
    expect(onSelectSnapshot).toHaveBeenCalledWith(null, { readOnly: false });
  });

  it("distinguishes an intermediate newer snapshot from the active snapshot", async () => {
    const { result } = renderHook(() => useSnapshotNavigation({
      enabled: true,
      activeSnapshotId: 30,
      currentSnapshot: record(10, "frozen"),
      onSelectSnapshot: vi.fn(),
    }));

    await waitFor(() => expect(result.current.canNewer).toBe(true));
    expect(result.current.newerIsCurrent).toBe(false);
  });

  // Current must supersede an in-flight historical HTTP response. The demo has
  // no historical records; assert the resulting owner state rather than wiring.
  it.each(["resolve", "reject"] as const)("keeps Current selected after a superseded load %s", async (outcome) => {
    let resolveLoad!: (view: SnapshotView) => void;
    let rejectLoad!: (error: Error) => void;
    vi.mocked(getSnapshotById).mockReturnValue(new Promise<SnapshotView>((resolve, reject) => {
      resolveLoad = resolve;
      rejectLoad = reject;
    }));
    const active = record(30, "active");
    const { result } = renderHook(() => {
      const [selected, setSelected] = useState<SnapshotView | null>(null);
      const navigation = useSnapshotNavigation({
        enabled: true,
        activeSnapshotId: active.id,
        currentSnapshot: selected?.snapshot || active,
        onSelectSnapshot: setSelected,
      });
      return { ...navigation, selected };
    });
    await waitFor(() => expect(result.current.canOlder).toBe(true));
    let pending!: Promise<void>;
    act(() => { pending = result.current.onNavigate("older"); });
    expect(result.current.navigating).toBe("older");
    act(() => result.current.onReturnToCurrent());
    await act(async () => {
      if (outcome === "resolve") resolveLoad({ snapshot: record(20, "frozen"), readOnly: true } as SnapshotView);
      else rejectLoad(new Error("Delayed historical failure"));
      await pending;
    });
    expect(result.current.selected).toBeNull();
    expect(result.current.snapshot?.id).toBe(30);
    expect(result.current.navigating).toBeNull();
    expect(result.current.error).toBeNull();
  });

});
