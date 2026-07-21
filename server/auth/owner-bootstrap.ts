import type { OwnerRecord } from "./owner-store.ts";

interface OwnerBootstrapStore {
  getOwner(): Promise<OwnerRecord | null>;
  claimOwner(input: {
    userId: string;
    passwordHash: string;
    claimedAt: number;
  }): Promise<{ claimed: boolean }>;
}

interface OwnerBootstrapOptions {
  store: OwnerBootstrapStore;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  now?: () => number;
  onLegacyOwner?: (owner: OwnerRecord) => void | Promise<void>;
}

export type OwnerBootstrapResult =
  | { claimed: false; owner: null; source: "unclaimed" }
  | { claimed: true; owner: OwnerRecord; source: "stored" | "legacy_import" };

function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value);
}

function readLegacyIdentity(env: OwnerBootstrapOptions["env"]): {
  userId: string;
  passwordHash: string;
} | null {
  const userId = env.EA_USER_ID;
  const passwordHash = env.EA_PASSWORD_HASH;
  const hasUserId = typeof userId === "string" && userId.length > 0;
  const hasPasswordHash = typeof passwordHash === "string" && passwordHash.length > 0;

  if (hasUserId !== hasPasswordHash) {
    throw new Error("Legacy owner configuration is incomplete");
  }
  if (!hasUserId || !hasPasswordHash) return null;
  if (!isBcryptHash(passwordHash!)) {
    throw new Error("Legacy owner password hash is invalid");
  }
  return { userId: userId!, passwordHash: passwordHash! };
}

export async function resolveOwnerBootstrap({
  store,
  env,
  now = Date.now,
  onLegacyOwner,
}: OwnerBootstrapOptions): Promise<OwnerBootstrapResult> {
  const legacy = readLegacyIdentity(env);
  const stored = await store.getOwner();

  if (stored) {
    if (legacy && (
      legacy.userId !== stored.userId
      || legacy.passwordHash !== stored.passwordHash
    )) {
      throw new Error("Legacy owner configuration conflicts with the stored owner");
    }
    if (legacy) await onLegacyOwner?.(stored);
    return { claimed: true, owner: stored, source: "stored" };
  }

  if (!legacy) return { claimed: false, owner: null, source: "unclaimed" };

  const result = await store.claimOwner({
    userId: legacy.userId,
    passwordHash: legacy.passwordHash,
    claimedAt: now(),
  });
  if (!result.claimed) {
    throw new Error("Owner bootstrap changed concurrently; restart required");
  }
  const owner = await store.getOwner();
  if (!owner) throw new Error("Legacy owner import did not persist");
  await onLegacyOwner?.(owner);
  return { claimed: true, owner, source: "legacy_import" };
}
