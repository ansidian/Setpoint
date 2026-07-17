const CRITICAL_ORDER = ["security", "legal", "finance"];
const COMMITMENT_CATEGORIES = new Set(["school", "infra", "work"]);
const CONTEXT_CATEGORIES = new Set(["personal", "delivery", "utilities", "product"]);
const PASSIVE_CATEGORIES = new Set(["updates", "marketing", "social", "uncategorized"]);
const KNOWN_CATEGORIES = new Set([
  "finance",
  "security",
  "legal",
  "school",
  "personal",
  "work",
  "delivery",
  "infra",
  "updates",
  "marketing",
  "product",
  "social",
  "uncategorized",
  "utilities",
]);

const DEFAULT_VISIBLE_LIMIT = 4;

function priorityForCategory(category: string) {
  if (CRITICAL_ORDER.includes(category)) {
    return { band: 0, rank: CRITICAL_ORDER.indexOf(category) };
  }
  if (COMMITMENT_CATEGORIES.has(category)) return { band: 1, rank: 0 };
  if (CONTEXT_CATEGORIES.has(category)) return { band: 2, rank: 0 };
  if (!KNOWN_CATEGORIES.has(category)) return { band: 3, rank: 0 };
  if (PASSIVE_CATEGORIES.has(category)) return { band: 4, rank: 0 };
  return { band: 3, rank: 0 };
}

function compareByCountThenLabel(a: InboxCategoryFilter, b: InboxCategoryFilter) {
  if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0);
  return a.category.localeCompare(b.category);
}

export function formatInboxCategoryLabel(category: string | null | undefined): string {
  return String(category || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function sortInboxCategoryFilters(categories: InboxCategoryFilter[] = []): InboxCategoryFilter[] {
  return [...categories].sort((a, b) => {
    const aPriority = priorityForCategory(a.category);
    const bPriority = priorityForCategory(b.category);

    if (aPriority.band !== bPriority.band) return aPriority.band - bPriority.band;
    if (aPriority.band === 0) return aPriority.rank - bPriority.rank;
    return compareByCountThenLabel(a, b);
  });
}

export function partitionInboxCategoryFilters(categories: InboxCategoryFilter[] = [], {
  visibleLimit = DEFAULT_VISIBLE_LIMIT,
  activeCategory = "__all",
}: { visibleLimit?: number; activeCategory?: string } = {}) {
  const ordered = sortInboxCategoryFilters(categories);
  const visible = ordered.slice(0, visibleLimit);
  const hidden = ordered.slice(visibleLimit);
  const activeHiddenCategory = hidden.find((entry) => entry.category === activeCategory) || null;

  return {
    ordered,
    visible,
    hidden,
    activeHiddenCategory,
    hiddenCount: hidden.length,
  };
}
import type { InboxCategoryFilter } from "./inboxTypes";
