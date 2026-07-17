import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { PinnedEmailEntry } from "../../../shared/types/email";
import useInboxSelectionHistory from "../../hooks/email/useInboxSelectionHistory";
import useInboxUndoSlot from "./useInboxUndoSlot";
import {
  markEmailAsRead,
  markAllEmailsAsRead,
} from "../../api";
import {
  makeSynthAccount,
  collectActiveSnapshotEmails,
  collectLiveEmails,
  collectResurfaced,
  collectPinned,
  mergePinnedIntoFlat,
} from "./inboxWorkItems";
import type { InboxActiveSnapshotLike, ResurfacedEntry } from "./inboxWorkItems";
import {
  computeScopedNoiseUnreadCount,
  computeLaneCounts,
  computeLiveCount,
  computeMobileChipCounts,
  computeUnreadCount,
} from "./inboxCountsModel";
import { computeNextTickDelay } from "./inboxNowTick";
import { selectVisibleEmails } from "./inboxVisibleEmailsModel";
import { resolveReadScope, READ_SCOPE, planMarkAllVisibleRead } from "./inboxReadRoutingModel";
import useIndexedSearch from "./useIndexedSearch";
import useInboxActionDispatch from "./useInboxActionDispatch";
import useInboxKeyboardCommands from "./useInboxKeyboardCommands";
import useInboxSessionState from "./useInboxSessionState";
import useSnapshotOptimisticOverlay from "./useSnapshotOptimisticOverlay";
import type { InboxSessionState } from "./useInboxSessionState";
import type {
  InboxAccount,
  InboxEmailLike,
  InboxId,
  InboxPinnedOverride,
  InboxReadOverrides,
  NormalizedInboxRow,
} from "./inboxTypes";

export interface SnoozedEntry {
  uid: string;
  until_ts: number;
}

function isPinnedEmailEntry(value: unknown): value is PinnedEmailEntry {
  return typeof value === "object"
    && value !== null
    && "uid" in value
    && typeof value.uid === "string"
    && "pinned_at" in value
    && typeof value.pinned_at === "string";
}

export interface InboxControllerOptions {
  emailAccounts?: InboxAccount[];
  activeSnapshot?: InboxActiveSnapshotLike | null;
  liveEmails?: InboxEmailLike[];
  liveReadOverrides?: InboxReadOverrides;
  onLiveReadOverrideChange?: (uid: string, read: boolean) => void;
  snoozedEntries?: SnoozedEntry[];
  resurfacedEntries?: Array<ResurfacedEntry & { uid: string }>;
  isMobile?: boolean;
  sessionState?: Partial<InboxSessionState>;
  onSessionStateChange?: Dispatch<SetStateAction<InboxSessionState>>;
  commitPendingUndoSignal?: unknown;
  onActiveSnapshotRefresh?: () => unknown | Promise<unknown>;
  readOnly?: boolean;
  onAskAlfred?: (query: string) => void;
}

export default function useInboxController({
  emailAccounts = [],
  activeSnapshot = null,
  liveEmails = [],
  liveReadOverrides = {},
  onLiveReadOverrideChange = () => {},
  snoozedEntries = [],
  resurfacedEntries = [],
  isMobile = false,
  sessionState,
  onSessionStateChange = () => {},
  commitPendingUndoSignal,
  onActiveSnapshotRefresh = () => {},
  readOnly = false,
  onAskAlfred = () => {},
}: InboxControllerOptions) {
  const {
    accountId,
    lane,
    search,
    selectedId,
    setAccountId,
    setLane,
    setSearch,
    setSelectedId,
  } = useInboxSessionState({ sessionState, onSessionStateChange });
  const searchRef = useRef<HTMLInputElement>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [snoozedMap, setSnoozedMap] = useState<Map<string, number>>(
    () => new Map((snoozedEntries || []).map((entry) => [entry.uid, entry.until_ts])),
  );
  const [pinnedOverrides, setPinnedOverrides] = useState<Map<string, InboxPinnedOverride>>(() => new Map());
  const [resurfacedMap, setResurfacedMap] = useState<Map<string, ResurfacedEntry>>(
    () => new Map((resurfacedEntries || []).map((entry) => [entry.uid, entry])),
  );
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [liveTrashedUids, setLiveTrashedUids] = useState<Set<string>>(() => new Set());
  const [billOpen, setBillOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("__all");
  const {
    indexedSearch,
    indexedSearchActive,
    updateIndexedSearchRead,
    markIndexedSearchReadBulk,
    loadMoreIndexedSearch,
  } = useIndexedSearch({ search, liveReadOverrides });
  const {
    undo,
    undoSlotRef,
    replaceUndoSlot,
    finalizeUndoSlot,
    onUndo,
  } = useInboxUndoSlot({ onActiveSnapshotRefresh });
  const commitPendingUndoSignalRef = useRef(commitPendingUndoSignal);

  useEffect(() => {
    if (commitPendingUndoSignalRef.current === commitPendingUndoSignal) return;
    commitPendingUndoSignalRef.current = commitPendingUndoSignal;
    finalizeUndoSlot();
  }, [commitPendingUndoSignal, finalizeUndoSlot]);

  const closeSelectedEmail = useInboxSelectionHistory({ selectedId, setSelectedId, enabled: !isMobile });

  // nowTick scheduling lives below, after `flatEmails`, so it can also fire at
  // pending-security-grace label transitions (the grace rows live in flatEmails).
  // See the computeNextTickDelay effect after flatEmails.

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset locally-mutable map when the entries prop changes
    setSnoozedMap(new Map((snoozedEntries || []).map((entry) => [entry.uid, entry.until_ts])));
  }, [snoozedEntries]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset locally-mutable map when the entries prop changes
    setResurfacedMap(new Map((resurfacedEntries || []).map((entry) => [entry.uid, entry])));
  }, [resurfacedEntries]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset locally-mutable map when the payload changes
    setPinnedOverrides(new Map());
  }, [activeSnapshot?.pinned]);

  const accountsById = useMemo(() => {
    const map: Record<string, InboxAccount> = {};
    for (const account of emailAccounts) {
      map[account.id || account.name] = account;
    }
    return map;
  }, [emailAccounts]);

  const activeSnapshotMode = !!activeSnapshot?.snapshot;
  const snapshotCategories = (activeSnapshot?.filters?.categories || []).flatMap((entry) => (
    typeof entry.category === "string"
      ? [{ category: entry.category, count: entry.count || 0 }]
      : []
  ));

  useEffect(() => {
    if (activeSnapshotMode) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset filter when leaving snapshot mode
    setCategoryFilter("__all");
  }, [activeSnapshotMode]);

  const rawActiveSnapshotEmails = useMemo(() => (
    activeSnapshotMode ? collectActiveSnapshotEmails(activeSnapshot, liveReadOverrides) : []
  ), [activeSnapshot, activeSnapshotMode, liveReadOverrides]);

  const {
    optimisticActiveSnapshotEmails,
    setSnapshotOptimistic,
    snapshotPendingRef,
    snapshotRequestRef,
  } = useSnapshotOptimisticOverlay({ activeSnapshotMode, rawActiveSnapshotEmails });

  // Pinned overlay rows: server pins (activeSnapshot.pinned) reconciled with
  // locally-optimistic pin/unpin overrides. Frozen (readOnly) views contribute
  // no pinned rows — that's what keeps historical browsing overlay-free.
  const pinnedRows = useMemo(() => {
    if (readOnly) return [];
    const overriddenOff = new Set();
    const optimisticEntries = [];
    for (const [uid, override] of pinnedOverrides) {
      if (!override.pinned) overriddenOff.add(uid);
      else if (override.entry) optimisticEntries.push(override.entry);
    }
    const serverEntries = (activeSnapshot?.pinned || [])
      .filter(isPinnedEmailEntry)
      .filter((entry) => !overriddenOff.has(entry.uid));
    const seen = new Set(serverEntries.map((entry) => entry.uid));
    const entries = [...serverEntries, ...optimisticEntries.filter((entry) => !seen.has(entry.uid))];
    if (!entries.length) return [];
    return collectPinned(entries, makeSynthAccount(emailAccounts), liveReadOverrides);
  }, [readOnly, pinnedOverrides, activeSnapshot?.pinned, emailAccounts, liveReadOverrides]);

  const flatEmails = useMemo(() => {
    const synthAccount = makeSynthAccount(emailAccounts);
    const resurfacedEmails = collectResurfaced(
      resurfacedMap,
      synthAccount,
      liveReadOverrides,
      liveTrashedUids,
    );

    if (activeSnapshotMode) {
      const resurfacedKeys = new Set(resurfacedEmails.map((entry) => entry.uid || entry.id));
      return mergePinnedIntoFlat([
        ...optimisticActiveSnapshotEmails
          .filter((entry) => {
            const key = entry.uid || entry.id;
            return key == null || !resurfacedKeys.has(key);
          }),
        ...resurfacedEmails,
      ], pinnedRows);
    }

    const out: NormalizedInboxRow[] = [];
    const seenUids = new Set<InboxId>();
    const pushEmail = (entry: NormalizedInboxRow) => {
      const key = entry.uid || entry.id;
      if (key && seenUids.has(key)) return;
      if (key) seenUids.add(key);
      out.push(entry);
    };
    for (const entry of collectLiveEmails(
      liveEmails,
      synthAccount,
      liveTrashedUids,
      liveReadOverrides,
      resurfacedMap,
    )) {
      pushEmail(entry);
    }
    for (const entry of collectResurfaced(
      resurfacedMap,
      synthAccount,
      liveReadOverrides,
      liveTrashedUids,
    )) {
      pushEmail(entry);
    }
    return mergePinnedIntoFlat(out, pinnedRows);
  }, [
    activeSnapshotMode,
    emailAccounts,
    liveEmails,
    liveReadOverrides,
    liveTrashedUids,
    optimisticActiveSnapshotEmails,
    resurfacedMap,
    pinnedRows,
  ]);

  // Bump nowTick at the soonest moment a derived value actually changes: a snooze
  // boundary passing (the snooze sweep) OR a pending-security-grace row crossing a
  // label bucket (EmailRow derives that countdown from _pendingSecurityGraceAt +
  // nowTick). Idle when neither is pending, so an inbox with no near-term snooze
  // or grace transition never re-filters/re-renders. flatEmails is the dep that
  // carries the grace rows; rescheduling on nowTick advances through the buckets.
  useEffect(() => {
    const delay = computeNextTickDelay(snoozedMap, flatEmails, Date.now());
    if (delay == null) return undefined;
    const id = setTimeout(() => setNowTick(Date.now()), delay + 1);
    return () => clearTimeout(id);
  }, [snoozedMap, flatEmails, nowTick]);

  // Stable account lookup for the rows: only re-allocates the merged object when
  // search state or the underlying maps actually change. Previously each pane
  // re-spread `{ ...accountsById, ...indexedSearchAccountsById }` in its render
  // body, handing EmailRow a fresh `account` reference every render and
  // defeating its memo while indexed search was active.
  const rowAccountsById = useMemo(() => (
    indexedSearchActive
      ? { ...accountsById, ...indexedSearch.accountsById }
      : accountsById
  ), [indexedSearchActive, accountsById, indexedSearch.accountsById]);

  const visibleEmails = useMemo(() => selectVisibleEmails({
    flatEmails,
    indexedSearchActive,
    indexedSearchEmails: indexedSearch.emails,
    accountId,
    categoryFilter,
    lane,
    snoozedMap,
    nowTick,
  }), [
    flatEmails,
    accountId,
    categoryFilter,
    lane,
    snoozedMap,
    nowTick,
    indexedSearch.emails,
    indexedSearchActive,
  ]);

  const laneCounts = useMemo(
    () => computeLaneCounts(flatEmails, { accountId }),
    [flatEmails, accountId],
  );

  const liveCount = useMemo(
    () => computeLiveCount(flatEmails, { accountId }),
    [flatEmails, accountId],
  );

  const mobileChipCounts = useMemo(
    () => computeMobileChipCounts(flatEmails, { accountId, snoozedMap, nowTick }),
    [flatEmails, snoozedMap, nowTick, accountId],
  );

  const totalUnread = useMemo(() => computeUnreadCount(flatEmails), [flatEmails]);

  const noiseUnreadCount = useMemo(() => computeScopedNoiseUnreadCount(flatEmails, {
    accountId,
    categoryFilter,
    indexedSearchActive,
    snoozedMap,
    nowTick,
  }), [accountId, categoryFilter, flatEmails, indexedSearchActive, nowTick, snoozedMap]);

  const unreadInView = useMemo(() => computeUnreadCount(visibleEmails), [visibleEmails]);

  const selectedEmail = useMemo(() => {
    if (!selectedId) return null;
    const searchHit = indexedSearch.emails.find((email) => email.id === selectedId || email.uid === selectedId);
    if (searchHit) return searchHit;
    return flatEmails.find((email) => email.id === selectedId || email.uid === selectedId) || null;
  }, [selectedId, flatEmails, indexedSearch.emails]);

  // CONTEXT.md: the inbox AI entry points (Sparkles, Cmd/Ctrl+Enter) hand off
  // to Alfred — the panel opens and runs the query immediately.
  const askAlfred = useCallback((query: string = search) => {
    const q = String(query || "").trim();
    if (!q) return;
    onAskAlfred(q);
  }, [search, onAskAlfred]);

  useEffect(() => {
    if (!selectedId) return;
    if (selectedEmail) return;
    setSelectedId(null);
  }, [selectedEmail, selectedId, setSelectedId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close the bill drawer when the selected email changes
    setBillOpen(false);
  }, [selectedId]);

  const markAllVisibleRead = useCallback(() => {
    if (readOnly) return;
    const { unread, overrideUids, allUids } = planMarkAllVisibleRead(visibleEmails);
    if (unread.length === 0) return;

    for (const uid of overrideUids) onLiveReadOverrideChange(uid, true);

    if (allUids.length) {
      markIndexedSearchReadBulk(allUids);
      markAllEmailsAsRead(allUids).catch(() => {});
    }
  }, [readOnly, visibleEmails, onLiveReadOverrideChange, markIndexedSearchReadBulk]);

  // Stable open handler so EmailRow's React.memo holds across list re-renders.
  // Previously each pane passed an inline `(email) => setSelectedId(...)` arrow,
  // a fresh reference per render that defeated the row memo.
  const onOpen = useCallback((email: InboxEmailLike) => {
    setSelectedId(email.id || email.uid || null);
  }, [setSelectedId]);

  const moveBy = useCallback((direction: number) => {
    const index = visibleEmails.findIndex((email) => email.id === selectedId || email.uid === selectedId);
    const nextIndex = Math.max(0, Math.min(visibleEmails.length - 1, index + direction));
    const next = visibleEmails[nextIndex];
    if (next) setSelectedId(next.id || next.uid || null);
  }, [visibleEmails, selectedId, setSelectedId]);

  const { onAction, announcement } = useInboxActionDispatch({
    selectedEmail,
    readOnly,
    moveBy,
    onLiveReadOverrideChange,
    closeSelectedEmail,
    updateIndexedSearchRead,
    onActiveSnapshotRefresh,
    replaceUndoSlot,
    setSelectedId,
    setLiveTrashedUids,
    setSnapshotOptimistic,
    setSnoozedMap,
    setPinnedOverrides,
    snapshotPendingRef,
    snapshotRequestRef,
  });

  useEffect(() => {
    if (!selectedId) return undefined;
    if (readOnly) return undefined;
    const timeout = setTimeout(() => {
      const email = selectedEmail;
      if (!email || email.read) return;

      const scope = resolveReadScope(email);
      if (scope === READ_SCOPE.LIVE || scope === READ_SCOPE.SNAPSHOT) {
        if (!email.uid) return;
        onLiveReadOverrideChange(email.uid, true);
        markEmailAsRead(email.uid).catch(() => {});
        return;
      }

      updateIndexedSearchRead(String(email.uid || selectedId), true);
      if (email.uid) markEmailAsRead(email.uid).catch(() => {});
    }, 500);

    return () => clearTimeout(timeout);
  }, [readOnly, selectedId, selectedEmail, onLiveReadOverrideChange, updateIndexedSearchRead]);

  useInboxKeyboardCommands({
    undoSlotRef,
    onUndo,
    searchRef,
    moveBy,
    selectedEmail,
    readOnly,
    onAction,
  });

  const selectedAccount = selectedEmail
    ? accountsById[selectedEmail._accountKey || ""] || selectedEmail._account
    : null;

  const scopedAccount = accountId === "__all"
    ? null
    : emailAccounts.find((account) => (account.id || account.name) === accountId);

  return {
    nowTick,
    accountId,
    setAccountId,
    lane,
    setLane,
    search,
    setSearch,
    searchRef,
    selectedId,
    setSelectedId,
    onOpen,
    closeSelectedEmail,
    selectedEmail,
    selectedAccount,
    mobileFiltersOpen,
    setMobileFiltersOpen,
    billOpen,
    setBillOpen,
    accountsById,
    rowAccountsById,
    indexedSearchAccountsById: indexedSearch.accountsById,
    indexedSearchActive,
    indexedSearchLoading: indexedSearch.loading,
    indexedSearchError: indexedSearch.error,
    indexedSearchTotal: indexedSearch.total,
    indexedSearchHasMore: indexedSearch.hasMore,
    loadMoreIndexedSearch,
    onAskAlfred: askAlfred,
    visibleEmails,
    laneCounts,
    liveCount,
    mobileChipCounts,
    totalUnread,
    noiseUnreadCount,
    unreadInView,
    markAllVisibleRead,
    onAction,
    announcement,
    undo,
    onUndo,
    showTriage: true,
    showDraft: false,
    showPreview: true,
    density: "comfortable",
    layout: "two-pane",
    grouping: isMobile ? "flat" : "swimlanes",
    activeSnapshotMode,
    snapshotCategories,
    categoryFilter,
    setCategoryFilter,
    scopedAccount: indexedSearchActive ? null : scopedAccount,
  };
}

export type InboxControllerState = ReturnType<typeof useInboxController>;
