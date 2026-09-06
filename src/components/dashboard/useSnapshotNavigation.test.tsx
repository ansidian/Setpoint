import { useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSnapshotById, getSnapshotHistory } from "../../api";
import type { SnapshotHistoryEntry, SnapshotRecord, SnapshotView } from "../../../shared/types/snapshots";
import useSnapshotNavigation from "./useSnapshotNavigation";

// test-architecture: allow-boundary-mock -- Deferred authenticated snapshot HTTP responses exercise the real navigation owner's handling of late success/failure after Current is selected.
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
