import type { PaymentGroup, PaymentItem, PaymentOrganization } from './types/payment-groups.ts';

type OrganizationValidation =
  | { valid: true; value: PaymentOrganization }
  | { valid: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= limit
    && [...value].every(character => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127);
}

/** Display configuration only: it cannot change provider accounts or financial automation. */
export function validatePaymentOrganization(input: unknown): OrganizationValidation {
  const invalid = (message: string): OrganizationValidation => ({ valid: false, message });
  if (!isRecord(input) || Object.keys(input).some(key => !['budgetId', 'revision', 'groups'].includes(key))
    || !boundedText(input.budgetId, 128) || input.budgetId.trim() !== input.budgetId
    || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0) {
    return invalid('Reload Payments before saving these groups.');
  }
  if (!Array.isArray(input.groups) || !input.groups.length || input.groups.length > 100) {
    return invalid('Use between 1 and 100 payment groups.');
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  const itemIds = new Set<string>();
  const groups: PaymentGroup[] = [];
  for (const raw of input.groups) {
    if (!isRecord(raw) || Object.keys(raw).some(key => !['id', 'name', 'itemIds'].includes(key))
      || !boundedText(raw.id, 128) || raw.id.trim() !== raw.id || ids.has(raw.id)) {
      return invalid('Each payment group needs a unique identity.');
    }
    if (!boundedText(raw.name, 60)) return invalid('Give each group a name of 1–60 characters.');
    const name = raw.name.trim();
    if (names.has(name.toLowerCase())) return invalid('Choose a different name for each group.');
    if (!Array.isArray(raw.itemIds)) return invalid('Each payment must belong to one group.');
    const ordered: string[] = [];
    for (const id of raw.itemIds) {
      if (!boundedText(id, 256) || id.trim() !== id || !/^(?:utility|schedule):\S/.test(id) || itemIds.has(id)) {
        return invalid('Each payment must appear in exactly one group.');
      }
      itemIds.add(id);
      ordered.push(id);
    }
    if (itemIds.size > 5000) return invalid('This payment organization contains too many items.');
    ids.add(raw.id);
    names.add(name.toLowerCase());
    groups.push({ id: raw.id, name, itemIds: ordered });
  }
  if (!ids.has('ungrouped')) return invalid('Keep the default group for newly discovered payments. You can rename it.');
  return { valid: true, value: { budgetId: input.budgetId, revision: Number(input.revision), groups } };
}

export function initializePaymentOrganization(budgetId: string, items: PaymentItem[]): PaymentOrganization {
  const groups: PaymentGroup[] = [
    { id: 'utilities', name: 'Utilities', itemIds: [] },
    { id: 'credit-cards', name: 'Credit cards', itemIds: [] },
    { id: 'subscriptions', name: 'Subscriptions', itemIds: [] },
    { id: 'ungrouped', name: 'Ungrouped', itemIds: [] },
  ];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const groupId = item.kind === 'utility' ? 'utilities' : item.kind === 'credit_card' ? 'credit-cards' : 'ungrouped';
    groups.find(group => group.id === groupId)!.itemIds.push(item.id);
  }
  return { budgetId, revision: 0, groups };
}

/** Missing metadata never deletes a saved assignment. Newly discovered items use the owner's default group. */
export function reconcilePaymentOrganization(organization: PaymentOrganization, items: PaymentItem[]): PaymentOrganization {
  const groups = organization.groups.map(group => ({ ...group, itemIds: [...group.itemIds] }));
  const assigned = new Set(groups.flatMap(group => group.itemIds));
  const fallback = groups.find(group => group.id === 'ungrouped');
  if (!fallback) throw new Error('Payment organization is missing its default group.');
  for (const item of items) {
    if (assigned.has(item.id)) continue;
    fallback.itemIds.push(item.id);
    assigned.add(item.id);
  }
  return { ...organization, groups };
}
