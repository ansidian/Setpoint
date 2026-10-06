import { afterEach, describe, expect, it, vi } from 'vitest';

async function demo() {
  vi.resetModules();
  vi.stubEnv('VITE_EA_DEMO', '1');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-07T18:00:00Z'));
  vi.stubGlobal('fetch', () => { throw new Error('Demo reached network'); });
  vi.stubGlobal('EventSource', class { constructor() { throw new Error('Demo reached SSE'); } });
  vi.stubGlobal('localStorage', { setItem() { throw new Error('Demo persisted data'); } });
  return import('../api');
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

describe('demo finances', () => {
  it('projects every fictional schedule once into the starter layout and reads the shared Journal locally', async () => {
    const api = await demo();
    const workspace = await api.getFinances();
    const ids = workspace.paymentItems!.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(workspace.recurring.map(row => `schedule:${row.scheduleId}`)));
    expect(workspace.paymentOrganization!.groups.find(group => group.id === 'ungrouped')!.itemIds).toEqual(ids);
    expect(workspace.recurring.find(row => row.scheduleId === 'demo-card')).toMatchObject({ type: 'transfer', amount: 512.84 });
    const journal = await api.getFinanceJournal('2026-09-01', '2026-09-07');
    expect(journal.transactions.every(row => row.date >= '2026-09-01' && row.date <= '2026-09-07')).toBe(true);
    expect(workspace.recordedHistory!.transactions.length).toBeGreaterThanOrEqual(journal.transactions.length);
  });

  it('saves only a complete payment organization in memory, isolates readers, and resets on refresh without changing Actual data', async () => {
    const api = await demo();
    const before = await api.getFinances();
    const original = structuredClone(before.paymentOrganization!);
    const draft = structuredClone(original);
    draft.groups.reverse();
    const fallback = draft.groups.find(group => group.id === 'ungrouped')!;
    fallback.name = 'Personal';
    draft.groups.find(group => group.id === 'credit-cards')!.itemIds.push(fallback.itemIds.pop()!);
    expect((await api.getFinances()).paymentOrganization).toEqual(original);

    const saved = await api.savePaymentOrganization(draft);
    expect(saved).toEqual({ ...draft, revision: 1 });
    const after = await api.getFinances();
    expect(after.paymentOrganization).toEqual(saved);
    expect(after.recordedHistory).toEqual(before.recordedHistory);
    expect(after.recurring).toEqual(before.recurring);
    saved.groups[0]!.name = 'Caller-only edit';
    expect((await api.getFinances()).paymentOrganization!.groups[0]!.name).toBe('Personal');
    await expect(api.savePaymentOrganization(original)).rejects.toMatchObject({ status: 409 });
    await expect(api.savePaymentOrganization({ ...after.paymentOrganization!, groups: [] })).rejects.toMatchObject({ status: 400 });
    expect((await api.getFinances()).paymentOrganization).toEqual(after.paymentOrganization);

    const refreshed = await demo();
    expect((await refreshed.getFinances()).paymentOrganization).toEqual(original);
  });
});
