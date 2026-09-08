import { randomUUID } from 'node:crypto';
import type { FinancialWriteEvidence } from '../../shared/types/financial-activity.ts';
import type { CorrectionRow, CorrectionSnapshot, CorrectionStep, CorrectionTargets, FinancialCorrectionDraft } from '../../shared/types/financial-corrections.ts';
import type { ActualScheduleCondition } from '../../shared/types/actual.ts';
import { buildCorrectionDateCondition } from '../actual/actual.ts';
import { correctionJson, correctionConditions, decodeCorrectionJson } from '../actual/actual.ts';

export function correctionConstraint(message: string): never {
  throw Object.assign(new Error(message), { status: 409, code: 'FINANCIAL_CORRECTION_CONSTRAINT' });
}
const active = (row: CorrectionRow) => !row.tombstone;
const same = (a: unknown, b: unknown) => correctionJson(a) === correctionJson(b);
function disposable(row: CorrectionRow, evidence: FinancialWriteEvidence) {
  const original = evidence.objects.find(object => object.kind === 'transaction' && object.id === row.id);
  if (original?.provenance !== 'created' || original.beforeState !== 'confirmed_absent') correctionConstraint('Removing this transaction requires proof that the original operation created it.');
  if (row.reconciled || row.isParent || row.isChild || row.schedule || row.raw_synced_data || row.starting_balance_flag) correctionConstraint('A reconciled, split, or schedule-linked transaction cannot be removed by this conversion.');
}
function rawPatchToSdk(row: CorrectionRow): CorrectionRow {
  const names: Record<string, string> = { acct: 'account', description: 'payee', transferred_id: 'transfer_id', financial_id: 'imported_id', isParent: 'is_parent', isChild: 'is_child' };
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [names[key] || key, key === 'date' && typeof value === 'number'
    ? `${String(value).slice(0, 4)}-${String(value).slice(4, 6)}-${String(value).slice(6, 8)}` : value])) as CorrectionRow;
}
export function planFinancialCorrection(snapshot: CorrectionSnapshot, evidence: FinancialWriteEvidence, draft: FinancialCorrectionDraft, context: { allowMissingPrimary?: boolean; scheduleId?: string } = {}): { steps: CorrectionStep[]; targets: CorrectionTargets } {
  if (!draft || !['payment', 'income', 'transfer', 'bill', 'transfer_schedule'].includes(draft.type)) correctionConstraint('Choose a supported record type.');
  const scheduleEdit = draft.type === 'bill' || draft.type === 'transfer_schedule';
  if (!Number.isSafeInteger(draft.amountCents) || draft.amountCents <= 0) correctionConstraint('Amount must be positive integer cents.');
  const parsedDate = new Date(`${draft.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== draft.date) correctionConstraint('Choose a valid calendar date.');
  for (const value of [draft.notes, draft.name]) if (value !== undefined && (typeof value !== 'string' || value.length > 2000)) correctionConstraint('Notes and names must be bounded text.');
  const account = (id: string | undefined) => {
    const row = snapshot.accounts.find(row => row.id === id && active(row) && !row.closed);
    if (!row) correctionConstraint('Choose an available open Actual account.');
    return row;
  };
  if (draft.payeeId && !snapshot.payees.some(row => row.id === draft.payeeId && active(row) && !row.transfer_acct)) correctionConstraint('Choose an available ordinary payee.');
  if (draft.categoryId && !snapshot.categories.some(row => row.id === draft.categoryId && active(row))) correctionConstraint('Choose an available category.');
  const primaryEvidence = evidence.objects.filter(object => object.role === 'primary' && ['transaction', 'schedule'].includes(object.kind));
  if (primaryEvidence.length !== 1) correctionConstraint('Resolve one exact original primary target before correcting.');
  const original = primaryEvidence[0]!;
  let primary = snapshot.transactions.find(row => row.id === original.id && active(row));
  const schedule = snapshot.schedules.find(row => row.id === (context.scheduleId || (scheduleEdit && draft.targetScheduleId ? draft.targetScheduleId : original.id)) && active(row));
  if (draft.targetScheduleId && (!schedule || !scheduleEdit)) correctionConstraint('The explicitly selected target schedule is unavailable or incompatible with this record type.');
  if (draft.type === 'transfer_schedule' && (primary || !schedule || original.kind !== 'schedule' || schedule.id !== original.id)) correctionConstraint('Choose the exact existing transfer schedule; this edit cannot convert a transaction or create another schedule.');
  if (primary && draft.type === 'bill') disposable(primary, evidence);
  if (schedule && snapshot.schedules.some(row => row.id !== schedule.id && !row.tombstone && row.rule === schedule.rule)) correctionConstraint('This rule is shared by another schedule and cannot be changed safely.');
  const scheduleEvidence = schedule ? evidence.objects.find(object => object.kind === 'schedule' && object.id === schedule.id) || original : original;
  if (!primary && !schedule && !context.allowMissingPrimary) correctionConstraint('The exact bound record no longer exists.');
  const steps: CorrectionStep[] = [];
  const targets: CorrectionTargets = { transactionIds: snapshot.transactions.map(row => row.id), scheduleIds: snapshot.schedules.map(row => row.id), ruleIds: snapshot.rules.map(row => row.id) };
  const addStep = (command: CorrectionStep['command'], payload: unknown, after: CorrectionStep['after']) => {
    steps.push({ id: randomUUID(), command, payload, after, before: structuredClone(snapshot), targets: structuredClone(targets) });
  };
  const date = Number(draft.date.replaceAll('-', ''));
  let paymentSchedule: string | null = null;
  if (schedule && !scheduleEdit) {
    if (!draft.scheduleTreatment) correctionConstraint('Choose explicitly whether to keep, retire, or restore the current schedule; the historical before-image may be unavailable.');
    if (draft.scheduleTreatment === 'keep') paymentSchedule = schedule.id;
    else if (draft.scheduleTreatment === 'restore') {
      if (scheduleEvidence.beforeState !== 'captured' || !scheduleEvidence.before) correctionConstraint('The original schedule before-image was not saved; automatic restoration is unavailable.');
      const ruleEvidence = evidence.objects.find(object => object.kind === 'rule' && object.id === schedule.rule);
      if (ruleEvidence?.beforeState !== 'captured' || !ruleEvidence.before || !ruleEvidence.after) correctionConstraint('The original rule before-image was not saved.');
      const currentRule = snapshot.rules.find(row => row.id === schedule.rule);
      if (!same(schedule, scheduleEvidence.after) || !same(currentRule, ruleEvidence.after)) correctionConstraint('The schedule changed after the original update; choose its current treatment rather than restoring over later edits.');
      const conditions = correctionConditions(ruleEvidence.before.conditions);
      const oldDate = conditions.find(condition => condition.field === 'date')?.value;
      const occurrence = typeof oldDate === 'string' ? oldDate : null;
      const dateEvidence = evidence.objects.find(object => object.kind === 'schedule_next_date' && object.before?.schedule_id === schedule.id);
      const savedDate = dateEvidence?.before;
      if (dateEvidence?.after && !same(snapshot.dates.find(row => row.id === dateEvidence.id), dateEvidence.after)) correctionConstraint('The saved occurrence changed after the original update.');
      const originalNext = savedDate && (savedDate.local_next_date_ts === savedDate.base_next_date_ts ? savedDate.local_next_date : savedDate.base_next_date);
      if (!occurrence || dateEvidence?.beforeState !== 'captured' || originalNext !== Number(occurrence.replaceAll('-', ''))) correctionConstraint('Exact occurrence restoration requires a saved one-time next-date before-image. Keep the current schedule or correct its occurrence explicitly.');
      if ((schedule.posts_transaction || scheduleEvidence.before.posts_transaction) && (!occurrence || occurrence <= new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))) correctionConstraint('Restoring this automatically posting schedule may post a due occurrence during synchronization.');
      const restored = { ...scheduleEvidence.before, id: schedule.id };
      const fields: Record<string, unknown> = { ...restored }; delete fields.rule; delete fields.active;
      addStep('schedule/update', { schedule: fields, conditions }, { schedule: restored, conditions, nextDate: Number(originalNext) });
      const actions = decodeCorrectionJson(ruleEvidence.before.actions);
      addStep('schedule/rule-update', { scheduleId: schedule.id, actions }, { ruleActions: { scheduleId: schedule.id, actions } });
      paymentSchedule = schedule.id;
    } else if (draft.scheduleTreatment === 'retire') {
      const rule = snapshot.rules.find(row => row.id === schedule.rule);
      const recurring = rule && decodeCorrectionJson(rule.conditions).some(condition => condition && typeof condition === 'object' && 'field' in condition && condition.field === 'date' && 'value' in condition && typeof condition.value === 'object');
      if (scheduleEvidence.provenance !== 'created' || scheduleEvidence.beforeState !== 'confirmed_absent' || recurring || snapshot.transactions.some(active)) correctionConstraint('Only a proven created standalone schedule without linked payments can be retired.');
      addStep('schedule/delete', { id: schedule.id }, { removedScheduleId: schedule.id });
    } else correctionConstraint('Invalid schedule treatment.');
  }
  if (scheduleEdit) {
    const rule = schedule ? snapshot.rules.find(row => row.id === schedule.rule && active(row)) : undefined;
    if (schedule && !rule) correctionConstraint('The schedule graph has no intact rule.');
    const nextDates = schedule ? snapshot.dates.filter(row => row.schedule_id === schedule.id && !row.tombstone) : [];
    if (schedule && nextDates.length !== 1) correctionConstraint('The schedule next-date graph is missing or duplicated.');
    const next = nextDates[0];
    const currentNextDate = next ? (next.local_next_date_ts === next.base_next_date_ts ? next.local_next_date : next.base_next_date) : null;
    const chosenName = draft.name?.trim() || null;
    if (chosenName && snapshot.scheduleNames.some(row => row.name === chosenName && row.id !== schedule?.id)) correctionConstraint('Another schedule already has this name. Choose the exact existing target or a different name.');
    const old = rule ? correctionConditions(rule.conditions) : [];
    let chosenAccount: CorrectionRow;
    let amount = -draft.amountCents;
    let payeeId = draft.payeeId;
    if (draft.type === 'transfer_schedule') {
      if (draft.categoryId !== undefined || draft.payeeId !== undefined || draft.accountId !== undefined || draft.scheduleTreatment !== undefined) correctionConstraint('Edit a transfer schedule using its funding and destination accounts.');
      if (!['amount', 'account', 'payee', 'date'].every(field => old.filter(condition => condition.field === field).length === 1)) correctionConstraint('The transfer schedule must have one exact amount, account, payee, and date condition.');
      const oldAmount = old.find(condition => condition.field === 'amount');
      const oldAccount = old.find(condition => condition.field === 'account');
      const oldPayee = old.find(condition => condition.field === 'payee');
      const linked = snapshot.payees.find(row => row.id === oldPayee?.value && active(row));
      if (oldAmount?.op !== 'is' || typeof oldAmount.value !== 'number' || !Number.isSafeInteger(oldAmount.value) || oldAmount.value === 0 || oldAccount?.op !== 'is' || oldPayee?.op !== 'is' || !linked?.transfer_acct || linked.transfer_acct === oldAccount.value) correctionConstraint('The bound schedule does not identify an exact transfer.');
      if (draft.date <= new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })) correctionConstraint('Choose a future transfer date. Editing a schedule does not record a completed transfer.');
      const from = account(draft.fromAccountId), to = account(draft.toAccountId);
      if (from.id === to.id) correctionConstraint('Transfer accounts must be distinct.');
      chosenAccount = oldAmount.value > 0 ? to : from;
      amount = oldAmount.value > 0 ? draft.amountCents : -draft.amountCents;
      const opposite = oldAmount.value > 0 ? from : to;
      const transferPayees = snapshot.payees.filter(row => row.transfer_acct === opposite.id && active(row));
      if (transferPayees.length !== 1) correctionConstraint('The opposite account must have one available Actual transfer payee.');
      payeeId = transferPayees[0]!.id;
    } else chosenAccount = account(draft.accountId);
    const dateCondition = buildCorrectionDateCondition(old, draft.date);
    const requested = typeof dateCondition.value === 'object' ? dateCondition.value?.start : dateCondition.value;
    if (typeof dateCondition.value === 'object' && dateCondition.value?.skipWeekend && [0, 6].includes(new Date(`${draft.date}T00:00:00Z`).getUTCDay())) correctionConstraint('This schedule moves weekend occurrences; choose its effective weekday date.');
    if (requested !== draft.date && currentNextDate !== date) correctionConstraint('This recurrence interval does not support moving the occurrence date.');
    if (schedule?.posts_transaction && draft.date <= new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })) correctionConstraint('This schedule already posts automatically; a due or past date may create an unpreviewed payment during synchronization.');
    const replacements: ActualScheduleCondition[] = [dateCondition, { field: 'amount', op: 'is', value: amount }, { field: 'account', op: 'is', value: chosenAccount.id }];
    if (payeeId !== undefined) replacements.push({ field: 'payee', op: 'is', value: payeeId });
    const conditions = [...replacements, ...old.filter(condition => !replacements.some(replacement => replacement.field === condition.field))];
    let targetScheduleId: string;
    if (schedule) {
      targetScheduleId = schedule.id;
      const patch = { id: schedule.id, ...(draft.name !== undefined ? { name: draft.name } : {}) };
      const actions = decodeCorrectionJson(rule!.actions).map(value => {
        const action = value as Record<string, unknown>;
        const options = action.options as Record<string, unknown> | undefined;
        return action.op === 'set' && action.field === 'amount' && !options?.template && !options?.formula ? { ...action, value: amount } : action;
      });
      addStep('schedule/update', { schedule: patch, conditions }, { schedule: { ...schedule, ...patch }, conditions, scheduleActions: actions, nextDate: date });
    } else {
      if (!primary && !context.allowMissingPrimary) correctionConstraint('The source transaction is missing.');
      if (primary) disposable(primary, evidence);

      const id = randomUUID();
      targetScheduleId = id;
      targets.scheduleIds.push(id);
      const created = { id, name: draft.name?.trim() || null, posts_transaction: 0 };
      addStep('schedule/create', { schedule: created, conditions }, { schedule: created, conditions, scheduleActions: [{ op: 'link-schedule', value: id }], nextDate: date });

    }
    if (draft.categoryId !== undefined || draft.notes !== undefined) {
      const initial = rule ? decodeCorrectionJson(rule.actions) : [{ op: 'link-schedule', value: targetScheduleId }];
      const actions = initial.map(action => {
        const row = action as Record<string, unknown>;
        return row.op === 'set' && row.field === 'amount' && !(row.options as Record<string, unknown> | undefined)?.template && !(row.options as Record<string, unknown> | undefined)?.formula ? { ...row, value: amount } : row;
      }).filter(action => !(action.op === 'set' && ((action.field === 'category' && draft.categoryId !== undefined) || (action.field === 'notes' && draft.notes !== undefined))));
      if (draft.categoryId !== undefined && draft.categoryId && !chosenAccount.offbudget) actions.push({ op: 'set', field: 'category', value: draft.categoryId });
      if (draft.notes !== undefined) actions.push({ op: 'set', field: 'notes', value: draft.notes });
      addStep('schedule/rule-update', { scheduleId: targetScheduleId, actions }, { ruleActions: { scheduleId: targetScheduleId, actions } });
    }
    if (primary) {
      const removed = [primary];
      if (primary.transferred_id) {
        const counterpartId = primary.transferred_id;
        const counterpart = snapshot.transactions.find(row => row.id === counterpartId && active(row));
        if (!counterpart || counterpart.transferred_id !== primary.id) correctionConstraint('The source transfer pair is incomplete.');
        disposable(counterpart, evidence);
        if (counterpart.financial_id || counterpart.raw_synced_data) correctionConstraint('The counterpart has a provider identity and cannot be removed.');
        removed.push(counterpart);
      }
      addStep('transactions-batch-update', { added: [], updated: [], deleted: removed.map(row => ({ id: row.id })), runTransfers: false, learnCategories: false }, { transactions: removed.map(row => ({ id: row.id, tombstone: 1 })) });
    }
    return { steps, targets };
  }
  let peer = primary?.transferred_id ? snapshot.transactions.find(row => row.id === primary!.transferred_id && active(row)) : undefined;
  if (primary?.transferred_id && (!peer || peer.transferred_id !== primary.id || Number(peer.amount) !== -Number(primary.amount))) correctionConstraint('The transfer pair is missing or is not reciprocal.');
  if (draft.type !== 'transfer' && peer) {
    if (!draft.retainTransactionId || ![primary!.id, peer.id].includes(draft.retainTransactionId)) correctionConstraint('Select the exact transfer side to retain.');
    if (draft.retainTransactionId === peer.id) [primary, peer] = [peer, primary];
    disposable(peer!, evidence);
    if (peer!.financial_id || peer!.raw_synced_data) correctionConstraint('The counterpart has a provider identity and cannot be removed.');
  }
  const added: CorrectionRow[] = [];
  const updated: CorrectionRow[] = [];
  const deleted: CorrectionRow[] = [];
  const after: CorrectionRow[] = [];
  function patch(row: CorrectionRow | undefined, fields: Record<string, unknown>): CorrectionRow {
    const id = row?.id || randomUUID();
    if (row && (row.isParent || row.isChild || snapshot.transactions.some(child => child.parent_id === id && active(child)))) correctionConstraint('This correction cannot preserve the split allocation; correct its split structure explicitly.');
    if (row?.reconciled && ['amount', 'acct', 'date'].some(key => fields[key] !== undefined && !same(fields[key], row[key]))) correctionConstraint('This change would alter a reconciled balance or date.');
    const delta = { id, ...fields };
    const result = row ? { ...row, ...delta } : { cleared: 0, reconciled: 0, tombstone: 0, ...delta };
    (row ? updated : added).push(rawPatchToSdk(row ? delta : result));
    after.push(result);
    if (!targets.transactionIds.includes(id)) targets.transactionIds.push(id);
    return result;
  }
  const common = { date, ...(draft.notes !== undefined ? { notes: draft.notes } : {}), ...(paymentSchedule ? { schedule: paymentSchedule } : {}) };
  if (draft.type === 'transfer') {
    const from = account(draft.fromAccountId), to = account(draft.toAccountId);
    if (from.id === to.id) correctionConstraint('Transfer accounts must be distinct.');
    let linkedAccount: string | null = null;
    if (paymentSchedule) {
      const scheduleRule = snapshot.rules.find(row => row.id === schedule?.rule);
      const conditions = (steps.find(step => step.after.schedule?.id === paymentSchedule)?.after.conditions || correctionConditions(scheduleRule?.conditions)) as ActualScheduleCondition[];
      const scheduledAccount = conditions.find(condition => condition.field === 'account')?.value;
      const scheduledAmount = conditions.find(condition => condition.field === 'amount')?.value;
      if (typeof scheduledAmount !== 'number' || scheduledAccount !== (scheduledAmount < 0 ? from.id : to.id)) correctionConstraint('The preserved schedule must match the account and direction of its linked transfer side.');
      linkedAccount = String(scheduledAccount);
    }
    const payee = (id: string) => {
      const match = snapshot.payees.find(row => row.transfer_acct === id && active(row));
      if (!match) correctionConstraint('The transfer account has no available Actual transfer payee.');
      return match.id;
    };
    const negative = primary && Number(primary.amount) < 0 ? primary : peer;
    const positive = primary && Number(primary.amount) >= 0 ? primary : peer;
    const negativeId = negative?.id || randomUUID(), positiveId = positive?.id || randomUUID();
    const transferPatch = (row: CorrectionRow | undefined, id: string, acct: CorrectionRow, opposite: CorrectionRow, amount: number, otherId: string) => {
      const fields = { ...common, ...(paymentSchedule ? { schedule: acct.id === linkedAccount ? paymentSchedule : null } : {}), acct: acct.id, amount, description: payee(opposite.id), transferred_id: otherId,
        category: acct.offbudget || !opposite.offbudget ? null : draft.categoryId === undefined ? row?.category ?? null : draft.categoryId };
      if (row) patch(row, fields);
      else {
        const result = patch(undefined, fields);
        // Replace the newly allocated ID with the reciprocal ID frozen above.
        const allocatedId = result.id;
        added[added.length - 1]!.id = id; after[after.length - 1]!.id = id;
        targets.transactionIds = targets.transactionIds.filter(target => target !== allocatedId); targets.transactionIds.push(id);
      }
    };
    transferPatch(negative, negativeId, from, to, -draft.amountCents, positiveId);
    transferPatch(positive, positiveId, to, from, draft.amountCents, negativeId);
  } else {
    const chosen = account(draft.accountId);
    patch(primary, { ...common, acct: chosen.id, amount: draft.type === 'income' ? draft.amountCents : -draft.amountCents,
      description: draft.payeeId !== undefined ? draft.payeeId : (peer ? null : primary?.description ?? null), transferred_id: null,
      category: chosen.offbudget ? null : draft.categoryId === undefined ? primary?.category ?? null : draft.categoryId });
    if (peer) { deleted.push({ id: peer.id }); after.push({ id: peer.id, tombstone: 1 }); }
  }
  addStep('transactions-batch-update', { added, updated, deleted, runTransfers: false, learnCategories: false }, { transactions: after });
  return { steps, targets };
}
