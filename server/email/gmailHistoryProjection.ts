// Pure Gmail history-record projections lifted from gmail-sync.ts: scan history
// records into id-sets / event-maps, and derive provider state from message
// metadata. No IO, no db.

import type {
  GmailHistoryEvent,
  GmailHistoryRecord,
  GmailMessageMetadata,
  GmailProviderRemovalEvent,
  GmailProviderState,
} from "./email-sync-types.ts";

export function collectInboxMessageIds(history: GmailHistoryRecord[] = []): string[] {
  const ids = new Set<string>();
  for (const record of history) {
    for (const entry of record.messagesAdded || []) {
      const message = entry.message || {};
      if (message.id && message.labelIds?.includes("INBOX")) ids.add(message.id);
    }
    for (const entry of record.labelsAdded || []) {
      const message = entry.message || {};
      const labels = entry.labelIds || message.labelIds || [];
      if (message.id && labels.includes("INBOX")) ids.add(message.id);
    }
  }
  return [...ids];
}

function eventLabelIds(entry: GmailHistoryEvent): string[] {
  return entry.labelIds || entry.message?.labelIds || [];
}

export function collectUnreadLabelMessageIds(history: GmailHistoryRecord[] = []): string[] {
  const ids = new Set<string>();
  for (const record of history) {
    for (const entry of record.labelsAdded || []) {
      if (entry.message?.id && eventLabelIds(entry).includes("UNREAD")) ids.add(entry.message.id);
    }
    for (const entry of record.labelsRemoved || []) {
      if (entry.message?.id && eventLabelIds(entry).includes("UNREAD")) ids.add(entry.message.id);
    }
  }
  return [...ids];
}

export function collectProviderRemovalEvents(history: GmailHistoryRecord[] = []): Map<string, Set<GmailProviderRemovalEvent>> {
  const events = new Map<string, Set<GmailProviderRemovalEvent>>();
  const addEvent = (messageId: string | undefined, eventType: GmailProviderRemovalEvent): void => {
    if (!messageId) return;
    const current = events.get(messageId) || new Set();
    current.add(eventType);
    events.set(messageId, current);
  };

  for (const record of history) {
    for (const entry of record.labelsRemoved || []) {
      if (entry.message?.id && eventLabelIds(entry).includes("INBOX")) {
        addEvent(entry.message.id, "inbox_removed");
      }
    }
    for (const entry of record.labelsAdded || []) {
      if (entry.message?.id && eventLabelIds(entry).includes("TRASH")) {
        addEvent(entry.message.id, "trash_added");
      }
    }
    for (const entry of record.messagesDeleted || []) {
      addEvent(entry.message?.id, "message_deleted");
    }
  }
  return events;
}

export function providerStateFromMetadata(metadata: GmailMessageMetadata | null | undefined): GmailProviderState | null {
  if (!metadata) return null;
  const labels = metadata?.labelIds || [];
  if (labels.includes("TRASH")) return "trashed";
  if (!labels.includes("INBOX")) return "archived";
  return null;
}
