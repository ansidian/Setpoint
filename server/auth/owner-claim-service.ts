import bcrypt from "bcrypt";
import crypto from "crypto";
import { activateOwner } from "./owner-context.ts";
import { ownerStore, type OwnerRecord } from "./owner-store.ts";
import { isAcceptableNewPassword } from "./password-policy.ts";

interface OwnerClaimStore {
  getOwner(): Promise<OwnerRecord | null>;
  claimOwner(input: {
    userId: string;
    passwordHash: string;
    claimedAt: number;
    recoveryCodeHashes?: string[];
    canonicalOrigin?: string;
  }): Promise<{ claimed: boolean }>;
}

interface ClaimOwnerOptions {
  store?: OwnerClaimStore;
  now?: () => number;
  createUserId?: () => string;
  hashPassword?: (password: string) => Promise<string>;
  onClaimed?: (owner: OwnerRecord) => void;
  recoveryCodeHashes?: string[];
  canonicalOrigin?: string;
}

export type InitialOwnerClaimResult =
  | { status: "claimed"; owner: OwnerRecord }
  | { status: "conflict" }
  | { status: "invalid" };

export async function claimInitialOwner(
  password: unknown,
  {
    store = ownerStore,
    now = Date.now,
    createUserId = crypto.randomUUID,
    hashPassword = (value) => bcrypt.hash(value, 12),
    onClaimed = activateOwner,
    recoveryCodeHashes = [],
    canonicalOrigin,
  }: ClaimOwnerOptions = {},
): Promise<InitialOwnerClaimResult> {
  if (!isAcceptableNewPassword(password)) {
    return { status: "invalid" };
  }
  if (await store.getOwner()) return { status: "conflict" };

  const input = {
    userId: createUserId(),
    passwordHash: await hashPassword(password),
    claimedAt: now(),
    recoveryCodeHashes,
    canonicalOrigin,
  };
  const result = await store.claimOwner(input);
  if (!result.claimed) return { status: "conflict" };

  const owner = await store.getOwner();
  if (!owner) throw new Error("Owner claim did not persist");
  onClaimed(owner);
  return { status: "claimed", owner };
}
