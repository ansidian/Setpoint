import { useState } from 'react';
import { getSettings, inspectFinancialActivityBinding } from '../../api';
import type { FinancialActivity } from '../../../shared/types/financial-activity';

export default function FinancialBindingRepair({ activity,onChanged,onRepair }: { activity:FinancialActivity; onChanged:()=>void; onRepair:()=>void }) {
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState('');
  async function resolve() {
    if (busy) return; setBusy(true); setMessage('');
    try {
      const settings = await getSettings();
      const budgetId = settings.actual_budget_sync_id;
      if (!budgetId) { setMessage('Select the original Actual budget in Connections before checking this record.'); return; }
      const result = await inspectFinancialActivityBinding(activity.reference,budgetId);
      const labels = { resolved:'The original entry was uniquely located. You can inspect and correct it now.',missing:'The original entry could not be found in this budget. No replacement was created.',ambiguous:'More than one entry matches the original identity. Resolve the duplicate entries in Actual before checking again.',wrong_budget:'This record belongs to a different Actual budget. Select its original budget in Connections.',unavailable:'Actual is unavailable. The saved result remains readable.' };
      setMessage(labels[result.status]); if (result.status === 'resolved') onChanged();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The original entry could not be checked.'); }
    finally { setBusy(false); }
  }
  return <section className="financial-section"><h3>Original Actual target</h3><p className="financial-note">This older result has no resolved Actual target. Check its saved import identity in the selected budget before correcting.</p>
    <div className="flex flex-wrap gap-2 mt-3"><button className="financial-button" disabled={busy} onClick={() => void resolve()}>{busy ? 'Checking original entry…' : 'Locate original Actual entry'}</button><button className="financial-button" onClick={onRepair}>Check Actual connection</button></div>{message && <p role="status" className="financial-error">{message}</p>}
  </section>;
}
