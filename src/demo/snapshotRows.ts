import type { DemoSeed } from "./store.ts";

type DemoSnapshot = DemoSeed["activeSnapshot"];
type DemoSnapshotRow = DemoSnapshot["carryover"][number];

export function allSnapshotRows(snapshot: DemoSnapshot): DemoSnapshotRow[] {
  return [
    ...(snapshot.carryover || []),
    ...Object.values(snapshot.lanes || {}).flat(),
  ];
}

export function mutateSnapshotRows(snapshot: DemoSnapshot, uid: string, updater: (row: DemoSnapshotRow) => void): void {
  for (const row of allSnapshotRows(snapshot)) {
    if (String(row.uid || row.email_id) === String(uid)) updater(row);
  }
}

export function findSnapshotRow(snapshot: DemoSnapshot, uid: string): DemoSnapshotRow | null {
  return allSnapshotRows(snapshot).find((row) => String(row.uid || row.email_id) === String(uid)) || null;
}
