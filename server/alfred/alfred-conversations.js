import crypto from "crypto";

const TTL_MS = 4 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const MAX_CONVERSATIONS = 20;

const conversations = new Map();

export function createAlfredConversation({ now = Date.now() } = {}) {
  if (conversations.size >= MAX_CONVERSATIONS) {
    const oldest = [...conversations.values()].sort((a, b) => a.touchedAt - b.touchedAt)[0];
    if (oldest) conversations.delete(oldest.id);
  }
  const conversation = {
    id: crypto.randomUUID(),
    messages: [],
    items: new Map(),
    touchedAt: now,
  };
  conversations.set(conversation.id, conversation);
  return conversation;
}

export function getAlfredConversation(id, { now = Date.now() } = {}) {
  const conversation = conversations.get(id);
  if (!conversation) return null;
  if (now - conversation.touchedAt > TTL_MS) {
    conversations.delete(id);
    return null;
  }
  conversation.touchedAt = now;
  return conversation;
}

export function deleteAlfredConversation(id) {
  return conversations.delete(id);
}

export function cacheAlfredItems(conversation, kind, rows, keyField = "id") {
  for (const row of rows || []) {
    const key = row?.[keyField];
    if (key == null) continue;
    conversation.items.set(`${kind}:${key}`, row);
  }
}

export function readAlfredItems(conversation, kind, ids) {
  const found = [];
  const missing = [];
  for (const id of ids || []) {
    const row = conversation.items.get(`${kind}:${id}`);
    if (row) found.push(row);
    else missing.push(String(id));
  }
  return { found, missing };
}

export function sweepAlfredConversations({ now = Date.now() } = {}) {
  for (const [id, conversation] of conversations) {
    if (now - conversation.touchedAt > TTL_MS) conversations.delete(id);
  }
}

let sweeperTimer = null;

export function startAlfredConversationSweeper() {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
  sweeperTimer = setInterval(() => sweepAlfredConversations(), SWEEP_INTERVAL_MS);
  sweeperTimer.unref?.();
  return sweeperTimer;
}

export function stopAlfredConversationSweeper() {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
}

export function _clearAlfredConversationsForTest() {
  conversations.clear();
}
