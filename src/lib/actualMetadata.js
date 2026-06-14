import { getActualMetadata } from "../api.js";

// Shared Actual Budget metadata cache — single fetch for accounts, payees,
// categories. Layer (a) of the Actual metadata cache stack (see the layering
// diagram in server/bills/bills-service.js). Invalidated when the bills
// SSE event signals that bill data changed; the next consumer refetches.
let _metadataCache = null;
let _metadataFetching = false;
let _metadataListeners = [];
let _generation = 0;

export function invalidateActualMetadata() {
  _metadataCache = null;
  // Bump the generation so an in-flight fetch that started before the
  // invalidation cannot repopulate the cache with stale data.
  _generation += 1;
}

// Reset the fetch bookkeeping before invoking callbacks so a load triggered
// from inside a callback (or right after an invalidation) starts a new fetch
// instead of parking a listener that nothing will ever call.
function settleListeners(metadata) {
  const listeners = _metadataListeners;
  _metadataListeners = [];
  _metadataFetching = false;
  listeners.forEach(fn => fn(metadata));
}

export function ensureMetadataLoaded(callback) {
  if (_metadataCache) { callback(_metadataCache); return; }
  _metadataListeners.push(callback);
  if (_metadataFetching) return;
  _metadataFetching = true;
  const generation = _generation;
  getActualMetadata()
    .then(data => {
      // Flatten grouped categories into a flat list
      const flatCategories = [];
      for (const g of data.categories || []) {
        for (const c of g.categories) {
          flatCategories.push({ id: c.id, name: c.name, group: g.group_name });
        }
      }
      const metadata = { accounts: data.accounts || [], payees: data.payees || [], categories: flatCategories };
      if (generation === _generation) _metadataCache = metadata;
      settleListeners(metadata);
    })
    .catch(() => {
      settleListeners({ accounts: [], payees: [], categories: [] });
    });
}

export { _metadataCache };
