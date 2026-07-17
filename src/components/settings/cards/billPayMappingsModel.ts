import type {
  BillPayBehavior,
  BillPayBehaviorTargets,
  BillPayMappings,
  BillPayProfile,
} from "../../../../shared/types/settings";

export interface NormalizedBillPayBehavior extends Omit<BillPayBehavior, "id" | "name" | "enabled" | "type" | "intent" | "amountStrategy" | "amountFallback" | "targets"> {
  id: string;
  name: string;
  enabled: boolean;
  type: NonNullable<BillPayBehavior["type"]>;
  intent: { subject: string[]; body: string[] };
  amountStrategy: NonNullable<BillPayBehavior["amountStrategy"]>;
  amountFallback: NonNullable<BillPayBehavior["amountFallback"]>;
  targets: BillPayBehaviorTargets;
}
export interface NormalizedBillPayProfile extends Omit<BillPayProfile, "id" | "name" | "enabled" | "identity" | "behaviors"> {
  id: string;
  name: string;
  enabled: boolean;
  identity: { sender: string[]; domain: string[]; aliases: string[]; last4: string[] };
  behaviors: NormalizedBillPayBehavior[];
}
export interface NormalizedBillPayMappings {
  version: 1;
  profiles: NormalizedBillPayProfile[];
}
interface ActualOption { id: string; name: string; [key: string]: unknown }
interface ActualCategoryGroup { group_name?: string; categories?: ActualOption[] }
export interface StoredActualOption extends ActualOption { missing?: boolean; missingLabel?: string }

export const EMPTY_MAPPINGS: Readonly<NormalizedBillPayMappings> = Object.freeze({ version: 1, profiles: [] });

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

export function normalizeMappings(value: BillPayMappings | null | undefined): NormalizedBillPayMappings {
  if (!value || value.version !== 1 || !Array.isArray(value.profiles)) {
    return { version: 1, profiles: [] };
  }
  return {
    version: 1,
    profiles: value.profiles.map(normalizeProfile),
  };
}

export function normalizeProfile(profile: BillPayProfile = {}): NormalizedBillPayProfile {
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

export function normalizeBehavior(behavior: BillPayBehavior = {}): NormalizedBillPayBehavior {
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

export function createProfile(): NormalizedBillPayProfile {
  return normalizeProfile({
    id: createId("profile"),
    name: "New profile",
    enabled: false,
    behaviors: [createBehavior()],
  });
}

export function createBehavior(): NormalizedBillPayBehavior {
  return normalizeBehavior({
    id: createId("behavior"),
    name: "New behavior",
    enabled: false,
  });
}

export function updateAt<T>(items: T[], index: number, updater: (item: T) => T): T[] {
  return items.map((item, currentIndex) => currentIndex === index ? updater(item) : item);
}

export function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_, currentIndex) => currentIndex !== index);
}

export function moveAt<T>(items: T[], index: number, direction: number): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
  return next;
}

export function setChipValue(_source: unknown, value: unknown): string[] {
  return normalizeChips(value);
}

export function addChip(source: unknown, value: unknown): string[] {
  const trimmed = String(value || "").trim();
  if (!trimmed) return normalizeChips(source);
  const current = normalizeChips(source);
  if (current.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) return current;
  return [...current, trimmed];
}

export function removeChip(source: unknown, index: number): string[] {
  return normalizeChips(source).filter((_, currentIndex) => currentIndex !== index);
}

export function flattenActualCategories(categories: Array<ActualCategoryGroup | ActualOption | null | undefined> = []): ActualOption[] {
  return categories.flatMap((entry) => {
    if (!entry) return [];
    if ("categories" in entry && Array.isArray(entry.categories)) {
      return entry.categories.map((category: ActualOption) => ({
        id: category.id,
        name: category.name,
        group: typeof entry.group_name === "string" ? entry.group_name : undefined,
      }));
    }
    return [entry as ActualOption];
  });
}

export function optionWithStoredLabel(options: ActualOption[], id?: string, label?: string, prefix = "Target"): StoredActualOption[] {
  if (!id || options.some((option) => option.id === id)) return options;
  return [
    {
      id,
      name: label || id,
      missing: true,
      missingLabel: `${prefix} missing`,
    },
    ...options,
  ];
}

export function targetWarning(options: ActualOption[], id?: string, label?: string, targetLabel = "Target"): string | null {
  if (!id || options.some((option) => option.id === id)) return null;
  return `${targetLabel} missing: ${label || id}`;
}

function normalizeChips(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => Array.isArray(entry) ? entry : [entry])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function normalizeTargets(targets: BillPayBehaviorTargets = {}): BillPayBehaviorTargets {
  const next: BillPayBehaviorTargets = {};
  const fields: Array<keyof BillPayBehaviorTargets> = [
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
  for (const field of fields) {
    if (targets[field]) next[field] = targets[field];
  }
  return next;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
