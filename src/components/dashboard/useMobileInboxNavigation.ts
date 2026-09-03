import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import useBrowserBackDismiss from "../../hooks/useBrowserBackDismiss";
import { setInboxSession, useInboxSelectedId } from "../inbox/useInboxSessionState";
import type { InboxSelectionId } from "../inbox/inboxTypes";
import type { DashboardTab } from "./dashboardShellModel";

/** Owns mobile Inbox history; the Inbox selection-history hook stays disabled. */
export default function useMobileInboxNavigation({ isMobile, tab, setTab }: {
  isMobile: boolean;
  tab: DashboardTab;
  setTab: Dispatch<SetStateAction<DashboardTab>>;
}) {
  const selectedId = useInboxSelectedId();
  const [readerOrigin, setReaderOrigin] = useState<"dashboard" | "inbox">("inbox");
  const homeRequestedRef = useRef(false);
  const readerOpen = isMobile && tab === "inbox" && !!selectedId;
  const dismissInbox = useBrowserBackDismiss({
    // A dashboard email is one navigation step. Its reader sits directly above
    // Dashboard rather than introducing an Inbox list the owner never visited.
    enabled: isMobile && tab === "inbox" && readerOrigin === "inbox",
    historyKey: "eaDashboardMobileTab",
    onDismiss: () => {
      homeRequestedRef.current = false;
      setTab("dashboard");
    },
  });
  const dismissReader = useBrowserBackDismiss({
    enabled: readerOpen,
    historyKey: "eaMobileReader",
    onDismiss: () => {
      setInboxSession((previous) => ({ ...previous, selectedId: null }));
      if (readerOrigin === "dashboard") {
        homeRequestedRef.current = false;
        setReaderOrigin("inbox");
        setTab("dashboard");
      } else if (homeRequestedRef.current) {
        // Unwind the tab only after the reader entry actually popped. Each
        // dismissal checks its own token; no guessed history depth is needed.
        dismissInbox();
      }
    },
  });

  useEffect(() => {
    if (!isMobile || tab !== "inbox" || selectedId || readerOrigin !== "dashboard") return;
    // Selection can also disappear after a mail action. Return to the same
    // origin while useBrowserBackDismiss removes the now-closed reader entry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReaderOrigin("inbox");
    setTab("dashboard");
  }, [isMobile, readerOrigin, selectedId, setTab, tab]);

  const prepareEmailOpen = useCallback((id: InboxSelectionId) => {
    setReaderOrigin(isMobile && tab === "dashboard" && id ? "dashboard" : "inbox");
    if (id) setInboxSession((previous) => ({ ...previous, selectedId: id }));
  }, [isMobile, tab]);

  const returnHome = useCallback(() => {
    homeRequestedRef.current = true;
    if (readerOpen) dismissReader();
    else dismissInbox();
  }, [dismissInbox, dismissReader, readerOpen]);

  return {
    readerOpen,
    prepareEmailOpen,
    dismissReader,
    returnHome,
    readerBackLabel: readerOrigin === "dashboard" ? "Back to dashboard" : "Back to inbox",
  };
}
