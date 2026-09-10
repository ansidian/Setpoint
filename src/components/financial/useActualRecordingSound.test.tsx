import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FinancialActivity } from '../../../shared/types/financial-activity';
import useActualRecordingSound from './useActualRecordingSound';

let now: number;
let played: Array<{ path: string; volume: number }>;
let enabled: boolean;
const pending = {
  id: 'record', updatedAt: 1, status: 'needs_attention', originalReceipts: [],
} as unknown as FinancialActivity;
const settled = {
  ...pending, updatedAt: 3, status: 'completed',
  originalReceipts: [{ reference: { owner: 'event', id: 'record' }, revision: 2, capturedAt: 3,
    captureKind: 'settlement', outcome: 'added', input: {}, result: {}, evidence: null }],
} as FinancialActivity;

beforeEach(() => {
  now = 100_000; played = []; enabled = true;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('AudioContext', undefined);
  vi.stubGlobal('fetch', async (path: string) => {
    if (path !== '/api/ea/settings') throw new Error(`Unexpected request: ${path}`);
    return Response.json({ triage_sound_settings: { volume: 0.6,
      triggers: { actual_recorded: { enabled, soundId: 'latch' } } } });
  });
  vi.stubGlobal('Audio', class {
    volume = 1;
    private path: string;
    constructor(path: string) { this.path = path; }
    async play() { played.push({ path: this.path, volume: this.volume }); }
    pause() {}
    removeAttribute() {}
    load() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  return renderHook(({ activity, open }) => useActualRecordingSound(activity, open), {
    initialProps: { activity: pending, open: true },
  });
}

it.each(['added', 'updated', 'already_present'])('plays one configured cue for a fresh %s receipt even when confirmation takes longer than ten seconds', async outcome => {
  const { result, rerender } = setup();
  act(() => { result.current(); });
  rerender({ activity: { ...pending, status: 'processing', updatedAt: 2 }, open: true });
  expect(played).toEqual([]);
  now += 60_000;
  const confirmed = { ...settled, originalReceipts: [{ ...settled.originalReceipts[0]!, outcome }] };
  rerender({ activity: confirmed, open: true });
  await waitFor(() => expect(played).toEqual([{ path: '/sounds/notifications/latch.mp3', volume: 0.6 }]));
  rerender({ activity: { ...confirmed }, open: true });
  expect(played).toHaveLength(1);
});

it.each(['closed', 'hidden', 'rejected', 'disabled', 'attention', 'no-receipt', 'historical'] as const)(
  'stays quiet for %s results', async reason => {
    const { result, rerender } = setup();
    let cancel = () => {};
    if (reason !== 'historical') act(() => { cancel = result.current(); });
    if (reason === 'closed') {
      rerender({ activity: pending, open: false });
      rerender({ activity: pending, open: true });
    }
    if (reason === 'hidden') act(() => {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    });
    if (reason === 'rejected') act(cancel);
    if (reason === 'disabled') enabled = false;
    if (reason === 'attention') rerender({ activity: { ...pending, updatedAt: 2 }, open: true });
    await act(async () => rerender({ activity: reason === 'no-receipt' ? { ...settled, originalReceipts: [] } : settled, open: true }));
    expect(played).toEqual([]);
  },
);
