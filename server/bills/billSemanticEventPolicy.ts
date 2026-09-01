import crypto from "node:crypto";
import type { BillCandidate, BillEventKind, BillPayBehavior, BillPayTargets } from "../../shared/types/bills.ts";

export interface SemanticTargetPolicy {
  key: string;
  behavior: BillPayBehavior;
  behaviors: BillPayBehavior[];
  description: string;
}

const EVENT_COMPATIBLE_TYPES: Readonly<Record<BillEventKind, readonly string[]>> = Object.freeze({
  statement_issued: ["transfer", "bill"],
  payment_due: ["transfer", "bill"],
  payment_scheduled: ["transfer", "bill"],
  card_payment_completed: ["transfer"],
  payment_completed: ["expense", "bill"],
  payment_cancelled: [],
  purchase: ["expense"],
  refund: ["income"],
  bill_issued: ["bill", "expense"],
  reward: ["income"],
  payment_failed: [],
  other: [],
});

function normalizedLabel(value: unknown): string {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

const LABEL_ID_PAIRS: Readonly<Record<string, keyof BillPayTargets>> = Object.freeze({
  payee_label: "payee_id",
  account_label: "account_id",
  category_label: "category_id",
  from_account_label: "from_account_id",
  to_account_label: "to_account_id",
});

function canonicalTargetEntries(targets: BillPayTargets = {}): Array<[string, unknown]> {
  return Object.entries(targets)
    .filter(([field, value]) => {
      if (value == null || value === "") return false;
      const idField = LABEL_ID_PAIRS[field];
      return !idField || !targets[idField];
    })
    .map(([field, value]) => [field, field.endsWith("_label") || field === "schedule_name"
      ? normalizedLabel(value)
      : value] as [string, unknown])
    .sort(([left], [right]) => left.localeCompare(right));
}

function policyDescription(behaviors: BillPayBehavior[]): string {
  const labels = new Set<string>();
  for (const behavior of behaviors) {
    if (typeof behavior.name === "string" && behavior.name.trim()) labels.add(behavior.name.trim());
    for (const [field, value] of Object.entries(behavior.targets || {})) {
      if ((field.endsWith("_label") || field === "schedule_name") && String(value || "").trim()) {
        labels.add(String(value).normalize("NFKC").replace(/\s+/g, " ").trim());
      }
    }
  }
  return [...labels].join(" · ");
}

export function semanticTargetPolicies(
  behaviors: BillPayBehavior[],
  candidate: BillCandidate,
): { policies: SemanticTargetPolicy[]; reason: string | null } {
  if (!candidate.event_kind) return { policies: [], reason: "semantic_event_missing" };

  const compatibleTypes = EVENT_COMPATIBLE_TYPES[candidate.event_kind] || [];
  const compatible = behaviors.filter((behavior) => (
    behavior?.enabled !== false
    && typeof behavior.type === "string"
    && compatibleTypes.includes(behavior.type)
  ));
  if (!compatible.length) return { policies: [], reason: "semantic_event_no_compatible_behavior" };

  const candidateTypeMatches = compatible.filter((behavior) => behavior.type === candidate.type);
  const routedBehaviors = candidateTypeMatches.length ? candidateTypeMatches : compatible;
  const groups = new Map<string, BillPayBehavior[]>();
  for (const behavior of routedBehaviors) {
    const canonical = JSON.stringify({
      type: behavior.type,
      targets: canonicalTargetEntries(behavior.targets),
    });
    const group = groups.get(canonical) || [];
    group.push(behavior);
    groups.set(canonical, group);
  }
  const policies = [...groups.entries()].map(([canonical, groupedBehaviors]) => ({
    key: `policy-${crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 12)}`,
    behavior: groupedBehaviors[0]!,
    behaviors: groupedBehaviors,
    description: policyDescription(groupedBehaviors),
  }));
  return { policies, reason: policies.length > 1 ? "semantic_event_ambiguous_targets" : null };
}

export function selectSemanticEventBehavior(
  behaviors: BillPayBehavior[],
  candidate: BillCandidate,
): { behavior: BillPayBehavior | null; reason: string | null } {
  const result = semanticTargetPolicies(behaviors, candidate);
  if (!result.policies.length) return { behavior: null, reason: result.reason };
  if (result.policies.length === 1) return { behavior: result.policies[0]!.behavior, reason: null };
  const selected = result.policies.find((policy) => policy.key === candidate.target_policy_key);
  return selected
    ? { behavior: selected.behavior, reason: null }
    : { behavior: null, reason: "semantic_event_ambiguous_targets" };
}
