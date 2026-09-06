import { History } from "lucide-react";
import { formatSnapshotContext } from "./snapshotSummary";
import SnapshotNavigationControls from "./SnapshotNavigationControls";
import type { InboxSnapshotNavigation } from "./inboxViewTypes";

export default function DesktopSnapshotNavigator({ navigation }: {
  navigation: InboxSnapshotNavigation | null;
}) {
  if (!navigation) return null;
  return (
    <div className="inbox-a-history" data-testid="desktop-snapshot-navigator">
      <div className="inbox-a-history-actions" role="group" aria-label="Snapshot history">
        <History size={14} aria-hidden="true" />
        <SnapshotNavigationControls
          navigation={{ ...navigation, newerIsCurrent: false }}
          historical
          onNavigate={(direction) => { void navigation.onNavigate(direction); }}
        />
        {navigation.onReturnToCurrent && <button
          type="button"
          className="inbox-a-control"
          aria-label="Return to current snapshot"
          disabled={navigation.historyLoading || !!navigation.navigating}
          onClick={navigation.onReturnToCurrent}
        >Back to current</button>}
      </div>
      <p className="inbox-a-history-context">{formatSnapshotContext(navigation.snapshot)} · Read only</p>
    </div>
  );
}
