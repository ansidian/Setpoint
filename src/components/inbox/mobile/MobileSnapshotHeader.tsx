import { formatSnapshotContext } from "../snapshotSummary";
import type { InboxSnapshotNavigation } from "../inboxViewTypes";

export default function MobileSnapshotHeader({ readOnly, snapshotNavigation }: {
  readOnly: boolean;
  snapshotNavigation: InboxSnapshotNavigation | null;
}) {
  if (!readOnly) return null;
  const context = formatSnapshotContext(snapshotNavigation?.snapshot || null);
  return (
    <div className="mobile-inbox-history" data-testid="mobile-snapshot-context">
      <span>{context || "Historical snapshot"}<small>Read only</small></span>
      {snapshotNavigation?.onReturnToCurrent && (
        <button type="button" className="mobile-inbox-control" onClick={snapshotNavigation.onReturnToCurrent}>Current</button>
      )}
    </div>
  );
}
