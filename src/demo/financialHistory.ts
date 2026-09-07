import type { FinancialActivity } from '../../shared/types/financial-activity';
import { getDemoSeed } from './store';

/** A single bill with an original notice, a revised notice, and an explicit correction. */
export function withDemoFinancialHistory(activity: FinancialActivity): FinancialActivity {
  const seed = getDemoSeed();
  const related = activity.reference.id === 'demo-event-partial';
  const emails = related ? [
    { uid:'demo-electric-original', subject:'Fictional Electric · your $82 bill', receivedAt:activity.createdAt },
    { uid:'demo-electric-revised', subject:'Fictional Electric · revised bill and due date', receivedAt:activity.createdAt + 10 * 60_000 },
  ] : activity.emailUids.map(uid => ({ uid,subject:activity.subject,receivedAt:null }));
  if (related) {
    const revisedDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0,10);
    seed.emailBodies['demo-electric-original'] = { uid:'demo-electric-original', body:'Fictional demo bill — Fictional Electric. Bill reference ELEC-2048. Your bill is $82.00, payable from Demo Checking. This is the original notice retained with this financial record.', attachments:[] };
    seed.emailBodies['demo-electric-revised'] = { uid:'demo-electric-revised', body:`Fictional demo revised bill — Fictional Electric. Bill reference ELEC-2048. The corrected amount is $90.00 and the due date is ${revisedDate}. This replaces the amount and date in our earlier notice for the same bill. Review and confirm the correction in Setpoint.`, attachments:[] };
    const receipt = activity.originalReceipts[0];
    if (receipt?.evidence) {
      receipt.captureKind = 'settlement';
      receipt.evidence.objects.push(
        { kind:'rule',id:'demo-schedule-rule',role:'schedule_rule',provenance:'updated',beforeState:'unknown',before:null,
          after:{ id:'demo-schedule-rule',conditions:[{ field:'amount',op:'is',value:-8200 },{ field:'account',op:'is',value:'demo-checking' },{ field:'date',op:'is',value:seed.dateKey }],actions:[] } },
        { kind:'schedule_next_date',id:'demo-shared-schedule-date',role:'next_date',provenance:'updated',beforeState:'unknown',before:null,
          after:{ id:'demo-shared-schedule-date',schedule_id:'demo-shared-schedule',local_next_date:Number(seed.dateKey.replace(/-/g,'')) } },
      );
    }
  }
  return { ...activity, emailUids:emails.map(email => email.uid), history:{ emails,corrections:activity.history?.corrections || [] } };
}
