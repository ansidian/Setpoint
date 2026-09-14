import useInboxBatchSelection, { type InboxRowModifiers } from "./useInboxBatchSelection";
import useInboxBatchActions from "./useInboxBatchActions";
import { batchActionOptions, batchHotkey } from "./inboxBatchModel";
import useSnoozedEmails from "./useSnoozedEmails";
import { collectSnoozed } from "./inboxSnoozedModel";
import type { InboxActionDispatcher } from "./useInboxActionDispatch";
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
  computeInboxChipCounts,
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
    collection = "inbox", setCollection,
    accountId,
    lane,
    search,
    selectedId,
    setAccountId,
    setLane,
    setSearch,
    setSelectedId,
  } = useInboxSessionState({ sessionState, onSessionStateChange });
  const snoozed = useSnoozedEmails(collection === "snoozed");
  const searchRef = useRef<HTMLInputElement>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileUnreadOnly, setMobileUnreadOnly] = useState(false);
  const [snoozedMap, setSnoozedMap] = useState<Map<string, number>>(
    () => new Map((snoozedEntries || []).map((entry) => [entry.uid, entry.until_ts])),
  );
  const [pinnedOverrides, setPinnedOverrides] = useState<Map<string, InboxPinnedOverride>>(() => new Map());
  const [resurfacedMap, setResurfacedMap] = useState<Map<string, ResurfacedEntry>>(
    () => new Map((resurfacedEntries || []).map((entry) => [entry.uid, entry])),
  );
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [liveTrashedUids, setLiveTrashedUids] = useState<Set<string>>(() => new Set());
  const {
    indexedSearch,
    indexedSearchActive,
    updateIndexedSearchRead,
    markIndexedSearchReadBulk,
    loadMoreIndexedSearch,
    refreshIndexedSearch,
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

  const closeSingleEmail = useInboxSelectionHistory({ selectedId, setSelectedId, enabled: !isMobile });

  // nowTick scheduling lives below, after `flatEmails`, so it can also fire at
  // pending-security-grace label transitions (the grace rows live in flatEmails).
  // See the computeNextTickDelay effect after flatEmails.

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset locally-mutable map when the entries prop changes
    setSnoozedMap(new Map([...snoozedEntries.map((entry): [string, number] => [entry.uid, entry.until_ts]), ...snoozed.entries.map((entry): [string, number] => [entry.uid, Infinity])]));
  }, [snoozedEntries, snoozed.entries]);

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
  // boundary passing (the snooze sweep) or a verification marker reaching its
  // active deadline. Idle when
  // none is pending. flatEmails carries both timed row states; rescheduling on
  // nowTick advances through their boundaries.
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

  const snoozedRows = useMemo(() => collectSnoozed(
    snoozed.entries, emailAccounts, liveReadOverrides,
    new Set(pinnedRows.map((row) => row.uid)), pinnedOverrides, snoozed.returningUid,
  ), [snoozed.entries, emailAccounts, liveReadOverrides, pinnedRows, pinnedOverrides, snoozed.returningUid]);
  const collectionAccounts = useMemo(() => {
    const merged = new Map(emailAccounts.map((account) => [account.id || account.name, account]));
    for (const row of snoozedRows) merged.set(row._accountKey, row._account);
    return [...merged.values()];
  }, [emailAccounts, snoozedRows]);
  const batchScope = JSON.stringify([activeSnapshot?.snapshot?.id, collection, search]);
  const batchSources = useMemo(() => [...flatEmails, ...indexedSearch.emails, ...snoozedRows], [flatEmails, indexedSearch.emails, snoozedRows]);
  const updateBatchRead = useCallback((uid: string, read: boolean) => {
    onLiveReadOverrideChange(uid, read);
    updateIndexedSearchRead(uid, read);
  }, [onLiveReadOverrideChange, updateIndexedSearchRead]);
  const { refresh: refreshSnoozedBatch } = snoozed;
  const refreshBatch = useCallback(async () => {
    const results = await Promise.allSettled([
      Promise.resolve().then(onActiveSnapshotRefresh),
      ...(collection === "snoozed" ? [refreshSnoozedBatch()] : []),
      ...(indexedSearchActive ? [refreshIndexedSearch()] : []),
    ]);
    if (results.some(result => result.status === "rejected")) throw new Error("Inbox refresh failed");
  }, [onActiveSnapshotRefresh, collection, refreshSnoozedBatch, indexedSearchActive, refreshIndexedSearch]);
  const batch = useInboxBatchActions({ sourceEmails: batchSources, scope: batchScope, readOnly, replaceUndoSlot, finalizeUndoSlot, undoSlotRef, undoing: undo?.status === "undoing", refresh: refreshBatch, updateRead: updateBatchRead });
  const { projectRows: projectBatchRows, busy: batchBusy } = batch;
  const projectedFlat = useMemo(() => projectBatchRows(flatEmails, !indexedSearchActive && collection === "inbox"), [projectBatchRows, flatEmails, indexedSearchActive, collection]);
  const projectedSearch = useMemo(() => projectBatchRows(indexedSearch.emails, indexedSearchActive), [projectBatchRows, indexedSearch.emails, indexedSearchActive]);
  const projectedSnoozed = useMemo(() => projectBatchRows(snoozedRows), [projectBatchRows, snoozedRows]);
  const scopedSnoozedRows = useMemo(() => projectedSnoozed.filter((row) => (
    (accountId === "__all" || row._accountKey === accountId) && (!isMobile || !mobileUnreadOnly || !row.read)
  )), [projectedSnoozed, accountId, isMobile, mobileUnreadOnly]);

  const visibleEmails = useMemo(() => !indexedSearchActive && collection === "snoozed" ? scopedSnoozedRows : selectVisibleEmails({
    flatEmails: projectedFlat,
    indexedSearchActive,
    indexedSearchEmails: projectedSearch,
    accountId,
    lane,
    snoozedMap: readOnly ? undefined : snoozedMap,
    nowTick,
    sortOrder: isMobile ? "newest" : "lane",
    unreadOnly: isMobile && mobileUnreadOnly,
  }), [
    collection, scopedSnoozedRows, readOnly,
    projectedFlat,
    accountId,
    lane,
    snoozedMap,
    nowTick,
    projectedSearch,
    indexedSearchActive,
    isMobile,
    mobileUnreadOnly,
  ]);

  const batchSelection = useInboxBatchSelection({
    scope: JSON.stringify([batchScope, accountId, lane, commitPendingUndoSignal]), enabled: !isMobile,
    emails: visibleEmails, pendingEmails: batch.pendingEmails,
  });
  const { active: batchActive, clear: clearBatch, select: selectBatch } = batchSelection;
  const batchOptions = batchActionOptions(batchSelection.selectedEmails, readOnly);
  const closeSelectedEmail = useCallback(() => {
    if (batchActive) clearBatch(); else closeSingleEmail();
  }, [batchActive, clearBatch, closeSingleEmail]);
  const laneCounts = useMemo(
    () => computeLaneCounts(flatEmails, { accountId }),
    [flatEmails, accountId],
  );

  const chipCounts = useMemo(
    () => computeInboxChipCounts(flatEmails, { accountId, snoozedMap: readOnly ? undefined : snoozedMap, nowTick }),
    [flatEmails, snoozedMap, nowTick, accountId, readOnly],
  );

  const totalUnread = useMemo(() => computeUnreadCount(flatEmails), [flatEmails]);

  const noiseUnreadCount = useMemo(() => computeScopedNoiseUnreadCount(flatEmails, {
    accountId,
    indexedSearchActive,
    snoozedMap: readOnly ? undefined : snoozedMap,
    nowTick,
  }), [accountId, flatEmails, indexedSearchActive, nowTick, snoozedMap, readOnly]);

  const unreadInView = useMemo(() => computeUnreadCount(visibleEmails), [visibleEmails]);

  const selectedEmail = useMemo(() => {
    if (!selectedId || batchActive) return null;
    const searchHit = projectedSearch.find((email) => email.id === selectedId || email.uid === selectedId);
    if (indexedSearchActive && searchHit) return searchHit;
    // Search changes the list, not the open reader or its unsaved workspace.
    const source = collection === "snoozed" ? projectedSnoozed : projectedFlat;
    return source.find((email) => email.id === selectedId || email.uid === selectedId) || null;
  }, [selectedId, projectedFlat, projectedSearch, indexedSearchActive, collection, projectedSnoozed, batchActive]);

  // CONTEXT.md: the desktop Inbox AI entry points (Sparkles, Cmd/Ctrl+Enter)
  // hand off to Alfred — the panel opens and runs the query immediately.
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

  const markAllVisibleRead = useCallback(() => {
    if (readOnly || batchBusy) return;
    const { unread, overrideUids, allUids } = planMarkAllVisibleRead(visibleEmails);
    if (unread.length === 0) return;

    for (const uid of overrideUids) onLiveReadOverrideChange(uid, true);

    if (allUids.length) {
      markIndexedSearchReadBulk(allUids);
      markAllEmailsAsRead(allUids).catch(() => {});
    }
  }, [readOnly, visibleEmails, onLiveReadOverrideChange, markIndexedSearchReadBulk, batchBusy]);

  // Stable open handler so EmailRow's React.memo holds across list re-renders.
  // Previously each pane passed an inline `(email) => setSelectedId(...)` arrow,
  // a fresh reference per render that defeated the row memo.
  const onOpen = useCallback((email: InboxEmailLike, modifiers: InboxRowModifiers = {}) => {
    if (!isMobile && (modifiers.metaKey || modifiers.ctrlKey || modifiers.shiftKey)) {
      selectBatch(email, modifiers, selectedEmail);
      setSelectedId(null);
      return;
    }
    clearBatch();
    setSelectedId(email.id || email.uid || null);
  }, [setSelectedId, isMobile, selectBatch, clearBatch, selectedEmail]);

  const moveBy = useCallback((direction: number) => {
    const index = visibleEmails.findIndex((email) => email.id === selectedId || email.uid === selectedId);
    const nextIndex = Math.max(0, Math.min(visibleEmails.length - 1, index + direction));
    const next = visibleEmails[nextIndex];
    if (next) setSelectedId(next.id || next.uid || null);
  }, [visibleEmails, selectedId, setSelectedId]);

  const { onAction: dispatchAction, announcement } = useInboxActionDispatch({
    onSnoozedChange: snoozed.refresh,
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

  const onAction: InboxActionDispatcher = (kind, payload) => {
    if (batchBusy || batchActive) return;
    if (kind !== "unsnooze") { dispatchAction(kind, payload); return; }
    const email = selectedEmail;
    if (!email?._snoozed || email._snoozedUnavailable || !email.uid) return;
    const uid = email.uid;
    void snoozed.returnEarly(uid).then((success) => {
      if (!success) return;
      setSnoozedMap((previous) => { const next = new Map(previous); next.delete(uid); return next; });
      setSelectedId((previous) => previous === email.id || previous === uid ? null : previous);
      void onActiveSnapshotRefresh();
    });
  };

  useEffect(() => {
    if (!selectedId) return undefined;
    if (readOnly || batchActive || batchBusy) return undefined;
    const timeout = setTimeout(() => {
      const email = selectedEmail;
      if (!email || email.read || email._snoozedUnavailable) return;

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
  }, [readOnly, selectedId, selectedEmail, onLiveReadOverrideChange, updateIndexedSearchRead, batchActive, batchBusy]);

  useInboxKeyboardCommands({
    batchActive: batchActive,
    onBatchKey: (key) => {
      if (key === "escape") { clearBatch(); return; }
      const action = batchHotkey(key, batchOptions);
      if (action) void batch.execute(batchSelection.selectedEmails, action);
    },
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
    batchSelection, batchOptions, batch,
    collection, setCollection,
    snoozedCount: snoozedRows.filter((row) => accountId === "__all" || row._accountKey === accountId).length,
    snoozedLoading: snoozed.loading, snoozedError: snoozed.error, refreshSnoozed: snoozed.refresh,
    emailAccounts: collection === "snoozed" ? collectionAccounts : emailAccounts,
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
    mobileUnreadOnly,
    setMobileUnreadOnly,
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
    chipCounts,
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
    grouping: isMobile || collection === "snoozed" ? "flat" : "swimlanes",
    activeSnapshotMode,
    scopedAccount: indexedSearchActive ? null : scopedAccount,
  };
}

export type InboxControllerState = ReturnType<typeof useInboxController>;
