export const BILL_PAY_MAPPINGS_VERSION = 1;
export const DEFAULT_BILL_PAY_MAPPINGS = Object.freeze({
  version: BILL_PAY_MAPPINGS_VERSION,
  profiles: [],
});

export const BILL_PAY_PROFILE_IDENTITY_FIELDS = Object.freeze([
  "sender",
  "domain",
  "aliases",
  "last4",
]);

export const BILL_PAY_BEHAVIOR_INTENT_FIELDS = Object.freeze([
  "subject",
  "body",
]);

export const BILL_PAY_BEHAVIOR_TYPES = Object.freeze([
  "transfer",
  "bill",
  "expense",
  "income",
]);

export const BILL_PAY_AMOUNT_STRATEGIES = Object.freeze([
  "statement_balance",
  "minimum_due",
  "amount_due",
  "model_amount",
  "none",
]);

export const BILL_PAY_AMOUNT_FALLBACKS = Object.freeze([
  "blank_if_not_found",
  "use_model_amount",
]);

function cloneDefaultMappings() {
  return {
    version: DEFAULT_BILL_PAY_MAPPINGS.version,
    profiles: [],
  };
}

export function normalizeBillPayMappings(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return cloneDefaultMappings();
  }
  if (value.version !== BILL_PAY_MAPPINGS_VERSION || !Array.isArray(value.profiles)) {
    return cloneDefaultMappings();
  }
  return {
    ...value,
    version: BILL_PAY_MAPPINGS_VERSION,
    profiles: value.profiles,
  };
}

export function parseBillPayMappingsJson(json) {
  if (!json) return cloneDefaultMappings();
  try {
    return normalizeBillPayMappings(JSON.parse(json));
  } catch {
    return cloneDefaultMappings();
  }
}

export function isEnabledDraft(value) {
  return value?.enabled !== false;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasMatcherGroup(value) {
  if (!Array.isArray(value)) return false;
  return value.some((alternative) => {
    if (isNonBlankString(alternative)) return true;
    return Array.isArray(alternative) && alternative.some(isNonBlankString);
  });
}

export function hasAnyMatcher(source, fields) {
  if (!isPlainObject(source)) return false;
  return fields.some((field) => hasMatcherGroup(source[field]));
}

function validateMatcherFields(source, fields, label) {
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

function validateTargets(targets) {
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

export function validateBillPayMappings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, message: "Invalid bill_pay_mappings" };
  }
  if (value.version !== BILL_PAY_MAPPINGS_VERSION) {
    return { valid: false, message: "Invalid bill_pay_mappings version" };
  }
  if (!Array.isArray(value.profiles)) {
    return { valid: false, message: "Invalid bill_pay_mappings profiles" };
  }

  for (const profile of value.profiles) {
    if (!isPlainObject(profile)) {
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
    for (const behavior of profile.behaviors || []) {
      if (!isPlainObject(behavior)) {
        return { valid: false, message: "Invalid bill_pay_mappings behavior" };
      }
      const behaviorEnabled = isEnabledDraft(behavior);
      if (behaviorEnabled && !BILL_PAY_BEHAVIOR_TYPES.includes(behavior.type)) {
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
      const targetError = validateTargets(behavior.targets);
      if (targetError) return { valid: false, message: targetError };
    }
  }

  return { valid: true };
}
