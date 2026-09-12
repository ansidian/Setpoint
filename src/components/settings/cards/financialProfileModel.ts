import type { ActualMetadataResponse } from "../../../../shared/types/bills";
import type { FinancialProfile, FinancialProfileDraft, FinancialProfileTarget } from "../../../../shared/types/financial-profiles";

export const PROFILE_KINDS = [
  { id: "utility", name: "Utility bill" },
  { id: "card_payment", name: "Scheduled card payment" },
  { id: "expense", name: "Expense" },
  { id: "income", name: "Income / refund" },
] satisfies { id: FinancialProfileTarget["kind"]; name: string }[];

export function emptyProfileTarget(kind: FinancialProfileTarget["kind"]): FinancialProfileTarget {
  if (kind === "utility") return { kind, scheduleId: "" };
  if (kind === "card_payment") return { kind, fromAccountId: "", toAccountId: "" };
  return { kind, accountId: "", payeeId: "" };
}

export function profileSenderAddresses(value: string): string[] {
  return [...new Set(value.split(/[\s,;]+/).map(address => address.trim().toLowerCase()).filter(Boolean))];
}

export function profileDraftFromRouteState(state: unknown): FinancialProfileDraft | undefined {
  if (!state || typeof state !== "object" || !("financialProfileDraft" in state)) return undefined;
  const raw = state.financialProfileDraft;
  if (!raw || typeof raw !== "object" || !("target" in raw) || !("name" in raw) || !("budgetId" in raw) || !("senderAddresses" in raw)) return undefined;
  if (typeof raw.name !== "string" || typeof raw.budgetId !== "string" || !Array.isArray(raw.senderAddresses)
    || !raw.senderAddresses.every(address => typeof address === "string")) return undefined;
  const target = raw.target;
  if (!target || typeof target !== "object" || !("kind" in target)) return undefined;
  let destination: FinancialProfileTarget;
  if (target.kind === "utility" && "scheduleId" in target && typeof target.scheduleId === "string") {
    destination = { kind: "utility", scheduleId: target.scheduleId };
  } else if (target.kind === "card_payment" && "fromAccountId" in target && typeof target.fromAccountId === "string"
    && "toAccountId" in target && typeof target.toAccountId === "string") {
    destination = { kind: "card_payment", fromAccountId: target.fromAccountId, toAccountId: target.toAccountId,
      ...("scheduleId" in target && typeof target.scheduleId === "string" ? { scheduleId: target.scheduleId } : {}) };
  } else if ((target.kind === "expense" || target.kind === "income") && "accountId" in target && typeof target.accountId === "string"
    && "payeeId" in target && typeof target.payeeId === "string") {
    destination = { kind: target.kind, accountId: target.accountId, payeeId: target.payeeId,
      ...("categoryId" in target && typeof target.categoryId === "string" ? { categoryId: target.categoryId } : {}) };
  } else return undefined;
  const draft: FinancialProfileDraft = {
    name: raw.name, budgetId: raw.budgetId, senderAddresses: [...raw.senderAddresses], target: destination,
    ...("merchantName" in raw && typeof raw.merchantName === "string" ? { merchantName: raw.merchantName } : {}),
    ...("accountLast4" in raw && typeof raw.accountLast4 === "string" ? { accountLast4: raw.accountLast4 } : {}),
  };
  return profileValidation({ ...draft, id: "draft", enabled: false }) ? undefined : draft;
}

export function profileValidation(profile: FinancialProfile): string {
  if (!profile.name.trim()) return "Give this profile a name.";
  if (!profile.budgetId) return "Connect an Actual budget before saving a profile.";
  if (!profile.senderAddresses.length) return "Add at least one exact sender email address.";
  if (profile.senderAddresses.some(address => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address))) {
    return "Use full sender email addresses, separated by commas or new lines.";
  }
  if (profile.accountLast4 && !/^\d{4}$/.test(profile.accountLast4)) return "Enter exactly four digits for the card.";
  const target = profile.target;
  if (target.kind === "utility" && !target.scheduleId) return "Choose the existing utility schedule in Actual.";
  if (target.kind === "card_payment") {
    if (!target.fromAccountId || !target.toAccountId) return "Choose the source account and destination card.";
    if (target.fromAccountId === target.toAccountId) return "The source account and destination card must be different.";
  }
  if ((target.kind === "expense" || target.kind === "income") && (!target.accountId || !target.payeeId)) {
    return "Choose the Actual account and payee.";
  }
  return "";
}

export function profileTargetProblem(profile: FinancialProfile, metadata: ActualMetadataResponse): string {
  const target = profile.target;
  const accountExists = (id: string) => metadata.accounts?.some(account => account.id === id && !account.closed);
  if (target.kind === "utility") {
    return availableProfileSchedules("utility", metadata).some(schedule => schedule.id === target.scheduleId)
      ? "" : "The saved utility schedule is unavailable. Choose an existing utility schedule.";
  }
  if (target.kind === "card_payment") {
    if (!accountExists(target.fromAccountId) || !accountExists(target.toAccountId)) return "A payment account is unavailable or closed. Choose both accounts again.";
    if (target.scheduleId && !availableProfileSchedules("card_payment", metadata).some(schedule => schedule.id === target.scheduleId)) {
      return "The saved payment schedule is unavailable. Choose an existing payment schedule or let Setpoint find the matching one.";
    }
    return "";
  }
  if (!accountExists(target.accountId)) return "The saved account is unavailable or closed. Choose an open account.";
  if (!metadata.payees?.some(payee => payee.id === target.payeeId && !payee.transfer_acct)) return "The saved payee is unavailable. Choose a payee.";
  if (target.categoryId && !metadata.categories?.some(group => group.categories.some(category => category.id === target.categoryId))) return "The saved category is unavailable. Choose a category or leave it uncategorized.";
  return "";
}

export function profileAuthority(profile: FinancialProfile): string {
  return JSON.stringify([profile.budgetId, profile.enabled, profile.senderAddresses, profile.merchantName || null, profile.accountLast4 || null, profile.target]);
}

export function profileScheduleName(id: string, metadata: ActualMetadataResponse): string {
  const schedule = metadata.schedules?.find(item => item.id === id);
  const payeeId = schedule?.conditions?.find(condition => condition.field === "payee")?.value;
  return schedule?.name || (typeof payeeId === "string" && metadata.payeeMap?.[payeeId]) || (schedule ? "Unnamed schedule" : "Schedule unavailable");
}

export function profileTargetSummary(target: FinancialProfileTarget, metadata: ActualMetadataResponse): string {
  const account = (id: string) => metadata.accounts?.find(item => item.id === id)?.name || (id ? "Account unavailable" : "Choose an account");
  const scheduleExists = (id: string) => metadata.schedules?.some(schedule => schedule.id === id);
  if (target.kind === "utility") {
    if (!target.scheduleId) return "Choose a utility schedule";
    return scheduleExists(target.scheduleId) ? `Update ${profileScheduleName(target.scheduleId, metadata)}` : "Saved utility schedule unavailable";
  }
  if (target.kind === "card_payment") {
    const route = `${account(target.fromAccountId)} → ${account(target.toAccountId)}`;
    const schedule = target.scheduleId
      ? scheduleExists(target.scheduleId) ? `Update ${profileScheduleName(target.scheduleId, metadata)}` : "Saved payment schedule unavailable"
      : "Payment schedule";
    return `${schedule} · ${route}`;
  }
  const payee = metadata.payees?.find(item => item.id === target.payeeId)?.name || (target.payeeId ? "Payee unavailable" : "Choose a payee");
  const category = metadata.categories?.flatMap(group => group.categories).find(item => item.id === target.categoryId)?.name;
  return `${target.kind === "income" ? "Income" : "Expense"} · ${account(target.accountId)} · ${payee}${target.categoryId ? ` · ${category || "Category unavailable"}` : " · Uncategorized"}`;
}

export function availableProfileSchedules(kind: "utility" | "card_payment", metadata: ActualMetadataResponse) {
  return (metadata.schedules || []).filter(schedule => schedule.id && !schedule.completed && (
    kind === "card_payment" ? schedule.type === "transfer" : schedule.type !== "transfer" && schedule.type !== "income"
  )).map(schedule => ({ id: schedule.id!, name: profileScheduleName(schedule.id!, metadata) }));
}
