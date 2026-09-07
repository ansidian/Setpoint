import type { FinancialWriteEvidence } from '../../shared/types/financial-activity.ts';
import { randomUUID } from 'node:crypto';
import type { FinancialCorrection, CorrectionSnapshot, CorrectionStep } from '../../shared/types/financial-corrections.ts';
import { correctionJson, decodeCorrectionJson } from '../actual/actual.ts';
import { correctionConstraint } from './financial-correction-model.ts';

/** Known partial child graphs are explicitly retired before a fresh parent is allocated. */
export function correctionSuccessorSteps(previous: FinancialCorrection | null, snapshot: CorrectionSnapshot): CorrectionStep[] {
  if (!previous || previous.state === 'completed') return [];
  if (!previous.executionStopped || previous.steps.some(step => step.attemptedAt !== null && !['applied', 'partial', 'no_write'].includes(step.state))) correctionConstraint('Every attempted effect must be settled and execution stopped before a successor.');
  const steps: CorrectionStep[] = [];
  for (const entry of previous.steps.filter(step => step.state === 'partial')) {
    const parentId = entry.step.after.schedule?.id;
    if (!parentId || entry.step.command !== 'schedule/create' || !entry.observed) correctionConstraint('This partial result has no safely resolvable schedule graph.');
    if (snapshot.schedules.some(row => row.id === parentId && !row.tombstone) || snapshot.transactions.some(row => row.schedule === parentId && !row.tombstone)) correctionConstraint('The partial schedule has a parent or linked payment; retain it for explicit resolution.');
    const knownRules = entry.observed.rules.filter(row => decodeCorrectionJson(row.actions).some(action => action && typeof action === 'object' && 'op' in action && action.op === 'link-schedule' && 'value' in action && action.value === parentId));
    for (const rule of knownRules) {
      const current = snapshot.rules.find(row => row.id === rule.id);
      if (correctionJson(current) !== correctionJson(rule) || snapshot.schedules.some(row => !row.tombstone && row.rule === rule.id)) correctionConstraint('The orphan rule changed or is referenced; it cannot be retired.');
      if (decodeCorrectionJson(rule.actions).some(action => !action || typeof action !== 'object' || !('op' in action) || action.op !== 'link-schedule' || !('value' in action) || action.value !== parentId)) correctionConstraint('The orphan rule has additional actions and cannot be safely retired.');
      if (!rule.tombstone) steps.push({ id: randomUUID(), command: 'rule-delete', payload: rule.id,
        targets: previous.preview.targets, before: snapshot, after: { removedRuleId: rule.id } });
    }
  }
  return steps;
}

export function correctionSuccessorContext(previous: FinancialCorrection | null, snapshot: CorrectionSnapshot, evidence: FinancialWriteEvidence) {
  if (!previous || previous.state === 'completed') return { evidence, context: {} };
  const primary = evidence.objects.find(object => object.role === 'primary');
  const applied = previous.steps.filter(entry => entry.state === 'applied');
  const createdSchedules = applied.flatMap(entry => entry.step.command === 'schedule/create' && entry.step.after.schedule
    ? [entry.step.after.schedule] : []).filter(parent => snapshot.schedules.some(row => row.id === parent.id && !row.tombstone));
  if (createdSchedules.length > 1) correctionConstraint('Choose an exact replacement schedule before resolving this partial correction.');
  const objects = [...evidence.objects];
  for (const parent of createdSchedules) {
    if (!objects.some(object => object.kind === 'schedule' && object.id === parent.id)) objects.push({ kind: 'schedule', id: parent.id,
      role: 'counterpart', provenance: 'created', beforeState: 'confirmed_absent', before: null,
      after: snapshot.schedules.find(row => row.id === parent.id)! });
  }
  const allowMissingPrimary = !!primary && applied.some(entry => entry.step.after.removedScheduleId === primary.id
    || entry.step.after.transactions?.some(row => row.id === primary.id && row.tombstone));
  return { evidence: { ...evidence, objects }, context: { allowMissingPrimary, scheduleId: createdSchedules[0]?.id } };
}
