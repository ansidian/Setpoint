import type { SnapshotHistoryEntry } from "../../../shared/types/snapshots";

export type SnapshotNavigationDirection = "older" | "newer";

export function resolveAdjacentSnapshot(
  history: SnapshotHistoryEntry[],
  currentId: number | null,
  direction: SnapshotNavigationDirection,
): SnapshotHistoryEntry | null {
  if (currentId == null) return null;
  const currentIndex = history.findIndex((snapshot) => snapshot.id === currentId);
  if (currentIndex < 0) return null;
  const targetIndex = direction === "older" ? currentIndex + 1 : currentIndex - 1;
  return history[targetIndex] || null;
}
