import { getActualMetadata } from "../api";

export interface ActualMetadataEntry {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface ActualCategoryMetadata extends ActualMetadataEntry {
  group: string;
}

export interface ActualMetadata {
  accounts: ActualMetadataEntry[];
  payees: ActualMetadataEntry[];
  categories: ActualCategoryMetadata[];
}

type ActualMetadataListener = (metadata: ActualMetadata) => void;

// Shared Actual Budget metadata cache — single fetch for accounts, payees,
// categories. Layer (a) of the Actual metadata cache stack (see the layering
// diagram in server/bills/bills-service.ts). Invalidated when the bills
// SSE event signals that bill data changed; the next consumer refetches.
let _metadataCache: ActualMetadata | null = null;
let _metadataFetching = false;
let _metadataListeners: ActualMetadataListener[] = [];
let _generation = 0;

export function invalidateActualMetadata(): void {
  _metadataCache = null;
  // Bump the generation so an in-flight fetch that started before the
  // invalidation cannot repopulate the cache with stale data.
  _generation += 1;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ea-actual-metadata-invalidated"));
  }
}

// Reset the fetch bookkeeping before invoking callbacks so a load triggered
// from inside a callback (or right after an invalidation) starts a new fetch
// instead of parking a listener that nothing will ever call.
function settleListeners(metadata: ActualMetadata): void {
  const listeners = _metadataListeners;
  _metadataListeners = [];
  _metadataFetching = false;
  listeners.forEach(fn => fn(metadata));
}

export function ensureMetadataLoaded(callback: ActualMetadataListener): void {
  if (_metadataCache) { callback(_metadataCache); return; }
  _metadataListeners.push(callback);
  if (_metadataFetching) return;
  _metadataFetching = true;
  const generation = _generation;
  getActualMetadata()
    .then(data => {
      // Flatten grouped categories into a flat list
      const flatCategories: ActualCategoryMetadata[] = [];
      for (const g of data.categories || []) {
        for (const c of g.categories) {
          flatCategories.push({ id: c.id, name: c.name, group: g.group_name || g.name || "" });
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
