import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useInboxSelectionHistory from "../../hooks/email/useInboxSelectionHistory";
import useInboxUndoSlot from "./useInboxUndoSlot";
import {
  markEmailAsRead,
  markAllEmailsAsRead,
  searchEmails,
} from "../../api";
import {
  makeSynthAccount,
  collectActiveSnapshotEmails,
  collectLiveEmails,
  collectResurfaced,
  composeReadOverrides,
} from "./inboxWorkItems.js";
import { computeScopedNoiseUnreadCount } from "./inboxCountsModel.js";
import { normalizeIndexedSearchResults } from "./indexedSearchModel.js";
import { SNAPSHOT_LANE_ORDER } from "./activeSnapshotWorkflowModel.js";
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
  customize,
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
  const mobileFilterTriggerRef = useRef(null);
  const mobileFilterPanelRef = useRef(null);
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
  const [indexedSearch, setIndexedSearch] = useState({
    query: "",
    emails: [],
    accountsById: {},
    loading: false,
    error: null,
  });
  const searchRequestRef = useRef(0);
  // Local read-toggles applied to indexed-search hits that are not live/snapshot
  // emails. These live only in indexedSearch.emails, not in liveReadOverrides,
  // so a fresh search response would otherwise rebuild rows from server read +
  // liveReadOverrides and drop a just-applied toggle. Carry them forward here so
  // re-merges reconcile against the latest local search read state.
  const searchReadOverridesRef = useRef(new Map());
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

  const closeSelectedEmail = useInboxSelectionHistory({ selectedId, setSelectedId });

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setSnoozedMap(new Map((snoozedEntries || []).map((entry) => [entry.uid, entry.until_ts])));
  }, [snoozedEntries]);

  useEffect(() => {
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

  const indexedSearchActive = search.trim().length >= 2;

  const visibleEmails = useMemo(() => {
    if (indexedSearchActive) return indexedSearch.emails;
    return flatEmails.filter((email) => {
      const uid = email.uid || email.id;
      const snoozeUntil = snoozedMap.get(uid);
      if (snoozeUntil && snoozeUntil > nowTick) return false;
      if (accountId !== "__all" && email._accountKey !== accountId) return false;
      if (categoryFilter !== "__all" && email.category !== categoryFilter) return false;
      if (lane === "__live" && !email._untriaged) return false;
      if (lane !== "__all" && lane !== "__live" && email._lane !== lane) return false;
      return true;
    }).sort((a, b) => {
      if (a._untriaged && !b._untriaged) return -1;
      if (!a._untriaged && b._untriaged) return 1;
      if (SNAPSHOT_LANE_ORDER[a._lane] !== SNAPSHOT_LANE_ORDER[b._lane]) {
        return (SNAPSHOT_LANE_ORDER[a._lane] ?? 4) - (SNAPSHOT_LANE_ORDER[b._lane] ?? 4);
      }
      const aKey = a._resurfacedAt || new Date(a.date).getTime();
      const bKey = b._resurfacedAt || new Date(b.date).getTime();
      return bKey - aKey;
    });
  }, [
    flatEmails,
    accountId,
    categoryFilter,
    lane,
    snoozedMap,
    nowTick,
    indexedSearch.emails,
    indexedSearchActive,
  ]);

  useEffect(() => {
    const term = search.trim();
    searchRequestRef.current += 1;
    const requestId = searchRequestRef.current;

    if (term.length < 2) {
      setIndexedSearch({
        query: term,
        emails: [],
        accountsById: {},
        loading: false,
        error: null,
      });
      return undefined;
    }

    setIndexedSearch((prev) => ({
      ...prev,
      query: term,
      loading: true,
      error: null,
    }));

    const timeout = setTimeout(() => {
      searchEmails(term)
        .then((data) => {
          if (searchRequestRef.current !== requestId) return;
          // Reconcile fresh results against the latest read state: session-wide
          // liveReadOverrides first, then local indexed-search toggles (which win)
          // so a read/unread applied just before this search does not go stale.
          const readOverrides = composeReadOverrides(
            liveReadOverrides,
            searchReadOverridesRef.current,
          );
          setIndexedSearch(normalizeIndexedSearchResults(data, readOverrides));
        })
        .catch((err) => {
          if (searchRequestRef.current !== requestId) return;
          setIndexedSearch({
            query: term,
            emails: [],
            accountsById: {},
            loading: false,
            error: err.message || "Search failed",
          });
        });
    }, 250);

    return () => clearTimeout(timeout);
  // Intentionally key the API request only on the query. Some callers pass
  // object-literal read override defaults, and including that object here
  // would restart the debounce after every search-state render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const laneCounts = useMemo(() => {
    const counts = { queued: 0, needs_attention: 0, action: 0, carryover: 0, catch_up: 0, fyi: 0, handled: 0, untriaged_read: 0, noise: 0 };
    for (const email of flatEmails) {
      if (accountId !== "__all" && email._accountKey !== accountId) continue;
      if (email._untriaged) continue;
      if (email._lane in counts) counts[email._lane] += 1;
    }
    counts.action = counts.needs_attention;
    return counts;
  }, [flatEmails, accountId]);

  const liveCount = useMemo(() => {
    return flatEmails.filter(
      (email) => email._untriaged && (accountId === "__all" || email._accountKey === accountId),
    ).length;
  }, [flatEmails, accountId]);

  const mobileChipCounts = useMemo(() => {
    const counts = {
      __all: 0,
      __live: 0,
      queued: 0,
      needs_attention: 0,
      action: 0,
      carryover: 0,
      catch_up: 0,
      fyi: 0,
      handled: 0,
      untriaged_read: 0,
      noise: 0,
    };
    for (const email of flatEmails) {
      const uid = email.uid || email.id;
      const snoozeUntil = snoozedMap.get(uid);
      if (snoozeUntil && snoozeUntil > nowTick) continue;
      if (accountId !== "__all" && email._accountKey !== accountId) continue;
      counts.__all += 1;
      if (email._untriaged) counts.__live += 1;
      else if (email._lane && counts[email._lane] != null) counts[email._lane] += 1;
    }
    counts.action = counts.needs_attention;
    return counts;
  }, [flatEmails, snoozedMap, nowTick, accountId]);

  const totalUnread = useMemo(() => {
    return flatEmails.filter((email) => email._lane !== "untriaged_read" && !email.read).length;
  }, [flatEmails]);

  const noiseUnreadCount = useMemo(() => computeScopedNoiseUnreadCount(flatEmails, {
    accountId,
    categoryFilter,
    indexedSearchActive,
    snoozedMap,
    nowTick,
  }), [accountId, categoryFilter, flatEmails, indexedSearchActive, nowTick, snoozedMap]);

  const unreadInView = useMemo(() => {
    return visibleEmails.filter((email) => email._lane !== "untriaged_read" && !email.read).length;
  }, [visibleEmails]);

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
    setBillOpen(false);
  }, [selectedId]);

  const updateIndexedSearchRead = useCallback((uid, read) => {
    if (uid) searchReadOverridesRef.current.set(uid, !!read);
    setIndexedSearch((prev) => ({
      ...prev,
      emails: prev.emails.map((email) => (
        email.uid === uid || email.id === uid ? { ...email, read } : email
      )),
    }));
  }, []);

  const markAllVisibleRead = useCallback(() => {
    if (readOnly) return;
    const unread = visibleEmails.filter((email) => !email.read);
    if (unread.length === 0) return;

    const liveUids = [];
    for (const email of unread) {
      if (email._live && email.uid) liveUids.push(email.uid);
      else if (email._activeSnapshot && email.uid) onLiveReadOverrideChange(email.uid, true);
    }

    if (liveUids.length) {
      for (const uid of liveUids) onLiveReadOverrideChange(uid, true);
    }

    const allUids = unread.map((email) => email.uid).filter(Boolean);
    if (allUids.length) {
      for (const uid of allUids) searchReadOverridesRef.current.set(uid, true);
      setIndexedSearch((prev) => ({
        ...prev,
        emails: prev.emails.map((email) => (
          allUids.includes(email.uid) ? { ...email, read: true } : email
        )),
      }));
      markAllEmailsAsRead(allUids).catch(() => {});
    }
  }, [readOnly, visibleEmails, onLiveReadOverrideChange]);

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

      if (email._live) {
        onLiveReadOverrideChange(email.uid, true);
        markEmailAsRead(email.uid).catch(() => {});
        return;
      }

      if (email._activeSnapshot && email.uid) {
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
    accountId,
    setAccountId,
    lane,
    setLane,
    search,
    setSearch,
    searchRef,
    mobileFilterTriggerRef,
    mobileFilterPanelRef,
    selectedId,
    setSelectedId,
    closeSelectedEmail,
    selectedEmail,
    selectedAccount,
    mobileFiltersOpen,
    setMobileFiltersOpen,
    billOpen,
    setBillOpen,
    accountsById,
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
    showTriage: customize.aiVerbosity !== "minimal",
    showDraft: customize.aiVerbosity === "full",
    showPreview: isMobile ? true : customize.showPreview,
    density: isMobile ? "default" : customize.inboxDensity,
    sidebarCompact: isMobile ? false : customize.sidebarCompact,
    layout: isMobile ? "two-pane" : customize.inboxLayout,
    grouping: isMobile ? "flat" : customize.inboxGrouping,
    activeSnapshotMode,
    snapshotCategories,
    categoryFilter,
    setCategoryFilter,
    scopedAccount: indexedSearchActive ? null : scopedAccount,
  };
}

