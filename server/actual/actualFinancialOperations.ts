import { createHash } from "node:crypto";
import type { ActualAccount, ActualPayee, ActualScheduleCondition } from "../../shared/types/actual.ts";
import type {
  ActualCompletedTransferInput,
  ActualFinancialOperationInput,
  ActualFinancialOperationMode,
  ActualFinancialOperationResult,
  ActualFinancialTransactionInput,
  ActualUtilityScheduleInput,
} from "../../shared/types/financial-operations.ts";
import { buildDateCondition } from "./actualCoreModel.ts";
import { runActualTransactionImport, type SdkImportResult, type SdkImportTransactionInput } from "./actualTransactionImportModel.ts";

interface Query {
  filter(value: unknown): Query;
  select(fields: string[]): Query;
  withDead(): Query;
  withoutValidatedRefs(): Query;
}
export interface ActualFinancialSdk {
  sync(): Promise<void>;
  getAccounts(): Promise<ActualAccount[]>;
  getPayees(): Promise<ActualPayee[]>;
  createPayee(input: { name: string }): Promise<string>;
  addTransactions(accountId: string, transactions: Array<{
    date: string; amount: number; payee: string; imported_id: string; notes: string; cleared: boolean;
  }>, options: { runTransfers: boolean; learnCategories: boolean }): Promise<unknown>;
  importTransactions(accountId: string, transactions: Array<SdkImportTransactionInput & { payee?: string }>, options: { dryRun: boolean }): Promise<SdkImportResult>;
  q(dataset: string): Query;
  runQuery(query: Query): Promise<{ data: unknown[] }>;
  internal: { send(operation: string, payload: unknown): Promise<unknown> };
}
interface TransactionRow {
  id: string;
  account: string;
  payee: string | null;
  amount: number;
  date: string;
  imported_id: string | null;
  transfer_id: string | null;
  tombstone?: boolean;
}
interface ScheduleRow {
  id: string;
  name: string | null;
  rule: string;
  next_date: string | null;
  completed: boolean;
  tombstone: boolean;
  posts_transaction?: boolean;
}
interface RuleAction { op: string; field?: string; value?: unknown; options?: unknown }
interface RuleRow {
  id: string;
  stage?: string | null;
  conditions: ActualScheduleCondition[];
  conditions_op: string;
  actions: RuleAction[];
  tombstone: boolean;
}
type ResultFactory = (outcome: ActualFinancialOperationResult["outcome"], reason: string, details?: Partial<ActualFinancialOperationResult>) => ActualFinancialOperationResult;

function validDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function scheduleIdentity(budgetId: string, identityKey: string): string {
  const value = hash(["financial-utility-v1", budgetId, identityKey]);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}
function condition(rule: RuleRow, field: string): ActualScheduleCondition | undefined {
  return rule.conditions.find((item) => item.field === field
    || (field === "account" && item.field === "acct") || (field === "payee" && item.field === "description"));
}
function fingerprint(schedule: ScheduleRow, rule: RuleRow): string {
  return hash([schedule, rule]);
}
function categoryMatches(rule: RuleRow, categoryId: string | null | undefined): boolean {
  return !categoryId || rule.actions.some((action) => action.op === "set" && action.field === "category" && action.value === categoryId);
}

async function availableCategoryId(sdk: ActualFinancialSdk, categoryId: string | null | undefined): Promise<string | undefined> {
  if (!nonempty(categoryId)) return undefined;
  try {
    const categories = await sdk.runQuery(sdk.q("categories").filter({ id: categoryId }).select(["id"]));
    return categories.data.some((entry) => entry && typeof entry === "object" && "id" in entry && entry.id === categoryId)
      ? categoryId : undefined;
  } catch {
    // Categorization is optional; unavailable category metadata cannot prevent
    // independently verified money movement or clear an existing category.
    return undefined;
  }
}

async function transaction(
  sdk: ActualFinancialSdk,
  input: ActualFinancialTransactionInput,
  mode: ActualFinancialOperationMode,
  result: ResultFactory,
): Promise<ActualFinancialOperationResult> {
  const review = (reason: string) => result("needs_review", reason);
  if (!nonempty(input.accountId) || !nonempty(input.payee) || typeof input.notes !== "string"
    || (input.payeeId != null && !nonempty(input.payeeId))) {
    return review("Transaction details are invalid.");
  }
  const [accounts, payees, records] = await Promise.all([
    sdk.getAccounts(), sdk.getPayees(),
    sdk.runQuery(sdk.q("transactions").withDead().withoutValidatedRefs().filter({
      $or: [{ imported_id: input.identityKey }, { account: input.accountId, date: input.date }],
    }).select(["id", "account", "payee", "amount", "date", "imported_id", "transfer_id", "tombstone"])),
  ]);
  if (!accounts.some((account) => account.id === input.accountId && !account.closed)) return review("The transaction account is closed or unavailable.");
  const matchingPayees = payees.filter((payee) => input.payeeId
    ? payee.id === input.payeeId : !payee.transfer_acct && normalizeName(payee.name) === normalizeName(input.payee));
  if (matchingPayees.length > 1 || (input.payeeId && matchingPayees.length !== 1)
    || matchingPayees.some((payee) => !!payee.transfer_acct)) return review("The transaction payee cannot be identified uniquely.");
  const payee = matchingPayees[0];
  const rows = records.data as TransactionRow[];
  const owned = rows.filter((row) => row.imported_id === input.identityKey);
  if (owned.some((row) => row.tombstone)) return review("The previously recorded transaction was deleted. It will not be recreated.");
  if (owned.length) {
    const recorded = owned[0]!;
    if (owned.length !== 1 || recorded.account !== input.accountId || recorded.date !== input.date
      || recorded.amount !== input.amountCents || recorded.transfer_id) return review("The recorded transaction identity conflicts with this event.");
    return result("already_present", "The transaction identity is already recorded.", { transactionId: recorded.id });
  }
  // Distinct managed event IDs prove distinct purchases even when all their
  // visible fields coincide. Only unowned/manual/provider imports can be legacy
  // duplicates; Actual's strict imported-ID reconciliation preserves this split.
  const legacy = rows.filter((row) => !row.tombstone && !row.transfer_id
    && !row.imported_id?.startsWith("financial-event:")
    && row.account === input.accountId && row.date === input.date && row.amount === input.amountCents
    && payee && row.payee === payee.id);
  if (legacy.length === 1) return result("already_present", "An exact existing Actual transaction matches this event.", { transactionId: legacy[0]!.id });
  if (legacy.length > 1) return review("Multiple existing Actual transactions match this event.");
  if (mode === "recover") return review("A transaction write was attempted but its result cannot be verified.");
  const categoryId = await availableCategoryId(sdk, input.categoryId);
  const groups = [{ accountId: input.accountId, transactions: [{
    itemId: input.identityKey, importedId: input.identityKey, date: input.date,
    amountCents: input.amountCents, payee: payee?.name || input.payee.trim(), notes: input.notes, categoryId,
  }] }];
  const importInput = {
    groups,
    importTransactions: (accountId: string, inputs: SdkImportTransactionInput[], options: { dryRun: boolean }) =>
      sdk.importTransactions(accountId, inputs.map((entry) => ({ ...entry, ...(payee ? { payee: payee.id } : {}) })), options),
    sync: () => sdk.sync(),
  };
  const preview = await runActualTransactionImport({ ...importInput, dryRun: true });
  if (preview.groups[0]?.items[0]?.outcome !== "would_add") return review("Actual import reconciliation would change or ambiguously match existing activity.");
  if (mode === "preview") return result("would_add", "Current Actual data confirms this transaction can be imported.");
  const committed = await runActualTransactionImport({ ...importInput, dryRun: false });
  const outcome = committed.groups[0]?.items[0]?.outcome;
  if (outcome !== "added" && outcome !== "already_present") return review("Actual did not confirm the expected transaction import.");
  const verified = await transaction(sdk, input, "recover", result);
  return verified.outcome === "already_present"
    ? { ...verified, outcome: outcome === "added" ? "added" : "already_present", reason: "The transaction import was verified against Actual." } : verified;
}

async function completedTransfer(
  sdk: ActualFinancialSdk,
  input: ActualCompletedTransferInput,
  mode: ActualFinancialOperationMode,
  result: ResultFactory,
  now: Date,
): Promise<ActualFinancialOperationResult> {
  const review = (reason: string) => result("needs_review", reason);
  if (!nonempty(input.fromAccountId) || !nonempty(input.toAccountId) || input.fromAccountId === input.toAccountId
    || input.amountCents <= 0 || typeof input.notes !== "string") return review("Completed transfer details are invalid.");
  if (input.date > now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })) {
    return review("A future payment is not a completed transfer.");
  }
  const [accounts, payees, records] = await Promise.all([
    sdk.getAccounts(), sdk.getPayees(),
    sdk.runQuery(sdk.q("transactions").withDead().withoutValidatedRefs().filter({
      $or: [{ imported_id: input.identityKey }, { date: input.date }],
    }).select(["id", "account", "payee", "amount", "date", "imported_id", "transfer_id", "tombstone"])),
  ]);
  if (![input.fromAccountId, input.toAccountId].every((id) => accounts.some((account) => account.id === id && !account.closed))) {
    return review("One of the transfer accounts is closed or unavailable.");
  }
  const sourcePayees = payees.filter((payee) => payee.transfer_acct === input.toAccountId);
  const destinationPayees = payees.filter((payee) => payee.transfer_acct === input.fromAccountId);
  if (sourcePayees.length !== 1 || destinationPayees.length !== 1) return review("Transfer accounts require unique Actual transfer payees.");
  const rows = records.data as TransactionRow[];
  const owned = rows.filter((row) => row.imported_id === input.identityKey);
  if (owned.some((row) => row.tombstone)) return review("The previously recorded transfer was deleted. It will not be recreated.");
  if (owned.length > 1) return review("The transfer identity has multiple Actual transactions.");
  const matchingSource = rows.filter((row) => !row.tombstone && row.account === input.fromAccountId
    && row.payee === sourcePayees[0]!.id && row.date === input.date && row.amount === -input.amountCents);
  const matchingDestination = rows.filter((row) => !row.tombstone && row.account === input.toAccountId
    && row.payee === destinationPayees[0]!.id && row.date === input.date && row.amount === input.amountCents);
  if (owned.length) {
    const recorded = matchingSource.find((row) => row.id === owned[0]!.id);
    if (!recorded) return review("The recorded transfer identity conflicts with the requested payment.");
    const reciprocal = matchingDestination.filter((row) => row.id === recorded.transfer_id && row.transfer_id === recorded.id);
    if (reciprocal.length === 1) return result("already_present", "The transfer identity and both reciprocal entries are recorded.", { transactionId: recorded.id });
    return review("The recorded transfer has incomplete Actual transaction links.");
  }
  const managedSourceIds = new Set(matchingSource.filter((row) => row.imported_id?.startsWith("financial-event:")).map((row) => row.id));
  const source = matchingSource.filter((row) => !managedSourceIds.has(row.id));
  const destination = matchingDestination.filter((row) => !row.transfer_id || !managedSourceIds.has(row.transfer_id));
  if (source.length || destination.length) {
    if (source.length === 1 && destination.length === 1
      && source[0]!.transfer_id === destination[0]!.id && destination[0]!.transfer_id === source[0]!.id) {
      return result("already_present", "An exact linked transfer is recorded.", { transactionId: source[0]!.id });
    }
    return review("The transfer has incomplete or competing Actual transaction links.");
  }
  if (mode === "recover") return review("A transfer write was attempted but no complete result can be verified.");
  if (mode === "preview") return result("would_add", "The completed transfer can be recorded.");
  await sdk.addTransactions(input.fromAccountId, [{
    date: input.date, amount: -input.amountCents, payee: sourcePayees[0]!.id,
    imported_id: input.identityKey, notes: input.notes, cleared: false,
  }], { runTransfers: true, learnCategories: false });
  await sdk.sync();
  const verified = await completedTransfer(sdk, input, "recover", result, now);
  return verified.outcome === "already_present"
    ? { ...verified, outcome: "added", reason: "The completed transfer and both linked entries were synced." } : verified;
}

async function readSchedules(sdk: ActualFinancialSdk): Promise<{ schedules: ScheduleRow[]; rules: RuleRow[] }> {
  const [schedules, rules] = await Promise.all([
    sdk.runQuery(sdk.q("schedules").withDead().withoutValidatedRefs().select(["id", "name", "rule", "next_date", "completed", "tombstone", "posts_transaction"])),
    sdk.runQuery(sdk.q("rules").withDead().select(["id", "stage", "conditions", "conditions_op", "actions", "tombstone"])),
  ]);
  const fieldName = (field: string | undefined) => field === "acct" ? "account" : field === "description" ? "payee" : field;
  return {
    schedules: schedules.data as ScheduleRow[],
    rules: (rules.data as RuleRow[]).map((rule) => ({
      ...rule,
      conditions: (Array.isArray(rule.conditions) ? rule.conditions : []).map((item) => ({ ...item, field: fieldName(item.field) })),
      actions: (Array.isArray(rule.actions) ? rule.actions : []).map((item) => item.field ? { ...item, field: fieldName(item.field) } : item),
    })),
  };
}
function supportedBillRule(schedule: ScheduleRow, rule: RuleRow | undefined, accountId: string, payeeId: string): rule is RuleRow {
  return !!rule && !rule.tombstone && rule.conditions_op === "and"
    && rule.actions.some((action) => action.op === "link-schedule" && action.value === schedule.id)
    && ["account", "payee", "amount", "date"].every((field) => {
      const aliases = field === "account" ? [field, "acct"] : field === "payee" ? [field, "description"] : [field];
      return rule.conditions.filter((item) => aliases.includes(String(item.field))).length === 1;
    })
    && condition(rule, "account")?.op === "is" && condition(rule, "account")?.value === accountId
    && condition(rule, "payee")?.op === "is" && condition(rule, "payee")?.value === payeeId
    && condition(rule, "amount")?.op === "is" && Number(condition(rule, "amount")?.value) < 0
    && condition(rule, "date")?.op === "is";
}

async function utilitySchedule(
  sdk: ActualFinancialSdk,
  budgetId: string,
  input: ActualUtilityScheduleInput,
  mode: ActualFinancialOperationMode,
  result: ResultFactory,
): Promise<ActualFinancialOperationResult> {
  const review = (reason: string) => result("needs_review", reason);
  if (!nonempty(input.accountId) || !nonempty(input.payee) || !nonempty(input.name) || input.amountCents >= 0
    || (input.payeeId != null && !nonempty(input.payeeId))) {
    return review("Utility schedule details are invalid.");
  }
  const [accounts, payees, state] = await Promise.all([sdk.getAccounts(), sdk.getPayees(), readSchedules(sdk)]);
  if (!accounts.some((account) => account.id === input.accountId && !account.closed)) return review("The utility account is closed or unavailable.");
  const matchingPayees = payees.filter((payee) => input.payeeId
    ? payee.id === input.payeeId : !payee.transfer_acct && normalizeName(payee.name) === normalizeName(input.payee));
  if (matchingPayees.length > 1 || (input.payeeId && matchingPayees.length !== 1)
    || matchingPayees.some((payee) => !!payee.transfer_acct)) return review("The utility payee cannot be identified uniquely.");
  const categoryId = mode === "recover" ? undefined : await availableCategoryId(sdk, input.categoryId);
  let payeeId = matchingPayees[0]?.id;
  if (payeeId) {
    const paidRows = await sdk.runQuery(sdk.q("transactions").withoutValidatedRefs().filter({
      account: input.accountId, payee: payeeId, date: input.date, amount: input.amountCents,
    }).select(["id", "account", "payee", "amount", "date", "transfer_id"]));
    const paid = (paidRows.data as TransactionRow[]).filter((row) => row.account === input.accountId
      && row.payee === payeeId && row.date === input.date && row.amount === input.amountCents && !row.transfer_id && !row.tombstone);
    if (paid.length === 1) return result("already_present", "The utility payment is already recorded.", { transactionId: paid[0]!.id });
    if (paid.length > 1) return review("Multiple utility payments match this statement.");
  }
  const deterministicId = scheduleIdentity(budgetId, input.identityKey);
  const owned = state.schedules.find((schedule) => schedule.id === deterministicId);
  if (owned?.tombstone) return review("The previously created utility schedule was deleted. It will not be recreated.");
  const rules = new Map(state.rules.map((rule) => [rule.id, rule]));
  const exactTargets = state.schedules.filter((schedule) => {
    const rule = rules.get(schedule.rule);
    return !schedule.tombstone && !schedule.completed && rule && payeeId
      && condition(rule, "account")?.value === input.accountId && condition(rule, "payee")?.value === payeeId;
  });
  const requested = input.scheduleId ? state.schedules.find((schedule) => schedule.id === input.scheduleId) : undefined;
  if (input.scheduleId && !requested && input.scheduleId !== deterministicId) return review("The selected utility schedule is unavailable.");
  if (!requested && !owned && exactTargets.length > 1) return review("Multiple utility schedules match the account and payee.");
  const selected = requested || owned || (exactTargets.length === 1 ? exactTargets[0] : undefined);
  if (selected?.tombstone || selected?.completed) return review("The selected utility schedule is deleted or completed.");
  const rule = selected ? rules.get(selected.rule) : undefined;
  if (selected && (!payeeId || !supportedBillRule(selected, rule, input.accountId, payeeId))) {
    return review("The selected utility schedule has conflicting or unsupported rules.");
  }
  const scheduleFingerprint = selected && rule ? fingerprint(selected, rule) : undefined;
  if (selected && rule && condition(rule, "amount")?.value === input.amountCents && selected.next_date === input.date
    && categoryMatches(rule, categoryId)) {
    return result("already_present", "An exact utility schedule already exists.", { scheduleId: selected.id, scheduleFingerprint });
  }
  if (mode === "recover") return review("A utility schedule write was attempted but its complete result cannot be verified.");
  if (selected && mode === "write_once" && input.expectedScheduleFingerprint !== scheduleFingerprint) {
    return review("The utility schedule changed after preview or has no verified preview.");
  }
  const desiredDate = rule ? buildDateCondition(rule.conditions, input.date) : { field: "date", op: "is", value: input.date };
  if (rule && typeof desiredDate.value === "object" && desiredDate.value?.frequency
    && (desiredDate.value.interval ?? 0) > 1 && selected?.next_date !== input.date) {
    return review("The utility schedule has a recurrence that cannot be moved to this statement date.");
  }
  if (mode === "preview") return result(selected ? "would_update" : "would_add",
    selected ? "The exact utility schedule can be updated." : "A utility schedule can be created.",
    { scheduleId: selected?.id || deterministicId, scheduleFingerprint });
  payeeId ||= await sdk.createPayee({ name: input.payee.trim() });
  const conditions: ActualScheduleCondition[] = rule
    ? rule.conditions.map((item) => item.field === "amount" ? { ...item, value: input.amountCents }
      : item.field === "date" ? desiredDate : item)
    : [desiredDate, { field: "amount", op: "is", value: input.amountCents },
        { field: "account", op: "is", value: input.accountId }, { field: "payee", op: "is", value: payeeId }];
  const scheduleId = selected?.id || deterministicId;
  if (selected) {
    await sdk.internal.send("schedule/update", { schedule: { id: scheduleId }, conditions });
  } else {
    const usedNames = new Set(state.schedules.filter((schedule) => !schedule.tombstone).map((schedule) => schedule.name));
    const name = usedNames.has(input.name.trim()) ? `${input.name.trim()} (${input.date}, ${deterministicId.slice(0, 8)})` : input.name.trim();
    await sdk.internal.send("schedule/create", {
      schedule: { id: scheduleId, name, completed: false, tombstone: false, posts_transaction: false }, conditions,
    });
  }
  if (categoryId) {
    const updated = await readSchedules(sdk);
    const updatedSchedule = updated.schedules.find((schedule) => schedule.id === scheduleId);
    const updatedRule = updated.rules.find((entry) => entry.id === updatedSchedule?.rule);
    if (!updatedRule) throw new Error("The utility schedule rule could not be verified after writing.");
    const actions = updatedRule.actions.filter((action) => !(action.op === "set" && action.field === "category"));
    actions.push({ op: "set", field: "category", value: categoryId });
    const updatedResult = await sdk.internal.send("rule-update", {
      id: updatedRule.id, stage: updatedRule.stage ?? null, conditionsOp: updatedRule.conditions_op,
      conditions: updatedRule.conditions, actions,
    });
    if (updatedResult && typeof updatedResult === "object" && "error" in updatedResult) throw new Error("The utility schedule category could not be written.");
  }
  await sdk.sync();
  const verified = await utilitySchedule(sdk, budgetId, { ...input, payeeId, scheduleId }, "recover", result);
  return verified.outcome === "already_present"
    ? { ...verified, outcome: selected ? "updated" : "added", reason: "The utility schedule was written and synced." } : verified;
}

// Called under the Actual SDK session lock. The durable event outbox admits one
// write_once dispatch; every uncertain later attempt must use recover.
export async function reconcileActualFinancialOperation(
  sdk: ActualFinancialSdk,
  budgetId: string,
  input: ActualFinancialOperationInput,
  mode: ActualFinancialOperationMode,
  now = new Date(),
): Promise<ActualFinancialOperationResult> {
  const result: ResultFactory = (outcome, reason, details = {}) => ({ outcome, reason, budgetId, ...details });
  if (!input || !["completed_transfer", "utility_schedule", "transaction"].includes(input.kind) || !nonempty(input.identityKey)
    || !validDate(input.date) || !Number.isSafeInteger(input.amountCents) || input.amountCents === 0
    || !["preview", "write_once", "recover"].includes(mode)) return result("needs_review", "Financial operation details are invalid.");
  if ((input.budgetId && input.budgetId !== budgetId) || (mode !== "preview" && !input.budgetId)) {
    return result("needs_review", "The Actual budget differs from the verified operation budget.");
  }
  await sdk.sync();
  if (input.kind === "transaction") return transaction(sdk, input, mode, result);
  return input.kind === "completed_transfer"
    ? completedTransfer(sdk, input, mode, result, now)
    : utilitySchedule(sdk, budgetId, input, mode, result);
}
