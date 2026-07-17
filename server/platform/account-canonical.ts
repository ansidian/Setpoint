export type ConfiguredAccount = {
  id?: unknown;
  type?: unknown;
  email?: unknown;
  sort_order?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

export function normalizeEmailAddress(email: unknown) {
  return String(email || "").trim().toLowerCase();
}

function parseDateMs(value: unknown) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function shouldReplaceCanonical<T extends object>(current: T | undefined, candidate: T) {
  if (!current) return true;
  const currentFields = current as ConfiguredAccount;
  const candidateFields = candidate as ConfiguredAccount;
  const currentUpdated = parseDateMs(currentFields.updated_at);
  const candidateUpdated = parseDateMs(candidateFields.updated_at);
  if (candidateUpdated !== currentUpdated) return candidateUpdated > currentUpdated;

  const currentCreated = parseDateMs(currentFields.created_at);
  const candidateCreated = parseDateMs(candidateFields.created_at);
  if (candidateCreated !== currentCreated) return candidateCreated > currentCreated;

  const currentSort = Number.isFinite(Number(currentFields.sort_order)) ? Number(currentFields.sort_order) : Number.MAX_SAFE_INTEGER;
  const candidateSort = Number.isFinite(Number(candidateFields.sort_order)) ? Number(candidateFields.sort_order) : Number.MAX_SAFE_INTEGER;
  if (candidateSort !== currentSort) return candidateSort < currentSort;

  return String(candidateFields.id || "").localeCompare(String(currentFields.id || "")) < 0;
}

export function canonicalizeConfiguredAccounts<T extends object>(
  accounts: readonly T[] = [],
): T[] {
  const canonicalByKey = new Map<string, T>();

  for (const [index, account] of accounts.entries()) {
    const fields = account as ConfiguredAccount;
    if (fields.type === "gmail") {
      const normalizedEmail = normalizeEmailAddress(fields.email);
      if (!normalizedEmail) continue;
      const key = `gmail:${normalizedEmail}`;
      const current = canonicalByKey.get(key);
      if (shouldReplaceCanonical(current, account)) {
        canonicalByKey.set(key, account);
      }
      continue;
    }

    const key = `id:${fields.id || index}`;
    if (!canonicalByKey.has(key)) canonicalByKey.set(key, account);
  }

  return [...canonicalByKey.values()].sort((a, b) => {
    const aFields = a as ConfiguredAccount;
    const bFields = b as ConfiguredAccount;
    const aSort = Number.isFinite(Number(aFields.sort_order)) ? Number(aFields.sort_order) : Number.MAX_SAFE_INTEGER;
    const bSort = Number.isFinite(Number(bFields.sort_order)) ? Number(bFields.sort_order) : Number.MAX_SAFE_INTEGER;
    if (aSort !== bSort) return aSort - bSort;
    return parseDateMs(aFields.created_at) - parseDateMs(bFields.created_at);
  });
}

export function findCanonicalGmailAccount<T extends object>(
  accounts: readonly T[] = [],
  email: unknown,
): T | null {
  const normalizedEmail = normalizeEmailAddress(email);
  if (!normalizedEmail) return null;
  return canonicalizeConfiguredAccounts(accounts).find(
    (account) => {
      const fields = account as ConfiguredAccount;
      return fields.type === "gmail" && normalizeEmailAddress(fields.email) === normalizedEmail;
    },
  ) || null;
}
