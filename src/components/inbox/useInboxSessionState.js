import { useCallback, useSyncExternalStore } from "react";

export const DEFAULT_INBOX_SESSION = Object.freeze({
  accountId: "__all",
  lane: "__all",
  search: "",
  selectedId: null,
});

// Module-scoped store so the inbox session (account / lane / search /
// selection) survives InboxView unmounting on tab switches
// without the dashboard shell owning inbox state (EAD-328). Resets on page
// refresh by construction. DashboardShell mutates it imperatively
// (open-email-in-inbox, snapshot selection); InboxView reads it through
// useInboxSessionStore when no controlled sessionState prop is supplied.
let inboxSession = DEFAULT_INBOX_SESSION;
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInboxSession() {
  return inboxSession;
}

// useState-compatible setter: accepts the next session object or an updater
// receiving the previous session and returning the next one.
export function setInboxSession(next) {
  inboxSession = typeof next === "function" ? next(inboxSession) : next;
  notify();
}

export function resetInboxSession(overrides = {}) {
  inboxSession = { ...DEFAULT_INBOX_SESSION, ...overrides };
  notify();
}

export function useInboxSessionStore() {
  const session = useSyncExternalStore(subscribe, getInboxSession);
  return [session, setInboxSession];
}

// Field-level accessors over a controlled session pair. Owns the
// normalization defaults that previously lived inline in useInboxController.
export default function useInboxSessionState({
  sessionState,
  onSessionStateChange,
}) {
  const accountId = sessionState?.accountId || "__all";
  const lane = sessionState?.lane || "__all";
  const search = sessionState?.search || "";
  const selectedId = sessionState?.selectedId || null;

  const setSessionField = useCallback((field, value) => {
    onSessionStateChange((prev) => ({
      accountId: prev?.accountId || "__all",
      lane: prev?.lane || "__all",
      search: prev?.search || "",
      selectedId: prev?.selectedId || null,
      ...prev,
      [field]: typeof value === "function" ? value(prev?.[field] ?? null) : value,
    }));
  }, [onSessionStateChange]);

  const setAccountId = useCallback((value) => {
    setSessionField("accountId", value);
  }, [setSessionField]);

  const setLane = useCallback((value) => {
    setSessionField("lane", value);
  }, [setSessionField]);

  const setSearch = useCallback((value) => {
    setSessionField("search", value);
  }, [setSessionField]);

  const setSelectedId = useCallback((value) => {
    setSessionField("selectedId", value);
  }, [setSessionField]);

  return {
    accountId,
    lane,
    search,
    selectedId,
    setAccountId,
    setLane,
    setSearch,
    setSelectedId,
    setSessionField,
  };
}
