import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import useBrowserBackDismiss from "../../hooks/useBrowserBackDismiss";
import { getInboxSession, setInboxSession, useInboxSelectedId } from "../inbox/useInboxSessionState";
import type { InboxSelectionId } from "../inbox/inboxTypes";
import type { DashboardTab } from "./dashboardShellModel";
import type { InboxReaderBeforeClose } from "../inbox/inboxViewTypes";

/** Owns mobile Inbox history; the Inbox selection-history hook stays disabled. */
export default function useMobileInboxNavigation({ isMobile, tab, setTab, foregroundOpen = false }: {
  isMobile: boolean;
  tab: DashboardTab;
  setTab: Dispatch<SetStateAction<DashboardTab>>;
  foregroundOpen?: boolean;
}) {
  const selectedId = useInboxSelectedId();
  const [readerOrigin, setReaderOrigin] = useState<"dashboard" | "inbox">("inbox");
  const homeRequestedRef = useRef(false);
  const beforeReaderCloseRef = useRef<InboxReaderBeforeClose | null>(null);
  const allowedCloseRef = useRef<InboxSelectionId>(null);
  const readerOpen = isMobile && tab === "inbox" && !!selectedId;
  const dismissInbox = useBrowserBackDismiss({
    // A dashboard email is one navigation step. Its reader sits directly above
    // Dashboard rather than introducing an Inbox list the owner never visited.
    enabled: isMobile && tab === "inbox" && readerOrigin === "inbox",
    suspended: foregroundOpen,
    historyKey: "eaDashboardMobileTab",
    onDismiss: () => {
      homeRequestedRef.current = false;
      setTab("dashboard");
    },
  });
  const dismissReader = useBrowserBackDismiss({
    enabled: readerOpen,
    suspended: foregroundOpen,
    historyKey: "eaMobileReader",
    onDismiss: () => {
      if (allowedCloseRef.current !== selectedId && beforeReaderCloseRef.current) {
        const returnHomeRequested = homeRequestedRef.current;
        const proceed = () => {
          if (getInboxSession().selectedId !== selectedId) return;
          homeRequestedRef.current = returnHomeRequested;
          allowedCloseRef.current = selectedId;
          dismissReader();
        };
        if (beforeReaderCloseRef.current(proceed) === false) {
          // useBrowserBackDismiss re-arms this entry. A pending in-app choice
          // is synchronous rejection, never a truthy promise or lost draft.
          homeRequestedRef.current = false;
          return false;
        }
      }
      allowedCloseRef.current = null;
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
  const registerReaderBeforeClose = useCallback((guard: InboxReaderBeforeClose | null) => {
    beforeReaderCloseRef.current = guard;
  }, []);

  useEffect(() => { allowedCloseRef.current = null; }, [selectedId, foregroundOpen]);

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
    // Dashboard targets belong to the active Inbox, even when the retained
    // session was last browsing Snoozed. Select the collection and UID together.
    if (id) setInboxSession((previous) => ({ ...previous, collection: "inbox", selectedId: id }));
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
    registerReaderBeforeClose,
    returnHome,
    readerBackLabel: readerOrigin === "dashboard" ? "Back to dashboard" : "Back to inbox",
  };
}
