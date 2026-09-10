import { useCallback, useEffect, useRef } from 'react';
import { getSettings } from '../../api';
import { playTriageNotificationSound } from '../../lib/triageSoundPlayback';
import { resolveDashboardSoundForTrigger } from '../../lib/triageSoundRouter';
import type { FinancialActivity } from '../../../shared/types/financial-activity';

const receiptKey = (receipt: FinancialActivity['originalReceipts'][number]) =>
  JSON.stringify([receipt.reference, receipt.revision, receipt.capturedAt]);

/** An explicit recording gesture may sound only while its fresh, confirmed result is still in view. */
export default function useActualRecordingSound(activity: FinancialActivity, open: boolean, scope = activity.id) {
  const attempt = useRef<{
    controller: AbortController;
    receipts: Set<string>;
    revision: number;
    consumed: boolean;
  } | null>(null);
  const cancel = useCallback(() => {
    attempt.current?.controller.abort();
    attempt.current = null;
  }, []);

  useEffect(() => {
    if (!open) cancel();
    const visibilityChanged = () => { if (document.visibilityState === 'hidden') cancel(); };
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pagehide', cancel);
    return () => {
      cancel();
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('pagehide', cancel);
    };
  }, [open, scope, cancel]);

  const begin = useCallback(() => {
    cancel();
    if (!open || document.visibilityState === 'hidden') return cancel;
    const controller = new AbortController();
    attempt.current = {
      controller,
      receipts: new Set(activity.originalReceipts.map(receiptKey)), revision: activity.updatedAt, consumed: false,
    };
    return () => {
      controller.abort();
      if (attempt.current?.controller === controller) attempt.current = null;
    };
  }, [activity.originalReceipts, activity.updatedAt, open, cancel]);

  useEffect(() => {
    const current = attempt.current;
    if (!current || current.consumed) return;
    if (!open || document.visibilityState === 'hidden' || activity.correction) {
      cancel(); return;
    }
    const receipt = activity.originalReceipts.find(value => value.captureKind === 'settlement'
      && ['added', 'updated', 'already_present'].includes(value.outcome)
      && !current.receipts.has(receiptKey(value)));
    if (activity.status !== 'completed' || !receipt) {
      if (activity.updatedAt !== current.revision && activity.status !== 'processing') cancel();
      return;
    }
    current.consumed = true;
    void getSettings().then(settings => {
      if (current.controller.signal.aborted || document.visibilityState === 'hidden') return;
      const sound = resolveDashboardSoundForTrigger('actual_recorded', settings.triage_sound_settings,
        settings.triage_notification_sounds);
      if (sound) void playTriageNotificationSound(sound.sound, {
        volume: sound.volume, signal: current.controller.signal,
      });
    }).catch(() => {});
  }, [activity, open, cancel]);

  return begin;
}
