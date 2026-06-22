// Pure Gmail history-record projections lifted from gmail-sync.js: scan history
// records into id-sets / event-maps, and derive provider state from message
// metadata. No IO, no db.

export function collectInboxMessageIds(history = []) {
  const ids = new Set();
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

function eventLabelIds(entry) {
  return entry.labelIds || entry.message?.labelIds || [];
}

export function collectUnreadLabelMessageIds(history = []) {
  const ids = new Set();
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

export function collectProviderRemovalEvents(history = []) {
  const events = new Map();
  const addEvent = (messageId, eventType) => {
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

export function providerStateFromMetadata(metadata) {
  if (!metadata) return null;
  const labels = metadata?.labelIds || [];
  if (labels.includes("TRASH")) return "trashed";
  if (!labels.includes("INBOX")) return "archived";
  return null;
}
