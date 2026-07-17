export type ConfiguredAccount = {
  id?: unknown;
  type?: unknown;
  email?: unknown;
  sort_order?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  [key: string]: unknown;
};

export function normalizeEmailAddress(email: unknown) {
  return String(email || "").trim().toLowerCase();
}

function parseDateMs(value: unknown) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function shouldReplaceCanonical<T extends ConfiguredAccount>(current: T | undefined, candidate: T) {
  if (!current) return true;
  const currentUpdated = parseDateMs(current.updated_at);
  const candidateUpdated = parseDateMs(candidate.updated_at);
  if (candidateUpdated !== currentUpdated) return candidateUpdated > currentUpdated;

  const currentCreated = parseDateMs(current.created_at);
  const candidateCreated = parseDateMs(candidate.created_at);
  if (candidateCreated !== currentCreated) return candidateCreated > currentCreated;

  const currentSort = Number.isFinite(Number(current.sort_order)) ? Number(current.sort_order) : Number.MAX_SAFE_INTEGER;
  const candidateSort = Number.isFinite(Number(candidate.sort_order)) ? Number(candidate.sort_order) : Number.MAX_SAFE_INTEGER;
  if (candidateSort !== currentSort) return candidateSort < currentSort;

  return String(candidate.id || "").localeCompare(String(current.id || "")) < 0;
}

export function canonicalizeConfiguredAccounts<T extends ConfiguredAccount>(
  accounts: readonly T[] = [],
): T[] {
  const canonicalByKey = new Map<string, T>();

  for (const [index, account] of accounts.entries()) {
    if (account?.type === "gmail") {
      const normalizedEmail = normalizeEmailAddress(account.email);
      if (!normalizedEmail) continue;
      const key = `gmail:${normalizedEmail}`;
      const current = canonicalByKey.get(key);
      if (shouldReplaceCanonical(current, account)) {
        canonicalByKey.set(key, account);
      }
      continue;
    }

    const key = `id:${account?.id || index}`;
    if (!canonicalByKey.has(key)) canonicalByKey.set(key, account);
  }

  return [...canonicalByKey.values()].sort((a, b) => {
    const aSort = Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
    const bSort = Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;
    if (aSort !== bSort) return aSort - bSort;
    return parseDateMs(a?.created_at) - parseDateMs(b?.created_at);
  });
}

export function findCanonicalGmailAccount<T extends ConfiguredAccount>(
  accounts: readonly T[] = [],
  email: unknown,
): T | null {
  const normalizedEmail = normalizeEmailAddress(email);
  if (!normalizedEmail) return null;
  return canonicalizeConfiguredAccounts(accounts).find(
    (account) => account?.type === "gmail" && normalizeEmailAddress(account.email) === normalizedEmail,
  ) || null;
}
