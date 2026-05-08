import InboxDesktopPane from "./InboxDesktopPane";
import MobileInboxView from "./mobile/MobileInboxView";
import useInboxController from "./useInboxController";
import { useEffect, useMemo, useRef, useState } from "react";
import useActiveSnapshot from "../../hooks/useActiveSnapshot";
import { settleArrivalGrace, settleArrivalGraceOnExit } from "../../api";

const EMPTY_ACTIVE_SNAPSHOT_VIEW = {
  snapshot: { id: "loading" },
  filters: { accounts: [], categories: [] },
  carryover: [],
  lanes: { queued: [], needs_attention: [], catch_up: [], fyi: [], handled: [], untriaged_read: [], noise: [] },
  laneCounts: { queued: 0, needs_attention: 0, catch_up: 0, fyi: 0, handled: 0, untriaged_read: 0, noise: 0, carryover: 0 },
  processing: { total: 0, active: false },
};

export default function InboxView({
  accent,
  customize,
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
  onOpenDashboard,
  onRefresh,
  seedSelectedId,
  sessionState,
  onSessionStateChange,
  isMobile = false,
}) {
  const [localSessionState, setLocalSessionState] = useState(() => ({
    accountId: "__all",
    lane: "__all",
    search: "",
    selectedId: seedSelectedId || null,
  }));
  const resolvedSessionState = sessionState || localSessionState;
  const setResolvedSessionState = onSessionStateChange || setLocalSessionState;

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
  useEffect(() => {
    shouldSettleArrivalGraceRef.current = snapshotInboxMode && !readOnly;
  }, [snapshotInboxMode, readOnly]);

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
      settleArrivalGrace().catch(() => {});
    };
  }, []);
  const snapshotAccounts = useMemo(() => (
    activeSnapshotView?.filters?.accounts || []
  ).map((account) => ({
    id: account.account_id,
    account_id: account.account_id,
    name: account.label || account.email || account.account_id,
    email: account.email || "",
    color: account.color || accent,
    icon: account.icon || "Mail",
    unread: account.count || 0,
    important: [],
    noise: [],
  })), [accent, activeSnapshotView?.filters?.accounts]);

  const displayedAccounts = snapshotInboxMode ? snapshotAccounts : emailAccounts;
  const processingCount = activeSnapshotView?.processing?.total || 0;

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
    customize,
    isMobile,
    briefingGeneratedAt: activeSnapshotView?.snapshot?.updated_at || briefingGeneratedAt,
    sessionState: normalizedSessionState,
    onSessionStateChange: setResolvedSessionState,
    onActiveSnapshotRefresh: activeSnapshot.refresh,
    readOnly,
  });

  const sharedProps = {
    accent,
    briefingSummary,
    briefingGeneratedAt: activeSnapshotView?.snapshot?.updated_at || briefingGeneratedAt,
    emailAccounts: displayedAccounts,
    liveEmailsLoading: snapshotInboxMode
      ? activeSnapshot.loading || !!processingCount
      : liveEmailsLoading || activeSnapshot.loading || !!processingCount,
    processingCount,
    activeSnapshotError: activeSnapshot.error,
    onOpenDashboard,
    onRefresh: handleRefresh,
    readOnly,
    ...controller,
  };

  if (isMobile) return <MobileInboxView {...sharedProps} />;
  return <InboxDesktopPane {...sharedProps} />;
}
