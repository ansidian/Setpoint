import type {
  BillPayMappings,
} from "../../shared/types/bills.ts";

export const BILL_PAY_MAPPINGS_VERSION = 2;
export const DEFAULT_BILL_PAY_MAPPINGS: Readonly<BillPayMappings> = Object.freeze({
  version: BILL_PAY_MAPPINGS_VERSION,
  profiles: [],
});

export const BILL_PAY_PROFILE_IDENTITY_FIELDS: readonly string[] = Object.freeze([
  "sender",
  "domain",
  "aliases",
  "last4",
]);

export const BILL_PAY_TARGET_FIELDS: readonly string[] = Object.freeze([
  "payee_id",
  "payee_label",
  "account_id",
  "account_label",
  "category_id",
  "category_label",
  "from_account_id",
  "from_account_label",
  "to_account_id",
  "to_account_label",
  "schedule_name",
]);

function cloneDefaultMappings(): BillPayMappings {
  return {
    version: DEFAULT_BILL_PAY_MAPPINGS.version,
    profiles: [],
  };
}

export function normalizeBillPayMappings(value: unknown = null): BillPayMappings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return cloneDefaultMappings();
  }
  const record = value as Record<string, unknown>;
  if (record.version !== BILL_PAY_MAPPINGS_VERSION || !Array.isArray(record.profiles)) {
    return cloneDefaultMappings();
  }
  return {
    version: BILL_PAY_MAPPINGS_VERSION,
    profiles: (record.profiles
      .filter(isPlainObject)
      .map((profile) => ({
        ...(profile.id !== undefined ? { id: profile.id as string | null } : {}),
        ...(profile.name !== undefined ? { name: profile.name as string | null } : {}),
        ...(profile.enabled !== undefined ? { enabled: profile.enabled as boolean } : {}),
        identity: isPlainObject(profile.identity)
          ? Object.fromEntries(Object.entries(profile.identity).filter(([field]) => BILL_PAY_PROFILE_IDENTITY_FIELDS.includes(field)))
          : {},
        behaviors: Array.isArray(profile.behaviors)
          ? profile.behaviors.filter(isPlainObject).map((behavior) => ({
              ...(behavior.id !== undefined ? { id: behavior.id as string | null } : {}),
              ...(behavior.name !== undefined ? { name: behavior.name as string | null } : {}),
              ...(behavior.enabled !== undefined ? { enabled: behavior.enabled as boolean } : {}),
              ...(behavior.type !== undefined ? { type: behavior.type as string } : {}),
              targets: isPlainObject(behavior.targets)
                ? Object.fromEntries(Object.entries(behavior.targets).filter(([field]) => BILL_PAY_TARGET_FIELDS.includes(field)))
                : {},
            }))
          : [],
      }))) as BillPayMappings["profiles"],
  };
}

export function parseBillPayMappingsJson(json: unknown): BillPayMappings {
  if (!json) return cloneDefaultMappings();
  try {
    return normalizeBillPayMappings(JSON.parse(String(json)));
  } catch {
    return cloneDefaultMappings();
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
