import type { ActualBillOccurrence, ActualPayee, ActualSchedule } from '../../shared/types/actual.ts';
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
export function buildPaymentCatalog({ schedules, occurrences, payees = [] }: {
  schedules: ActualSchedule[];
  occurrences: RetainedPayment[];
  payees?: ActualPayee[];
}): PaymentItem[] {
  const activeSchedules = schedules.filter(schedule => schedule.id && !schedule.completed);
  const allIds = new Set([...activeSchedules.map(schedule => schedule.id!), ...occurrences.map(item => item.scheduleId)]);
  return [...allIds].map(id => {
    const schedule = activeSchedules.find(item => item.id === id);
    const occurrence = occurrences.filter(item => item.scheduleId === id).sort((a, b) => b.next_date.localeCompare(a.next_date))[0];
    const payeeCondition = schedule?.conditions?.filter(condition => condition.field === 'payee' && condition.op === 'is');
    const payeeId = payeeCondition?.length === 1 ? payeeCondition[0]!.value : null;
    const provider = payees.find(payee => payee.id === payeeId)?.name || occurrence?.payee || '';
    return { id: `schedule:${id}`, name: schedule?.name?.trim() || occurrence?.name || provider || 'Recurring payment', provider, scheduleId: id };
  });
}
