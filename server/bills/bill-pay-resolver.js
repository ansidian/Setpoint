import {
  BILL_PAY_BEHAVIOR_INTENT_FIELDS,
  BILL_PAY_PROFILE_IDENTITY_FIELDS,
  normalizeBillPayMappings,
} from "./bill-pay-mappings.js";
import { normalizeBillCandidate } from "../snapshots/snapshot-lifecycle.js";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function alternativesFor(group) {
  if (!Array.isArray(group)) return [];
  return group
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .map(normalizeText)
    .filter(Boolean);
}

function includesAny(haystack, group) {
  const text = normalizeText(haystack);
  if (!text) return false;
  return alternativesFor(group).some((needle) => text.includes(needle));
}

function configuredGroups(source, fields) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  return fields
    .filter((field) => alternativesFor(source[field]).length > 0)
    .map((field) => [field, source[field]]);
}

function flattenContext({ email = {}, candidate = {} } = {}) {
  const normalizedCandidate = normalizeBillCandidate(candidate) || {};
  return {
    from: [
      email.from,
      email.fromEmail,
      email.from_address,
      email.from_name,
    ].filter(Boolean).join(" "),
    subject: email.subject || "",
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

function matchesIdentity(profile, context) {
  const groups = configuredGroups(profile.identity, BILL_PAY_PROFILE_IDENTITY_FIELDS);
  if (!groups.length) return false;
  return groups.every(([field, group]) => {
    if (field === "sender" || field === "domain") return includesAny(context.from, group);
    if (field === "last4" || field === "aliases") return includesAny(context.all, group);
    return false;
  });
}

function matchesIntent(behavior, context) {
  const groups = configuredGroups(behavior.intent, BILL_PAY_BEHAVIOR_INTENT_FIELDS);
  if (!groups.length) return false;
  return groups.every(([field, group]) => {
    if (field === "subject") return includesAny(context.subject, group);
    if (field === "body") return includesAny(context.body, group);
    return false;
  });
}

function parseMoney(value) {
  if (!value) return null;
  const normalized = String(value).replace(/,/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

const MONTHS = Object.freeze({
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

function parseLabeledAmount(text, labels) {
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

function parseTrailingLabeledAmount(text, label) {
  const source = String(text || "");
  const index = normalizeText(source).indexOf(normalizeText(label));
  if (index < 0) return null;

  const tail = source.slice(index + label.length, index + label.length + 260);
  const matches = [...tail.matchAll(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/g)];
  if (!matches.length) return null;
  return parseMoney(matches[matches.length - 1]?.[1]);
}

function toIsoDate(month, day, year) {
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

function toIsoDateFromMonthName(month, day, year) {
  const numericMonth = MONTHS[normalizeText(month)];
  return toIsoDate(numericMonth, day, year);
}

function parseLabeledDate(text) {
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

function amountFromStrategy(strategy, context) {
  if (strategy === "none") return { amount: null, source: "none" };
  if (strategy === "model_amount" || !strategy) {
    return { amount: context.candidate.amount ?? null, source: "model_amount" };
  }
  const text = `${context.subject}\n${context.body}`;
  const labelsByStrategy = {
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

function defaultAmountFallback(source) {
  return source === "pasted_text" ? "blank_if_not_found" : "use_model_amount";
}

function fallbackBill(candidate) {
  return normalizeBillCandidate(candidate) || {
    payee: "",
    amount: null,
    due_date: null,
    type: "expense",
  };
}

function categoryRows(categories = []) {
  return categories.flatMap((categoryOrGroup) => {
    if (Array.isArray(categoryOrGroup?.categories)) return categoryOrGroup.categories;
    return categoryOrGroup ? [categoryOrGroup] : [];
  });
}

function metadataIndex(metadata = {}) {
  return {
    accountIds: new Set((metadata.accounts || []).map((row) => row.id).filter(Boolean)),
    payeeIds: new Set((metadata.payees || []).map((row) => row.id).filter(Boolean)),
    categoryIds: new Set(categoryRows(metadata.categories).map((row) => row.id).filter(Boolean)),
    accounts: new Map((metadata.accounts || []).map((row) => [row.id, row])),
    payees: new Map((metadata.payees || []).map((row) => [row.id, row])),
    categories: new Map(categoryRows(metadata.categories).map((row) => [row.id, row])),
  };
}

function hasTargetValidationMetadata(metadata = {}) {
  return Array.isArray(metadata.accounts)
    || Array.isArray(metadata.payees)
    || Array.isArray(metadata.categories);
}

function targetDiagnostics(targets = {}, metadata = {}) {
  if (!hasTargetValidationMetadata(metadata)) return [];
  const index = metadataIndex(metadata);
  const checks = [
    ["payee_id", index.payeeIds, "Payee not found"],
    ["account_id", index.accountIds, "Account not found"],
    ["from_account_id", index.accountIds, "Account not found"],
    ["to_account_id", index.accountIds, "Account not found"],
    ["category_id", index.categoryIds, "Category not found"],
  ];
  return checks
    .filter(([field, ids]) => targets[field] && !ids.has(targets[field]))
    .map(([field, , message]) => ({ field, id: targets[field], message }));
}

function labelForTarget(targets, metadata, idField, labelField, collection) {
  if (targets[labelField]) return targets[labelField];
  const index = metadataIndex(metadata);
  return index[collection].get(targets[idField])?.name || "";
}

function applyTargets(bill, behavior, metadata) {
  const targets = behavior.targets || {};
  const next = { ...bill, type: behavior.type || bill.type || "expense" };

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

function applyPastedTextDate(bill, context) {
  if (bill.due_date) return bill;
  const dueDate = parseLabeledDate(`${context.subject}\n${context.body}`);
  return dueDate ? { ...bill, due_date: dueDate } : bill;
}

function resolveAmount({ behavior, context, source }) {
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
} = {}) {
  const normalizedMappings = normalizeBillPayMappings(mappings);
  const context = flattenContext({ email, candidate });
  const baseBill = fallbackBill(candidate);
  const matchedProfiles = [];

  for (const profile of normalizedMappings.profiles) {
    if (profile?.enabled === false) continue;
    if (!matchesIdentity(profile, context)) continue;
    matchedProfiles.push(profile.id || null);

    for (const behavior of profile.behaviors || []) {
      if (behavior?.enabled === false) continue;
      if (!matchesIntent(behavior, context)) continue;

      const behaviorId = behavior.id || null;
      const commonMapping = {
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
