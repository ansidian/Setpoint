import type { ActualBillOccurrence, ActualPayee, ActualSchedule } from '../../shared/types/actual.ts';
import type { FinancialProfile } from '../../shared/types/financial-profiles.ts';
import type { UtilityIdentity } from '../../shared/types/finances.ts';
import type { PaymentItem } from '../../shared/types/payment-groups.ts';
import type { Client } from '@libsql/client';
import db from '../db/connection.ts';

type RetainedPayment = Pick<ActualBillOccurrence, 'scheduleId' | 'name' | 'payee' | 'next_date'>;

/** The editor also includes retained schedules outside the workspace's bounded history window. */
export async function readRetainedPaymentSchedules(
  userId: string, { dbClient = db }: { dbClient?: Pick<Client, 'execute'> } = {},
): Promise<RetainedPayment[]> {
  const result = await dbClient.execute({
    sql: `SELECT schedule_id, name, payee, occurrence_date FROM (
      SELECT schedule_id, name, payee, occurrence_date,
        ROW_NUMBER() OVER (PARTITION BY schedule_id ORDER BY occurrence_date DESC, occurrence_id DESC) AS position
      FROM ea_bill_occurrence_mirror WHERE user_id=?
    ) WHERE position=1 ORDER BY name, schedule_id`,
    args: [userId],
  });
  return result.rows.map(row => ({
    scheduleId: String(row.schedule_id), name: String(row.name), payee: String(row.payee), next_date: String(row.occurrence_date),
  }));
}

/** All stable payment identities, independent of the month currently being viewed. */
export function buildPaymentCatalog({
  budgetId, utilities, schedules, occurrences, payees = [], profiles = [], cardScheduleIds = [],
}: {
  budgetId: string;
  utilities: UtilityIdentity[];
  schedules: ActualSchedule[];
  occurrences: RetainedPayment[];
  payees?: ActualPayee[];
  profiles?: FinancialProfile[];
  cardScheduleIds?: string[];
}): PaymentItem[] {
  const items: PaymentItem[] = utilities.map(identity => ({
    id: `utility:${identity.id}`, name: identity.label, provider: identity.provider, kind: 'utility', utilityId: identity.id,
  }));
  const usedSchedules = new Set(utilities.flatMap(identity => identity.scheduleIds));
  const cards = new Set(cardScheduleIds);
  for (const profile of profiles) {
    if (profile.enabled && profile.budgetId === budgetId && profile.target.kind === 'card_payment' && profile.target.scheduleId) {
      const scheduleId = profile.target.scheduleId;
      const matches = schedules.filter(schedule => schedule.id === scheduleId);
      if (matches.length === 1 && matches[0]!.type === 'transfer') cards.add(scheduleId);
    }
  }
  const activeSchedules = schedules.filter(schedule => schedule.id && !schedule.completed);
  const allIds = new Set([...activeSchedules.map(schedule => schedule.id!), ...occurrences.map(item => item.scheduleId), ...cardScheduleIds]);
  for (const id of allIds) {
    if (usedSchedules.has(id)) continue;
    const schedule = activeSchedules.find(item => item.id === id);
    const occurrence = occurrences.filter(item => item.scheduleId === id).sort((a, b) => b.next_date.localeCompare(a.next_date))[0];
    const payeeCondition = schedule?.conditions?.filter(condition => condition.field === 'payee' && condition.op === 'is');
    const payeeId = payeeCondition?.length === 1 ? payeeCondition[0]!.value : null;
    const provider = payees.find(payee => payee.id === payeeId)?.name || occurrence?.payee || '';
    const cardProfile = profiles.find(profile => cards.has(id) && profile.enabled && profile.budgetId === budgetId
      && profile.target.kind === 'card_payment' && profile.target.scheduleId === id);
    items.push({
      id: `schedule:${id}`, name: schedule?.name?.trim() || occurrence?.name || provider || cardProfile?.name
        || (cards.has(id) ? 'Credit card payment' : 'Recurring payment'), provider,
      kind: cards.has(id) ? 'credit_card' : 'recurring', scheduleId: id,
    });
  }
  return items;
}
