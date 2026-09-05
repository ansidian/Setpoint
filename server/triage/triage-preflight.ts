import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type {
  TriageEmail,
  TriageLane,
  TriagePreflightAction,
  TriagePreflightResult,
  TriageRule,
  TriageRuleMatch,
  TriageUrgency,
} from "./triage-types.ts";

interface EmailTextParts {
  subject: string;
  snippet: string;
  body: string;
  fromName: string;
  fromAddress: string;
  fromDomain: string;
  headerText: string;
  allText: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const DEFAULT_RULES_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "triage-preflight-rules.json",
);

// Fail fast at load: matchesRule silently treats broken regexes as
// non-matching, so a malformed catalog would otherwise just stop matching.
export function loadDefaultPreflightRules(path = DEFAULT_RULES_PATH): TriageRule[] {
  let rules: unknown;
  try {
    rules = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load triage preflight rules from ${path}: ${message}`);
  }
  if (!Array.isArray(rules)) {
    throw new Error(`Triage preflight rule catalog must be an array (${path})`);
  }
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!isRecord(rule) || typeof rule.key !== "string" || !rule.key) {
      throw new Error(`Triage preflight rule without a string key (${path})`);
    }
    if (seen.has(rule.key)) {
      throw new Error(`Duplicate triage preflight rule key "${rule.key}" (${path})`);
    }
    seen.add(rule.key);
    if (!Number.isFinite(Number(rule.priority))) {
      throw new Error(`Triage preflight rule "${rule.key}" has a non-numeric priority (${path})`);
    }
    if (!isRecord(rule.match_json)) {
      throw new Error(`Triage preflight rule "${rule.key}" has no match_json object (${path})`);
    }
    for (const field of ["subject_regex", "body_regex"]) {
      const pattern = rule.match_json[field];
      if (pattern === undefined) continue;
      try {
        new RegExp(String(pattern), "i");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Triage preflight rule "${rule.key}" has an invalid ${field}: ${message}`);
      }
    }
  }
  return rules as TriageRule[];
}

export const DEFAULT_PREFLIGHT_RULES = loadDefaultPreflightRules();

const VALID_LANES = new Set(["needs_attention", "fyi", "noise"]);
const VALID_URGENCIES = new Set(["high", "medium", "normal", "low"]);
const VALID_ACTIONS = new Set(["finalize", "audit", "route_model"]);
const DEFAULT_CONFIDENCE = 0.8;

const HARD_RISK_PATTERNS = [
  /\bpast due\b/i,
  /\boverdue\b/i,
  /\blow balance\b/i,
  /\binsufficient funds\b/i,
  /\bservice (?:interruption|suspension|disconnect|disconnection)\b/i,
  /\bmay be interrupted\b/i,
  /\bcard (?:expired|expiring|declined)\b/i,
  /\bpayment due\b/i,
  /\bpayment (?:failed|failure|declined|unsuccessful)\b/i,
  /\blegal notice\b/i,
  /\btax document\b/i,
  /\btuition\b/i,
  /\bregistration deadline\b/i,
  /\bassignment (?:deadline|due)\b/i,
  /\bunrecognized sign-?in\b/i,
  /\bsuspicious sign-?in\b/i,
  /\bpassword changed\b/i,
  /\baccount recovery\b/i,
  /\bthird-party oauth application\b/i,
];

function safeJson(value: unknown, fallback: TriageRuleMatch = {}): TriageRuleMatch {
  if (!value) return fallback;
  if (isRecord(value)) return value as TriageRuleMatch;
  try {
    const parsed: unknown = JSON.parse(String(value));
    return isRecord(parsed) ? parsed as TriageRuleMatch : fallback;
  } catch {
    return fallback;
  }
}

function toText(value: unknown): string {
  return String(value || "").toLowerCase();
}

function normalizeLane(value: unknown): TriageLane | null {
  if (value === "actionable") return "needs_attention";
  return typeof value === "string" && VALID_LANES.has(value) ? value as TriageLane : null;
}

function normalizeCategory(value: unknown): string {
  return String(value || "uncategorized").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
}

function normalizeUrgency(value: unknown): TriageUrgency {
  return typeof value === "string" && VALID_URGENCIES.has(value) ? value as TriageUrgency : "normal";
}

function extractAmountHint(text: unknown): string | null {
  const match = String(text || "").match(/\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/);
  return match ? `$${match[1]}` : null;
}

function domainFromAddress(address: unknown): string {
  const [, domain = ""] = String(address || "").toLowerCase().split("@");
  return domain;
}

function textParts(email: Partial<TriageEmail>): EmailTextParts {
  const subject = toText(email.subject);
  const snippet = toText(email.body_snippet);
  const body = toText(email.body_text);
  const fromName = toText(email.from_name);
  const fromAddress = toText(email.from_address);
  const fromDomain = domainFromAddress(email.from_address);
  return {
    subject,
    snippet,
    body,
    fromName,
    fromAddress,
    fromDomain,
    headerText: [fromName, fromAddress, subject, snippet].join("\n"),
    allText: [fromName, fromAddress, subject, snippet, body].join("\n"),
  };
}

function includesAny(text: string, needles: unknown[] = []): boolean {
  return needles.some((needle) => text.includes(toText(needle)));
}

function includesAll(text: string, needles: unknown[] = []): boolean {
  return needles.every((needle) => text.includes(toText(needle)));
}

function normalizeEmailInterests(interests: unknown = []): string[] {
  if (!Array.isArray(interests)) return [];
  return interests
    .map((interest) => String(interest || "").trim())
    .filter(Boolean);
}

function senderScopedInterestMatch(email: Partial<TriageEmail>, interests: unknown[] = [], parts = textParts(email)): string | null {
  for (const interest of normalizeEmailInterests(interests)) {
    const needle = toText(interest);
    if (!needle) continue;
    if (
      parts.fromName.includes(needle)
      || parts.fromAddress.includes(needle)
      || parts.fromDomain.includes(needle)
    ) {
      return interest;
    }
  }
  return null;
}

// Compile each distinct rule pattern once and reuse it. evaluateTriagePreflight
// runs on every model-routed email and previously recompiled the same default
// subject/body regexes per call. These patterns are case-insensitive only (no
// `g`/`y` flag), so `.test()` keeps no lastIndex state and the cached RegExp is
// safe to share across calls. Invalid patterns cache as null (treated as
// non-matching, preserving the prior try/catch behavior).
const compiledRegexCache = new Map<string, RegExp | null>();

function compileRegex(pattern: string): RegExp | null {
  if (compiledRegexCache.has(pattern)) return compiledRegexCache.get(pattern) ?? null;
  let compiled: RegExp | null;
  try {
    compiled = new RegExp(pattern, "i");
  } catch {
    compiled = null;
  }
  compiledRegexCache.set(pattern, compiled);
  return compiled;
}

function regexMatches(text: string, pattern: string | undefined): boolean {
  if (!pattern) return false;
  const compiled = compileRegex(pattern);
  return compiled ? compiled.test(text) : false;
}

function hasHardRisk(email: Partial<TriageEmail>, parts = textParts(email), exclusions: unknown[] = []): boolean {
  if (exclusions.length && includesAny(parts.allText, exclusions)) return false;
  return HARD_RISK_PATTERNS.some((pattern) => pattern.test(parts.allText));
}

function hardRiskExclusionsFor(match: TriageRuleMatch): unknown[] {
  return [
    ...(Array.isArray(match.hard_risk_exclusions) ? match.hard_risk_exclusions : []),
    ...(Array.isArray(match.risk_exclusions) ? match.risk_exclusions : []),
  ];
}

function ruleKey(rule: TriageRule): string {
  if (rule.key) return rule.key;
  if (rule.id != null) return `db_rule_${rule.id}`;
  return `rule_${toText(rule.name).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "unknown"}`;
}

function ruleMode(rule: TriageRule, match: TriageRuleMatch): TriagePreflightAction | "disabled" {
  if (typeof match.action === "string" && VALID_ACTIONS.has(match.action)) return match.action as TriagePreflightAction;
  if (match.mode === "disabled" || match.mode === "audit" || match.mode === "finalize") return match.mode;
  if (rule.route_to_model === "strong") return "route_model";
  if (rule.lane) return "finalize";
  return "route_model";
}

function isScopedRule(match: TriageRuleMatch): boolean {
  return Boolean(
    match.from_addresses?.length
    || match.from_domains?.length
    || match.from_domain_suffixes?.length
    || match.from_name_includes?.length
  );
}

function matchesRule(email: Partial<TriageEmail>, rule: TriageRule, parts = textParts(email)): boolean {
  const match = safeJson(rule.match_json);
  if (!match || match.enabled === false) return false;
  if (match.none_includes?.length && includesAny(parts.allText, match.none_includes)) return false;
  const identityChecks = [];
  if (match.from_addresses?.length) {
    identityChecks.push(match.from_addresses.map(toText).includes(parts.fromAddress));
  }
  if (match.from_domains?.length) {
    identityChecks.push(match.from_domains.map(toText).includes(parts.fromDomain));
  }
  if (match.from_domain_suffixes?.length) {
    identityChecks.push(match.from_domain_suffixes.map(toText).some(
      (suffix) => parts.fromDomain === suffix || parts.fromDomain.endsWith(`.${suffix}`),
    ));
  }
  if (match.from_name_includes?.length) {
    identityChecks.push(includesAny(parts.fromName, match.from_name_includes));
  }
  if (identityChecks.length && !identityChecks.some(Boolean)) return false;
  if (match.subject_includes?.length && !includesAny(parts.subject, match.subject_includes)) return false;
  if (match.subject_regex && !regexMatches(parts.subject, match.subject_regex)) return false;
  if (match.snippet_includes?.length && !includesAny(parts.snippet, match.snippet_includes)) return false;
  if (match.body_includes?.length && !match.allow_body_match && !match.body_match_enabled) return false;
  if (match.body_includes?.length && !includesAny(parts.body, match.body_includes)) return false;
  if (match.body_regex && !(match.allow_body_match || match.body_match_enabled)) return false;
  if (match.body_regex && !regexMatches(parts.body, match.body_regex)) return false;
  if (match.all_includes?.length && !includesAll(parts.allText, match.all_includes)) return false;
  if (match.any_includes?.length && !includesAny(parts.allText, match.any_includes)) return false;

  return Boolean(
    match.from_addresses?.length
    || match.from_domains?.length
    || match.from_domain_suffixes?.length
    || match.from_name_includes?.length
    || match.subject_includes?.length
    || match.subject_regex
    || match.snippet_includes?.length
    || match.body_includes?.length
    || match.body_regex
    || match.all_includes?.length
    || match.any_includes?.length
  );
}

function sensitivityFor(rule: TriageRule, match: TriageRuleMatch): string {
  return String(match.sensitivity || rule.sensitivity || "normal");
}

function canFinalizeLane(match: TriageRuleMatch, parts: EmailTextParts, lane: TriageLane | null, sensitivity: string): boolean {
  if (lane === "needs_attention") return true;
  if (match.any_includes?.length && !isScopedRule(match) && !match.allow_legacy_any_finalize) return false;
  if (sensitivity === "critical" && lane === "noise" && !isScopedRule(match)) return false;
  if (sensitivity === "sensitive" && lane === "noise") {
    return isScopedRule(match)
      || Boolean(match.subject_regex && regexMatches(parts.subject, match.subject_regex))
      || Boolean(match.subject_includes?.length && includesAny(parts.subject, match.subject_includes))
      || Boolean(match.snippet_includes?.length && includesAny(parts.snippet, match.snippet_includes));
  }
  return true;
}

function resultForRule(rule: TriageRule, match: TriageRuleMatch, action: TriagePreflightAction, parts: EmailTextParts): TriagePreflightResult {
  const lane = normalizeLane(rule.lane);
  const category = normalizeCategory(rule.category);
  const sensitivity = sensitivityFor(rule, match);
  const modelTier = rule.route_to_model === "strong" ? "strong" : "cheap";
  return {
    action,
    lane,
    category,
    urgency: normalizeUrgency(rule.urgency),
    escalation_badge: rule.escalation_badge ? String(rule.escalation_badge) : null,
    summary: rule.reason ? String(rule.reason) : "Matched triage preflight rule.",
    decisionAction: match.decision_action || (lane === "noise" ? "Ignore" : "Review when convenient"),
    deadline_at: null,
    modelTier: action === "finalize" ? null : modelTier,
    reasonCode: String(match.reason_code || rule.reason_code || rule.rule_type || ruleKey(rule)),
    sensitivity,
    confidence: Number.isFinite(Number(rule.confidence)) ? Number(rule.confidence) : DEFAULT_CONFIDENCE,
    riskOverride: false,
    matchedRuleKey: ruleKey(rule),
    ruleId: rule.id || null,
    modelSaved: action === "finalize",
    audit: action === "audit",
    riskReason: null,
    matchedTextScope: parts ? "scoped" : "unknown",
    matchedInterest: null,
    interestPromotion: null,
    metadata: metadataForRule(match, parts),
  };
}

function hasRuleSpecificHardRiskClearance(email: Partial<TriageEmail>, rules: TriageRule[], parts: EmailTextParts): boolean {
  return rules.some((rule) => {
    const match = safeJson(rule.match_json);
    const mode = ruleMode(rule, match);
    const exclusions = hardRiskExclusionsFor(match);
    return mode !== "disabled"
      && isScopedRule(match)
      && exclusions.length
      && matchesRule(email, rule, parts)
      && !hasHardRisk(email, parts, exclusions);
  });
}

function hasScopedHardRiskFinalizer(email: Partial<TriageEmail>, rules: TriageRule[], parts: EmailTextParts): boolean {
  return rules.some((rule) => {
    const match = safeJson(rule.match_json);
    const mode = ruleMode(rule, match);
    return mode === "finalize"
      && match.allow_hard_risk_finalize === true
      && normalizeLane(rule.lane) === "needs_attention"
      && isScopedRule(match)
      && matchesRule(email, rule, parts);
  });
}

function promoteNoiseForInterest(result: TriagePreflightResult, matchedInterest: string | null): TriagePreflightResult {
  if (!matchedInterest || result.action !== "finalize" || result.lane !== "noise" || result.riskOverride) {
    return result;
  }
  return {
    ...result,
    lane: "fyi",
    category: "updates",
    urgency: "normal",
    summary: `Matched email interest: ${matchedInterest}.`,
    decisionAction: "Review when convenient",
    reasonCode: "email_interest_promoted_noise_to_fyi",
    matchedInterest,
    interestPromotion: {
      originalLane: result.lane,
      originalReasonCode: result.reasonCode,
      originalMatchedRuleKey: result.matchedRuleKey,
      originalCategory: result.category,
    },
  };
}

function resultForSenderInterest(matchedInterest: string): TriagePreflightResult {
  return {
    action: "finalize",
    lane: "fyi",
    category: "updates",
    urgency: "normal",
    escalation_badge: null,
    summary: `Matched email interest: ${matchedInterest}.`,
    decisionAction: "Review when convenient",
    deadline_at: null,
    modelTier: null,
    reasonCode: "email_interest_sender_fyi",
    sensitivity: "normal",
    confidence: 0.88,
    riskOverride: false,
    matchedRuleKey: null,
    ruleId: null,
    modelSaved: true,
    audit: false,
    riskReason: null,
    matchedTextScope: "sender",
    matchedInterest,
    interestPromotion: null,
    metadata: null,
  };
}

function metadataForRule(match: TriageRuleMatch, parts: EmailTextParts): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = isRecord(match.metadata) ? { ...match.metadata } : {};
  if (metadata.finance_candidate) {
    if (parts.fromName.includes("citi")) metadata.finance_candidate_kind = "card_transaction";
    else if (parts.fromName.includes("fidelity") || parts.fromName.includes("east west")) {
      metadata.finance_candidate_kind = "transfer";
    } else if (parts.fromName.includes("paypal") || parts.fromName.includes("steam") || parts.fromName.includes("apple") || parts.fromName.includes("freetaxusa")) {
      metadata.finance_candidate_kind = "receipt";
    }
    const amountHint = extractAmountHint(parts.subject) || extractAmountHint(parts.snippet);
    if (amountHint) metadata.amount_hint = amountHint;
  }
  return Object.keys(metadata).length ? metadata : null;
}

export function evaluateTriagePreflight(email: Partial<TriageEmail>, {
  rules = [],
  includeDefaults = true,
  emailInterests = [],
  disabledProfileGroups = [],
}: {
  rules?: TriageRule[];
  includeDefaults?: boolean;
  emailInterests?: unknown[];
  disabledProfileGroups?: unknown[];
} = {}): TriagePreflightResult {
  const parts = textParts(email);
  const disabledGroups = new Set<unknown>(disabledProfileGroups);
  const allRules = [
    ...rules,
    ...(includeDefaults ? DEFAULT_PREFLIGHT_RULES : []),
  ]
    .filter((rule) => !disabledGroups.has(rule.profile_group || rule.profileGroup))
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));

  if (
    hasHardRisk(email, parts)
    && !hasRuleSpecificHardRiskClearance(email, allRules, parts)
    && !hasScopedHardRiskFinalizer(email, allRules, parts)
  ) {
    return {
      action: "route_model",
      lane: null,
      category: "uncategorized",
      urgency: "high",
      escalation_badge: "High Risk",
      summary: "High-risk content requires strong-model review.",
      decisionAction: "Review",
      deadline_at: null,
      modelTier: "strong",
      reasonCode: "hard_risk_override",
      sensitivity: "critical",
      confidence: 0.9,
      riskOverride: true,
      matchedRuleKey: null,
      ruleId: null,
      modelSaved: false,
      audit: false,
      riskReason: "global_hard_risk",
      matchedInterest: null,
      interestPromotion: null,
    };
  }

  for (const rule of allRules) {
    const match = safeJson(rule.match_json);
    const mode = ruleMode(rule, match);
    if (mode === "disabled") continue;
    if (!matchesRule(email, rule, parts)) continue;
    const action = mode === "route_model" ? "route_model" : mode;
    const result = resultForRule(rule, match, action, parts);
    if (action === "finalize" && !canFinalizeLane(match, parts, result.lane, result.sensitivity)) {
      return {
        ...result,
        action: "route_model",
        modelTier: "cheap",
        modelSaved: false,
        reasonCode: `${result.reasonCode}_audit_required`,
      };
    }
    return promoteNoiseForInterest(result, senderScopedInterestMatch(email, emailInterests, parts));
  }

  const matchedInterest = senderScopedInterestMatch(email, emailInterests, parts);
  if (matchedInterest) {
    return resultForSenderInterest(matchedInterest);
  }

  return {
    action: "route_model",
    lane: null,
    category: "uncategorized",
    urgency: "normal",
    escalation_badge: null,
    summary: "No deterministic preflight rule matched.",
    decisionAction: "Review",
    deadline_at: null,
    modelTier: "cheap",
    reasonCode: "no_preflight_match",
    sensitivity: "normal",
    confidence: null,
    riskOverride: false,
    matchedRuleKey: null,
    ruleId: null,
    modelSaved: false,
    audit: false,
    riskReason: null,
    matchedInterest: null,
    interestPromotion: null,
  };
}

export function preflightDecisionMetadata(preflight: TriagePreflightResult | null | undefined): Record<string, unknown> | null {
  if (!preflight) return null;
  return {
    preflight: {
      action: preflight.action,
      lane: preflight.lane,
      modelTier: preflight.modelTier,
      reasonCode: preflight.reasonCode,
      sensitivity: preflight.sensitivity,
      confidence: preflight.confidence,
      riskOverride: preflight.riskOverride,
      riskReason: preflight.riskReason,
      matchedRuleKey: preflight.matchedRuleKey,
      ruleId: preflight.ruleId,
      modelSaved: preflight.modelSaved,
      audit: preflight.audit,
      matchedInterest: preflight.matchedInterest,
      interestPromotion: preflight.interestPromotion,
      metadata: preflight.metadata,
    },
  };
}
