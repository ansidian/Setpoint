import { useCallback, useEffect, useRef, useState } from "react";
import { searchEmails } from "../../api";
import { composeReadOverrides } from "./inboxWorkItems.js";
import { normalizeIndexedSearchResults } from "./indexedSearchModel.js";

// Indexed full-text search: debounced server query, stale-response guard, and
// the local read-override reconciliation that keeps a just-toggled read state
// from being clobbered by a fresh search response. Lifted out of
// useInboxController so the controller no longer owns this async subsystem.
export default function useIndexedSearch({ search, liveReadOverrides }) {
  const [indexedSearch, setIndexedSearch] = useState({
    query: "",
    emails: [],
    accountsById: {},
    loading: false,
    error: null,
    total: 0,
    hasMore: false,
  });
  const [searchLimit, setSearchLimit] = useState(30);
  const searchRequestRef = useRef(0);
  // Tracks the query the current searchLimit was grown for, so the term-change
  // effect below can tell "limit already reset for this term" apart from
  // "term changed, reset the limit" without re-triggering on every render.
  const searchLimitTermRef = useRef(search.trim());
  // Local read-toggles applied to indexed-search hits that are not live/snapshot
  // emails. These live only in indexedSearch.emails, not in liveReadOverrides,
  // so a fresh search response would otherwise rebuild rows from server read +
  // liveReadOverrides and drop a just-applied toggle. Carry them forward here so
  // re-merges reconcile against the latest local search read state.
  const searchReadOverridesRef = useRef(new Map());

  const indexedSearchActive = search.trim().length >= 2;

  useEffect(() => {
    const term = search.trim();

    // A changed search term resets the grow-limit back to the base page size.
    // Track the term the limit was last grown for so a loadMore-triggered
    // render (searchLimit changes, term does not) doesn't reset itself.
    if (searchLimitTermRef.current !== term) {
      searchLimitTermRef.current = term;
      if (searchLimit !== 30) {
        setSearchLimit(30);
        return undefined;
      }
    }

    searchRequestRef.current += 1;
    const requestId = searchRequestRef.current;

    if (term.length < 2) {
      setIndexedSearch({
        query: term,
        emails: [],
        accountsById: {},
        loading: false,
        error: null,
        total: 0,
        hasMore: false,
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
      searchEmails(term, searchLimit)
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
            total: 0,
            hasMore: false,
          });
        });
    }, 250);

    return () => clearTimeout(timeout);
  // Intentionally exclude liveReadOverrides from deps. Some callers pass
  // object-literal read override defaults, and including that object here
  // would restart the debounce after every search-state render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, searchLimit]);

  const loadMoreIndexedSearch = useCallback(() => {
    setSearchLimit((current) => (current >= 100 ? current : Math.min(current + 30, 100)));
  }, []);

  const updateIndexedSearchRead = useCallback((uid, read) => {
    if (uid) searchReadOverridesRef.current.set(uid, !!read);
    setIndexedSearch((prev) => ({
      ...prev,
      emails: prev.emails.map((email) => (
        email.uid === uid || email.id === uid ? { ...email, read } : email
      )),
    }));
  }, []);

  // Bulk variant used by "mark all visible read": record the overrides and flip
  // every matching indexed-search row read in one pass.
  const markIndexedSearchReadBulk = useCallback((uids) => {
    if (!uids || uids.length === 0) return;
    for (const uid of uids) searchReadOverridesRef.current.set(uid, true);
    setIndexedSearch((prev) => ({
      ...prev,
      emails: prev.emails.map((email) => (
        uids.includes(email.uid) ? { ...email, read: true } : email
      )),
    }));
  }, []);

  // Once the grow-limit ceiling is reached, loadMore can't fetch anything
  // further, so hasMore is surfaced as false regardless of what the server
  // reports (the UI instead shows "first 100 of N" via total > emails.length).
  const cappedIndexedSearch = indexedSearch.hasMore && searchLimit >= 100
    ? { ...indexedSearch, hasMore: false }
    : indexedSearch;

  return {
    indexedSearch: cappedIndexedSearch,
    indexedSearchActive,
    updateIndexedSearchRead,
    markIndexedSearchReadBulk,
    loadMoreIndexedSearch,
  };
}
