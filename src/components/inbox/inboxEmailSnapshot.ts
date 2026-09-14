import type { PinnedEmailSnapshot } from "../../../shared/types/email";
import type { InboxEmailLike } from "./inboxTypes";

export function buildEmailSnapshot(email: InboxEmailLike | null | undefined): (PinnedEmailSnapshot & InboxEmailLike) | null {
  if (!email) return null;
  const account = email._account;
  return {
    uid: String(email.uid || email.id || ""),
    id: email.id || email.uid || "",
    subject: email.subject || "",
    from: email.from || "",
    fromEmail: email.fromEmail || email.from_email || "",
    from_email: email.from_email || email.fromEmail || "",
    preview: email.preview || email.body_preview || "",
    body_preview: email.body_preview || email.preview || "",
    date: email.date,
    read: !!email.read,
    account_id: email.account_id || account?.account_id || account?.id || null,
    account_email: email.account_email || account?.email || null,
    account_label: email.account_label || account?.name || null,
    account_color: email.account_color || account?.color || null,
    account_icon: email.account_icon || account?.icon || null,
    deadline_at: email.deadline_at, escalation_badge: email.escalation_badge,
    summary: email.summary, action: email.action, lane: email.lane || email._lane, category: email.category,
    urgency: email.urgency || null,
    hasBill: email.hasBill,
    extractedBill: email.extractedBill,
    claude: email.claude,
    aiSummary: email.aiSummary,
  };
}

