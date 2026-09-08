import type { FinancialWriteEvidence } from '../../shared/types/financial-activity.ts';
import type { CorrectionSnapshot, FinancialCorrectionPreview } from '../../shared/types/financial-corrections.ts';

export function correctionResult(preview: FinancialCorrectionPreview, snapshot: CorrectionSnapshot) {
  const desiredRows = preview.steps.flatMap(step => step.after.transactions || []).filter(row => !row.tombstone);
  const originalPrimary = preview.evidence.objects.find(object => object.kind === 'transaction' && object.role === 'primary');
  const transactionId = desiredRows.find(row => row.id === originalPrimary?.id)?.id
    || desiredRows.find(row => Number(row.amount) < 0)?.id || desiredRows[0]?.id;
  const scheduleId = preview.steps.find(step => step.after.schedule)?.after.schedule?.id;
  const primaryId = preview.draft.type === 'bill' || preview.draft.type === 'transfer_schedule' ? scheduleId : transactionId;
  const evidence: FinancialWriteEvidence = { budgetId: snapshot.budgetId, objects: [] };
  for (const [kind, rows] of [['transaction', snapshot.transactions], ['schedule', snapshot.schedules], ['rule', snapshot.rules], ['schedule_next_date', snapshot.dates]] as const) {
    for (const row of rows.filter(row => !row.tombstone)) {
      if (kind === 'transaction' && !desiredRows.some(desired => desired.id === row.id)) continue;
      const original = preview.evidence.objects.find(object => object.kind === kind && object.id === row.id);
      const prior = kind === 'transaction' ? preview.snapshot.transactions : kind === 'schedule' ? preview.snapshot.schedules : kind === 'rule' ? preview.snapshot.rules : preview.snapshot.dates;
      const existed = prior.some(before => before.id === row.id);
      evidence.objects.push({ kind, id: row.id, role: row.id === primaryId ? 'primary' : kind === 'transaction' ? 'counterpart' : kind === 'rule' ? 'schedule_rule' : kind === 'schedule_next_date' ? 'next_date' : 'counterpart',
        provenance: !existed ? 'created' : original?.provenance || 'updated',
        beforeState: !existed ? 'confirmed_absent' : original?.beforeState || 'captured',
        before: !existed ? null : original?.before || prior.find(before => before.id === row.id) || null, after: row });
    }
  }
  return { outcome: 'updated', correctionId: preview.id, entry: { ...preview.draft, scheduleId, scheduleName: preview.draft.name, kind: preview.draft.type === 'payment' ? 'expense' : preview.draft.type, amount: preview.draft.amountCents / 100, payee: snapshot.payees.find(row => row.id === (preview.draft.payeeId ?? snapshot.transactions.find(transaction => transaction.id === transactionId)?.description))?.name || undefined }, evidence, transactionId, scheduleId };
}
