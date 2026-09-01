import { BILL_PAY_PROFILE_IDENTITY_FIELDS, normalizeBillPayMappings } from "./bill-pay-mappings.ts";
import { normalizeBillCandidate } from "../snapshots/snapshot-lifecycle.ts";
import { selectSemanticEventBehavior } from "./billSemanticEventPolicy.ts";
import { selectSemanticBillAmount } from "./billSemanticAmountPolicy.ts";
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
  BillPayTargets,
} from "../../shared/types/bills.ts";

interface ResolverContext {
  senderAddress: string;
  senderDomain: string;
  senderDisplayName: string;
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
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function alternativesFor(group: unknown): string[] {
  if (!Array.isArray(group)) return [];
  return group.flatMap((item) => (Array.isArray(item) ? item : [item])).map(normalizeText).filter(Boolean);
}

function normalizedEmailAddress(value: unknown): string {
  const text = String(value || "").trim().toLowerCase();
  const angle = text.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angle?.[1]) return angle[1];
  return text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/i)?.[0]?.toLowerCase() || "";
}

function normalizedDisplayName(email: BillEmailContext): string {
  if (email.from_name) return normalizeText(email.from_name);
  const raw = String(email.from || "");
  return normalizeText(raw.replace(/<[^<>]+>/g, "").replace(normalizedEmailAddress(raw), ""));
}

function exactMatch(value: unknown, group: unknown): boolean {
  const normalized = normalizeText(value);
  return Boolean(normalized) && alternativesFor(group).includes(normalized);
}

function domainMatch(senderDomain: string, group: unknown): boolean {
  if (!senderDomain) return false;
  return alternativesFor(group).some((entry) => {
    const configured = entry.replace(/^@/, "").replace(/^\.+|\.+$/g, "");
    return Boolean(configured) && (senderDomain === configured || senderDomain.endsWith(`.${configured}`));
  });
}

function normalizedLast4(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 4 ? digits : "";
}

function trustedCandidateLast4(candidate: BillCandidate): string {
  const last4 = normalizedLast4(candidate.account_last4);
  const evidence = String(candidate.account_last4_evidence || "");
  const confidence = Number(candidate.account_last4_confidence);
  if (!last4 || !evidence || !Number.isFinite(confidence) || confidence < 0.8) return "";
  return evidence.replace(/\D/g, "").includes(last4) ? last4 : "";
}

function configuredGroups(source: unknown, fields: readonly string[]): Array<[string, BillPayMatcherGroup]> {
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  const record = source as Record<string, unknown>;
  return fields
    .filter((field) => alternativesFor(record[field]).length > 0)
    .map((field) => [field, record[field] as BillPayMatcherGroup]);
}

function resolverContext(email: BillEmailContext, candidate: BillCandidate | null): ResolverContext {
  const normalizedCandidate = (normalizeBillCandidate(candidate) || {}) as BillCandidate;
  const senderAddress = normalizedEmailAddress(email.from_address || email.fromEmail || email.from);
  return {
    senderAddress,
    senderDomain: senderAddress.split("@")[1] || "",
    senderDisplayName: normalizedDisplayName(email),
    candidate: normalizedCandidate,
  };
}

function matchesIdentity(profile: BillPayProfile, context: ResolverContext): boolean {
  const groups = configuredGroups(profile.identity, BILL_PAY_PROFILE_IDENTITY_FIELDS);
  if (!groups.length) return false;
  return groups.every(([field, group]) => {
    if (field === "sender") {
      return Boolean(context.senderAddress)
        && alternativesFor(group).some((entry) => normalizedEmailAddress(entry) === context.senderAddress);
    }
    if (field === "domain") return domainMatch(context.senderDomain, group);
    if (field === "aliases") {
      return [context.senderDisplayName, context.candidate.payee, context.candidate.payee_hint]
        .some((value) => exactMatch(value, group));
    }
    if (field === "last4") {
      const last4 = trustedCandidateLast4(context.candidate);
      return Boolean(last4) && alternativesFor(group).some((value) => normalizedLast4(value) === last4);
    }
    return false;
  });
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
  return categories.flatMap((entry) => {
    if ("categories" in entry && Array.isArray(entry.categories)) return entry.categories;
    return "id" in entry ? [entry] : [];
  });
}

function metadataIndex(metadata: BillPayMetadata = {}): MetadataIndex {
  const categories = categoryRows(metadata.categories);
  return {
    accountIds: new Set((metadata.accounts || []).map((row) => row.id).filter(Boolean)),
    payeeIds: new Set((metadata.payees || []).map((row) => row.id).filter(Boolean)),
    categoryIds: new Set(categories.map((row) => row.id).filter(Boolean)),
    accounts: new Map((metadata.accounts || []).map((row) => [row.id, row])),
    payees: new Map((metadata.payees || []).map((row) => [row.id, row])),
    categories: new Map(categories.map((row) => [row.id, row])),
  };
}

function targetDiagnostics(targets: BillPayTargets = {}, metadata: BillPayMetadata = {}) {
  if (![metadata.accounts, metadata.payees, metadata.categories].some(Array.isArray)) return [];
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
  const id = targets[idField];
  return typeof id === "string" ? metadataIndex(metadata)[collection].get(id)?.name || "" : "";
}

function applyTargets(bill: BillCandidate, behavior: BillPayBehavior, metadata: BillPayMetadata): BillCandidate {
  const targets = behavior.targets || {};
  const next: BillCandidate = { ...bill, type: behavior.type || bill.type || "expense" };
  if (targets.payee_id) {
    next.payee_id = targets.payee_id;
    next.payee = labelForTarget(targets, metadata, "payee_id", "payee_label", "payees") || next.payee;
  } else if (targets.payee_label) next.payee = targets.payee_label;
  for (const field of ["account_id", "category_id", "from_account_id", "to_account_id", "schedule_name"] as const) {
    if (targets[field]) next[field] = targets[field];
  }
  for (const field of ["payee_label", "account_label", "category_label", "from_account_label", "to_account_label"] as const) {
    if (targets[field]) next[field] = targets[field] as string;
  }
  return next;
}

export function resolveBillPayMapping({ mappings, metadata = {}, email = {}, candidate = null }: BillPayResolveInput = {}): BillPayResolution {
  const context = resolverContext(email, candidate);
  const baseBill = fallbackBill(candidate);
  const matchingProfiles = normalizeBillPayMappings(mappings).profiles
    .filter((profile) => profile.enabled !== false && matchesIdentity(profile, context));
  const matchedProfiles = matchingProfiles.map((profile) => profile.id || null);
  if (matchingProfiles.length > 1) {
    return { bill: baseBill, mapping: { status: "identity_only", reason: "semantic_identity_ambiguous_profiles", matchedProfiles } };
  }
  if (!matchingProfiles.length) {
    return { bill: baseBill, mapping: { status: "unmapped", reason: "no_profile_match", matchedProfiles } };
  }

  const profile = matchingProfiles[0]!;
  const semanticMatch = selectSemanticEventBehavior((profile.behaviors || []).filter((behavior) => behavior.enabled !== false), context.candidate);
  if (!semanticMatch.behavior) {
    return {
      bill: baseBill,
      mapping: {
        status: "identity_only",
        profileId: profile.id || null,
        reason: semanticMatch.reason || "no_behavior_match",
        matchedProfiles,
      },
    };
  }
  const behavior = semanticMatch.behavior;
  const commonMapping: Omit<BillPayMappingOutcome, "status"> = {
    profileId: profile.id || null,
    behaviorId: behavior.id || null,
    matchedProfiles,
  };
  if (!behavior.targets || Object.keys(behavior.targets).length === 0) {
    return { bill: baseBill, mapping: { status: "incomplete_mapping", ...commonMapping, reason: "missing_behavior_targets" } };
  }
  const diagnostics = targetDiagnostics(behavior.targets, metadata);
  if (diagnostics.length) {
    return { bill: baseBill, mapping: { status: "invalid_target", ...commonMapping, diagnostics } };
  }
  const amount = selectSemanticBillAmount(context.candidate);
  if (!amount) {
    return { bill: baseBill, mapping: { status: "identity_only", ...commonMapping, reason: "semantic_amount_missing" } };
  }
  return {
    bill: { ...applyTargets(baseBill, behavior, metadata), amount: amount.amount, amount_kind: amount.kind },
    mapping: { status: "matched", ...commonMapping, amountSource: amount.source },
  };
}
