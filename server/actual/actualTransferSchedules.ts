import { buildDateCondition } from "./actualCoreModel.ts";
import { createHash } from "node:crypto";
import { readOriginalResult, settleOriginalEvidence, type ActualEvidencePort } from "./actualOriginalEvidence.ts";
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
  internal: ActualEvidencePort["internal"] & { send(operation: string, payload: unknown): Promise<unknown> };
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
    && !!input.identityKey?.trim() && (input.allowUpdate === true || !!input.name?.trim())
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
async function reconcileTransferScheduleOperation(
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
  const requestedSchedule = input.allowUpdate && input.scheduleId
    ? schedules.find(schedule => schedule.id === input.scheduleId) : undefined;
  if (input.allowUpdate && input.scheduleId && !requestedSchedule && input.scheduleId !== scheduleId) {
    return review("The selected transfer schedule is unavailable. Choose its current schedule in Actual.");
  }
  if (requestedSchedule?.tombstone) return review("The selected transfer schedule was deleted. It will not be recreated.");

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

  // The destination account is authoritative for a managed payment's default name.
  if (!input.name?.trim()) input = { ...input, name: `${accounts.find(a => a.id === input.toAccountId)!.name} Payment` };
  const normalizeName = (name: string | null) => name?.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  const exact: ScheduleRow[] = [];
  const updates: Array<{ schedule: ScheduleRow; conditions: ActualScheduleCondition[]; rule: unknown }> = [];
  let conflict = false;
  // A managed profile or prepared update names its exact existing target. A new
  // deterministic ID pinned by preview still needs the full ambiguity check.
  for (const schedule of requestedSchedule ? [requestedSchedule] : schedules) {
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
    if (schedule.id !== scheduleId && schedule.id !== requestedSchedule?.id) {
      if (!samePair && !(involvesCard && onDate)) continue;
      const reusableCompleted = input.allowUpdate && schedule.completed && !schedule.tombstone
        && schedule.next_date && schedule.next_date < input.date && normalizeName(schedule.name) === normalizeName(input.name);
      if ((schedule.tombstone || schedule.completed) && !onDate && !reusableCompleted) continue;
    }
    const amount = conditions.find((c) => c.field === "amount");
    const expected = account === input.fromAccountId ? -input.amountCents : input.amountCents;
    const supported = !!rule && !rule.tombstone && rule.conditions_op === "and"
      && rule.actions.some((a) => a.op === "link-schedule" && a.value === schedule.id)
      && ["account", "payee", "amount", "date"].every((field) => conditions.filter((c) => c.field === field).length === 1)
      && conditions.length === 4
      && conditions.every((c) => c.op === "is" || (input.allowUpdate && c.field === "date" && c.op === "isapprox"));
    const dateMatches = schedule.next_date === input.date
      && (typeof date === "string" ? date === input.date : date != null && typeof date === "object" && !!date.frequency);
    if (samePair && supported && amount?.value === expected && dateMatches && !schedule.completed && !schedule.tombstone) exact.push(schedule);
    else if (input.allowUpdate && samePair && supported && !schedule.tombstone
      && typeof amount?.value === "number" && Math.sign(amount.value) === Math.sign(expected)
      && (!schedule.completed || (schedule.next_date && schedule.next_date < input.date
        && normalizeName(schedule.name) === normalizeName(input.name)))) {
      updates.push({ schedule, conditions, rule });
    } else conflict = true;
  }
  const activeUpdates = updates.filter(item => !item.schedule.completed);
  // Completed prior cycles are eligible only by the same name and endpoints.
  // Prefer the latest dated cycle, but never break ties arbitrarily.
  const latestDate = updates.map(item => item.schedule.next_date || "").sort().at(-1);
  const candidates = activeUpdates.length ? activeUpdates : updates.filter(item => item.schedule.next_date === latestDate);
  if (conflict || exact.length > 1 || (exact.length && activeUpdates.length) || (!exact.length && candidates.length > 1)) {
    return review("An existing transfer schedule conflicts with this payment. Review it in Actual.");
  }
  const selected = exact[0] || candidates[0]?.schedule;
  if (input.scheduleId && input.scheduleId !== (selected?.id || scheduleId)) return review("The previewed transfer schedule is no longer the unique matching payment.");
  if (exact.length === 1) return result("already_scheduled", "An exact transfer schedule already exists.", { scheduleId: exact[0]!.id });
  if (mode === "recover") return review("A previous write was attempted, but its complete result could not be verified. Review Actual before adding anything.");
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  if (input.date <= today) return review("The payment date has arrived or passed. This notice does not confirm a completed transfer.");
  const transferPayees = payees.filter((p) => p.transfer_acct === input.fromAccountId);
  if (transferPayees.length !== 1) return review("The funding account does not have a unique Actual transfer payee.");
  const update = candidates[0];
  const scheduleFingerprint = update ? createHash("sha256").update(JSON.stringify([update.schedule, update.rule])).digest("hex") : undefined;
  const desiredDate = update ? { ...buildDateCondition(update.conditions, input.date), op: update.conditions.find(c => c.field === "date")!.op }
    : { field: "date", op: "is", value: input.date };
  if (update && typeof desiredDate.value === "object" && desiredDate.value?.frequency
    && (desiredDate.value.interval ?? 0) > 1 && update.schedule.next_date !== input.date) {
    return review("The transfer schedule has a recurrence that cannot be moved to this payment date.");
  }
  const targetId = update?.schedule.id || scheduleId;
  if (mode === "preview") return result(update ? "would_update" : "would_create",
    update ? "The existing transfer schedule can be updated." : "No existing payment matches; a future transfer schedule can be created.",
    { scheduleId: targetId, scheduleFingerprint });
  if (update && (input.scheduleId !== targetId || input.expectedScheduleFingerprint !== scheduleFingerprint || !input.preparedEvidence)) {
    return review("The transfer schedule changed after preview or has no verified preview.");
  }
  if (input.preparedEvidence) {
    const current = await readOriginalResult(sdk, budgetId, { scheduleId: targetId });
    if (JSON.stringify(current) !== JSON.stringify(input.preparedEvidence)) return review("The exact transfer schedule graph changed after its durable preparation.");
  }
  if (update) {
    const account = update.conditions.find(c => c.field === "account")?.value;
    const amount = account === input.fromAccountId ? -input.amountCents : input.amountCents;
    await sdk.internal.send("schedule/update", {
      schedule: { id: targetId, completed: false },
      conditions: update.conditions.map(c => c.field === "amount" ? { ...c, value: amount } : c.field === "date" ? desiredDate : c),
    });
  } else {
    await sdk.internal.send("schedule/create", {
      schedule: { id: scheduleId, name: availableScheduleName(input, schedules), completed: false, posts_transaction: false, tombstone: false },
      conditions: [
        { field: "account", op: "is", value: input.toAccountId },
        { field: "payee", op: "is", value: transferPayees[0]!.id },
        { field: "amount", op: "is", value: input.amountCents },
        desiredDate,
      ],
    });
  }
  // Verify the full synced object. A successful dispatch alone is not completion.
  const confirmed = await reconcileTransferScheduleOperation(sdk, budgetId, input, "recover", now);
  return confirmed.outcome === "already_scheduled" && confirmed.scheduleId === targetId
    ? { ...confirmed, outcome: update ? "updated" : "created", reason: update ? "The transfer schedule was updated and synced." : "A future transfer schedule was created and synced." }
    : confirmed;
}

export async function reconcileActualTransferSchedule(sdk: TransferSdk, budgetId: string,
  input: ActualTransferScheduleInput, mode: ActualTransferScheduleMode, now = new Date()): Promise<ActualTransferScheduleResult> {
  const result = await reconcileTransferScheduleOperation(sdk, budgetId, input, mode, now);
  if (result.outcome === "needs_review") return result;
  const evidence = await readOriginalResult(sdk, budgetId, result);
  return { ...result, ...(evidence ? { evidence: mode === "preview" ? evidence
    : settleOriginalEvidence(evidence, input.preparedEvidence, result.outcome === "created" ? "created" : result.outcome === "updated" ? "updated" : mode === "recover" ? "unknown" : "matched") } : {}) };
}
