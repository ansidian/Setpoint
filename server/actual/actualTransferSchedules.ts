import { createHash } from "node:crypto";
import type { ActualAccount, ActualPayee, ActualScheduleCondition } from "../../shared/types/actual.ts";
import type { ActualTransferScheduleInput, ActualTransferScheduleMode, ActualTransferScheduleResult } from "../../shared/types/transaction-imports.ts";

interface Query {
  filter(value: unknown): Query;
  select(fields: string[]): Query;
  withDead(): Query;
  withoutValidatedRefs(): Query;
}
interface TransferSdk {
  sync(): Promise<void>;
  getAccounts(): Promise<ActualAccount[]>;
  getPayees(): Promise<ActualPayee[]>;
  getRules(): Promise<Array<{ id: string; conditions?: ActualScheduleCondition[]; conditions_op?: string }>>;
  q(dataset: string): Query;
  runQuery(query: Query): Promise<{ data: unknown[] }>;
  internal: { send(operation: string, payload: unknown): Promise<unknown> };
}
interface ScheduleRow {
  id: string;
  name: string | null;
  rule: string;
  next_date: string | null;
  completed: boolean;
  tombstone: boolean;
}
interface TransactionRow {
  id: string;
  account: string;
  payee: string | null;
  amount: number;
  date: string;
  transfer_id: string | null;
}

function validInput(input: ActualTransferScheduleInput): boolean {
  const parsed = new Date(`${input.date}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(input.date) && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === input.date
    && Number.isSafeInteger(input.amountCents) && input.amountCents > 0
    && !!input.identityKey?.trim() && !!input.name?.trim()
    && !!input.fromAccountId && !!input.toAccountId && input.fromAccountId !== input.toAccountId;
}

function availableScheduleName(input: ActualTransferScheduleInput, schedules: ScheduleRow[]): string {
  const base = input.name.trim();
  const used = new Set(schedules.filter((schedule) => !schedule.tombstone).map((schedule) => schedule.name?.trim()).filter(Boolean));
  if (!used.has(base)) return base;
  const dated = `${base} (${input.date})`;
  if (!used.has(dated)) return dated;
  let suffix = 2;
  while (used.has(`${base} (${input.date}, ${suffix})`)) suffix += 1;
  return `${base} (${input.date}, ${suffix})`;
}

// This operation is called inside actual-core's SDK lock. create_once is admitted
// only after the import store has durably marked an attempt. Recovery never creates:
// the SDK's rule/next-date/schedule inserts are not one atomic operation.
export async function reconcileActualTransferSchedule(
  sdk: TransferSdk,
  budgetId: string,
  input: ActualTransferScheduleInput,
  mode: ActualTransferScheduleMode,
  now = new Date(),
): Promise<ActualTransferScheduleResult> {
  const hash = createHash("sha256").update(JSON.stringify([budgetId, input.identityKey])).digest("hex");
  const scheduleId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const result = (outcome: ActualTransferScheduleResult["outcome"], reason: string, ids: Partial<ActualTransferScheduleResult> = {}): ActualTransferScheduleResult => ({ outcome, reason, budgetId, ...ids });
  const review = (reason: string) => result("needs_review", reason);
  if (!validInput(input) || !["preview", "create_once", "recover"].includes(mode)) return review("Transfer details are incomplete or invalid.");
  if (input.budgetId && input.budgetId !== budgetId) return review("The Actual budget changed after this payment was checked.");
  if (mode !== "preview" && !input.budgetId) return review("The payment has no verified Actual budget.");

  // Sync also pushes an earlier locally completed write before we accept it as present.
  await sdk.sync();
  const [accounts, payees, rules, scheduleData, transactionData] = await Promise.all([
    sdk.getAccounts(), sdk.getPayees(),
    sdk.runQuery(sdk.q("rules").withDead().select(["id", "conditions", "conditions_op", "actions", "tombstone"])),
    sdk.runQuery(sdk.q("schedules").withDead().withoutValidatedRefs().select(["id", "name", "rule", "next_date", "completed", "tombstone"])),
    sdk.runQuery(sdk.q("transactions").withoutValidatedRefs().filter({ date: input.date }).select(["id", "account", "payee", "amount", "date", "transfer_id"])),
  ]);
  if (![input.fromAccountId, input.toAccountId].every((id) => accounts.some((a) => a.id === id && !a.closed))) {
    return review("One of the transfer accounts is closed or unavailable.");
  }
  const transfers = new Map(payees.filter((p) => p.transfer_acct).map((p) => [p.id, p.transfer_acct!]));
  const schedules = scheduleData.data as ScheduleRow[];
  const ruleMap = new Map((rules.data as Array<{ id: string; conditions: ActualScheduleCondition[]; conditions_op: string; actions: Array<{ op: string; value: string }>; tombstone: boolean }>).map((r) => [r.id, r]));
  const ownSchedule = schedules.find((s) => s.id === scheduleId);
  if (ownSchedule?.tombstone) return review("The previously created payment schedule was deleted. It will not be recreated.");

  const transactions = (transactionData.data as TransactionRow[]).filter((t) => {
    const other = transfers.get(t.payee || "");
    return (t.account === input.fromAccountId && other === input.toAccountId)
      || (t.account === input.toAccountId && !!other);
  });
  const source = transactions.filter((t) => t.account === input.fromAccountId && t.amount === -input.amountCents);
  const destination = transactions.filter((t) => t.account === input.toAccountId && t.amount === input.amountCents);
  const paired = source.length === 1 && destination.length === 1
    && source[0]!.transfer_id === destination[0]!.id && destination[0]!.transfer_id === source[0]!.id;
  if (transactions.length) {
    if (paired && transactions.length === 2) {
      return result("already_recorded", "An exact recorded transfer already exists.", { transactionId: source[0]!.id });
    }
    return review("Recorded transfers on this date have conflicting amounts, direction, or links.");
  }

  const exact: ScheduleRow[] = [];
  let conflict = false;
  for (const schedule of schedules) {
    const rule = ruleMap.get(schedule.rule);
    const conditions = (rule?.conditions || []).map((c) => ({ ...c, field: c.field === "acct" ? "account" : c.field === "description" ? "payee" : c.field }));
    const account = conditions.find((c) => c.field === "account")?.value;
    const payee = conditions.find((c) => c.field === "payee")?.value;
    const other = typeof payee === "string" ? transfers.get(payee) : undefined;
    const samePair = (account === input.fromAccountId && other === input.toAccountId)
      || (account === input.toAccountId && other === input.fromAccountId);
    const date = conditions.find((c) => c.field === "date")?.value;
    const onDate = schedule.next_date === input.date || date === input.date;
    const involvesCard = account === input.toAccountId || other === input.toAccountId;
    if (schedule.id !== scheduleId) {
      if (!samePair && !(involvesCard && onDate)) continue;
      if ((schedule.tombstone || schedule.completed) && !onDate) continue;
    }
    const amount = conditions.find((c) => c.field === "amount");
    const expected = account === input.fromAccountId ? -input.amountCents : input.amountCents;
    const supported = !!rule && !rule.tombstone && rule.conditions_op === "and"
      && rule.actions.some((a) => a.op === "link-schedule" && a.value === schedule.id)
      && ["account", "payee", "amount", "date"].every((field) => conditions.filter((c) => c.field === field).length === 1)
      && conditions.length === 4
      && conditions.every((c) => c.op === "is");
    const dateMatches = schedule.next_date === input.date
      && (typeof date === "string" ? date === input.date : date != null && typeof date === "object" && !!date.frequency);
    if (samePair && supported && amount?.value === expected && dateMatches && !schedule.completed && !schedule.tombstone) exact.push(schedule);
    else conflict = true;
  }
  if (conflict || exact.length > 1) return review("An existing transfer schedule conflicts with this payment. Review it in Actual.");
  if (exact.length === 1) return result("already_scheduled", "An exact transfer schedule already exists.", { scheduleId: exact[0]!.id });
  if (mode === "recover") return review("A previous write was attempted, but its complete result could not be verified. Review Actual before adding anything.");
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  if (input.date <= today) return review("The payment date has arrived or passed. This notice does not confirm a completed transfer.");
  const transferPayees = payees.filter((p) => p.transfer_acct === input.fromAccountId);
  if (transferPayees.length !== 1) return review("The funding account does not have a unique Actual transfer payee.");
  if (mode === "preview") return result("would_create", "No existing payment matches; a future transfer schedule can be created.", { scheduleId });

  await sdk.internal.send("schedule/create", {
    schedule: { id: scheduleId, name: availableScheduleName(input, schedules), completed: false, posts_transaction: false, tombstone: false },
    conditions: [
      { field: "account", op: "is", value: input.toAccountId },
      { field: "payee", op: "is", value: transferPayees[0]!.id },
      { field: "amount", op: "is", value: input.amountCents },
      { field: "date", op: "is", value: input.date },
    ],
  });
  // Verify the full synced object. A successful dispatch alone is not completion.
  const confirmed = await reconcileActualTransferSchedule(sdk, budgetId, input, "recover", now);
  return confirmed.outcome === "already_scheduled" && confirmed.scheduleId === scheduleId
    ? { ...confirmed, outcome: "created", reason: "A future transfer schedule was created and synced." }
    : confirmed;
}
