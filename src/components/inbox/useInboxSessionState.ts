import { useCallback, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { InboxSelectionId } from "./inboxTypes";

export interface InboxSessionState {
  collection?: "inbox" | "snoozed";
  accountId: string;
  lane: string;
  search: string;
  selectedId: InboxSelectionId;
}

export interface InboxSessionActions {
  setCollection: (value: "inbox" | "snoozed") => void;
  setAccountId: Dispatch<SetStateAction<string>>;
  setLane: Dispatch<SetStateAction<string>>;
  setSearch: Dispatch<SetStateAction<string>>;
  setSelectedId: Dispatch<SetStateAction<InboxSelectionId>>;
  setSessionField: <K extends keyof InboxSessionState>(
    field: K,
    value: InboxSessionState[K] | ((previous: InboxSessionState[K]) => InboxSessionState[K]),
  ) => void;
}

export type InboxSessionController = InboxSessionState & InboxSessionActions;

export const DEFAULT_INBOX_SESSION: Readonly<InboxSessionState> = Object.freeze({
  collection: "inbox",
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
let inboxSession: InboxSessionState = { ...DEFAULT_INBOX_SESSION };
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInboxSession(): InboxSessionState {
  return inboxSession;
}

// useState-compatible setter: accepts the next session object or an updater
// receiving the previous session and returning the next one.
export function setInboxSession(next: SetStateAction<InboxSessionState>): void {
  inboxSession = typeof next === "function" ? next(inboxSession) : next;
  notify();
}

export function resetInboxSession(overrides: Partial<InboxSessionState> = {}): void {
  inboxSession = { ...DEFAULT_INBOX_SESSION, ...overrides };
  notify();
}

export function useInboxSessionStore(): [InboxSessionState, Dispatch<SetStateAction<InboxSessionState>>] {
  const session = useSyncExternalStore(subscribe, getInboxSession);
  return [session, setInboxSession];
}

// Field-selector subscription: re-renders only when the current selection id
// changes, so the DashboardShell can own the mobile reader's history entry
// without re-rendering on every lane/search/account change.
export function useInboxSelectedId(): InboxSelectionId {
  return useSyncExternalStore(subscribe, () => getInboxSession().selectedId);
}

// Field-level accessors over a controlled session pair. Owns the
// normalization defaults that previously lived inline in useInboxController.
export default function useInboxSessionState({
  sessionState,
  onSessionStateChange,
}: {
  sessionState?: Partial<InboxSessionState>;
  onSessionStateChange: Dispatch<SetStateAction<InboxSessionState>>;
}): InboxSessionController {
  const collection = sessionState?.collection || "inbox";
  const accountId = sessionState?.accountId || "__all";
  const lane = sessionState?.lane === "carryover" ? "needs_attention" : sessionState?.lane || "__all";
  const search = sessionState?.search || "";
  const selectedId = sessionState?.selectedId || null;

  const setSessionField = useCallback(<K extends keyof InboxSessionState>(
    field: K,
    value: InboxSessionState[K] | ((previous: InboxSessionState[K]) => InboxSessionState[K]),
  ) => {
    onSessionStateChange((prev) => ({
      ...prev,
      [field]: typeof value === "function"
        ? (value as (previous: InboxSessionState[K]) => InboxSessionState[K])(prev[field])
        : value,
    }));
  }, [onSessionStateChange]);

  const setAccountId = useCallback<Dispatch<SetStateAction<string>>>((value) => {
    setSessionField("accountId", value);
  }, [setSessionField]);

  const setLane = useCallback<Dispatch<SetStateAction<string>>>((value) => {
    setSessionField("lane", value);
  }, [setSessionField]);

  const setSearch = useCallback<Dispatch<SetStateAction<string>>>((value) => {
    setSessionField("search", value);
  }, [setSessionField]);

  const setSelectedId = useCallback<Dispatch<SetStateAction<InboxSelectionId>>>((value) => {
    setSessionField("selectedId", value);
  }, [setSessionField]);

  return {
    collection,
    setCollection: (value: "inbox" | "snoozed") => setSessionField("collection", value),
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
