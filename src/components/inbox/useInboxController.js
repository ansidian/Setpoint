import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "./inboxWorkItems.js";
import {
  computeScopedNoiseUnreadCount,
  computeLaneCounts,
  computeLiveCount,
  computeMobileChipCounts,
  computeUnreadCount,
} from "./inboxCountsModel.js";
import { computeNextTickDelay } from "./inboxNowTick.js";
import { selectVisibleEmails } from "./inboxVisibleEmailsModel.js";
import { resolveReadScope, READ_SCOPE, planMarkAllVisibleRead } from "./inboxReadRoutingModel.js";
import useIndexedSearch from "./useIndexedSearch";
import useInboxActionDispatch from "./useInboxActionDispatch";
import useInboxKeyboardCommands from "./useInboxKeyboardCommands";
import useInboxSessionState from "./useInboxSessionState";
import useSnapshotOptimisticOverlay from "./useSnapshotOptimisticOverlay";

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
}) {
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
  const searchRef = useRef(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [snoozedMap, setSnoozedMap] = useState(
    () => new Map((snoozedEntries || []).map((entry) => [entry.uid, entry.until_ts])),
  );
  const [resurfacedMap, setResurfacedMap] = useState(
    () => new Map((resurfacedEntries || []).map((entry) => [entry.uid, entry])),
  );
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [liveTrashedUids, setLiveTrashedUids] = useState(() => new Set());
  const [billOpen, setBillOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("__all");
  const {
    indexedSearch,
    indexedSearchActive,
    updateIndexedSearchRead,
    markIndexedSearchReadBulk,
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

  const accountsById = useMemo(() => {
    const map = {};
    for (const account of emailAccounts) {
      map[account.id || account.name] = account;
    }
    return map;
  }, [emailAccounts]);

  const activeSnapshotMode = !!activeSnapshot?.snapshot;
  const snapshotCategories = activeSnapshot?.filters?.categories || [];

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
      return [
        ...optimisticActiveSnapshotEmails
          .filter((entry) => !resurfacedKeys.has(entry.uid || entry.id)),
        ...resurfacedEmails,
      ];
    }

    const out = [];
    const seenUids = new Set();
    const pushEmail = (entry) => {
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
    return out;
  }, [
    activeSnapshotMode,
    emailAccounts,
    liveEmails,
    liveReadOverrides,
    liveTrashedUids,
    optimisticActiveSnapshotEmails,
    resurfacedMap,
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
  const askAlfred = useCallback((query = search) => {
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
  const onOpen = useCallback((email) => {
    setSelectedId(email.id || email.uid);
  }, [setSelectedId]);

  const moveBy = useCallback((direction) => {
    const index = visibleEmails.findIndex((email) => email.id === selectedId || email.uid === selectedId);
    const nextIndex = Math.max(0, Math.min(visibleEmails.length - 1, index + direction));
    const next = visibleEmails[nextIndex];
    if (next) setSelectedId(next.id || next.uid);
  }, [visibleEmails, selectedId, setSelectedId]);

  const onAction = useInboxActionDispatch({
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
        onLiveReadOverrideChange(email.uid, true);
        markEmailAsRead(email.uid).catch(() => {});
        return;
      }

      updateIndexedSearchRead(email.uid || selectedId, true);
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
    ? accountsById[selectedEmail._accountKey] || selectedEmail._account
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
    undo,
    onUndo,
    trashHold: { active: false, progress: 0 },
    snoozeHold: { active: false, progress: 0 },
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

