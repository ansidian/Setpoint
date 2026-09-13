import type { ActualSchedule } from '../../../../shared/types/actual';
import type { UtilityIdentity, UtilityMappingSettings } from '../../../../shared/types/finances';
import type { UtilityPayLink } from '../../../../shared/types/settings';

export function utilityScheduleOptions(data: UtilityMappingSettings, utility: UtilityIdentity) {
  const payees = data.payees.filter(payee => !payee.transfer_acct);
  const assignedElsewhere = new Set(data.utilities.filter(row => row.id !== utility.id).flatMap(row => row.scheduleIds));
  return data.schedules.flatMap(schedule => {
    const conditions = (schedule.conditions || []).filter(condition => condition.field === 'payee');
    const payee = conditions.length === 1 && conditions[0]?.op === 'is'
      ? payees.find(row => row.id === conditions[0]?.value) : undefined;
    if (!schedule.id || assignedElsewhere.has(schedule.id) || schedule.completed || schedule.type !== 'bill' || !payee) return [];
    return [{ id: schedule.id, name: schedule.name || payee.name, payee }];
  });
}

export function scheduleLabel(schedule: ActualSchedule | undefined, payeeMap: Record<string, string>) {
  if (!schedule) return '';
  const payee = schedule.conditions?.find(condition => condition.field === 'payee')?.value;
  return schedule.name || (typeof payee === 'string' && payeeMap[payee]) || 'Unnamed schedule';
}

export function payLinkHost(url: string) {
  if (!/^https?:\/\//i.test(url.trim())) return '';
  try {
    const parsed = new URL(url.trim());
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.hostname : '';
  } catch { return ''; }
}

/** Replace only the edited schedule's link, preserving unrelated calendar links. */
export function replacePayLink(links: UtilityPayLink[], originalScheduleId: string, next: UtilityPayLink | null) {
  const remaining = links.filter(link => link.scheduleId !== originalScheduleId && link.scheduleId !== next?.scheduleId);
  return next ? [...remaining, { ...next, url: next.url.trim() }] : remaining;
}
