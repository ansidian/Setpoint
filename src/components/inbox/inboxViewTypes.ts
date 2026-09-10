import type { ReactNode } from "react";
import type { InboxControllerState } from "./useInboxController";
import type { InboxAccount } from "./inboxTypes";
import type { AlfredEmailContextSource } from "../../../shared/types/alfred";
import type { SnapshotRecord } from "../../../shared/types/snapshots";

export type InboxSnapshotNavigationDirection = "older" | "newer";
export type InboxReaderBeforeClose = (proceed: () => void) => boolean;

export interface InboxSnapshotNavigation {
  snapshot: SnapshotRecord | null;
  canOlder: boolean;
  canNewer: boolean;
  newerIsCurrent?: boolean;
  historyLoading: boolean;
  navigating: InboxSnapshotNavigationDirection | null;
  error: string | null;
  onReturnToCurrent?: () => void;
  onNavigate: (direction: InboxSnapshotNavigationDirection) => void | Promise<void>;
}

export type InboxPaneProps = InboxControllerState & {
  accent: string;
  mobileShellActions?: ReactNode;
  mobileScrollTopRequestId?: number;
  onMobileReaderBack?: () => void;
  onMobileReaderBeforeCloseChange?: (guard: InboxReaderBeforeClose | null) => void;
  mobileReaderBackLabel?: string;
  briefingSummary?: ReactNode;
  emailAccounts: InboxAccount[];
  liveEmailsLoading?: boolean;
  processingCount?: number;
  activeSnapshotError?: string | null;
  onRefresh: () => void | Promise<void>;
  readOnly?: boolean;
  snapshotNavigation?: InboxSnapshotNavigation | null;
  onAttachEmailToAlfred?: (source: AlfredEmailContextSource) => void;
};
