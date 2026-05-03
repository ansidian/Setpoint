import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useKeyHold from "../../hooks/useKeyHold";
import useInboxSelectionHistory from "../../hooks/email/useInboxSelectionHistory";
import { useDashboard } from "../../context/DashboardContext";
import {
  markEmailAsRead,
  markEmailAsUnread,
  trashEmail,
  snoozeEmail,
  markAllEmailsAsRead,
  searchEmails,
  moveSnapshotItemLane,
  dismissSnapshotItemForToday,
  markSnapshotItemHandled,
} from "../../api";
import { getGmailUrl } from "../../lib/email-links";
import {
  timeSince,
  defaultSnoozeTs,
  makeSynthAccount,
  collectBriefingEmails,
  collectActiveSnapshotEmails,
  collectLiveEmails,
  collectResurfaced,
  mergeReadState,
} from "./helpers";

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
  briefingGeneratedAt,
  sessionState,
  onSessionStateChange = () => {},
  onActiveSnapshotRefresh = () => {},
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
  const searchRequestRef = useRef(0);

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
        ...collectActiveSnapshotEmails(activeSnapshot, liveReadOverrides)
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
    for (const entry of collectBriefingEmails(emailAccounts)) pushEmail(entry);
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
    activeSnapshot,
    activeSnapshotMode,
    emailAccounts,
    liveEmails,
    liveReadOverrides,
    liveTrashedUids,
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
      const order = { carryover: 0, needs_attention: 1, action: 1, fyi: 2, noise: 3 };
      if (a._untriaged && !b._untriaged) return -1;
      if (!a._untriaged && b._untriaged) return 1;
      if (order[a._lane] !== order[b._lane]) return (order[a._lane] ?? 3) - (order[b._lane] ?? 3);
      const aKey = a._resurfacedAt || new Date(a.date).getTime();
      const bKey = b._resurfacedAt || new Date(b.date).getTime();
      return bKey - aKey;
    });
  }, [flatEmails, accountId, categoryFilter, lane, snoozedMap, nowTick, indexedSearch.emails, indexedSearchActive]);

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
    const counts = { needs_attention: 0, action: 0, carryover: 0, fyi: 0, noise: 0 };
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
      fyi: 0,
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

  const unreadInView = useMemo(() => {
    return visibleEmails.filter((email) => !email.read).length;
  }, [visibleEmails]);

  const selectedEmail = useMemo(() => {
    if (!selectedId) return null;
    const searchHit = indexedSearch.emails.find((email) => email.id === selectedId || email.uid === selectedId);
    if (searchHit) return searchHit;
    return flatEmails.find((email) => email.id === selectedId || email.uid === selectedId) || null;
  }, [selectedId, flatEmails, indexedSearch.emails]);

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
  }, [visibleEmails, markEmailRead, onLiveReadOverrideChange]);

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

    if (kind === "next") {
      moveBy(1);
      return;
    }

    if (kind === "prev") {
      moveBy(-1);
      return;
    }

    if (kind === "trash") {
      if (selectedEmail._live) {
        setLiveTrashedUids((prev) => {
          const next = new Set(prev);
          next.add(uid);
          return next;
        });
        trashEmail(uid).then(() => onActiveSnapshotRefresh()).catch(() => {});
      } else if (selectedEmail._activeSnapshot) {
        trashEmail(uid).then(() => onActiveSnapshotRefresh()).catch(() => {});
      } else {
        handleDismiss(id);
        trashEmail(uid).catch(() => {});
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
      if (!selectedEmail._activeSnapshot || !selectedEmail.snapshot_item_id) return;
      moveSnapshotItemLane(selectedEmail.snapshot_item_id, payload)
        .then(() => onActiveSnapshotRefresh())
        .catch(() => {});
      return;
    }

    if (kind === "snapshot-dismiss") {
      if (!selectedEmail._activeSnapshot || !selectedEmail.snapshot_item_id) return;
      dismissSnapshotItemForToday(selectedEmail.snapshot_item_id)
        .then(() => onActiveSnapshotRefresh())
        .catch(() => {});
      moveBy(1);
      return;
    }

    if (kind === "snapshot-handled") {
      if (!selectedEmail._activeSnapshot || !selectedEmail.snapshot_item_id) return;
      markSnapshotItemHandled(selectedEmail.snapshot_item_id)
        .then(() => onActiveSnapshotRefresh())
        .catch(() => {});
      moveBy(1);
      return;
    }

    if (kind === "snooze") {
      const untilTs = Number(payload);
      if (!Number.isFinite(untilTs) || untilTs <= Date.now()) return;
      setSnoozedMap((prev) => {
        const next = new Map(prev);
        next.set(uid, untilTs);
        return next;
      });
      const snapshot = buildEmailSnapshot(selectedEmail);
      snoozeEmail(uid, untilTs, snapshot).catch(() => {
        setSnoozedMap((prev) => {
          const next = new Map(prev);
          next.delete(uid);
          return next;
        });
      });
      moveBy(1);
      return;
    }

    if (kind === "toggle-read") {
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
    moveBy,
    handleDismiss,
    buildEmailSnapshot,
    markEmailRead,
    markEmailUnread,
    onLiveReadOverrideChange,
    closeSelectedEmail,
    updateIndexedSearchRead,
    onActiveSnapshotRefresh,
  ]);

  const trashHold = useKeyHold({
    key: "e",
    durationMs: 750,
    enabled: !!selectedEmail,
    onComplete: () => onAction("trash"),
  });

  const snoozeHold = useKeyHold({
    key: "s",
    durationMs: 750,
    enabled: !!selectedEmail,
    onComplete: () => onAction("snooze", defaultSnoozeTs()),
  });

  useEffect(() => {
    if (!selectedId) return undefined;
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
  }, [selectedId, selectedEmail, onLiveReadOverrideChange, updateIndexedSearchRead]);

  useEffect(() => {
    function onKey(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        searchRef.current?.focus();
        searchRef.current?.select?.();
        return;
      }

      if (
        event.target.tagName === "INPUT"
        || event.target.tagName === "TEXTAREA"
        || event.target.isContentEditable
      ) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveBy(1);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveBy(-1);
      } else if (event.key === "o") {
        event.preventDefault();
        if (!selectedEmail) return;
        const url = getGmailUrl(selectedEmail);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveBy, onAction, selectedEmail]);

  const selectedAccount = selectedEmail
    ? accountsById[selectedEmail._accountKey] || selectedEmail._account
    : null;

  const briefingAgoLabel = briefingGeneratedAt
    ? `Triaged ${timeSince(briefingGeneratedAt.endsWith("Z") ? briefingGeneratedAt : `${briefingGeneratedAt}Z`)}`
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
    visibleEmails,
    laneCounts,
    liveCount,
    mobileChipCounts,
    totalUnread,
    unreadInView,
    markAllVisibleRead,
    onAction,
    trashHold,
    snoozeHold,
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
    briefingAgoLabel,
    scopedAccount: indexedSearchActive ? null : scopedAccount,
  };
}

function stripHighlight(value) {
  return String(value || "").replace(/<\/?mark>/g, "");
}

function normalizeIndexedSearchResults(data, readOverrides) {
  const accountsById = {};
  const emails = [];

  for (const account of data?.accounts || []) {
    const accountKey = account.account_id;
    const normalizedAccount = {
      id: account.account_id,
      name: account.account_label,
      email: account.account_email,
      color: account.account_color,
      icon: account.account_icon || "Mail",
    };
    accountsById[accountKey] = normalizedAccount;

    for (const result of account.results || []) {
      const uid = result.uid;
      emails.push({
        id: uid,
        uid,
        subject: stripHighlight(result.subject),
        from: result.from_name || result.from_address || "Unknown",
        fromEmail: result.from_address,
        from_email: result.from_address,
        preview: stripHighlight(result.body_snippet || result.body_highlight),
        body_preview: stripHighlight(result.body_snippet || result.body_highlight),
        date: result.email_date,
        email_date: result.email_date,
        read: mergeReadState(result.read, uid, readOverrides),
        account_id: account.account_id,
        account_label: account.account_label,
        account_email: account.account_email,
        account_color: account.account_color,
        account_icon: account.account_icon || "Mail",
        web_url: result.web_url,
        _accountKey: accountKey,
        _account: normalizedAccount,
        _lane: null,
        _untriaged: false,
        _indexedSearch: true,
      });
    }
  }

  return {
    query: data?.query || "",
    emails,
    accountsById,
    loading: false,
    error: null,
  };
}
