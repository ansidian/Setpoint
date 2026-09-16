import { describe, expect, it } from 'vitest';
import { createFinancialEmailPlanner } from './financial-email-planner.ts';
import { matchFinancialProfile } from './financialProfilePlanning.ts';

/** Profile/Actual reads are external persistence boundaries; the planner and its policies run together. */
const planner=createFinancialEmailPlanner({
  profileReader:async()=>({budgetId:'budget',revision:1,profiles:[]}),
  metadataReader:async()=>({accounts:[],payees:[],payeeMap:{},categories:[],schedules:[],recentTransactions:[],syncHealth:{state:'current',lastSuccessAt:null}}),
  occurrenceReader:async()=>({schedules:[],syncHealth:{state:'current',lastSuccessAt:null}}),
  transactionReader:async()=>({transactions:[]}),
});
describe('deterministic financial planning',()=>{
  it('leaves incomplete parser evidence in review without manufacturing model audit outcomes',async()=>{
    const result=await planner('owner',{assessmentMode:'deterministic',providerId:'citi',source:'financial_event',
      email:{from_address:'citicards@info6.citi.com',subject:'Your statement',body:'Your Costco Anywhere Visa statement is now available.'},
      candidate:{type:'transfer',event_kind:'statement_issued',event_evidence:'Your Costco Anywhere Visa statement is now available.'},
    });
    expect(result.automation.eligible).toBe(false);
    expect(result.operation.kind).toBe('review');
    expect(result.candidate.type_verification).toBeUndefined();
    expect(result.candidate.event_verification).toBeUndefined();
    expect(result.candidate.amount_verification).toBeUndefined();
    expect(result.candidate.amount).toBeFalsy();
  });
  it('requires a parsed candidate instead of falling through to extraction',async()=>{
    await expect(planner('owner',{assessmentMode:'deterministic',providerId:'citi',email:{body:'A statement'}})).rejects.toThrow('requires a parsed candidate');
  });
  it('does not grant authority from a shared sender without the matching provider identity',()=>{
    const configuration={budgetId:'budget',revision:2,profiles:[{id:'water',providerId:'sgv-water' as const,name:'SGV Water',enabled:true,budgetId:'budget',senderAddresses:['no-reply@invoicecloud.net'],target:{kind:'utility' as const,scheduleId:'water-schedule'}}]};
    const candidate={type:'bill' as const,event_kind:'bill_issued' as const};
    const input={sourceIdentity:{senderAddress:'no-reply@invoicecloud.net'}};
    expect(matchFinancialProfile(configuration,input,candidate).resolution.status).toBe('missing');
    expect(matchFinancialProfile(configuration,{...input,providerId:'sgv-water'},candidate).resolution.status).toBe('matched');
  });
});
