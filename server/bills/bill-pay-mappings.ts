import type {
  BillPayBehavior,
  BillPayMappings,
  BillPayMatcherGroup,
  BillPayTargets,
} from "../../shared/types/bills.ts";

export const BILL_PAY_MAPPINGS_VERSION = 1;
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

export const BILL_PAY_BEHAVIOR_INTENT_FIELDS: readonly string[] = Object.freeze([
  "subject",
  "body",
]);

export const BILL_PAY_BEHAVIOR_TYPES: readonly string[] = Object.freeze([
  "transfer",
  "bill",
  "expense",
  "income",
]);

export const BILL_PAY_AMOUNT_STRATEGIES: readonly string[] = Object.freeze([
  "statement_balance",
  "minimum_due",
  "amount_due",
  "model_amount",
  "none",
]);

export const BILL_PAY_AMOUNT_FALLBACKS: readonly string[] = Object.freeze([
  "blank_if_not_found",
  "use_model_amount",
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
    ...record,
    version: BILL_PAY_MAPPINGS_VERSION,
    profiles: record.profiles as BillPayMappings["profiles"],
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

export function isEnabledDraft(value: unknown): boolean {
  return !isPlainObject(value) || value.enabled !== false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasMatcherGroup(value: unknown): value is BillPayMatcherGroup {
  if (!Array.isArray(value)) return false;
  return value.some((alternative) => {
    if (isNonBlankString(alternative)) return true;
    return Array.isArray(alternative) && alternative.some(isNonBlankString);
  });
}

export function hasAnyMatcher(source: unknown, fields: readonly string[]): boolean {
  if (!isPlainObject(source)) return false;
  return fields.some((field) => hasMatcherGroup(source[field]));
}

function validateMatcherFields(source: unknown, fields: readonly string[], label: string): string | null {
  if (source === undefined) return null;
  if (!isPlainObject(source)) return `Invalid bill_pay_mappings ${label}`;
  for (const [field, value] of Object.entries(source)) {
    if (!fields.includes(field)) {
      return `Invalid bill_pay_mappings ${label} field`;
    }
    if (!Array.isArray(value)) {
      return `Invalid bill_pay_mappings ${label} matcher group`;
    }
    for (const alternative of value) {
      if (isNonBlankString(alternative)) continue;
      if (Array.isArray(alternative) && alternative.every(isNonBlankString) && alternative.length > 0) continue;
      return `Invalid bill_pay_mappings ${label} matcher`;
    }
  }
  return null;
}

function validateTargets(targets: unknown): string | null {
  if (targets === undefined) return null;
  if (!isPlainObject(targets)) return "Invalid bill_pay_mappings behavior targets";
  const stringFields = [
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
  ];
  for (const [field, value] of Object.entries(targets)) {
    if (!stringFields.includes(field)) return "Invalid bill_pay_mappings behavior target field";
    if (value != null && typeof value !== "string") return "Invalid bill_pay_mappings behavior target";
  }
  return null;
}

export function validateBillPayMappings(value: unknown): { valid: boolean; message?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, message: "Invalid bill_pay_mappings" };
  }
  const mappings = value as Record<string, unknown>;
  if (mappings.version !== BILL_PAY_MAPPINGS_VERSION) {
    return { valid: false, message: "Invalid bill_pay_mappings version" };
  }
  if (!Array.isArray(mappings.profiles)) {
    return { valid: false, message: "Invalid bill_pay_mappings profiles" };
  }

  for (const profileValue of mappings.profiles) {
    const profile = profileValue as Record<string, unknown>;
    if (!isPlainObject(profileValue)) {
      return { valid: false, message: "Invalid bill_pay_mappings profile" };
    }
    const identityError = validateMatcherFields(profile.identity, BILL_PAY_PROFILE_IDENTITY_FIELDS, "profile identity");
    if (identityError) return { valid: false, message: identityError };
    const profileEnabled = isEnabledDraft(profile);
    if (profileEnabled && !hasAnyMatcher(profile.identity, BILL_PAY_PROFILE_IDENTITY_FIELDS)) {
      return {
        valid: false,
        message: "Enabled bill_pay_mappings profile requires identity matchers",
      };
    }

    if (profile.behaviors !== undefined && !Array.isArray(profile.behaviors)) {
      return { valid: false, message: "Invalid bill_pay_mappings profile behaviors" };
    }
    for (const behaviorValue of (profile.behaviors as unknown[] | undefined) || []) {
      if (!isPlainObject(behaviorValue)) {
        return { valid: false, message: "Invalid bill_pay_mappings behavior" };
      }
      const behavior = behaviorValue as BillPayBehavior;
      const behaviorEnabled = isEnabledDraft(behavior);
      if (behaviorEnabled && (typeof behavior.type !== "string" || !BILL_PAY_BEHAVIOR_TYPES.includes(behavior.type))) {
        return { valid: false, message: "Enabled bill_pay_mappings behavior requires type" };
      }
      const intentError = validateMatcherFields(behavior.intent, BILL_PAY_BEHAVIOR_INTENT_FIELDS, "behavior intent");
      if (intentError) return { valid: false, message: intentError };
      if (behaviorEnabled && !hasAnyMatcher(behavior.intent, BILL_PAY_BEHAVIOR_INTENT_FIELDS)) {
        return {
          valid: false,
          message: "Enabled bill_pay_mappings behavior requires intent matchers",
        };
      }
      if (behavior.amountStrategy !== undefined && !BILL_PAY_AMOUNT_STRATEGIES.includes(behavior.amountStrategy)) {
        return { valid: false, message: "Invalid bill_pay_mappings amount strategy" };
      }
      if (behavior.amountFallback !== undefined && !BILL_PAY_AMOUNT_FALLBACKS.includes(behavior.amountFallback)) {
        return { valid: false, message: "Invalid bill_pay_mappings amount fallback" };
      }
      const targetError = validateTargets(behavior.targets as BillPayTargets | undefined);
      if (targetError) return { valid: false, message: targetError };
    }
  }

  return { valid: true };
}
