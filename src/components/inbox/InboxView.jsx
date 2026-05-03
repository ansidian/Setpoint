import InboxDesktopPane from "./InboxDesktopPane";
import MobileInboxView from "./mobile/MobileInboxView";
import useInboxController from "./useInboxController";
import { useEffect, useMemo, useState } from "react";
import useActiveSnapshot from "../../hooks/useActiveSnapshot";

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
  pinnedIds,
  pinnedSnapshots = [],
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
  const snapshotAccounts = useMemo(() => (
    activeSnapshot.snapshot?.filters?.accounts || []
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
  })), [accent, activeSnapshot.snapshot?.filters?.accounts]);

  const hasActiveSnapshot = !!activeSnapshot.snapshot?.snapshot;
  const displayedAccounts = hasActiveSnapshot ? snapshotAccounts : emailAccounts;
  const processingCount = activeSnapshot.snapshot?.processing?.total || 0;

  const handleRefresh = async () => {
    await onRefresh?.();
    if (!controlledActiveSnapshot) await (activeSnapshot.sync?.() || activeSnapshot.refresh());
  };

  const controller = useInboxController({
    emailAccounts: displayedAccounts,
    activeSnapshot: activeSnapshot.snapshot,
    liveEmails: hasActiveSnapshot ? [] : liveEmails,
    liveReadOverrides,
    onLiveReadOverrideChange,
    pinnedIds,
    pinnedSnapshots,
    snoozedEntries,
    resurfacedEntries,
    customize,
    isMobile,
    briefingGeneratedAt: activeSnapshot.snapshot?.snapshot?.updated_at || briefingGeneratedAt,
    sessionState: normalizedSessionState,
    onSessionStateChange: setResolvedSessionState,
    onActiveSnapshotRefresh: activeSnapshot.refresh,
  });

  const sharedProps = {
    accent,
    briefingSummary,
    briefingGeneratedAt: activeSnapshot.snapshot?.snapshot?.updated_at || briefingGeneratedAt,
    emailAccounts: displayedAccounts,
    liveEmailsLoading: liveEmailsLoading || activeSnapshot.loading || !!processingCount,
    processingCount,
    activeSnapshotError: activeSnapshot.error,
    onOpenDashboard,
    onRefresh: handleRefresh,
    ...controller,
  };

  if (isMobile) return <MobileInboxView {...sharedProps} />;
  return <InboxDesktopPane {...sharedProps} />;
}
