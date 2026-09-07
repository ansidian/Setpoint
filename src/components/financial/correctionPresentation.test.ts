import { describe, expect, it } from 'vitest';
import type { FinancialActivity } from '../../../shared/types/financial-activity';
import type { CorrectionSnapshot, FinancialCorrection, FinancialCorrectionInspection, CorrectionStepStatus } from '../../../shared/types/financial-corrections';
import { afterStep, initialDraft, intendedDraft, mayRequestSuccessor } from './correctionPresentation';

function inspection(): FinancialCorrectionInspection {
  return { reference:{ owner:'event',id:'source' }, activityId:'source',budgetId:'fictional', originalReceipts:[],correction:null,
    evidence:{ budgetId:'fictional',objects:[{ kind:'schedule',id:'schedule',role:'primary',provenance:'updated',beforeState:'unknown',before:null,after:null }] },
    snapshot:{ budgetId:'fictional',transactions:[{ id:'linked',acct:'wrong',amount:-100,date:20260101,schedule:'schedule' }],
      schedules:[{ id:'schedule',rule:'rule',name:'Current bill' }],
      rules:[{ id:'rule',conditions:JSON.stringify([{ field:'acct',value:'checking' },{ field:'amount',value:-12500 },{ field:'date',value:{ frequency:'monthly',start:'2026-09-01' } },{ field:'description',value:'utility' }]),
        actions:JSON.stringify([{ op:'set',field:'category',value:'utilities' },{ op:'set',field:'notes',value:'Keep my note' }]) }],
      dates:[{ id:'date',schedule_id:'schedule',local_next_date:20260901,base_next_date:20261001,local_next_date_ts:1,base_next_date_ts:2 }],
      accounts:[],payees:[],categories:[],scheduleNames:[] } };
}
const activity = { amountCents:1,payee:'Historical payee' } as FinancialActivity;
describe('correction draft normalization',() => {
  it('uses the exact primary schedule, current occurrence and raw actions instead of linked history',() => {
    const draft = initialDraft(inspection(),activity);
    expect(draft).toMatchObject({ type:'bill',amountCents:12500,date:'2026-10-01',accountId:'checking',payeeId:'utility',categoryId:'utilities',notes:'Keep my note',targetScheduleId:'schedule' });
  });
  it('preserves omitted instructions and explicit category clearing across the transport boundary',() => {
    const draft = { type:'transfer' as const,amountCents:100,date:'2026-09-01',fromAccountId:'from',toAccountId:'to',categoryId:null,payeeId:'inapplicable',targetScheduleId:'inapplicable' };
    expect(intendedDraft(draft)).toEqual({ type:'transfer',amountCents:100,date:'2026-09-01',fromAccountId:'from',toAccountId:'to',categoryId:null,notes:undefined });
    expect(intendedDraft({ ...draft,type:'bill',categoryId:undefined }).categoryId).toBeUndefined();
  });
  it('orients a positive primary transfer from its negative counterpart and ignores tombstones',() => {
    const source = inspection();
    source.evidence.objects[0] = { ...source.evidence.objects[0]!,kind:'transaction',id:'credit' };
    source.snapshot.transactions = [{ id:'deleted',amount:-9900,tombstone:1 },{ id:'credit',acct:'to',amount:12000,date:20260902,transferred_id:'debit' },{ id:'debit',acct:'from',amount:-12000,date:20260902,transferred_id:'credit' }];
    expect(initialDraft(source,activity)).toMatchObject({ type:'transfer',amountCents:12000,fromAccountId:'from',toAccountId:'to',payeeId:null,date:'2026-09-02' });
  });
});
describe('successor admission invitation',() => {
  function correction(state:CorrectionStepStatus['state'],attemptedAt:number|null,executionStopped=true): FinancialCorrection {
    return { state:'attention',executionStopped,steps:[{ state,attemptedAt }] } as FinancialCorrection;
  }
  it.each(['uncertain','conflict','unattempted'] as const)('cannot bypass an attempted %s effect',state => {
    expect(mayRequestSuccessor(correction(state,1))).toBe(false);
  });
  it('requires execution stopped and allows only settled attempted effects',() => {
    expect(mayRequestSuccessor(correction('partial',1,false))).toBe(false);
    expect(mayRequestSuccessor(correction('partial',1))).toBe(true);
    expect(mayRequestSuccessor(correction('conflict',null))).toBe(true);
    expect(mayRequestSuccessor({ ...correction('applied',1),state:'recovering' })).toBe(false);
  });
});
describe('sequential frozen preview evidence',() => {
  it('retains removed entry fields and projects action changes without mutating current evidence',() => {
    const before = inspection().snapshot;
    const step = { id:'step',command:'schedule/rule-update' as const,payload:{},before,targets:{ transactionIds:[],scheduleIds:[],ruleIds:[] },after:{ transactions:[{ id:'linked',tombstone:1 }],ruleActions:{ scheduleId:'schedule',actions:[{ op:'set',field:'notes',value:'Restored note' }] } } };
    const after:CorrectionSnapshot = afterStep(before,step);
    expect(after.transactions[0]).toMatchObject({ id:'linked',amount:-100,tombstone:1 });
    expect(after.rules[0]!.actions).toEqual([{ op:'set',field:'notes',value:'Restored note' }]);
    expect(before.transactions[0]!.tombstone).toBeUndefined();
    expect(typeof before.rules[0]!.actions).toBe('string');
  });
});
