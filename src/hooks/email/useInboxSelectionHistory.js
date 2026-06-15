import { useCallback, useEffect, useRef, useState } from "react";

const NAV_KEY = "eaInboxNav";

function buildState(nextState, sessionId, selectedId) {
  return {
    ...(nextState || {}),
    [NAV_KEY]: {
      sessionId,
      selectedId: selectedId || null,
    },
  };
}

function currentNavState() {
  return window.history.state?.[NAV_KEY] || null;
}

export default function useInboxSelectionHistory({ selectedId, setSelectedId, enabled = true }) {
  const [sessionId] = useState(() => `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const skipSyncRef = useRef(false);
  const prevSelectedRef = useRef(selectedId || null);

  useEffect(() => {
    if (!enabled) return undefined;
    const nav = currentNavState();
    if (!nav || nav.sessionId !== sessionId) {
      window.history.replaceState(
        buildState(window.history.state, sessionId, null),
        "",
      );
    }

    function handlePopState(event) {
      const nextNav = event.state?.[NAV_KEY];
      skipSyncRef.current = true;
      if (nextNav?.sessionId === sessionId) {
        setSelectedId(nextNav.selectedId || null);
      } else {
        setSelectedId(null);
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [sessionId, setSelectedId, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      prevSelectedRef.current = selectedId || null;
      return;
    }

    const prevSelected = prevSelectedRef.current;
    const nav = currentNavState();
    const hasSession = nav?.sessionId === sessionId;

    if (!hasSession) {
      window.history.replaceState(
        buildState(window.history.state, sessionId, null),
        "",
      );
    }

    if (!selectedId) {
      if (prevSelected) {
        window.history.replaceState(
          buildState(window.history.state, sessionId, null),
          "",
        );
      }
      prevSelectedRef.current = null;
      return;
    }

    if (!prevSelected) {
      window.history.pushState(
        buildState(window.history.state, sessionId, selectedId),
        "",
      );
    } else {
      window.history.replaceState(
        buildState(window.history.state, sessionId, selectedId),
        "",
      );
    }

    prevSelectedRef.current = selectedId;
  }, [selectedId, sessionId, enabled]);

  return useCallback(() => {
    // On mobile the DashboardShell owns the reader's browser-history entry, so
    // this hook is disabled there; closing the reader is a plain state clear and
    // the shell's back-dismiss hook reconciles history.
    if (!enabled) {
      setSelectedId(null);
      return;
    }
    const nav = currentNavState();
    if (nav?.sessionId === sessionId && nav.selectedId) {
      setSelectedId(null);
      window.history.back();
      return;
    }
    setSelectedId(null);
  }, [sessionId, setSelectedId, enabled]);
}
