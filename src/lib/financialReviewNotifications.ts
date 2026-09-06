import { isDemoMode } from "../demo/config";
import { publicAssetUrl } from "../publicAsset";
import { financialReviewHref, getFinancialReviewChanges } from "./financialReviewApi";
import type { FinancialReviewChangeCursor } from "../../shared/types/financial-review";

const STORAGE_KEY = "ea_financial_review_notifications_v1";
type SavedState = { cursor: FinancialReviewChangeCursor | null; keys: string[] };

function readSaved(): SavedState {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as SavedState | null;
    if (value && Array.isArray(value.keys) && value.keys.every((key) => typeof key === "string")
      && (!value.cursor || (Number.isFinite(value.cursor.updatedAt) && typeof value.cursor.id === "string"))) return value;
  } catch { /* Storage may be disabled. The mounted controller still deduplicates. */ }
  return { cursor: null, keys: [] };
}

function later(left: FinancialReviewChangeCursor | null, right: FinancialReviewChangeCursor | null) {
  if (!left) return right;
  if (!right) return left;
  return right.updatedAt > left.updatedAt || (right.updatedAt === left.updatedAt && right.id > left.id) ? right : left;
}

/** Browser delivery owner. The feed cursor finds late changes; stable keys suppress routine retries. */
export function createFinancialReviewNotifications(openReview: (href: string) => void) {
  if (isDemoMode() || typeof Notification === "undefined") return { refresh: async () => {}, dispose: () => {} };
  let saved = readSaved();
  const seen = new Set(saved.keys);
  let disposed = false;
  let active: Promise<void> | null = null;
  let pending = false;
  let continuation: FinancialReviewChangeCursor | null | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function drain() {
    if (disposed || Notification.permission !== "granted") return;
    const otherTab = readSaved();
    otherTab.keys.forEach((key) => seen.add(key));
    saved.cursor = later(saved.cursor, otherTab.cursor);
    // Replay a short overlap on each new sweep for timestamp ties and writes
    // that were in flight during the previous read. Delivery remains key-based.
    let cursor = continuation !== undefined ? continuation : saved.cursor
      ? { updatedAt: Math.max(0, saved.cursor.updatedAt - 60_000), id: "" } : null;
    const nextKeys = new Set(seen);
    const newItems: Array<{ key: string; emailUid: string }> = [];
    let hasMore = false;
    for (let page = 0; page < 5; page += 1) {
      const response = await getFinancialReviewChanges(cursor);
      if (disposed || Notification.permission !== "granted") return;
      for (const item of response.items) {
        if (nextKeys.has(item.key)) continue;
        nextKeys.add(item.key);
        newItems.push(item);
      }
      cursor = response.cursor;
      hasMore = response.hasMore;
      if (!hasMore) break;
    }
    if (newItems.length) {
      const notification = new Notification(newItems.length === 1 ? "A financial record needs your attention" : `${newItems.length} financial records need your attention`, {
        body: "Open Finance to complete missing details or check the record in Actual.",
        icon: publicAssetUrl("favicon.svg"), tag: "setpoint-financial-review",
      });
      notification.onclick = () => {
        window.focus();
        openReview(financialReviewHref(newItems.length === 1 ? newItems[0]!.emailUid : undefined));
        notification.close();
      };
    }
    nextKeys.forEach((key) => seen.add(key));
    saved = { cursor: later(saved.cursor, cursor), keys: [...seen] };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* Keep in-memory delivery state. */ }
    continuation = hasMore ? cursor : undefined;
    if (hasMore && !disposed) timer = setTimeout(() => { void refresh(); }, 3_000);
  }

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (active) { pending = true; return active; }
    clearTimeout(timer);
    // The Web Locks API prevents two open Setpoint tabs from delivering the
    // same batch. Browsers without it retain per-tab/in-storage deduplication.
    active = (typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(STORAGE_KEY, drain) : drain())
      .catch(() => { /* Failed reads/delivery leave the cursor available for retry. */ })
      .finally(() => {
        active = null;
        if (pending && !disposed) { pending = false; void refresh(); }
      });
    return active;
  }
  return { refresh, dispose: () => { disposed = true; clearTimeout(timer); } };
}
