import type { FinancialActivity } from '../../../shared/types/financial-activity';
import { dateLabel, record, rows, typeLabels } from './correctionPresentation';

/** Saved facts for scan rows; never substitute activity timestamps for transaction dates. */
export function activityFacts(activity: FinancialActivity) {
  const effective = record(activity.effectiveResult);
  const entry = record(effective.entry);
  if (effective.resolution === 'kept_actual' && !entry.type) return { type:'Kept result',date:'',label:'Kept result' };
  const receipt = activity.originalReceipts[0];
  const saved = record(receipt?.input);
  const operation = record(saved.operation);
  const input = record(operation.input || saved.input || saved);
  const plan = activity.completionPlan;
  const objects = rows(record(effective.evidence).objects).length ? rows(record(effective.evidence).objects) : receipt?.evidence?.objects || [];
  const transaction = record(objects.find(object => object.kind === 'transaction' && object.role === 'primary')?.after);
  const schedule = record(objects.find(object => object.kind === 'schedule')?.after);
  const kind = String(entry.type || input.type || (input.kind === 'transfer_schedule' || operation.executor === 'transfer_schedule' ? 'transfer_schedule' : transaction.transferred_id ? 'transfer' : schedule.id ? 'bill' : Number(transaction.amount ?? activity.amountCents) > 0 ? 'income' : plan?.candidate.type || 'payment'));
  const type = typeLabels[kind as keyof typeof typeLabels] || (kind === 'expense' ? 'One-time payment' : 'Financial record');
  const date = dateLabel(entry.date || transaction.date || input.date || plan?.candidate.due_date || (!receipt ? activity.importItem?.date : null) || schedule.next_date || record(objects.find(object => object.kind === 'schedule_next_date')?.after).local_next_date);
  const captured = receipt ? new Date(receipt.capturedAt).toLocaleDateString('en-US',{ month:'short',day:'numeric',year:'numeric' }) : null;
  return { type, date, label: `${type} · ${date || (captured ? `Captured ${captured}` : 'Date not captured')}` };
}

export function activityAmount(activity: FinancialActivity): string {
  if (activity.amountCents == null) return 'Amount unknown';
  const amount = activity.amountCents / 100;
  if (!activity.currency) return `${amount > 0 ? '+' : ''}${amount.toFixed(2)} · currency unknown`;
  try { return new Intl.NumberFormat('en-US', { style:'currency',currency:activity.currency,signDisplay:'exceptZero' }).format(amount); }
  catch { return `${amount > 0 ? '+' : ''}${amount.toFixed(2)} ${activity.currency}`; }
}

export function activityOutcome(activity: FinancialActivity): string {
  if (activity.correction?.resolution === 'kept_actual') return 'Current Actual result kept';
  if (activity.correction?.state === 'completed') return 'Correction saved to Actual';
  const outcome = activity.originalReceipts[0]?.outcome;
  const labels: Record<string,string> = { added:'Recorded in Actual',updated:'Updated in Actual',already_present:'Already recorded in Actual' };
  return labels[outcome || ''] || 'Completed';
}

export function activityReviewReason(activity: FinancialActivity): string {
  if (['ready','needs review','needs_review'].includes(activity.reason)) return activity.actions.complete ? 'Confirm the payment details' : 'Review this record';
  if (activity.reason === 'failed') return 'Import failed. Review or retry.';
  if (activity.reason === 'paused') return 'Processing paused. Review or retry.';
  return activity.reason;
}
