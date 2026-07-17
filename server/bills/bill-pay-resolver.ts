import {
  BILL_PAY_BEHAVIOR_INTENT_FIELDS,
  BILL_PAY_PROFILE_IDENTITY_FIELDS,
  normalizeBillPayMappings,
} from "./bill-pay-mappings.ts";
import { normalizeBillCandidate } from "../snapshots/snapshot-lifecycle.js";
import type {
  BillCandidate,
  BillEmailContext,
  BillPayBehavior,
  BillPayMappingOutcome,
  BillPayMatcherGroup,
  BillPayMetadata,
  BillPayProfile,
  BillPayResolution,
  BillPayResolveInput,
  BillPaySource,
  BillPayTargets,
} from "../../shared/types/bills.ts";

interface ResolverContext {
  from: string;
  subject: string;
  body: string;
  all: string;
  candidate: BillCandidate;
}

interface MetadataIndex {
  accountIds: Set<string>;
  payeeIds: Set<string>;
  categoryIds: Set<string>;
  accounts: Map<string, { id: string; name?: string }>;
  payees: Map<string, { id: string; name?: string }>;
  categories: Map<string, { id: string; name?: string }>;
}

function normalizeText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function alternativesFor(group: unknown): string[] {
  if (!Array.isArray(group)) return [];
  return group
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .map(normalizeText)
    .filter(Boolean);
}

function includesAny(haystack: unknown, group: unknown): boolean {
  const text = normalizeText(haystack);
  if (!text) return false;
  return alternativesFor(group).some((needle) => text.includes(needle));
}

function configuredGroups(source: unknown, fields: readonly string[]): Array<[string, BillPayMatcherGroup]> {
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  const record = source as Record<string, unknown>;
  return fields
    .filter((field) => alternativesFor(record[field]).length > 0)
    .map((field) => [field, record[field] as BillPayMatcherGroup]);
}

function flattenContext({ email = {}, candidate = {} }: { email?: BillEmailContext; candidate?: BillCandidate | null } = {}): ResolverContext {
  const normalizedCandidate = (normalizeBillCandidate(candidate) || {}) as BillCandidate;
  return {
    from: [
      email.from,
      email.fromEmail,
      email.from_address,
      email.from_name,
    ].filter(Boolean).join(" "),
    subject: String(email.subject || ""),
    body: [
      email.body,
      email.snippet,
      email.body_snippet,
      email.preview,
    ].filter(Boolean).join("\n"),
    all: [
      email.from,
      email.fromEmail,
      email.from_address,
      email.from_name,
      email.subject,
      email.body,
      email.snippet,
      email.body_snippet,
      email.preview,
      normalizedCandidate.payee,
      normalizedCandidate.payee_hint,
    ].filter(Boolean).join("\n"),
    candidate: normalizedCandidate,
  };
}

function matchesIdentity(profile: BillPayProfile, context: ResolverContext): boolean {
  const groups = configuredGroups(profile.identity, BILL_PAY_PROFILE_IDENTITY_FIELDS);
  if (!groups.length) return false;
  return groups.every(([field, group]) => {
    if (field === "sender" || field === "domain") return includesAny(context.from, group);
    if (field === "last4" || field === "aliases") return includesAny(context.all, group);
    return false;
  });
}

function matchesIntent(behavior: BillPayBehavior, context: ResolverContext): boolean {
  const groups = configuredGroups(behavior.intent, BILL_PAY_BEHAVIOR_INTENT_FIELDS);
  if (!groups.length) return false;
  return groups.every(([field, group]) => {
    if (field === "subject") return includesAny(context.subject, group);
    if (field === "body") return includesAny(context.body, group);
    return false;
  });
}

function parseMoney(value: unknown): number | null {
  if (!value) return null;
  const normalized = String(value).replace(/,/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

const MONTHS: Readonly<Record<string, number>> = Object.freeze({
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
});

function parseLabeledAmount(text: unknown, labels: string[]): number | null {
  const source = String(text || "");
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp(`${escaped}\\s*(?:is|of)?\\s*[:\\-]?\\s*\\$\\s*([0-9][0-9,]*(?:\\.\\d{1,2})?)`, "i");
    const match = source.match(re);
    const amount = parseMoney(match?.[1]);
    if (amount != null) return amount;
  }
  return null;
}

function parseTrailingLabeledAmount(text: unknown, label: string): number | null {
  const source = String(text || "");
  const index = normalizeText(source).indexOf(normalizeText(label));
  if (index < 0) return null;

  const tail = source.slice(index + label.length, index + label.length + 260);
  const matches = [...tail.matchAll(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/g)];
  if (!matches.length) return null;
  return parseMoney(matches[matches.length - 1]?.[1]);
}

function toIsoDate(month: unknown, day: unknown, year: unknown): string | null {
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const numericYear = Number(year);
  if (!Number.isInteger(numericMonth) || !Number.isInteger(numericDay) || !Number.isInteger(numericYear)) {
    return null;
  }
  if (numericMonth < 1 || numericMonth > 12 || numericDay < 1 || numericDay > 31 || numericYear < 1900) {
    return null;
  }
  return [
    String(numericYear).padStart(4, "0"),
    String(numericMonth).padStart(2, "0"),
    String(numericDay).padStart(2, "0"),
  ].join("-");
}

function toIsoDateFromMonthName(month: unknown, day: unknown, year: unknown): string | null {
  const numericMonth = MONTHS[normalizeText(month)];
  return toIsoDate(numericMonth, day, year);
}

function parseLabeledDate(text: unknown): string | null {
  const source = String(text || "");
  const labels = ["payment due date", "payment is due", "payment due", "due date", "payment date", "paid on", "transaction date", "date"];
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const numericRe = new RegExp(`${escaped}\\s*(?:is|of|on)?\\s*[:\\-]?\\s*\\n?\\s*(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})`, "i");
    const numericMatch = source.match(numericRe);
    const numericDate = numericMatch ? toIsoDate(numericMatch[1], numericMatch[2], numericMatch[3]) : null;
    if (numericDate) return numericDate;

    const namedRe = new RegExp(`${escaped}\\s*(?:is|of|on)?\\s*[:\\-]?\\s*\\n?\\s*(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?[,]?\\s+)?([A-Za-z]+)\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(\\d{4})`, "i");
    const namedMatch = source.match(namedRe);
    const namedDate = namedMatch ? toIsoDateFromMonthName(namedMatch[1], namedMatch[2], namedMatch[3]) : null;
    if (namedDate) return namedDate;
  }
  return null;
}

function amountFromStrategy(strategy: string | undefined, context: ResolverContext): { amount: number | null; source: string | null } {
  if (strategy === "none") return { amount: null, source: "none" };
  if (strategy === "model_amount" || !strategy) {
    return { amount: context.candidate.amount ?? null, source: "model_amount" };
  }
  const text = `${context.subject}\n${context.body}`;
  const labelsByStrategy: Record<string, string[]> = {
    statement_balance: ["remaining statement balance", "statement balance"],
    minimum_due: ["minimum due", "minimum payment due", "minimum payment"],
    amount_due: ["amount due", "total due", "payment due", "payment amount", "amount paid", "you paid", "payment", "amount"],
  };
  const amount = parseLabeledAmount(text, labelsByStrategy[strategy] || []);
  if (amount != null) return { amount, source: strategy };
  if (strategy === "statement_balance") {
    const trailingAmount = parseTrailingLabeledAmount(text, "remaining statement balance");
    if (trailingAmount != null) return { amount: trailingAmount, source: strategy };
  }
  return { amount: null, source: null };
}

function defaultAmountFallback(source: BillPaySource): string {
  return source === "pasted_text" ? "blank_if_not_found" : "use_model_amount";
}

function fallbackBill(candidate: BillCandidate | null | undefined): BillCandidate {
  return (normalizeBillCandidate(candidate) as BillCandidate | null) || {
    payee: "",
    amount: null,
    due_date: null,
    type: "expense",
  };
}

function categoryRows(categories: BillPayMetadata["categories"] = []): Array<{ id: string; name?: string }> {
  return categories.flatMap((categoryOrGroup) => {
    if ("categories" in categoryOrGroup && Array.isArray(categoryOrGroup.categories)) return categoryOrGroup.categories;
    return "id" in categoryOrGroup ? [categoryOrGroup] : [];
  });
}

function metadataIndex(metadata: BillPayMetadata = {}): MetadataIndex {
  return {
    accountIds: new Set((metadata.accounts || []).map((row) => row.id).filter(Boolean)),
    payeeIds: new Set((metadata.payees || []).map((row) => row.id).filter(Boolean)),
    categoryIds: new Set(categoryRows(metadata.categories).map((row) => row.id).filter(Boolean)),
    accounts: new Map((metadata.accounts || []).map((row) => [row.id, row])),
    payees: new Map((metadata.payees || []).map((row) => [row.id, row])),
    categories: new Map(categoryRows(metadata.categories).map((row) => [row.id, row])),
  };
}

function hasTargetValidationMetadata(metadata: BillPayMetadata = {}): boolean {
  return Array.isArray(metadata.accounts)
    || Array.isArray(metadata.payees)
    || Array.isArray(metadata.categories);
}

function targetDiagnostics(targets: BillPayTargets = {}, metadata: BillPayMetadata = {}) {
  if (!hasTargetValidationMetadata(metadata)) return [];
  const index = metadataIndex(metadata);
  const checks: Array<[keyof BillPayTargets, Set<string>, string]> = [
    ["payee_id", index.payeeIds, "Payee not found"],
    ["account_id", index.accountIds, "Account not found"],
    ["from_account_id", index.accountIds, "Account not found"],
    ["to_account_id", index.accountIds, "Account not found"],
    ["category_id", index.categoryIds, "Category not found"],
  ];
  return checks
    .filter(([field, ids]) => typeof targets[field] === "string" && !ids.has(targets[field] as string))
    .map(([field, , message]) => ({ field: String(field), id: targets[field], message }));
}

function labelForTarget(targets: BillPayTargets, metadata: BillPayMetadata, idField: keyof BillPayTargets, labelField: keyof BillPayTargets, collection: "accounts" | "payees" | "categories"): string {
  if (typeof targets[labelField] === "string") return targets[labelField] as string;
  const index = metadataIndex(metadata);
  const id = targets[idField];
  return typeof id === "string" ? index[collection].get(id)?.name || "" : "";
}

function applyTargets(bill: BillCandidate, behavior: BillPayBehavior, metadata: BillPayMetadata): BillCandidate {
  const targets = behavior.targets || {};
  const next: BillCandidate = { ...bill, type: behavior.type || bill.type || "expense" };

  if (targets.payee_id) {
    next.payee_id = targets.payee_id;
    next.payee = labelForTarget(targets, metadata, "payee_id", "payee_label", "payees") || next.payee;
  } else if (targets.payee_label) {
    next.payee = targets.payee_label;
  }
  if (targets.account_id) next.account_id = targets.account_id;
  if (targets.category_id) next.category_id = targets.category_id;
  if (targets.from_account_id) next.from_account_id = targets.from_account_id;
  if (targets.to_account_id) next.to_account_id = targets.to_account_id;
  if (targets.schedule_name) next.schedule_name = targets.schedule_name;

  for (const field of [
    "payee_label",
    "account_label",
    "category_label",
    "from_account_label",
    "to_account_label",
  ]) {
    if (targets[field]) next[field] = targets[field];
  }

  return next;
}

function applyPastedTextDate(bill: BillCandidate, context: ResolverContext): BillCandidate {
  if (bill.due_date) return bill;
  const dueDate = parseLabeledDate(`${context.subject}\n${context.body}`);
  return dueDate ? { ...bill, due_date: dueDate } : bill;
}

function resolveAmount({ behavior, context, source }: { behavior: BillPayBehavior; context: ResolverContext; source: BillPaySource }): { amount: number | null; source: string | null } {
  const strategy = behavior.amountStrategy || "model_amount";
  const resolved = amountFromStrategy(strategy, context);
  if (resolved.source) return resolved;

  const fallback = behavior.amountFallback || defaultAmountFallback(source);
  if (fallback === "use_model_amount") {
    return { amount: context.candidate.amount ?? null, source: "model_amount" };
  }
  return { amount: null, source: "blank" };
}

export function resolveBillPayMapping({
  mappings,
  metadata = {},
  source = "triage",
  email = {},
  candidate = null,
}: BillPayResolveInput = {}): BillPayResolution {
  const normalizedMappings = normalizeBillPayMappings(mappings);
  const context = flattenContext({ email, candidate });
  const baseBill = fallbackBill(candidate);
  const matchedProfiles: Array<string | null> = [];

  for (const profile of normalizedMappings.profiles) {
    if (profile?.enabled === false) continue;
    if (!matchesIdentity(profile, context)) continue;
    matchedProfiles.push(profile.id || null);

    for (const behavior of profile.behaviors || []) {
      if (behavior?.enabled === false) continue;
      if (!matchesIntent(behavior, context)) continue;

      const behaviorId = behavior.id || null;
      const commonMapping: Omit<BillPayMappingOutcome, "status"> = {
        profileId: profile.id || null,
        behaviorId,
        matchedProfiles,
      };
      if (!behavior.type || !behavior.targets || Object.keys(behavior.targets).length === 0) {
        return {
          bill: baseBill,
          mapping: {
            status: "incomplete_mapping",
            ...commonMapping,
            reason: "missing_behavior_targets",
          },
        };
      }

      const diagnostics = targetDiagnostics(behavior.targets, metadata);
      if (diagnostics.length) {
        return {
          bill: baseBill,
          mapping: {
            status: "invalid_target",
            ...commonMapping,
            diagnostics,
          },
        };
      }

      const amount = resolveAmount({ behavior, context, source });
      return {
        bill: applyPastedTextDate({
          ...applyTargets(baseBill, behavior, metadata),
          amount: amount.amount,
        }, context),
        mapping: {
          status: "matched",
          ...commonMapping,
          amountSource: amount.source,
        },
      };
    }
  }

  if (matchedProfiles.length) {
    return {
      bill: baseBill,
      mapping: {
        status: "identity_only",
        reason: "no_behavior_match",
        matchedProfiles,
      },
    };
  }

  return {
    bill: baseBill,
    mapping: {
      status: "unmapped",
      reason: "no_profile_match",
      matchedProfiles: [],
    },
  };
}
