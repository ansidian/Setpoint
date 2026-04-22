import InboxDesktopPane from "./InboxDesktopPane";
import MobileInboxView from "./mobile/MobileInboxView";
import useInboxController from "./useInboxController";
import { useEffect, useMemo, useState } from "react";

export default function InboxView({
  accent,
  customize,
  emailAccounts,
  briefingSummary,
  briefingGeneratedAt,
  liveEmails = [],
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

  const controller = useInboxController({
    emailAccounts,
    liveEmails,
    liveReadOverrides,
    onLiveReadOverrideChange,
    pinnedIds,
    pinnedSnapshots,
    snoozedEntries,
    resurfacedEntries,
    customize,
    isMobile,
    briefingGeneratedAt,
    sessionState: normalizedSessionState,
    onSessionStateChange: setResolvedSessionState,
  });

  const sharedProps = {
    accent,
    briefingSummary,
    briefingGeneratedAt,
    emailAccounts,
    onOpenDashboard,
    onRefresh,
    ...controller,
  };

  if (isMobile) return <MobileInboxView {...sharedProps} />;
  return <InboxDesktopPane {...sharedProps} />;
}
