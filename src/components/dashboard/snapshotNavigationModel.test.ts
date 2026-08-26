import { describe, expect, it } from "vitest";
import type { SnapshotHistoryEntry } from "../../../shared/types/snapshots";
import { resolveAdjacentSnapshot } from "./snapshotNavigationModel";

function snapshot(id: number): SnapshotHistoryEntry {
  return { id } as SnapshotHistoryEntry;
}

describe("resolveAdjacentSnapshot", () => {
  const history = [snapshot(30), snapshot(20), snapshot(10)];

  it("moves through newest-first history in chronological directions", () => {
    expect(resolveAdjacentSnapshot(history, 30, "older")?.id).toBe(20);
    expect(resolveAdjacentSnapshot(history, 20, "older")?.id).toBe(10);
    expect(resolveAdjacentSnapshot(history, 20, "newer")?.id).toBe(30);
  });

  it("returns no target at either history boundary", () => {
    expect(resolveAdjacentSnapshot(history, 30, "newer")).toBeNull();
    expect(resolveAdjacentSnapshot(history, 10, "older")).toBeNull();
  });

  it("returns no target when the current snapshot is absent", () => {
    expect(resolveAdjacentSnapshot(history, 999, "older")).toBeNull();
    expect(resolveAdjacentSnapshot(history, null, "newer")).toBeNull();
  });
});
