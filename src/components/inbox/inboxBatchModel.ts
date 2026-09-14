import { resolveReaderActions } from "./reader/readerActionsModel";
import type { InboxEmailLike } from "./inboxTypes";

export const emailSelectionKey = (email: InboxEmailLike): string => String(email.uid || email.id || "");
export type BatchAction = "read" | "unread" | "trash" | "needs_attention" | "fyi" | "noise" | "handled" | "reopen" | "dismiss" | "pin" | "unpin";
export interface BatchActionOption { action: BatchAction; label: string; count: number; }
const labels: Record<BatchAction, string> = {
  read: "Mark read", unread: "Mark unread", trash: "Move to trash",
  needs_attention: "Move to Needs Attention", fyi: "Move to FYI", noise: "Move to Noise",
  handled: "Mark handled", reopen: "Reopen", dismiss: "Dismiss from today", pin: "Pin", unpin: "Unpin",
};

export function batchTargets(emails: readonly InboxEmailLike[], action: BatchAction, readOnly = false): InboxEmailLike[] {
  const seen = new Set<string>();
  return emails.filter(email => {
    const uid = emailSelectionKey(email);
    if (!uid || seen.has(uid)) return false;
    seen.add(uid);
    if (email._snoozedUnavailable || email._snoozedReturning || email._providerRemoved || email._optimisticSnapshotPending) return false;
    const policy = resolveReaderActions(email, { readOnly });
    switch (action) {
      case "read": return policy.showMutableActions && !email.read;
      case "unread": return policy.showMutableActions && !!email.read;
      case "trash": return policy.showDestructiveActions;
      case "needs_attention": return policy.canMoveToNeeds;
      case "fyi": return policy.canMoveToFyi;
      case "noise": return policy.canMoveToNoise;
      case "handled": return policy.canHandle;
      case "reopen": return policy.canReopen;
      case "dismiss": return policy.canDismiss;
      case "pin": return policy.canPin && !email._pinned;
      case "unpin": return policy.canPin && !!email._pinned;
    }
  });
}

export function batchActionOptions(emails: readonly InboxEmailLike[], readOnly = false): BatchActionOption[] {
  return (Object.keys(labels) as BatchAction[]).map(action => ({ action, label: labels[action], count: batchTargets(emails, action, readOnly).length })).filter(option => option.count > 0);
}

export function batchHotkey(key: string, options: readonly BatchActionOption[]): BatchAction | null {
  const available = (action: BatchAction) => options.some(option => option.action === action);
  const direct: Record<string, BatchAction> = { a: "needs_attention", f: "fyi", n: "noise", d: "dismiss", e: "trash" };
  if (direct[key]) return available(direct[key]) ? direct[key] : null;
  const pair: [BatchAction, BatchAction] | null = key === "h" ? ["handled", "reopen"] : key === "p" ? ["pin", "unpin"] : null;
  if (pair && available(pair[0]) !== available(pair[1])) return available(pair[0]) ? pair[0] : pair[1];
  return null;
}
