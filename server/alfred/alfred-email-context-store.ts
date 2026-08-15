import crypto from "crypto";
import type { AlfredPreparedEmailContext } from "../../shared/types/alfred.ts";

const CONTEXT_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_CONTEXTS_PER_OWNER = 8;
const MAX_CONTEXTS_TOTAL = 32;

export interface StoredAlfredEmailContext extends AlfredPreparedEmailContext {
  userId: string;
  modelText: string;
  createdAt: number;
  expiresAt: number;
  claimed: boolean;
}

const contexts = new Map<string, StoredAlfredEmailContext>();

function sweepExpired(now: number): void {
  for (const [id, context] of contexts) {
    if (!context.claimed && context.expiresAt <= now) contexts.delete(id);
  }
}

function evictOldestUnclaimed(matches: (context: StoredAlfredEmailContext) => boolean): boolean {
  const oldest = [...contexts.values()]
    .filter((context) => !context.claimed && matches(context))
    .sort((left, right) => left.createdAt - right.createdAt)[0];
  if (!oldest) return false;
  contexts.delete(oldest.contextId);
  return true;
}

export function storeAlfredEmailContext(
  input: Omit<StoredAlfredEmailContext, "contextId" | "createdAt" | "expiresAt" | "claimed">,
  { now = Date.now() }: { now?: number } = {},
): StoredAlfredEmailContext {
  sweepExpired(now);
  while ([...contexts.values()].filter((context) => context.userId === input.userId).length >= MAX_CONTEXTS_PER_OWNER) {
    if (!evictOldestUnclaimed((context) => context.userId === input.userId)) {
      throw Object.assign(new Error("Too many email contexts are currently in use. Try again shortly."), { status: 429 });
    }
  }
  while (contexts.size >= MAX_CONTEXTS_TOTAL) {
    if (!evictOldestUnclaimed(() => true)) {
      throw Object.assign(new Error("Email context preparation is busy. Try again shortly."), { status: 429 });
    }
  }

  const context: StoredAlfredEmailContext = {
    ...input,
    contextId: crypto.randomUUID(),
    createdAt: now,
    expiresAt: now + CONTEXT_TTL_MS,
    claimed: false,
  };
  contexts.set(context.contextId, context);
  return context;
}

export type AlfredEmailContextClaim =
  | { status: "ok"; context: StoredAlfredEmailContext }
  | { status: "missing" }
  | { status: "busy" };

export function claimAlfredEmailContext(
  contextId: string,
  userId: string,
  { now = Date.now() }: { now?: number } = {},
): AlfredEmailContextClaim {
  sweepExpired(now);
  const context = contexts.get(contextId);
  if (!context || context.userId !== userId) {
    return { status: "missing" };
  }
  if (context.expiresAt <= now) {
    if (!context.claimed) contexts.delete(contextId);
    return { status: "missing" };
  }
  if (context.claimed) return { status: "busy" };
  context.claimed = true;
  return { status: "ok", context };
}

export function releaseAlfredEmailContext(contextId: string, userId: string): boolean {
  const context = contexts.get(contextId);
  if (!context || context.userId !== userId) return false;
  context.claimed = false;
  return true;
}

export function consumeAlfredEmailContext(contextId: string, userId: string): boolean {
  const context = contexts.get(contextId);
  if (!context || context.userId !== userId) return false;
  return contexts.delete(contextId);
}

export function discardAlfredEmailContext(contextId: string, userId: string): boolean {
  const context = contexts.get(contextId);
  if (!context || context.userId !== userId || context.claimed) return false;
  return contexts.delete(contextId);
}
