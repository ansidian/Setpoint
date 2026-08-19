import type { TriageDecision, TriageEmail, TriageLane } from "./triage-types.ts";

// Pure, DB-free triage projections lifted from triage-worker.ts so they can be
// unit-tested as input -> output. No db access, no IO; safeJson/toText stay
// module-private.

function safeJson(value: unknown, fallback: unknown = {}): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value)) as unknown;
  } catch {
    return fallback;
  }
}

function toText(value: unknown): string {
  return String(value || "").toLowerCase();
}

export function emailSearchText(email: Record<string, unknown>): string {
  return [
    email.from_name,
    email.from_address,
    email.subject,
    email.body_snippet,
    email.body_text,
  ].map(toText).join("\n");
}

export function normalizeEmailInterests(raw: unknown): string[] {
  const parsed = typeof raw === "string" ? safeJson(raw, []) : raw;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((interest) => String(interest || "").trim())
    .filter(Boolean);
}

export function triageSoundTriggerType(reason: string, lane: TriageLane | null = null): string {
  if (reason === "email_triage_failed") return "triage_failed";
  if (reason === "email_triage_finalized") {
    if (lane === "needs_attention") return "needs_attention_finalized";
    if (lane === "fyi") return "fyi_finalized";
  }
  return "triage_event";
}

export function emailTriageEventDetails(email: Pick<TriageEmail, "account_id" | "email_id" | "email_date" | "email_date_utc" | "read">, { reason, lane, triageSource }: { reason: string; lane: TriageLane; triageSource: string }): Record<string, unknown> {
  return {
    triggerType: triageSoundTriggerType(reason, lane),
    eventKey: `email_triage:${email.account_id}:${email.email_id}:${reason}`,
    emailId: email.email_id,
    emailReceivedAt: email.email_date_utc || email.email_date || null,
    lane,
    triageSource,
    reason,
    ...(email.read ? { read: true } : {}),
  };
}

export function maybeBillCandidate(email: Record<string, unknown>, decision: Partial<Pick<TriageDecision, "bill_candidate" | "category" | "deadline_at">>): Record<string, unknown> | null {
  if (decision.bill_candidate) return decision.bill_candidate;
  const text = emailSearchText(email);
  const looksFinancial = /\$\s*\d|payment|invoice|statement|balance|autopay|due/.test(text);
  if (!looksFinancial) return null;
  if (decision.category !== "finance" && !/\$\s*\d/.test(text)) return null;
  return {
    source: "triage",
    payee_hint: email.from_name || email.from_address || "",
    subject: email.subject || "",
    amount: null,
    due_date: decision.deadline_at || null,
    requires_confirmation: true,
  };
}
