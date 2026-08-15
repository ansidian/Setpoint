import crypto from "crypto";
import type { AlfredItem, AlfredItemKind, AlfredProvider } from "../../shared/types/alfred.ts";
import type { AlfredConversation } from "./alfred-types.ts";
import { DEFAULT_ALFRED_MODEL, DEFAULT_ALFRED_PROVIDER } from "./alfred-models.ts";

export const ALFRED_CONVERSATION_TTL_MS = 4 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const MAX_CONVERSATIONS = 20;

const conversations = new Map<string, AlfredConversation>();

export function createAlfredConversation({
  now = Date.now(),
  provider = DEFAULT_ALFRED_PROVIDER,
  model = DEFAULT_ALFRED_MODEL,
}: { now?: number; provider?: AlfredProvider; model?: string } = {}): AlfredConversation {
  if (conversations.size >= MAX_CONVERSATIONS) {
    const oldest = [...conversations.values()].sort((a, b) => a.touchedAt - b.touchedAt)[0];
    if (oldest) conversations.delete(oldest.id);
  }
  const conversation = {
    id: crypto.randomUUID(),
    provider,
    model,
    messages: [],
    items: new Map(),
    trustedOwnerTurns: [],
    calendarProposalState: {
      activeProposalId: null,
      proposals: new Map(),
      pendingDuplicateFingerprint: null,
    },
    touchedAt: now,
  };
  conversations.set(conversation.id, conversation);
  return conversation;
}

export function getAlfredConversation(id: string, { now = Date.now() }: { now?: number } = {}): AlfredConversation | null {
  const conversation = conversations.get(id);
  if (!conversation) return null;
  if (now - conversation.touchedAt > ALFRED_CONVERSATION_TTL_MS) {
    conversations.delete(id);
    return null;
  }
  conversation.touchedAt = now;
  return conversation;
}

export function deleteAlfredConversation(id: string): boolean {
  return conversations.delete(id);
}

export function alfredConversationExpiresAt(conversation: AlfredConversation): string {
  return new Date(conversation.touchedAt + ALFRED_CONVERSATION_TTL_MS).toISOString();
}

export function acknowledgeAlfredCalendarProposalCreated(
  conversation: AlfredConversation,
  proposalId: string,
): "created" | "missing" {
  const stored = conversation.calendarProposalState.proposals.get(proposalId);
  if (!stored) return "missing";
  if (stored.status !== "created") {
    stored.status = "created";
    if (conversation.calendarProposalState.activeProposalId === proposalId) {
      conversation.calendarProposalState.activeProposalId = null;
    }
  }
  return "created";
}

export function cacheAlfredItems(
  conversation: AlfredConversation,
  kind: AlfredItemKind,
  rows: object[],
  keyField: "id" | "uid" = "id",
): void {
  for (const row of rows || []) {
    const key = (row as Record<string, unknown>)[keyField];
    if (key == null) continue;
    conversation.items.set(`${kind}:${key}`, row as unknown as AlfredItem);
  }
}

export function readAlfredItems(conversation: AlfredConversation, kind: AlfredItemKind, ids: string[]): {
  found: AlfredItem[];
  missing: string[];
} {
  const found: AlfredItem[] = [];
  const missing = [];
  for (const id of ids || []) {
    const row = conversation.items.get(`${kind}:${id}`);
    if (row) found.push(row as AlfredItem);
    else missing.push(String(id));
  }
  return { found, missing };
}

export function sweepAlfredConversations({ now = Date.now() }: { now?: number } = {}): void {
  for (const [id, conversation] of conversations) {
    if (now - conversation.touchedAt > ALFRED_CONVERSATION_TTL_MS) conversations.delete(id);
  }
}

let sweeperTimer: NodeJS.Timeout | null = null;

export function startAlfredConversationSweeper(): NodeJS.Timeout {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
  sweeperTimer = setInterval(() => sweepAlfredConversations(), SWEEP_INTERVAL_MS);
  sweeperTimer.unref?.();
  return sweeperTimer;
}

export function stopAlfredConversationSweeper(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
}

export function clearAlfredConversations(): void {
  conversations.clear();
}
