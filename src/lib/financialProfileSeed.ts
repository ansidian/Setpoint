import type { BillCandidate, FinancialEmailPlan, FinancialPlanTarget } from "../../shared/types/bills";
import type { FinancialProfileTarget } from "../../shared/types/financial-profiles";

/** Client-only editing intent. Missing context stays unset until the owner supplies it. */
export interface FinancialProfileSeed {
  name?: string;
  budgetId?: string;
  senderAddresses: string[];
  merchantName?: string;
  accountLast4?: string;
  target?: FinancialProfileTarget;
}

interface SourceEmail {
  uid?: unknown; id?: unknown; email_id?: unknown; account_id?: unknown;
  from_address?: unknown; from_email?: unknown; fromEmail?: unknown; from?: unknown; from_name?: unknown;
  subject?: unknown; bill_candidate?: unknown; extractedBill?: unknown;
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? [...value].map(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character).join("").trim().slice(0, limit) : "";
}

function exactAddress(value: unknown): string {
  const address = text(value, 255).toLowerCase();
  return address.length <= 254 && /^[a-z0-9.!#$%&'+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(address)
    && address.split("@")[0]!.length <= 64 && !address.startsWith(".") && !address.split("@")[0]!.endsWith(".") && !address.includes("..") ? address : "";
}

function sender(email: SourceEmail): string {
  for (const value of [email.from_address, email.from_email, email.fromEmail]) {
    const address = exactAddress(value);
    if (address) return address;
  }
  const from = text(email.from, 400);
  const bracketed = from.match(/^[^<>]*<([^<>]+)>$/);
  return exactAddress(bracketed?.[1] || from);
}

function sourceKey(email: SourceEmail): string | null {
  const id = email.uid || email.id || email.email_id;
  return id == null ? null : `${email.account_id || ""}:${id}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function existingId(target: FinancialPlanTarget | undefined): string {
  return target?.status === "resolved" && !target.competingCandidates?.length
    && !target.provenance.some(item => item.reason === "grounded_new_payee") ? text(target.id, 128) : "";
}

function candidateTarget(candidate: BillCandidate | null, plan?: FinancialEmailPlan): FinancialProfileTarget | undefined {
  if (!candidate) return undefined;
  const targets = plan?.targets;
  if (candidate.type === "bill") return { kind: "utility", scheduleId: existingId(targets?.schedule) };
  if (candidate.type === "transfer" && ["statement_issued", "payment_scheduled"].includes(String(candidate.event_kind))) return {
    kind: "card_payment", fromAccountId: existingId(targets?.fromAccount), toAccountId: existingId(targets?.toAccount),
    ...(existingId(targets?.schedule) ? { scheduleId: existingId(targets?.schedule) } : {}),
  };
  if (candidate.type === "expense" || candidate.type === "income") return {
    kind: candidate.type, accountId: existingId(targets?.account), payeeId: existingId(targets?.payee),
    ...(existingId(targets?.category) ? { categoryId: existingId(targets?.category) } : {}),
  };
  return undefined;
}

/** Uses only the selected source and an already-loaded plan explicitly keyed to it. */
export function buildEmailFinancialProfileSeed(email: SourceEmail, {
  body, resolution,
}: { body?: string | null; resolution?: { key: string | null; plan: FinancialEmailPlan | null } } = {}): FinancialProfileSeed {
  const address = sender(email);
  const emailId = String(email.uid || email.id || email.email_id || "");
  const matchingPlan = resolution?.key && resolution.key === sourceKey(email) ? resolution.plan : null;
  const completionUid = matchingPlan?.workflow?.completion?.emailUid;
  const suggestionSenderMismatch = matchingPlan?.profileSuggestion && (!address || !matchingPlan.profileSuggestion.senderAddresses.includes(address));
  const plan = completionUid && completionUid !== emailId || suggestionSenderMismatch ? null : matchingPlan;
  const candidate = plan?.candidate || record(email.bill_candidate || email.extractedBill) as BillCandidate | null;
  const content = `${typeof email.subject === "string" ? email.subject : ""}\n${body || ""}`.replace(/\s+/g, " ");
  const grounded = (value: unknown) => typeof value === "string" && !!value.trim() && content.includes(value.replace(/\s+/g, " ").trim());
  const merchant = [candidate?.payee_hint, candidate?.payee].find(grounded);
  let suffix = text(candidate?.account_last4, 16);
  let suffixEvidence = candidate?.account_last4_evidence;
  let suffixConfidence = candidate?.account_last4_confidence;
  if (candidate?.type === "transfer" && ["statement_issued", "payment_scheduled"].includes(String(candidate.event_kind))) {
    const roleSuffix = (role: "from_account" | "to_account") => Number(candidate[`${role}_hint_confidence`]) >= 0.8
      && Number(candidate[`${role}_hint_confidence`]) <= 1 && grounded(candidate[`${role}_hint`])
      ? String(candidate[`${role}_hint`]).match(/\b\d{4}\b/g)?.pop() : undefined;
    const destination = roleSuffix("to_account");
    if (destination) { suffix = destination; suffixEvidence = candidate.to_account_hint; suffixConfidence = candidate.to_account_hint_confidence; }
    else if (suffix === roleSuffix("from_account")) suffix = "";
  }
  const suggestion = address && plan?.profileSuggestion?.senderAddresses.includes(address) ? plan.profileSuggestion : null;
  const budgetId = text(suggestion?.budgetId || plan?.profile?.budgetId, 128);
  const displayName = text(email.from_name, 120) || text(email.from, 120).replace(/\s*<[^<>]+>$/, "").replace(/^"(.*)"$/, "$1");
  const target = candidateTarget(candidate, budgetId ? plan || undefined : undefined);
  return {
    name: text(merchant, 120) || (exactAddress(displayName) ? "" : displayName), senderAddresses: address ? [address] : [],
    ...(budgetId ? { budgetId } : {}),
    ...(merchant ? { merchantName: text(merchant, 200) } : {}),
    ...(candidate && /^\d{4}$/.test(suffix) && Number(suffixConfidence) >= 0.8 && Number(suffixConfidence) <= 1
      && grounded(suffixEvidence) && String(suffixEvidence).includes(suffix) ? { accountLast4: suffix } : {}),
    ...(target ? { target } : {}),
  };
}

/** Strip all fields outside the editor contract, including identity/enablement. */
export function financialProfileSeedFromRouteState(state: unknown): FinancialProfileSeed | undefined {
  const raw = record(record(state)?.financialProfileSeed);
  if (!raw) return undefined;
  const target = record(raw.target);
  let destination: FinancialProfileTarget | undefined;
  if (target?.kind === "utility") destination = { kind: "utility", scheduleId: text(target.scheduleId, 128) };
  if (target?.kind === "card_payment") destination = {
    kind: "card_payment", fromAccountId: text(target.fromAccountId, 128), toAccountId: text(target.toAccountId, 128),
    ...(text(target.scheduleId, 128) ? { scheduleId: text(target.scheduleId, 128) } : {}),
  };
  if (target?.kind === "expense" || target?.kind === "income") destination = {
    kind: target.kind, accountId: text(target.accountId, 128), payeeId: text(target.payeeId, 128),
    ...(text(target.categoryId, 128) ? { categoryId: text(target.categoryId, 128) } : {}),
  };
  return {
    name: text(raw.name, 120), senderAddresses: Array.isArray(raw.senderAddresses) ? [...new Set(raw.senderAddresses.map(exactAddress).filter(Boolean))].slice(0, 20) : [],
    ...(text(raw.budgetId, 128) ? { budgetId: text(raw.budgetId, 128) } : {}),
    ...(text(raw.merchantName, 200) ? { merchantName: text(raw.merchantName, 200) } : {}),
    ...(typeof raw.accountLast4 === "string" && /^\d{4}$/.test(raw.accountLast4) ? { accountLast4: raw.accountLast4 } : {}),
    ...(destination ? { target: destination } : {}),
  };
}
