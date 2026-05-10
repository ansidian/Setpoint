import { DEFAULT_PREFLIGHT_RULES } from "./triage-preflight-profiles.js";

const VALID_LANES = new Set(["needs_attention", "fyi", "noise"]);
const VALID_URGENCIES = new Set(["high", "medium", "normal", "low"]);
const VALID_ACTIONS = new Set(["finalize", "audit", "grace", "route_model"]);
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
  /\bcanvas assignment\b/i,
  /\bunrecognized sign-?in\b/i,
  /\bsuspicious sign-?in\b/i,
  /\bpassword changed\b/i,
  /\baccount recovery\b/i,
  /\bthird-party oauth application\b/i,
];

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toText(value) {
  return String(value || "").toLowerCase();
}

function normalizeLane(value) {
  if (value === "actionable") return "needs_attention";
  return VALID_LANES.has(value) ? value : null;
}

function normalizeCategory(value) {
  return String(value || "uncategorized").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
}

function normalizeUrgency(value) {
  return VALID_URGENCIES.has(value) ? value : "normal";
}

function extractAmountHint(text) {
  const match = String(text || "").match(/\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/);
  return match ? `$${match[1]}` : null;
}

function domainFromAddress(address) {
  const [, domain = ""] = String(address || "").toLowerCase().split("@");
  return domain;
}

function textParts(email) {
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

function includesAny(text, needles = []) {
  return needles.some((needle) => text.includes(toText(needle)));
}

function includesAll(text, needles = []) {
  return needles.every((needle) => text.includes(toText(needle)));
}

function normalizeEmailInterests(interests = []) {
  if (!Array.isArray(interests)) return [];
  return interests
    .map((interest) => String(interest || "").trim())
    .filter(Boolean);
}

function senderScopedInterestMatch(email, interests = [], parts = textParts(email)) {
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

function regexMatches(text, pattern) {
  if (!pattern) return false;
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return false;
  }
}

function hasHardRisk(email, parts = textParts(email), exclusions = []) {
  if (exclusions.length && includesAny(parts.allText, exclusions)) return false;
  return HARD_RISK_PATTERNS.some((pattern) => pattern.test(parts.allText));
}

function hardRiskExclusionsFor(match) {
  return [
    ...(Array.isArray(match.hard_risk_exclusions) ? match.hard_risk_exclusions : []),
    ...(Array.isArray(match.risk_exclusions) ? match.risk_exclusions : []),
  ];
}

function ruleKey(rule) {
  if (rule.key) return rule.key;
  if (rule.id != null) return `db_rule_${rule.id}`;
  return `rule_${toText(rule.name).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "unknown"}`;
}

function ruleMode(rule, match) {
  if (VALID_ACTIONS.has(match.action)) return match.action;
  if (["disabled", "audit", "finalize"].includes(match.mode)) return match.mode;
  if (rule.route_to_model === "strong") return "route_model";
  if (rule.lane) return "finalize";
  return "route_model";
}

function isScopedRule(match) {
  return Boolean(
    match.from_addresses?.length
    || match.from_domains?.length
    || match.from_domain_suffixes?.length
    || match.from_name_includes?.length
  );
}

function matchesRule(email, rule, parts = textParts(email)) {
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
  if (match.body_regex && !regexMatches(parts.body.slice(0, 3500), match.body_regex)) return false;
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

function sensitivityFor(rule, match) {
  return match.sensitivity || rule.sensitivity || "normal";
}

function canFinalizeLane(rule, match, parts, lane, sensitivity) {
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

function resultForRule(rule, match, action, parts) {
  const lane = normalizeLane(rule.lane);
  const category = normalizeCategory(rule.category);
  const sensitivity = sensitivityFor(rule, match);
  const modelTier = rule.route_to_model === "strong" ? "strong" : "cheap";
  return {
    action,
    lane,
    category,
    urgency: normalizeUrgency(rule.urgency),
    escalation_badge: rule.escalation_badge || null,
    summary: rule.reason || "Matched triage preflight rule.",
    decisionAction: match.decision_action || (lane === "noise" ? "Ignore" : "Review when convenient"),
    deadline_at: null,
    modelTier: action === "finalize" ? null : modelTier,
    reasonCode: match.reason_code || rule.reason_code || rule.rule_type || ruleKey(rule),
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

function hasRuleSpecificHardRiskClearance(email, rules, parts) {
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

function hasScopedHardRiskFinalizer(email, rules, parts) {
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

function promoteNoiseForInterest(result, matchedInterest) {
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

function resultForSenderInterest(matchedInterest) {
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

function metadataForRule(match, parts) {
  const metadata = match.metadata && typeof match.metadata === "object" ? { ...match.metadata } : {};
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

export function evaluateTriagePreflight(email, {
  rules = [],
  includeDefaults = true,
  graceAlreadyUsed = false,
  emailInterests = [],
  disabledProfileGroups = [],
} = {}) {
  const parts = textParts(email);
  const disabledGroups = new Set(disabledProfileGroups);
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
    if (action === "grace" && graceAlreadyUsed) {
      return {
        ...result,
        action: "route_model",
        modelTier: "cheap",
        reasonCode: "weak_security_grace_elapsed",
        modelSaved: false,
      };
    }
    if (action === "finalize" && !canFinalizeLane(rule, match, parts, result.lane, result.sensitivity)) {
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

export function preflightDecisionMetadata(preflight) {
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

export function triageDecisionFromPreflight(preflight) {
  if (!preflight || preflight.action !== "finalize") return null;
  return {
    lane: preflight.lane,
    category: preflight.category,
    urgency: preflight.urgency,
    escalation_badge: preflight.escalation_badge,
    summary: preflight.summary,
    action: preflight.decisionAction,
    deadline_at: preflight.deadline_at,
    confidence: preflight.confidence,
    triage_source: "rule",
    rule_id: preflight.ruleId,
    model_usage: {},
    estimated_cost_usd: null,
    latency_ms: null,
    cheap_model_result: null,
    strong_model_result: null,
    bill_candidate: null,
    decision_metadata: preflightDecisionMetadata(preflight),
  };
}
