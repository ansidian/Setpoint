import type { OwnerRecord } from "./owner-store.ts";

export type OwnerIdentity = Pick<OwnerRecord, "singletonId" | "userId" | "claimedAt">;
type OwnerActivationListener = (owner: OwnerIdentity) => void | Promise<void>;

let activeOwner: OwnerIdentity | null = null;
const activationListeners = new Set<OwnerActivationListener>();

export function getActiveOwner(): OwnerIdentity | null {
  return activeOwner;
}

export function activateOwner(owner: OwnerRecord): void {
  if (activeOwner?.userId === owner.userId) return;
  activeOwner = {
    singletonId: owner.singletonId,
    userId: owner.userId,
    claimedAt: owner.claimedAt,
  };
  // Compatibility bridge for provider modules that still resolve the historical
  // single-owner id from process.env at operation time. Setpoint, not the host,
  // owns this value for newly claimed instances.
  process.env.EA_USER_ID = owner.userId;
  for (const listener of activationListeners) {
    Promise.resolve(listener(activeOwner)).catch((error: unknown) => {
      console.error("[EA] Owner runtime activation failed:", error instanceof Error ? error.message : error);
    });
  }
}

export function onOwnerActivated(listener: OwnerActivationListener): () => void {
  activationListeners.add(listener);
  return () => activationListeners.delete(listener);
}

export function __resetOwnerContextForTests(): void {
  activeOwner = null;
  activationListeners.clear();
}
