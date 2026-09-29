import { useEffect, useState } from 'react';
import type { FinancialActivity } from '../../../shared/types/financial-activity';
import FinancialEventCompletionForm from '../bills/FinancialEventCompletionForm';

interface Props {
  activity: FinancialActivity;
  onChanged: () => void;
  onAccepted: () => void;
  onRecordingSubmitted: () => () => void;
  onDirty: (dirty: boolean) => void;
  onRepair: () => void;
  onConfirming: (confirming:boolean) => void;
  requestDiscard: (action:()=>void) => void;
}

export default function PendingFinancialRecord(props: Props) {
  const { activity, onDirty, onRepair, requestDiscard } = props;
  useEffect(() => () => onDirty(false),[onDirty]);
  const [editing, setEditing] = useState(true);
  const plan = activity.completionPlan;
  if (!activity.actions.complete || !plan?.workflow?.completion) return <p className="financial-note">{activity.reason}</p>;
  return editing ? <FinancialEventCompletionForm onRecordingSubmitted={props.onRecordingSubmitted} plan={plan} onDirty={onDirty} onRepair={onRepair} onConfirming={props.onConfirming} onDismissed={() => { onDirty(false); props.onChanged(); }}
    onCancel={() => requestDiscard(() => { setEditing(false); onDirty(false); })} onQueued={() => { props.onAccepted(); onDirty(false); }} />
    : <button type="button" className="financial-button" onClick={() => setEditing(true)}>Complete record</button>;
}
