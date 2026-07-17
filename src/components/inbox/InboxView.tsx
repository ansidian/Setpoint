import InboxDesktopPane from "./InboxDesktopPane";
import MobileInboxView from "./mobile/MobileInboxView";
import useInboxController from "./useInboxController";
import { useEffect, useMemo, useRef } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import useActiveSnapshot from "../../hooks/useActiveSnapshot";
import { settleArrivalGrace, settleArrivalGraceOnExit } from "../../api";
import { useInboxSessionStore } from "./useInboxSessionState";
import { getInboxTriageActivity } from "./inboxProcessingModel";
import type { InboxSessionState } from "./useInboxSessionState";
import type { InboxAccount, InboxEmailLike, InboxReadOverrides, InboxSelectionId } from "./inboxTypes";
import type { InboxActiveSnapshotLike, ResurfacedEntry } from "./inboxWorkItems";
import type { SnoozedEntry } from "./useInboxController";

export interface InboxActiveSnapshotController {
  snapshot: InboxActiveSnapshotLike | null;
  loading: boolean;
  error: string | null;
  refresh: () => unknown | Promise<unknown>;
  sync?: () => unknown | Promise<unknown>;
}

export interface InboxViewProps {
  accent: string;
  customize?: unknown;
  emailAccounts: InboxAccount[];
  briefingSummary?: ReactNode;
  briefingGeneratedAt?: string | null;
  liveEmails?: InboxEmailLike[];
  liveEmailsLoading?: boolean;
  activeSnapshot?: InboxActiveSnapshotController | null;
  liveReadOverrides?: InboxReadOverrides;
  onLiveReadOverrideChange?: (uid: string, read: boolean) => void;
  snoozedEntries?: SnoozedEntry[];
  resurfacedEntries?: Array<ResurfacedEntry & { uid: string }>;
  onOpenDashboard?: () => void;
  onOpenRecordedBill?: (target: { date: string; itemId: string }) => void;
  onRefresh?: () => unknown | Promise<unknown>;
  seedSelectedId?: InboxSelectionId;
  sessionState?: Partial<InboxSessionState>;
  onSessionStateChange?: Dispatch<SetStateAction<InboxSessionState>>;
  commitPendingUndoSignal?: unknown;
  isMobile?: boolean;
  onAskAlfred?: (query: string) => void;
}

const EMPTY_ACTIVE_SNAPSHOT_VIEW: InboxActiveSnapshotLike & { laneCounts: Record<string, number> } = {
  snapshot: { id: "loading" },
  readOnly: false,
  filters: { accounts: [], categories: [] },
  carryover: [],
  lanes: { queued: [], needs_attention: [], catch_up: [], fyi: [], handled: [], untriaged_read: [], noise: [] },
  laneCounts: { queued: 0, needs_attention: 0, catch_up: 0, fyi: 0, handled: 0, untriaged_read: 0, noise: 0, carryover: 0 },
  processing: { total: 0, active: false },
};

export default function InboxView({
  accent,
  emailAccounts,
  briefingSummary,
  briefingGeneratedAt,
  liveEmails = [],
  liveEmailsLoading = false,
  activeSnapshot: controlledActiveSnapshot = null,
  liveReadOverrides = {},
  onLiveReadOverrideChange,
  snoozedEntries = [],
  resurfacedEntries = [],
  onOpenDashboard = () => {},
  onOpenRecordedBill,
  onRefresh = () => {},
  seedSelectedId,
  sessionState,
  onSessionStateChange,
  commitPendingUndoSignal,
  isMobile = false,
  onAskAlfred,
}: InboxViewProps) {
  const [storeSessionState, setStoreSessionState] = useInboxSessionStore();
  const resolvedSessionState = sessionState || storeSessionState;
  const setResolvedSessionState = onSessionStateChange || setStoreSessionState;

  useEffect(() => {
    if (!seedSelectedId) return;
    setResolvedSessionState((prev) => ({
      ...(prev || {}),
      accountId: prev?.accountId || "__all",
      lane: prev?.lane || "__all",
      search: prev?.search || "",
      selectedId: seedSelectedId,
    }));
  }, [seedSelectedId, setResolvedSessionState]);

  const normalizedSessionState = useMemo(() => ({
    accountId: resolvedSessionState?.accountId || "__all",
    lane: resolvedSessionState?.lane || "__all",
    search: resolvedSessionState?.search || "",
    selectedId: resolvedSessionState?.selectedId || null,
  }), [resolvedSessionState]);

  const localActiveSnapshot = useActiveSnapshot({ disabled: !!controlledActiveSnapshot });
  const activeSnapshot = controlledActiveSnapshot || localActiveSnapshot;
  const snapshotInboxMode = !!controlledActiveSnapshot || !!activeSnapshot.snapshot?.snapshot;
  const activeSnapshotView = activeSnapshot.snapshot || (snapshotInboxMode ? EMPTY_ACTIVE_SNAPSHOT_VIEW : null);
  const readOnly = !!activeSnapshotView?.readOnly;
  const shouldSettleArrivalGraceRef = useRef(false);
  const refreshAfterArrivalGraceSettleRef = useRef<InboxActiveSnapshotController["refresh"] | null>(null);
  useEffect(() => {
    shouldSettleArrivalGraceRef.current = snapshotInboxMode && !readOnly;
    refreshAfterArrivalGraceSettleRef.current = snapshotInboxMode && !readOnly
      ? controlledActiveSnapshot?.refresh || null
      : null;
  }, [controlledActiveSnapshot?.refresh, snapshotInboxMode, readOnly]);

  useEffect(() => {
    const settleOnPageExit = () => {
      if (!shouldSettleArrivalGraceRef.current) return;
      settleArrivalGraceOnExit();
    };
    window.addEventListener("pagehide", settleOnPageExit);
    window.addEventListener("beforeunload", settleOnPageExit);
    return () => {
      window.removeEventListener("pagehide", settleOnPageExit);
      window.removeEventListener("beforeunload", settleOnPageExit);
      if (!shouldSettleArrivalGraceRef.current) return;
      settleArrivalGrace()
        .then(() => refreshAfterArrivalGraceSettleRef.current?.())
        .catch(() => {});
    };
  }, []);
  const snapshotAccounts = useMemo(() => (
    activeSnapshotView?.filters?.accounts || []
  ).map((account) => ({
    id: account.account_id,
    account_id: account.account_id,
    name: account.label || account.email || account.account_id || "Inbox",
    email: account.email || "",
    color: account.color || accent,
    icon: account.icon || "Mail",
    unread: account.count || 0,
    important: [],
    noise: [],
  })), [accent, activeSnapshotView?.filters?.accounts]);

  const displayedAccounts = snapshotInboxMode ? snapshotAccounts : emailAccounts;
  const triageActivity = useMemo(() => getInboxTriageActivity(
    activeSnapshotView?.processing,
    { loading: activeSnapshot.loading },
  ), [activeSnapshot.loading, activeSnapshotView?.processing]);
  const processingCount = triageActivity.processingCount;

  const handleRefresh = async () => {
    if (readOnly) return;
    await onRefresh?.();
    if (!controlledActiveSnapshot) await (activeSnapshot.sync?.() || activeSnapshot.refresh());
  };

  const controller = useInboxController({
    emailAccounts: displayedAccounts,
    activeSnapshot: activeSnapshotView,
    liveEmails: snapshotInboxMode ? [] : liveEmails,
    liveReadOverrides,
    onLiveReadOverrideChange,
    snoozedEntries,
    resurfacedEntries,
    isMobile,
    sessionState: normalizedSessionState,
    onSessionStateChange: setResolvedSessionState,
    commitPendingUndoSignal,
    onActiveSnapshotRefresh: activeSnapshot.refresh,
    readOnly,
    onAskAlfred,
  });

  const sharedProps = {
    accent,
    briefingSummary,
    briefingGeneratedAt: activeSnapshotView?.snapshot?.updated_at || briefingGeneratedAt,
    emailAccounts: displayedAccounts,
    liveEmailsLoading: snapshotInboxMode
      ? triageActivity.syncing
      : liveEmailsLoading || triageActivity.syncing,
    processingCount,
    activeSnapshotError: activeSnapshot.error,
    onOpenDashboard,
    onOpenRecordedBill,
    onRefresh: handleRefresh,
    readOnly,
    ...controller,
  };

  if (isMobile) return <MobileInboxView {...sharedProps} />;
  return <InboxDesktopPane {...sharedProps} />;
}
