export function allSnapshotRows(snapshot) {
  return [
    ...(snapshot.carryover || []),
    ...Object.values(snapshot.lanes || {}).flat(),
  ];
}

export function mutateSnapshotRows(snapshot, uid, updater) {
  for (const row of allSnapshotRows(snapshot)) {
    if (String(row.uid || row.email_id) === String(uid)) updater(row);
  }
}

export function findSnapshotRow(snapshot, uid) {
  return allSnapshotRows(snapshot).find((row) => String(row.uid || row.email_id) === String(uid)) || null;
}
