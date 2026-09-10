import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FinancialActivity } from '../../../shared/types/financial-activity';
import type { FinancialEmailPlan, FinancialTargetKind } from '../../../shared/types/bills';
import { invalidateActualMetadata } from '../../lib/actualMetadata';
import FinancialWorkspace from './FinancialWorkspace';

const target = (kind:FinancialTargetKind) => ({ kind,status:'not_applicable' as const,provenance:[] });
const plan:FinancialEmailPlan = {
  version:1,identity:{ version:1,status:'resolved',key:'receipt' },
  candidate:{ type:'expense',amount:30,payee:'Example Merchant',currency:'USD',due_date:'2026-09-08' },
  classification:{ documentKind:'one_time_transaction',eventKind:'purchase',confidence:1,reasons:[] },
  operation:{ intended:'create_transaction',kind:'review',reasons:[] },
  targets:{ account:{ ...target('account'),status:'resolved',id:'checking',label:'Checking' },payee:target('payee'),category:target('category'),fromAccount:target('from_account'),toAccount:target('to_account'),schedule:target('schedule') },
  reconciliation:{ status:'not_checked',disposition:'review' },reviewReasons:[],
  automation:{ eligible:false,operationClass:'one_time_expense',rollout:'enabled',gates:[],reasons:[] },
  workflow:{ id:'event',state:'waiting',reason:'Confirm details',relatedEmails:1,nextAttemptAt:null,completion:{ emailUid:'receipt',documentRevision:1,eventRevision:1,canComplete:true } },
};
let current:FinancialActivity;
let failDetail = 0;
let rejectImport = false;
let played = 0;
beforeEach(() => {
  invalidateActualMetadata();
  failDetail = 0; rejectImport = false; played = 0;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('AudioContext', undefined);
  vi.stubGlobal('Audio', class {
    volume = 1;
    async play() { played++; }
    pause() {} removeAttribute() {} load() {}
  });
  current = { id:'event',reference:{ owner:'event',id:'event' },occurrences:[],source:'managed',contexts:['arrival'],emailUids:[],subject:'Receipt',payee:'Example Merchant',amountCents:-3000,currency:'USD',createdAt:1,updatedAt:1,status:'needs_attention',reason:'Confirm details',actions:{ complete:true,retry:false,inspect:true,correct:false },originalReceipts:[],sourceEvidence:[],targetBindings:[],liveState:'not_checked',effectiveResult:null,completionPlan:plan,importItem:null,runs:[] };
  vi.stubGlobal('fetch',async (path:string) => {
    if (path === '/api/ea/settings') return Response.json({ triage_sound_settings:{ volume:0.6,triggers:{ actual_recorded:{ enabled:true,soundId:'latch' } } } });
    if (path === '/api/briefing/actual/metadata') return Response.json({ accounts:[{ id:'checking',name:'Checking' }],payees:[],categories:[] });
    if (/\/financial-activity\/(event|document|import)\//.test(path)) { if (failDetail-- > 0) return Response.json({ message:'Temporary status failure' },{status:503}); return Response.json(current); }
    if (path.startsWith('/api/briefing/financial-activity?')) return Response.json({ items:current.status !== 'completed' ? [current] : [],total:current.status !== 'completed' ? 1 : 0,attentionTotal:current.status === 'needs_attention' ? 1 : 0,offset:0,limit:20 });
    if (path === '/api/briefing/financial-events/complete' || path.endsWith('/commit')) {
      if (path.endsWith('/commit') && rejectImport) return Response.json({accepted:0},{status:202});
      current = { ...current,status:'processing',updatedAt:2,reason:'Owner-confirmed entry queued for Actual.',actions:{ ...current.actions,complete:false } };
      if (current.reference.owner === 'document') current = { ...current,id:'event',reference:{ owner:'event',id:'event' } };
      return Response.json(path.endsWith('/commit') ? { accepted:1 } : { ...plan,workflow:{ ...plan.workflow,state:'pending' } },{ status:202 });
    }
    throw Error('Unexpected request: '+path);
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function useImportFixture() {
  current = { ...current,source:'paypal',reference:{ owner:'import',id:'event',runId:'run' },completionPlan:null,importItem:{ id:'event',runId:'run',gmailAccountId:'gmail',gmailMessageId:'message',emailUid:'receipt',emailSubject:'Receipt',internetMessageId:null,source:'paypal',parserVersion:'1',externalId:null,importedId:null,date:'2026-09-08',amountCents:-3000,currency:'USD',payee:'Example Merchant',notes:'',actualAccountId:'checking',actualCategoryId:null,automationMode:'observe',automaticSafe:false,blockingWarnings:[],evidence:[],financialPlan:null,planShadow:null,status:'needs_review',reconciliationStatus:null,attempts:0,lastError:null,confirmedAt:null,createdAt:1,updatedAt:1 } };
}

it.each(['managed','import','document'] as const)('keeps %s submissions selected and silent until a fresh verified receipt arrives',async owner => {
  if (owner === 'import') useImportFixture();
  if (owner === 'document') current = { ...current,id:'document:1',reference:{ owner:'document',id:'1' },completionPlan:{ ...plan,workflow:{ ...plan.workflow!,id:'document:1',completion:{ ...plan.workflow!.completion!,eventRevision:null } } } };
  render(<FinancialWorkspace search={`?financial=list&view=needs_attention&owner=${owner === 'import' ? 'import' : owner === 'document' ? 'document' : 'event'}&record=${owner === 'document' ? '1' : 'event'}&recordRun=run`} onNavigate={()=>{}} onClose={()=>{}} onRepair={()=>{}} onDirty={()=>{}} registerBack={()=>{}} requestDiscard={action=>action()} />);
  const review = await screen.findByRole('button',{ name:'Review before sending' });
  await waitFor(()=>expect((review as HTMLButtonElement).disabled).toBe(false));
  fireEvent.submit(screen.getByRole('form',{ name:'Complete financial record' }));
  vi.useFakeTimers({ toFake:['setTimeout','clearTimeout'] });
  await act(async()=>{
    if (owner === 'import') fireEvent.click(screen.getByRole('button',{ name:'Record in Actual' }));
    else fireEvent.submit(screen.getByRole('form',{ name:'Complete financial record' }));
  });
  expect(screen.getByRole('region',{ name:'Pending' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('processing will continue');
  expect(screen.queryByRole('button',{ name:'Record in Actual' })).toBeNull();
  expect(screen.queryByText('Already recorded in Actual')).toBeNull();
  expect(played).toBe(0);
  // A publication may race a transient failed read; it must not cancel recovery.
  failDetail = 1;
  await act(async()=>window.dispatchEvent(new Event('ea-financial-event-changed')));
  expect(screen.getByRole('alert').textContent).toContain('Temporary status failure');
  current = { ...current,status:'completed',updatedAt:3,originalReceipts:[{ reference:current.reference,revision:2,capturedAt:3,captureKind:'settlement',outcome:'already_present',input:{},result:{},evidence:null }] };
  // A selected pending record must settle without requiring focus or an SSE event.
  await act(async()=>{ await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByRole('status').textContent).toContain('Already recorded in Actual');
  expect(screen.getByRole('status').textContent).toContain('No duplicate');
  expect(screen.queryByRole('button',{ name:'Record in Actual' })).toBeNull();
  expect(played).toBe(1);
},10000);


it('restores review after accepted work returns to attention instead of retaining a stuck queued form',async () => {
  render(<FinancialWorkspace search="?financial=list&view=needs_attention&owner=event&record=event" onNavigate={()=>{}} onClose={()=>{}} onRepair={()=>{}} onDirty={()=>{}} registerBack={()=>{}} requestDiscard={action=>action()} />);
  const review = await screen.findByRole('button',{ name:'Review before sending' });
  await waitFor(()=>expect((review as HTMLButtonElement).disabled).toBe(false));
  fireEvent.submit(screen.getByRole('form',{ name:'Complete financial record' }));
  fireEvent.submit(screen.getByRole('form',{ name:'Complete financial record' }));
  await screen.findByRole('region',{ name:'Pending' });
  expect(screen.getByRole('status').textContent).toContain('processing will continue');
  current = { ...current,status:'needs_attention',updatedAt:3,reason:'Choose a different account.',actions:{ ...current.actions,complete:true } };
  act(()=>window.dispatchEvent(new Event('ea-financial-event-changed')));
  expect(await screen.findByRole('button',{ name:'Review before sending' })).toBeTruthy();
  expect(screen.queryByText('Confirmation received')).toBeNull();
  expect(screen.queryByText('Recorded in Actual')).toBeNull();
});


it('does not claim confirmation when an import admission returns accepted zero',async () => {
  useImportFixture(); rejectImport = true;
  render(<FinancialWorkspace search="?financial=list&view=needs_attention&owner=import&record=event&recordRun=run" onNavigate={()=>{}} onClose={()=>{}} onRepair={()=>{}} onDirty={()=>{}} registerBack={()=>{}} requestDiscard={action=>action()} />);
  const review = await screen.findByRole('button',{ name:'Review before sending' });
  await waitFor(()=>expect((review as HTMLButtonElement).disabled).toBe(false));
  fireEvent.submit(screen.getByRole('form',{ name:'Complete financial record' }));
  fireEvent.click(screen.getByRole('button',{ name:'Record in Actual' }));
  expect((await screen.findByRole('alert')).textContent).toContain('This confirmation was not accepted');
  expect(screen.queryByText('Confirmation received')).toBeNull();
  expect(screen.queryByText('Recorded in Actual')).toBeNull();
  expect(screen.getByRole('button',{ name:'Record in Actual' })).toBeTruthy();
});
