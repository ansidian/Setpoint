import { createHash } from "node:crypto";
import type { ActualMetadata } from "../../shared/types/actual.ts";
import type { BillCandidate, FinancialEmailInput, FinancialPlanReason, FinancialPlanTarget, FinancialPlanTargets } from "../../shared/types/bills.ts";
import type { FinancialProfile, FinancialProfileConfiguration, FinancialProfileResolution } from "../../shared/types/financial-profiles.ts";
import type { FinancialTargetInferenceResult } from "./financialEmailTargetInference.ts";
import { accountSuffix, namedAccountEvidence, scheduleAccountId, transferScheduleTopology, trustedAccountSuffix } from "./financialEmailAccountEvidence.ts";
import { hasVerbatimFinancialEvidence, isIgnoredFinancialNotice } from "./financialEmailClassificationPolicy.ts";
import { validateFinancialProfiles } from "./financial-profiles.ts";

function identity(value: unknown): string {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function groundedHint(candidate: BillCandidate, role: "account" | "from_account" | "to_account", content: string): string | null {
  const hint = candidate[`${role}_hint`];
  return typeof hint === "string" && Number(candidate[`${role}_hint_confidence`]) >= 0.8
    && hasVerbatimFinancialEvidence(content, hint) ? hint : null;
}

function fundingSuffix(candidate: BillCandidate, content: string): string | null {
  return candidate.type === "transfer" && ["statement_issued", "payment_scheduled"].includes(String(candidate.event_kind))
    ? accountSuffix(groundedHint(candidate, "from_account", content) || "") : null;
}

/** Older extractions have one general suffix. Explicit payment roles take precedence. */
export function financialProfileCardIdentity(candidate: BillCandidate, content: string): { suffix: string | null; evidence: string | null } {
  const destination = candidate.type === "transfer" ? groundedHint(candidate, "to_account", content) : null;
  const destinationSuffix = accountSuffix(destination || "");
  if (destinationSuffix) return { suffix: destinationSuffix, evidence: destination };
  const suffix = trustedAccountSuffix(candidate);
  return { suffix: suffix && suffix !== fundingSuffix(candidate, content) ? suffix : null,
    evidence: candidate.account_last4_evidence || null };
}

function profileKind(candidate: BillCandidate): FinancialProfile["target"]["kind"] | null {
  if (isIgnoredFinancialNotice(candidate)) return null;
  if (candidate.type === "bill" && ["bill_issued", "statement_issued"].includes(String(candidate.event_kind))) return "utility";
  if (candidate.type === "transfer" && ["statement_issued", "payment_scheduled"].includes(String(candidate.event_kind))) return "card_payment";
  if (candidate.type === "expense") return "expense";
  if (candidate.type === "income") return "income";
  return null;
}

export function matchFinancialProfile(configuration: FinancialProfileConfiguration, input: FinancialEmailInput, candidate: BillCandidate): {
  profile: FinancialProfile | null; resolution: FinancialProfileResolution;
} {
  const sender = identity(input.sourceIdentity?.senderAddress);
  const content = `${input.email?.subject || ""}\n${input.email?.body || input.email?.body_snippet || ""}`;
  const { suffix, evidence } = financialProfileCardIdentity(candidate, content);
  const matches = configuration.profiles.filter(profile => configuration.budgetId && profile.enabled && profile.budgetId === configuration.budgetId
    && profile.target.kind === profileKind(candidate)
    && profile.senderAddresses.some(address => identity(address) === sender)
    && (!profile.merchantName || [candidate.payee_hint, candidate.payee].some(value => identity(value) === identity(profile.merchantName))
      && hasVerbatimFinancialEvidence(content, candidate.payee_hint || candidate.payee))
    && (!profile.accountLast4 || profile.accountLast4 === suffix && hasVerbatimFinancialEvidence(content, evidence)));
  const profile = matches.length === 1 ? matches[0]! : null;
  return { profile, resolution: {
    status: profile ? "matched" : matches.length ? "ambiguous" : "missing",
    revision: configuration.revision, budgetId: configuration.budgetId,
    ...(profile ? { profileId: profile.id, profileName: profile.name, targetKind: profile.target.kind,
      cycleKey: profileCycleKey(profile, candidate) || undefined } : {}),
    reason: profile ? `Using ${profile.name}.`
      : matches.length ? "More than one financial profile matches this email. Resolve the overlapping profiles."
      : "Review this entry and configure a profile before similar emails can be recorded automatically.",
  } };
}

function target(kind: FinancialPlanTarget["kind"], profile: FinancialProfile, id?: string | null, label?: string | null): FinancialPlanTarget {
  return { kind, status: id ? "resolved" : "not_applicable", ...(id ? { id, label } : {}),
    provenance: id ? [{ source: "owner_profile", confidence: "exact", reason: "confirmed_profile", evidence: profile.name }] : [] };
}

export function resolveFinancialProfileTargets(profile: FinancialProfile, resolution: FinancialProfileResolution,
  source: BillCandidate, metadata: ActualMetadata, content: string): {
    resolution: FinancialProfileResolution; inference: FinancialTargetInferenceResult | null;
  } {
  const targets: FinancialPlanTargets = { account: target("account", profile), payee: target("payee", profile), category: target("category", profile),
    fromAccount: target("from_account", profile), toAccount: target("to_account", profile), schedule: target("schedule", profile) };
  const candidate: BillCandidate = { ...source, account_id: null, payee_id: null, category_id: null,
    from_account_id: null, to_account_id: null, schedule_name: null };
  const invalid = (reason: string) => ({ resolution: { ...resolution, status: "invalid" as const, reason }, inference: null });
  const validation = validateFinancialProfiles([profile], { budgetId: resolution.budgetId, metadata });
  if (!validation.valid) return invalid(validation.message);
  const openAccount = (id: string | null | undefined) => metadata.accounts.find(account => account.id === id && !account.closed);
  const contradictsAccount = (role: "account" | "from_account" | "to_account", id: string): boolean => {
    const hint = groundedHint(source, role, content);
    if (!hint) return false;
    const named = namedAccountEvidence(source, metadata, role, content);
    if (named.some(item => item.id !== id)) return true;
    // A generic last-four reference can use the saved mapping when Actual's
    // readable account name omits its number. Named destinations still require agreement.
    const referencedSuffix = hint.trim().match(/^(?:your\s+)?(?:(?:credit\s+)?card|account)?\s*(?:ending(?:\s+in)?\s*)?[*x•(]*\s*(\d{4})\)?$/i)?.[1];
    const mappedSuffix = !!referencedSuffix && referencedSuffix === profile.accountLast4;
    // A named income destination absent from Actual is still evidence. A saved
    // default cannot turn an external balance or unknown account into this card.
    if (source.type === "income" && !named.some(item => item.id === id) && !mappedSuffix) return true;
    const selectedSuffix = accountSuffix(openAccount(id)?.name || "");
    const hintedSuffix = accountSuffix(hint);
    return !!(hintedSuffix && selectedSuffix && hintedSuffix !== selectedSuffix);
  };
  const assignAccount = (role: "account" | "from_account" | "to_account", id: string): string | null => {
    const account = openAccount(id);
    if (!account) return "An account in this profile is unavailable in Actual. Update the profile.";
    if (contradictsAccount(role, account.id)) return "The email identifies a different account from the saved profile. Review this entry.";
    const suffix = role === "to_account" ? financialProfileCardIdentity(source, content).suffix : trustedAccountSuffix(source);
    if ((role === "account" || role === "to_account") && suffix && accountSuffix(account.name)
      && suffix !== accountSuffix(account.name) && hasVerbatimFinancialEvidence(content, source.account_last4_evidence)) {
      return "The email's card number conflicts with the saved profile. Review this entry.";
    }
    const key = role === "from_account" ? "fromAccount" : role === "to_account" ? "toAccount" : "account";
    targets[key] = target(role, profile, account.id, account.name);
    candidate[`${role}_id`] = account.id;
    return null;
  };
  const assignPayee = (id: string | null | undefined): boolean => {
    const payee = metadata.payees.find(item => item.id === id && !item.transfer_acct);
    if (!payee) return false;
    targets.payee = target("payee", profile, payee.id, payee.name);
    candidate.payee_id = payee.id; candidate.payee = payee.name;
    return true;
  };
  const assignCategory = (id: unknown): boolean => {
    if (!id) return true;
    const category = metadata.categories.flatMap(group => group.categories).find(item => item.id === id);
    if (!category) return false;
    targets.category = target("category", profile, category.id, category.name); candidate.category_id = category.id;
    return true;
  };
  const configured = profile.target;
  if (configured.kind === "utility") {
    const schedule = metadata.schedules.find(item => item.id === configured.scheduleId && item.type === "bill");
    if (!schedule) return invalid("The utility schedule in this profile is unavailable. Choose its current Actual schedule.");
    const account = scheduleAccountId(schedule);
    if (!account) return invalid("The utility schedule has no exact account. Update it in Actual.");
    // A utility's service-account suffix is not necessarily its funding account.
    const issue = assignAccount("from_account", account);
    if (issue) return invalid(issue);
    targets.account = { ...targets.fromAccount, kind: "account" }; targets.fromAccount = target("from_account", profile);
    candidate.account_id = account; candidate.from_account_id = null;
    const payeeId = schedule.conditions?.find(condition => ["payee", "description"].includes(String(condition.field)))?.value;
    if (typeof payeeId !== "string" || !assignPayee(payeeId)) return invalid("The utility schedule's payee is unavailable. Update it in Actual.");
    const categoryId = schedule.conditions?.find(condition => condition.field === "category")?.value;
    if (!assignCategory(categoryId)) return invalid("The utility schedule's category is unavailable. Update it in Actual.");
    targets.schedule = target("schedule", profile, schedule.id, schedule.name || profile.name);
    candidate.schedule_name = schedule.name || profile.name;
  } else if (configured.kind === "card_payment") {
    if (configured.fromAccountId === configured.toAccountId) return invalid("Choose different funding and card accounts in this profile.");
    const issue = assignAccount("from_account", configured.fromAccountId) || assignAccount("to_account", configured.toAccountId);
    if (issue) return invalid(issue);
    // Card-product evidence uses account_hint; scheduled-payment destinations must agree with it too.
    const general = groundedHint(source, "account", content);
    const funding = groundedHint(source, "from_account", content);
    const generalRole = general && funding && identity(general) === identity(funding) ? configured.fromAccountId : configured.toAccountId;
    if (contradictsAccount("account", generalRole)) {
      return invalid("The email identifies a different card from this profile. Review this entry.");
    }
    const schedule = configured.scheduleId ? metadata.schedules.find(item => item.id === configured.scheduleId) : null;
    if (configured.scheduleId) {
      const endpoints = schedule && transferScheduleTopology(schedule);
      if (!schedule || !endpoints || endpoints.fromAccountId !== configured.fromAccountId || endpoints.toAccountId !== configured.toAccountId) {
        return invalid("The payment schedule no longer matches this profile's funding and card accounts.");
      }
      targets.schedule = target("schedule", profile, schedule.id, schedule.name || profile.name);
    }
    candidate.schedule_name = schedule?.name || `${targets.toAccount.label || "Card"} Payment`;
  } else {
    const issue = assignAccount("account", configured.accountId);
    if (issue) return invalid(issue);
    if (configured.kind === "income" && contradictsAccount("to_account", configured.accountId)) {
      return invalid("The email identifies a different income destination from this profile. Review this entry.");
    }
    if (!assignPayee(configured.payeeId)) return invalid("The payee in this profile is unavailable. Choose its current Actual payee.");
    if (!assignCategory(configured.categoryId)) return invalid("The category in this profile is unavailable. Choose its current Actual category.");
  }
  return { resolution, inference: { candidate, targets, reasons: [] } };
}

export function financialProfileReason(resolution: FinancialProfileResolution): FinancialPlanReason | null {
  if (resolution.status === "matched") return null;
  return { code: resolution.status === "missing" ? "profile_required" : "profile_conflict", message: resolution.reason, blocking: true, field: "profile" };
}

/** A cycle belongs to a configured schedule, independently of sender/message/reference changes. */
export function financialProfileCycleKey(configuration: FinancialProfileConfiguration, input: FinancialEmailInput, candidate: BillCandidate): string | null {
  const { profile } = matchFinancialProfile(configuration, input, candidate);
  return profile ? profileCycleKey(profile, candidate) : null;
}

function profileCycleKey(profile: FinancialProfile, candidate: BillCandidate): string | null {
  if (!candidate.due_date) return null;
  const target = profile.target;
  const destination = target.kind === "utility" ? [target.scheduleId]
    : target.kind === "card_payment" ? [target.fromAccountId, target.toAccountId] : null;
  if (!destination) return null;
  return createHash("sha256").update(JSON.stringify(["financial-profile-cycle-v1", profile.budgetId,
    target.kind, ...destination, candidate.due_date])).digest("hex");
}
