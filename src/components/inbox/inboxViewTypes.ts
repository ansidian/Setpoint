import type { ReactNode } from "react";
import type { InboxControllerState } from "./useInboxController";
import type { InboxAccount } from "./inboxTypes";
import type { AlfredEmailContextSource } from "../../../shared/types/alfred";

export type InboxPaneProps = InboxControllerState & {
  accent: string;
  briefingSummary?: ReactNode;
  briefingGeneratedAt?: string | null;
  emailAccounts: InboxAccount[];
  liveEmailsLoading?: boolean;
  processingCount?: number;
  activeSnapshotError?: string | null;
  onOpenDashboard: () => void;
  onOpenRecordedBill?: (target: { date: string; itemId: string }) => void;
  onRefresh: () => void | Promise<void>;
  readOnly?: boolean;
  onAttachEmailToAlfred?: (source: AlfredEmailContextSource) => void;
};
