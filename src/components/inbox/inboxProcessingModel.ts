import type { SnapshotProcessingState } from "../../../shared/types/snapshots";

type JobCountsLike = Partial<SnapshotProcessingState["email_triage"]>;
type InboxProcessingLike = Omit<Partial<SnapshotProcessingState>, "email_triage" | "gmail_history_sync"> & {
  running?: number;
  email_triage?: JobCountsLike;
  gmail_history_sync?: JobCountsLike;
};

function count(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function getInboxTriageActivity(
  processing: InboxProcessingLike = {},
  { loading = false }: { loading?: boolean } = {},
) {
  const emailRunning = count(processing.email_triage?.running ?? processing.running);
  const historySync = processing.gmail_history_sync || {};
  const historyActive = !!historySync.active
    || count(historySync.running) > 0
    || count(historySync.pending) > 0
    || count(historySync.queued) > 0;

  return {
    processingCount: emailRunning,
    syncing: !!loading || emailRunning > 0 || historyActive,
  };
}
