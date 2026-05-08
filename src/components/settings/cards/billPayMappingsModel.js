export const EMPTY_MAPPINGS = Object.freeze({ version: 1, profiles: [] });

export const BEHAVIOR_TYPES = [
  { value: "expense", label: "Expense" },
  { value: "bill", label: "Bill" },
  { value: "transfer", label: "Transfer" },
  { value: "income", label: "Income" },
];

export const AMOUNT_STRATEGIES = [
  { value: "model_amount", label: "Model amount" },
  { value: "statement_balance", label: "Statement balance" },
  { value: "minimum_due", label: "Minimum due" },
  { value: "amount_due", label: "Amount due" },
  { value: "none", label: "No amount" },
];

export const AMOUNT_FALLBACKS = [
  { value: "use_model_amount", label: "Use model amount" },
  { value: "blank_if_not_found", label: "Leave blank" },
];

export function normalizeMappings(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.profiles)) {
    return { version: 1, profiles: [] };
  }
  return {
    version: 1,
    profiles: value.profiles.map(normalizeProfile),
  };
}

export function normalizeProfile(profile = {}) {
  return {
    id: profile.id || createId("profile"),
    name: profile.name || "New profile",
    enabled: profile.enabled === true,
    identity: {
      sender: normalizeChips(profile.identity?.sender),
      domain: normalizeChips(profile.identity?.domain),
      aliases: normalizeChips(profile.identity?.aliases),
      last4: normalizeChips(profile.identity?.last4),
    },
    behaviors: Array.isArray(profile.behaviors) ? profile.behaviors.map(normalizeBehavior) : [],
  };
}

export function normalizeBehavior(behavior = {}) {
  return {
    id: behavior.id || createId("behavior"),
    name: behavior.name || "New behavior",
    enabled: behavior.enabled === true,
    type: behavior.type || "expense",
    intent: {
      subject: normalizeChips(behavior.intent?.subject),
      body: normalizeChips(behavior.intent?.body),
    },
    amountStrategy: behavior.amountStrategy || "model_amount",
    amountFallback: behavior.amountFallback || "use_model_amount",
    targets: normalizeTargets(behavior.targets),
  };
}

export function createProfile() {
  return normalizeProfile({
    id: createId("profile"),
    name: "New profile",
    enabled: false,
    behaviors: [createBehavior()],
  });
}

export function createBehavior() {
  return normalizeBehavior({
    id: createId("behavior"),
    name: "New behavior",
    enabled: false,
  });
}

export function updateAt(items, index, updater) {
  return items.map((item, currentIndex) => currentIndex === index ? updater(item) : item);
}

export function removeAt(items, index) {
  return items.filter((_, currentIndex) => currentIndex !== index);
}

export function moveAt(items, index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

export function setChipValue(source, value) {
  return normalizeChips(value);
}

export function addChip(source, value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return normalizeChips(source);
  const current = normalizeChips(source);
  if (current.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) return current;
  return [...current, trimmed];
}

export function removeChip(source, index) {
  return normalizeChips(source).filter((_, currentIndex) => currentIndex !== index);
}

export function flattenActualCategories(categories = []) {
  return categories.flatMap((entry) => {
    if (Array.isArray(entry?.categories)) {
      return entry.categories.map((category) => ({
        id: category.id,
        name: category.name,
        group: entry.group_name,
      }));
    }
    return entry ? [entry] : [];
  });
}

export function optionWithStoredLabel(options, id, label, prefix) {
  if (!id || options.some((option) => option.id === id)) return options;
  return [
    {
      id,
      name: `Missing: ${label || id}`,
      missing: true,
      missingLabel: `${prefix} missing`,
    },
    ...options,
  ];
}

export function targetWarning(options, id, label, targetLabel) {
  if (!id || options.some((option) => option.id === id)) return null;
  return `${targetLabel} missing: ${label || id}`;
}

function normalizeChips(value) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => Array.isArray(entry) ? entry : [entry])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function normalizeTargets(targets = {}) {
  const next = {};
  for (const field of [
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
  ]) {
    if (targets[field]) next[field] = targets[field];
  }
  return next;
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
