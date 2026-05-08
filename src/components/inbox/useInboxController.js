import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useInboxSelectionHistory from "../../hooks/email/useInboxSelectionHistory";
import { useDashboard } from "../../context/DashboardContext";
import useInboxUndoSlot from "./useInboxUndoSlot";
import {
  markEmailAsRead,
  markEmailAsUnread,
  trashEmail,
  snoozeEmail,
  unsnoozeEmail,
  markAllEmailsAsRead,
  searchEmails,
  askInboxAiSearch,
  moveSnapshotItemLane,
  dismissSnapshotItemForToday,
  restoreSnapshotItemForToday,
  markSnapshotItemHandled,
  reopenSnapshotItem,
} from "../../api";
import { getGmailUrl } from "../../lib/email-links";
import {
  defaultSnoozeTs,
  isCatchUpEmail,
} from "./helpers";
import {
  makeSynthAccount,
  collectActiveSnapshotEmails,
  collectLiveEmails,
  collectResurfaced,
} from "./inboxWorkItems.js";
import { resolveInboxHotkeyAction, shouldSuspendInboxHotkeys } from "./inboxHotkeys";
import { computeScopedNoiseUnreadCount } from "./inboxCountsModel.js";
import {
  applyLiveTrashOptimistic,
  applySnapshotTrashOptimistic,
  buildTrashCommand,
  shouldHandleInboxUndoHotkey,
} from "./inboxCommandModel.js";
import { normalizeIndexedSearchResults } from "./indexedSearchModel.js";
import {
  EMPTY_INBOX_AI_SEARCH,
  clearInboxAiSearch,
  completeInboxAiRequest,
  failInboxAiRequest,
  isInboxAiResultMode,
  requestInboxAiConfirmation,
  startInboxAiRequest,
} from "./inboxAiSearchModel.js";

const SNAPSHOT_REOPEN_LANES = new Set(["needs_attention", "fyi", "noise"]);

function getSnapshotReopenLane(email) {
  const lane = email?._lane === "carryover"
    ? "needs_attention"
    : email?.lane || email?.lane_at_snapshot || email?._lane;
  return SNAPSHOT_REOPEN_LANES.has(lane) ? lane : "needs_attention";
}

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
  onActiveSnapshotRefresh = () => {},
  readOnly = false,
}) {
  const accountId = sessionState?.accountId || "__all";
  const lane = sessionState?.lane || "__all";
  const search = sessionState?.search || "";
  const searchRef = useRef(null);
  const mobileFilterTriggerRef = useRef(null);
  const mobileFilterPanelRef = useRef(null);
  const selectedId = sessionState?.selectedId || null;
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
  const [inboxAiSearch, setInboxAiSearch] = useState(EMPTY_INBOX_AI_SEARCH);
  const searchRequestRef = useRef(0);
  const inboxAiRequestRef = useRef(0);
  const liveReadOverridesRef = useRef(liveReadOverrides);
  const {
    undo,
    undoSlotRef,
    replaceUndoSlot,
    onUndo,
  } = useInboxUndoSlot({ onActiveSnapshotRefresh });

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
    setInboxAiSearch((prev) => (
      prev.status === "idle" ? prev : clearInboxAiSearch(prev)
    ));
    setSessionField("search", value);
  }, [setSessionField]);

  useEffect(() => {
    liveReadOverridesRef.current = liveReadOverrides;
  }, [liveReadOverrides]);

  const setSelectedId = useCallback((value) => {
    setSessionField("selectedId", value);
  }, [setSessionField]);

  const { markEmailRead, markEmailUnread, handleDismiss } = useDashboard();
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

  const [snapshotOptimistic, setSnapshotOptimistic] = useState(() => new Map());
  const snapshotPendingRef = useRef(new Set());
  const snapshotRequestRef = useRef(0);

  const rawActiveSnapshotEmails = useMemo(() => (
    activeSnapshotMode ? collectActiveSnapshotEmails(activeSnapshot, liveReadOverrides) : []
  ), [activeSnapshot, activeSnapshotMode, liveReadOverrides]);

  useEffect(() => {
    if (!activeSnapshotMode) {
      snapshotPendingRef.current.clear();
      setSnapshotOptimistic((prev) => (prev.size > 0 ? new Map() : prev));
      return;
    }

    const rowsByItemId = new Map(rawActiveSnapshotEmails.map((email) => [
      String(email.snapshot_item_id),
      email,
    ]));

    setSnapshotOptimistic((prev) => {
      let changed = false;
      const next = new Map();

      for (const [itemId, overlay] of prev.entries()) {
        const row = rowsByItemId.get(itemId);
        if (!row) {
          snapshotPendingRef.current.delete(itemId);
          changed = true;
          continue;
        }
        if (overlay.pending) {
          next.set(itemId, overlay);
          continue;
        }
        if (overlay.failed) {
          snapshotPendingRef.current.delete(itemId);
          changed = true;
          continue;
        }
        if (overlay.laneOverride && row._lane === overlay.laneOverride) {
          snapshotPendingRef.current.delete(itemId);
          changed = true;
          continue;
        }
        if (overlay.hidden || overlay.statusOverride) {
          next.set(itemId, overlay);
          continue;
        }
        next.set(itemId, overlay);
      }

      return changed ? next : prev;
    });
  }, [activeSnapshotMode, rawActiveSnapshotEmails]);

  const optimisticActiveSnapshotEmails = useMemo(() => {
    if (!activeSnapshotMode || snapshotOptimistic.size === 0) return rawActiveSnapshotEmails;
    const out = [];

    for (const email of rawActiveSnapshotEmails) {
      const itemId = String(email.snapshot_item_id);
      const overlay = snapshotOptimistic.get(itemId);
      if (!overlay) {
        out.push(email);
        continue;
      }
      if (overlay.hidden) continue;
      out.push({
        ...email,
        lane: overlay.laneOverride || email.lane,
        _lane: overlay.laneOverride || email._lane,
        handled_at: overlay.handledAt || email.handled_at,
        _optimisticSnapshotAction: overlay.pendingAction,
        _optimisticSnapshotPending: overlay.pending,
      });
    }

    return out;
  }, [activeSnapshotMode, rawActiveSnapshotEmails, snapshotOptimistic]);

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
  const inboxAiResultMode = isInboxAiResultMode(inboxAiSearch);

  const visibleEmails = useMemo(() => {
    if (inboxAiResultMode) return inboxAiSearch.emails;
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
      const order = { carryover: 0, needs_attention: 1, action: 1, catch_up: 2, fyi: 3, handled: 4, noise: 5 };
      if (a._untriaged && !b._untriaged) return -1;
      if (!a._untriaged && b._untriaged) return 1;
      if (order[a._lane] !== order[b._lane]) return (order[a._lane] ?? 3) - (order[b._lane] ?? 3);
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
    inboxAiResultMode,
    inboxAiSearch.emails,
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
          setIndexedSearch(normalizeIndexedSearchResults(data, liveReadOverrides));
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
    const counts = { needs_attention: 0, action: 0, carryover: 0, catch_up: 0, fyi: 0, handled: 0, noise: 0 };
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
      needs_attention: 0,
      action: 0,
      carryover: 0,
      catch_up: 0,
      fyi: 0,
      handled: 0,
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
    return flatEmails.filter((email) => !email.read).length;
  }, [flatEmails]);

  const noiseUnreadCount = useMemo(() => computeScopedNoiseUnreadCount(flatEmails, {
    accountId,
    categoryFilter,
    indexedSearchActive,
    snoozedMap,
    nowTick,
  }), [accountId, categoryFilter, flatEmails, indexedSearchActive, nowTick, snoozedMap]);

  const unreadInView = useMemo(() => {
    return visibleEmails.filter((email) => !email.read).length;
  }, [visibleEmails]);

  const selectedEmail = useMemo(() => {
    if (!selectedId) return null;
    const aiHit = inboxAiSearch.emails.find((email) => email.id === selectedId || email.uid === selectedId);
    if (aiHit) return aiHit;
    const searchHit = indexedSearch.emails.find((email) => email.id === selectedId || email.uid === selectedId);
    if (searchHit) return searchHit;
    return flatEmails.find((email) => email.id === selectedId || email.uid === selectedId) || null;
  }, [selectedId, flatEmails, indexedSearch.emails, inboxAiSearch.emails]);

  const requestInboxAiSearch = useCallback((query = search) => {
    setInboxAiSearch((prev) => requestInboxAiConfirmation(prev, query));
  }, [search]);

  const cancelInboxAiSearch = useCallback(() => {
    setInboxAiSearch((prev) => clearInboxAiSearch(prev));
  }, []);

  const confirmInboxAiSearch = useCallback(() => {
    const query = inboxAiSearch.status === "confirming" ? inboxAiSearch.query : search.trim();
    if (query.length < 2) return;

    inboxAiRequestRef.current += 1;
    const requestId = inboxAiRequestRef.current;
    setInboxAiSearch((prev) => startInboxAiRequest(prev, query, requestId));

    askInboxAiSearch(query)
      .then((data) => {
        setInboxAiSearch((prev) => completeInboxAiRequest(prev, {
          requestId,
          response: data,
          readOverrides: liveReadOverridesRef.current,
        }));
      })
      .catch((err) => {
        setInboxAiSearch((prev) => failInboxAiRequest(prev, { requestId, error: err }));
      });
  }, [inboxAiSearch.query, inboxAiSearch.status, search]);

  useEffect(() => {
    if (!selectedId) return;
    if (selectedEmail) return;
    setSelectedId(null);
  }, [selectedEmail, selectedId, setSelectedId]);

  useEffect(() => {
    setBillOpen(false);
  }, [selectedId]);

  const markEmailReadRef = useRef(markEmailRead);
  useEffect(() => {
    markEmailReadRef.current = markEmailRead;
  }, [markEmailRead]);

  const updateIndexedSearchRead = useCallback((uid, read) => {
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
      else if (email._activeSnapshot && email.uid) {
        onLiveReadOverrideChange(email.uid, true);
        markEmailRead(email.id || email.uid);
      }
      else markEmailRead(email.id || email.uid);
    }

    if (liveUids.length) {
      for (const uid of liveUids) onLiveReadOverrideChange(uid, true);
    }

    const allUids = unread.map((email) => email.uid).filter(Boolean);
    if (allUids.length) {
      setIndexedSearch((prev) => ({
        ...prev,
        emails: prev.emails.map((email) => (
          allUids.includes(email.uid) ? { ...email, read: true } : email
        )),
      }));
      markAllEmailsAsRead(allUids).catch(() => {});
    }
  }, [readOnly, visibleEmails, markEmailRead, onLiveReadOverrideChange]);

  const moveBy = useCallback((direction) => {
    const index = visibleEmails.findIndex((email) => email.id === selectedId || email.uid === selectedId);
    const nextIndex = Math.max(0, Math.min(visibleEmails.length - 1, index + direction));
    const next = visibleEmails[nextIndex];
    if (next) setSelectedId(next.id || next.uid);
  }, [visibleEmails, selectedId, setSelectedId]);

  const buildEmailSnapshot = useCallback((email) => {
    if (!email) return null;
    const account = email._account;
    return {
      uid: email.uid || email.id,
      id: email.id || email.uid,
      subject: email.subject,
      from: email.from,
      fromEmail: email.fromEmail || email.from_email,
      from_email: email.from_email || email.fromEmail,
      preview: email.preview || email.body_preview || "",
      body_preview: email.body_preview || email.preview || "",
      date: email.date,
      read: !!email.read,
      account_id: email.account_id || account?.account_id || account?.id,
      account_email: email.account_email || account?.email,
      account_label: email.account_label || account?.name,
      account_color: email.account_color || account?.color,
      account_icon: email.account_icon || account?.icon,
      urgency: email.urgency,
      hasBill: email.hasBill,
      extractedBill: email.extractedBill,
      claude: email.claude,
      aiSummary: email.aiSummary,
    };
  }, []);

  const onAction = useCallback((kind, payload) => {
    if (!selectedEmail) return;

    const id = selectedEmail.id;
    const uid = selectedEmail.uid || id;
    const catchUpSelected = isCatchUpEmail(selectedEmail);
    if (kind === "next") {
      moveBy(1);
      return;
    }

    if (kind === "prev") {
      moveBy(-1);
      return;
    }

    if (kind === "trash") {
      const command = buildTrashCommand(selectedEmail, { readOnly });
      if (!command.allowed) return;
      if (command.scope === "live") {
        setLiveTrashedUids((prev) => applyLiveTrashOptimistic(prev, command.uid, true));
        replaceUndoSlot({
          type: "trash",
          message: "Email moved to trash",
          commit: async () => {
            await trashEmail(command.uid);
            await onActiveSnapshotRefresh();
          },
          undo: async () => {
            setLiveTrashedUids((prev) => applyLiveTrashOptimistic(prev, command.uid, false));
            setSelectedId(command.restoreSelectedId);
          },
        });
      } else if (command.scope === "activeSnapshot") {
        if (command.itemId) setSnapshotOptimistic((prev) => applySnapshotTrashOptimistic(prev, command.itemId, true));
        replaceUndoSlot({
          type: "trash",
          message: "Email moved to trash",
          commit: async () => {
            await trashEmail(command.uid);
            await onActiveSnapshotRefresh();
          },
          undo: async () => {
            if (command.itemId) setSnapshotOptimistic((prev) => applySnapshotTrashOptimistic(prev, command.itemId, false));
            setSelectedId(command.restoreSelectedId);
          },
        });
      } else {
        handleDismiss(command.id);
        replaceUndoSlot({
          type: "trash",
          message: "Email moved to trash",
          commit: async () => {
            await trashEmail(command.uid);
          },
          undo: async () => {
            setSelectedId(command.restoreSelectedId);
          },
        });
      }

      setSnoozedMap((prev) => {
        if (!prev.has(uid)) return prev;
        const next = new Map(prev);
        next.delete(uid);
        return next;
      });

      moveBy(1);
      return;
    }

    if (kind === "snapshot-move-lane") {
      if (catchUpSelected) return;
      if (readOnly) return;
      if (!selectedEmail._activeSnapshot || !selectedEmail.snapshot_item_id) return;
      const itemId = String(selectedEmail.snapshot_item_id);
      if (snapshotPendingRef.current.has(itemId)) return;
      const previousLane = selectedEmail._lane === "carryover"
        ? "needs_attention"
        : selectedEmail._lane;
      const restoreSelectedId = id || uid;
      const requestToken = ++snapshotRequestRef.current;
      snapshotPendingRef.current.add(itemId);
      setSnapshotOptimistic((prev) => {
        const next = new Map(prev);
        next.set(itemId, {
          ...(prev.get(itemId) || {}),
          laneOverride: payload,
          hidden: false,
          pendingAction: "move-lane",
          pending: true,
          requestToken,
        });
        return next;
      });
      moveSnapshotItemLane(selectedEmail.snapshot_item_id, payload)
        .then(() => onActiveSnapshotRefresh())
        .then(() => {
          snapshotPendingRef.current.delete(itemId);
          setSnapshotOptimistic((prev) => {
            const current = prev.get(itemId);
            if (!current || current.requestToken !== requestToken) return prev;
            const next = new Map(prev);
            next.set(itemId, { ...current, pending: false });
            return next;
          });
        })
        .catch(() => {
          snapshotPendingRef.current.delete(itemId);
          setSnapshotOptimistic((prev) => {
            const current = prev.get(itemId);
            if (!current || current.requestToken !== requestToken) return prev;
            const next = new Map(prev);
            next.delete(itemId);
            return next;
          });
          onActiveSnapshotRefresh();
        });
      replaceUndoSlot({
        type: "snapshot-move-lane",
        message: `Moved to ${formatLaneLabel(payload)}`,
        undo: async () => {
          if (!previousLane || previousLane === payload) return;
          await moveSnapshotItemLane(selectedEmail.snapshot_item_id, previousLane);
          setSnapshotOptimistic((prev) => {
            const next = new Map(prev);
            next.set(itemId, {
              ...(prev.get(itemId) || {}),
              laneOverride: previousLane,
              hidden: false,
              pendingAction: "undo-move-lane",
              pending: false,
            });
            return next;
          });
          setSelectedId(restoreSelectedId);
          await onActiveSnapshotRefresh();
        },
      });
      return;
    }

    if (kind === "snapshot-dismiss") {
      if (catchUpSelected) return;
      if (readOnly) return;
      if (!selectedEmail._activeSnapshot || !selectedEmail.snapshot_item_id) return;
      const itemId = String(selectedEmail.snapshot_item_id);
      if (snapshotPendingRef.current.has(itemId)) return;
      const restoreSelectedId = id || uid;
      const requestToken = ++snapshotRequestRef.current;
      snapshotPendingRef.current.add(itemId);
      setSnapshotOptimistic((prev) => {
        const next = new Map(prev);
        next.set(itemId, {
          ...(prev.get(itemId) || {}),
          hidden: true,
          pendingAction: "dismiss",
          pending: true,
          requestToken,
        });
        return next;
      });
      dismissSnapshotItemForToday(selectedEmail.snapshot_item_id)
        .then(() => onActiveSnapshotRefresh())
        .then(() => {
          snapshotPendingRef.current.delete(itemId);
          setSnapshotOptimistic((prev) => {
            const current = prev.get(itemId);
            if (!current || current.requestToken !== requestToken) return prev;
            const next = new Map(prev);
            next.set(itemId, { ...current, pending: false });
            return next;
          });
        })
        .catch(() => {
          snapshotPendingRef.current.delete(itemId);
          setSnapshotOptimistic((prev) => {
            const current = prev.get(itemId);
            if (!current || current.requestToken !== requestToken) return prev;
            const next = new Map(prev);
            next.delete(itemId);
            return next;
          });
          onActiveSnapshotRefresh();
        });
      replaceUndoSlot({
        type: "snapshot-dismiss",
        message: "Email dismissed",
        undo: async () => {
          await restoreSnapshotItemForToday(selectedEmail.snapshot_item_id);
          setSnapshotOptimistic((prev) => {
            const next = new Map(prev);
            next.delete(itemId);
            return next;
          });
          setSelectedId(restoreSelectedId);
          await onActiveSnapshotRefresh();
        },
      });
      moveBy(1);
      return;
    }

    if (kind === "snapshot-handled") {
      if (catchUpSelected) return;
      if (readOnly) return;
      if (!selectedEmail._activeSnapshot || !selectedEmail.snapshot_item_id) return;
      const itemId = String(selectedEmail.snapshot_item_id);
      if (snapshotPendingRef.current.has(itemId)) return;
      const restoreSelectedId = id || uid;
      const restoreLane = getSnapshotReopenLane(selectedEmail);
      const requestToken = ++snapshotRequestRef.current;
      snapshotPendingRef.current.add(itemId);
      setSnapshotOptimistic((prev) => {
        const next = new Map(prev);
        next.set(itemId, {
          ...(prev.get(itemId) || {}),
          hidden: false,
          laneOverride: "handled",
          handledAt: new Date().toISOString(),
          statusOverride: "handled",
          pendingAction: "handled",
          pending: true,
          requestToken,
        });
        return next;
      });
      markSnapshotItemHandled(selectedEmail.snapshot_item_id)
        .then(() => onActiveSnapshotRefresh())
        .then(() => {
          snapshotPendingRef.current.delete(itemId);
          setSnapshotOptimistic((prev) => {
            const current = prev.get(itemId);
            if (!current || current.requestToken !== requestToken) return prev;
            const next = new Map(prev);
            next.set(itemId, { ...current, pending: false });
            return next;
          });
        })
        .catch(() => {
          snapshotPendingRef.current.delete(itemId);
          setSnapshotOptimistic((prev) => {
            const current = prev.get(itemId);
            if (!current || current.requestToken !== requestToken) return prev;
            const next = new Map(prev);
            next.delete(itemId);
            return next;
          });
          onActiveSnapshotRefresh();
        });
      replaceUndoSlot({
        type: "snapshot-handled",
        message: "Marked handled",
        undo: async () => {
          await reopenSnapshotItem(selectedEmail.snapshot_item_id);
          setSnapshotOptimistic((prev) => {
            const next = new Map(prev);
            next.set(itemId, {
              ...(prev.get(itemId) || {}),
              hidden: false,
              laneOverride: restoreLane,
              handledAt: null,
              statusOverride: null,
              pendingAction: "undo-handled",
              pending: false,
            });
            return next;
          });
          setSelectedId(restoreSelectedId);
          await onActiveSnapshotRefresh();
        },
      });
      moveBy(1);
      return;
    }

    if (kind === "snapshot-reopen") {
      if (catchUpSelected) return;
      if (readOnly) return;
      if (!selectedEmail._activeSnapshot || !selectedEmail.snapshot_item_id) return;
      const itemId = String(selectedEmail.snapshot_item_id);
      if (snapshotPendingRef.current.has(itemId)) return;
      const restoreSelectedId = id || uid;
      const restoreLane = getSnapshotReopenLane(selectedEmail);
      const requestToken = ++snapshotRequestRef.current;
      snapshotPendingRef.current.add(itemId);
      setSnapshotOptimistic((prev) => {
        const next = new Map(prev);
        next.set(itemId, {
          ...(prev.get(itemId) || {}),
          hidden: false,
          laneOverride: restoreLane,
          handledAt: null,
          statusOverride: null,
          pendingAction: "reopen",
          pending: true,
          requestToken,
        });
        return next;
      });
      reopenSnapshotItem(selectedEmail.snapshot_item_id)
        .then(() => onActiveSnapshotRefresh())
        .then(() => {
          snapshotPendingRef.current.delete(itemId);
          setSnapshotOptimistic((prev) => {
            const current = prev.get(itemId);
            if (!current || current.requestToken !== requestToken) return prev;
            const next = new Map(prev);
            next.set(itemId, { ...current, pending: false });
            return next;
          });
        })
        .catch(() => {
          snapshotPendingRef.current.delete(itemId);
          setSnapshotOptimistic((prev) => {
            const current = prev.get(itemId);
            if (!current || current.requestToken !== requestToken) return prev;
            const next = new Map(prev);
            next.delete(itemId);
            return next;
          });
          onActiveSnapshotRefresh();
        });
      replaceUndoSlot({
        type: "snapshot-reopen",
        message: "Email reopened",
        undo: async () => {
          await markSnapshotItemHandled(selectedEmail.snapshot_item_id);
          setSnapshotOptimistic((prev) => {
            const next = new Map(prev);
            next.set(itemId, {
              ...(prev.get(itemId) || {}),
              hidden: false,
              laneOverride: "handled",
              handledAt: selectedEmail.handled_at || new Date().toISOString(),
              statusOverride: "handled",
              pendingAction: "undo-reopen",
              pending: false,
            });
            return next;
          });
          setSelectedId(restoreSelectedId);
          await onActiveSnapshotRefresh();
        },
      });
      return;
    }

    if (kind === "snooze") {
      if (catchUpSelected) return;
      if (readOnly) return;
      const untilTs = Number(payload);
      if (!Number.isFinite(untilTs) || untilTs <= Date.now()) return;
      setSnoozedMap((prev) => {
        const next = new Map(prev);
        next.set(uid, untilTs);
        return next;
      });
      const snapshot = buildEmailSnapshot(selectedEmail);
      const restoreSelectedId = id || uid;
      const snoozePromise = snoozeEmail(uid, untilTs, snapshot).catch((err) => {
        setSnoozedMap((prev) => {
          const next = new Map(prev);
          next.delete(uid);
          return next;
        });
        throw err;
      });
      snoozePromise.catch(() => {});
      replaceUndoSlot({
        type: "snooze",
        message: "Email snoozed",
        undo: async () => {
          await snoozePromise.catch(() => {});
          await unsnoozeEmail(uid);
          setSnoozedMap((prev) => {
            const next = new Map(prev);
            next.delete(uid);
            return next;
          });
          setSelectedId(restoreSelectedId);
          await onActiveSnapshotRefresh();
        },
      });
      moveBy(1);
      return;
    }

    if (kind === "toggle-read") {
      if (readOnly) return;
      const markingUnread = !!selectedEmail.read;
      if (selectedEmail._live) {
        onLiveReadOverrideChange(uid, !markingUnread);
        const call = markingUnread ? markEmailAsUnread : markEmailAsRead;
        call(uid).catch(() => {});
      } else if (selectedEmail._activeSnapshot) {
        onLiveReadOverrideChange(uid, !markingUnread);
        const call = markingUnread ? markEmailAsUnread : markEmailAsRead;
        call(uid).catch(() => {});
      } else if (markingUnread) {
        markEmailUnread(id);
        markEmailAsUnread(uid).catch(() => {});
      } else {
        markEmailRead(id);
        markEmailAsRead(uid).catch(() => {});
      }
      updateIndexedSearchRead(uid, !markingUnread);
      if (markingUnread) closeSelectedEmail();
      return;
    }

  }, [
    selectedEmail,
    readOnly,
    moveBy,
    handleDismiss,
    buildEmailSnapshot,
    markEmailRead,
    markEmailUnread,
    onLiveReadOverrideChange,
    closeSelectedEmail,
    updateIndexedSearchRead,
    onActiveSnapshotRefresh,
    replaceUndoSlot,
    setSelectedId,
  ]);

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

      markEmailReadRef.current(selectedId);
      updateIndexedSearchRead(email.uid || selectedId, true);
      if (email.uid) markEmailAsRead(email.uid).catch(() => {});
    }, 500);

    return () => clearTimeout(timeout);
  }, [readOnly, selectedId, selectedEmail, onLiveReadOverrideChange, updateIndexedSearchRead]);

  useEffect(() => {
    function onKey(event) {
      if (shouldHandleInboxUndoHotkey({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        hasUndoSlot: !!undoSlotRef.current,
        editableTarget: isEditableKeyTarget(event.target),
      })) {
        event.preventDefault();
        event.stopPropagation();
        onUndo();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        searchRef.current?.focus();
        searchRef.current?.select?.();
        return;
      }

      if (
        shouldSuspendInboxHotkeys(event.target)
      ) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveBy(1);
      } else if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveBy(-1);
      } else if (key === "o") {
        event.preventDefault();
        if (!selectedEmail) return;
        const url = getGmailUrl(selectedEmail);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const action = resolveInboxHotkeyAction(key, selectedEmail, readOnly);
        if (!action) return;
        event.preventDefault();
        if (action.kind === "snooze-default") {
          onAction("snooze", defaultSnoozeTs());
        } else if (action.kind === "snapshot-move-lane") {
          onAction(action.kind, action.lane);
        } else {
          onAction(action.kind);
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveBy, onAction, onUndo, readOnly, selectedEmail, undoSlotRef]);

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
    inboxAiSearchAccountsById: inboxAiSearch.accountsById,
    inboxAiSearch,
    inboxAiSearchActive: inboxAiResultMode,
    onInboxAiIntent: requestInboxAiSearch,
    onInboxAiConfirm: confirmInboxAiSearch,
    onInboxAiCancel: cancelInboxAiSearch,
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
    scopedAccount: indexedSearchActive || inboxAiResultMode ? null : scopedAccount,
  };
}

function formatLaneLabel(lane) {
  if (lane === "needs_attention") return "Needs Attention";
  if (lane === "fyi") return "FYI";
  if (lane === "noise") return "Noise";
  if (lane === "handled") return "Handled";
  return "lane";
}

function isEditableKeyTarget(target) {
  if (!target) return false;
  const tagName = target.tagName;
  return tagName === "INPUT"
    || tagName === "TEXTAREA"
    || tagName === "SELECT"
    || target.isContentEditable;
}
