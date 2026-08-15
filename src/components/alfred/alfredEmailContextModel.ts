import type {
  AlfredEmailAttachmentRef,
  AlfredEmailContextSource,
  AlfredEmailItem,
  AlfredPreparedEmailContext,
} from "../../../shared/types/alfred";

export type AlfredPendingEmailContext = {
  key: string;
  source: AlfredEmailContextSource;
  status: "preparing" | "ready" | "error";
  prepared: AlfredPreparedEmailContext | null;
  error: string | null;
};

export function pendingEmailAttachment(pending: AlfredPendingEmailContext): AlfredEmailAttachmentRef {
  if (pending.prepared) {
    return {
      ...pending.prepared,
      accountId: pending.source.accountId || pending.prepared.accountId || null,
    };
  }
  const name = String(pending.source.senderName || "").trim();
  const address = String(pending.source.senderAddress || "").trim();
  return {
    uid: pending.source.uid,
    accountId: pending.source.accountId || null,
    subject: String(pending.source.subject || "").trim() || "(No subject)",
    sender: {
      name,
      address,
      display: name && address && name !== address ? `${name} <${address}>` : name || address || "Unknown sender",
    },
    timestamp: pending.source.timestamp || null,
    charCount: 0,
  };
}

export function emailAttachmentPreviewItem(attachment: AlfredEmailAttachmentRef): AlfredEmailItem {
  return {
    uid: attachment.uid,
    subject: attachment.subject,
    from: {
      name: attachment.sender.name || attachment.sender.display,
      address: attachment.sender.address || null,
    },
    email_date: attachment.timestamp,
    account: attachment.accountId ? { id: attachment.accountId } : undefined,
  };
}
