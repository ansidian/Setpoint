import { resolveManagedFinancialPlan } from './financial-event-status.ts';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { initializeFinancialEventTestSchema, authentication, receipt } from './financial-event-service.test-utils.ts';
import { createFinancialEventStore } from './financial-event-store.ts';
import { createFinancialEventWorker } from './financial-event-service.ts';
import { activateFinancialProviderEpoch } from './financial-provider-policy.ts';
import { readFinancialReviewChanges } from './financial-event-review.ts';
import admissionCases from '../triage/fixtures/financial-admission.json' with {type:'json'};
import { EMAIL_EVIDENCE_CHAR_LIMIT, EMAIL_EVIDENCE_TRUNCATED } from '../email/email-evidence.ts';

let db: Client;
let cutoff: string;
let now: number;
beforeEach(async () => {
  db = createClient({url:'file::memory:'});
  await initializeFinancialEventTestSchema(db);
  await db.execute("UPDATE ea_financial_workflow_state SET cutover_at='2020-01-01T00:00:00Z'");
  await db.execute("INSERT INTO ea_financial_connection_state(user_id,revision,source_fingerprint) VALUES('owner',1,'fixture')");
  cutoff = await activateFinancialProviderEpoch('owner',1,db);
  now = Date.parse(cutoff)+1000;
});
afterEach(()=>db.close());
async function email(uid: string, {from='sce@message.sce.com',subject='Bill is ready',body='Amount Due $125.35 Due Date October 15, 2026',date=new Date(now).toISOString(),indexedAt=new Date(now).toISOString()}={}) {
  const auth = authentication({...receipt(uid),from});
  await db.execute({sql:`INSERT INTO ea_email_index(uid,user_id,account_id,account_label,account_email,from_name,from_address,subject,body_text,email_date,email_date_utc,indexed_at,sender_authentication_json,read)
    VALUES(?,'owner','gmail','Mail','owner@example.test','Provider',?,?,?,?,?,?,?,0)`,args:[uid,from,subject,body,date,date,indexedAt,JSON.stringify(auth)]});
}
function setup(overrides: Partial<Parameters<typeof createFinancialEventWorker>[0]> = {}) {
  const store = createFinancialEventStore(db,()=>now);
  const worker = createFinancialEventWorker({store,now:()=>now,canRun:async()=>false,
    assessDocument:async()=>{throw new Error('Financial AI must not be used');},
    profileReader:async()=>({budgetId:'budget',revision:1,profiles:[]}),
    sourceAcquirer:async(_user,uid)=>{
      const document = (await store.getDocumentForEmail('owner',uid))!;
      return {subject:document.subject,body:document.body,fromAddress:document.fromAddress,fromName:document.fromName,emailDate:document.emailDate,threadId:null,messageId:null,senderAuthentication:document.senderAuthentication,attachments:[]};
    },
    ...overrides,
  });
  return {store,worker};
}
it('enrolls only mail both received and first indexed after the new epoch; refetch never enrolls historical mail',async()=>{
  await email('old-arrival',{date:new Date(Date.parse(cutoff)-1000).toISOString()});
  await email('old-index',{indexedAt:new Date(Date.parse(cutoff)-1000).toISOString()});
  await email('new');
  const {store}=setup();
  expect((await store.claimDocument('claim'))?.emailUid).toBe('new');
  await db.execute("UPDATE ea_email_index SET body_text='Changed' WHERE uid='old-arrival'");
  expect((await store.getDocumentForEmail('owner','old-arrival'))?.processingPolicy).toBe('legacy');
  await expect(activateFinancialProviderEpoch('owner',1,db)).rejects.toThrow('cannot be reset');
});
it('parses a supported provider while email AI is disabled and records parser provenance',async()=>{
  await email('supported');
  const {store,worker}=setup();
  await worker.processNextDocument();
  const document=await store.getDocumentForEmail('owner','supported');
  expect(document?.providerAssessment).toMatchObject({status:'parsed',providerId:'sce',templateId:'bill-ready'});
  expect(document?.candidate).toMatchObject({amount:125.35,due_date:'2026-10-15'});
  expect(document?.eventId).toBeTruthy();
});
it('ignores supported eBay packing notices while AI is paused',async()=>{
  const source=admissionCases[0]!.source;
  await email('packing',{from:source.fromAddress,subject:source.subject,body:source.body});
  const {store,worker}=setup();
  expect(await worker.processNextDocument()).toBe(true);
  expect(await store.getDocumentForEmail('owner','packing')).toMatchObject({status:'ignored',candidate:null,eventId:null,
    providerAssessment:{status:'nonfinancial',providerId:'ebay',templateId:'packing-update'}});
  expect((await readFinancialReviewChanges('owner',{dbClient:db})).items).toEqual([]);
  expect(await worker.processNextEvent()).toBe(false);
});
it('ignores unsupported templates without bill facts and keeps them out of review',async()=>{
  await email('unsupported',{subject:'Service notice',body:'Your service is available online.'});
  const {store,worker}=setup();
  await worker.processNextDocument();
  expect(await store.getDocumentForEmail('owner','unsupported')).toMatchObject({status:'ignored',candidate:null,eventId:null,
    providerAssessment:{status:'nonfinancial',providerId:'sce',templateId:'unsupported'}});
  expect((await readFinancialReviewChanges('owner',{dbClient:db})).items).toEqual([]);
});
it('makes unsupported templates with labeled bill facts reviewable with no invented financial candidate',async()=>{
  await email('unsupported',{subject:'New bill format',body:'Amount Due $84.20 Due Date October 15, 2026'});
  const {store,worker}=setup();
  await worker.processNextDocument();
  const document=(await store.getDocumentForEmail('owner','unsupported'))!;
  expect(document).toMatchObject({status:'retry',candidate:null,nextAttemptAt:null,providerAssessment:{status:'review',providerId:'sce'}});
  expect(document.processedRevision).toBe(document.revision);
  expect((await readFinancialReviewChanges('owner',{dbClient:db})).items.map(item=>item.emailUid)).toEqual(['unsupported']);
  expect(await store.getNextWakeAt()).toBeNull();
  expect(await store.dismissCandidate(document,null,{eventId:'dismissed',referenceKey:null})).toBe(true);
});
it('settles a receipt that an Actual schedule already covers without review or an Actual operation',async()=>{
  await email('covered',{from:'service@paypal.com',subject:'Apple Services: $0.99 USD',
    body:'You paid $0.99 USD to Apple Services Transaction ID REFERENCE00000001 Transaction date Aug 18, 2026 Merchant Apple Services Total $0.99 USD'});
  const {store,worker}=setup({
    metadataReader:async()=>({accounts:[],categories:[],payeeMap:{},payees:[{id:'apple',name:'Apple'}],recentTransactions:[],
      schedules:[{id:'family',name:'Family Cloud',next_date:'2026-08-18',type:'bill',conditions:[{field:'amount',op:'is',value:-99},{field:'payee',op:'is',value:'apple'}]}]}),
    execute:async()=>{throw new Error('Covered events must not reach Actual');},
  });
  await worker.processNextDocument();
  expect(await worker.processNextEvent()).toBe(true);
  expect(await store.getEventForEmail('owner','covered')).toMatchObject({status:'settled',attemptedAt:null,
    reason:'Covered by Actual schedule "Family Cloud" (Actual posts it on 2026-08-18).'});
  expect((await readFinancialReviewChanges('owner',{dbClient:db})).items).toEqual([]);
});
it('keeps a provider review notice out of review when its Actual schedule already covers it',async()=>{
  await email('autopay',{from:'no-reply@o.sofi.org',subject:'Your SoFi Credit Card autopay is scheduled for 10/05/2026',
    body:'Your autopay for your SoFi Credit Card ending in 1234 is scheduled. Scheduled payment date: 10/05/2026'});
  const {store,worker}=setup({metadataReader:async()=>({accounts:[],categories:[],payeeMap:{},payees:[],recentTransactions:[],
    schedules:[{id:'card',name:'SoFi Credit Card (1234) Payment',next_date:'2026-10-05',type:'transfer',conditions:[{field:'amount',op:'is',value:-20743}]}]})});
  await worker.processNextDocument();
  expect(await store.getDocumentForEmail('owner','autopay')).toMatchObject({status:'ignored',candidate:null,eventId:null,
    providerAssessment:{status:'review',templateId:'autopay-scheduled'},
    error:'Covered by Actual schedule "SoFi Credit Card (1234) Payment" (Actual posts it on 2026-10-05).'});
  expect((await readFinancialReviewChanges('owner',{dbClient:db})).items).toEqual([]);
});
it('preserves all Amazon orders through the stored manual review without scheduling an automatic write', async () => {
  await email('multi-order', { from: 'auto-confirm@amazon.com', subject: 'Ordered: Three items',
    body: 'Order # 111-1000000-1000001 Grand Total: 10.97 USD Order # 111-1000000-1000002 Grand Total: 113.61 USD Order # 111-1000000-1000003 Grand Total: 14.35 USD' });
  const { store, worker } = setup();
  await worker.processNextDocument();
  const review = await resolveManagedFinancialPlan('owner', 'multi-order', { dbClient: db });
  expect(review).toMatchObject({ candidate: { amount: null, order_items: [
    { reference: '111-1000000-1000001', amount: 10.97 }, { reference: '111-1000000-1000002', amount: 113.61 }, { reference: '111-1000000-1000003', amount: 14.35 },
  ] }, workflow: { completion: { canComplete: true } } });
  expect((await store.getDocumentForEmail('owner', 'multi-order'))?.error).toContain('Review one split per order');
  expect(await worker.processNextEvent()).toBe(false);
});
it('explains a SoCalGas notification that omits bill facts without inventing an amount or date',async()=>{
  await email('notification',{from:'customerservice@socalgas.com',subject:'Your bill from SoCalGas is now available',body:'Your current bill is available on My Account. Log in to view and pay your bill.'});
  const {store,worker}=setup();await worker.processNextDocument();
  expect(await store.getDocumentForEmail('owner','notification')).toMatchObject({status:'retry',nextAttemptAt:null,candidate:{amount:null,due_date:null},
    error:'This notification does not include an amount or due date. Check the bill and enter them.'});
});
it.each([
  ['receipt',{from:'orders@market.example',subject:'Your receipt',body:'Order ORDER-104 Total $42.10'}],
  ['reminder',{from:'billing@unknown.example',subject:'Payment reminder',body:'Your payment is due soon.'}],
  ['oversized',{from:'billing@unknown.example',body:'x'.repeat(EMAIL_EVIDENCE_CHAR_LIMIT+1)}],
  ['incomplete',{from:'billing@unknown.example',body:EMAIL_EVIDENCE_TRUNCATED}],
] as const)('ignores an unknown %s sender without AI assessment or review',async(uid,source)=>{
  await email(uid,source);
  const {store}=setup();
  const worker=createFinancialEventWorker({store,now:()=>now,canRun:async()=>true,
    assessDocument:async()=>{throw new Error('Unknown senders must not use financial AI');}});
  expect(await worker.processNextDocument()).toBe(true);
  expect(await store.getDocumentForEmail('owner',uid)).toMatchObject({status:'ignored',candidate:null,eventId:null,nextAttemptAt:null,
    error:null,providerAssessment:{status:'unrecognized'}});
  expect((await readFinancialReviewChanges('owner',{dbClient:db})).items).toEqual([]);
  expect(await store.getNextWakeAt()).toBeNull();
  expect(await worker.processNextEvent()).toBe(false);
});
it('does not allow historical queued work to acquire first-write authority',async()=>{
  await email('historical',{date:new Date(Date.parse(cutoff)-1000).toISOString()});
  const {store}=setup();
  expect(await store.claimDocument('old')).toBeNull();
  expect(await store.getNextWakeAt()).toBeNull();
});
it('keeps attempted historical recovery available without re-extraction or another dispatch',async()=>{
  await email('admitted',{date:new Date(Date.parse(cutoff)-1000).toISOString()});
  const operation={executor:'financial',input:{budgetId:'clone',kind:'transaction',identityKey:'immutable-original'}};
  await db.execute({sql:`INSERT INTO ea_financial_events(id,user_id,status,operation_json,attempted_at,created_at,updated_at)
    VALUES('attempted','owner','pending',?,1,1,1)`,args:[JSON.stringify(operation)]});
  await db.execute("UPDATE ea_financial_documents SET event_id='attempted' WHERE email_uid='admitted'");
  const {store}=setup();
  let recovered=0;
  const worker=createFinancialEventWorker({store,now:()=>now,canRun:async()=>false,
    assessDocument:async()=>{throw new Error('Must not re-extract immutable history');},
    execute:async(_owner,saved,mode)=>{
      expect(mode).toBe('recover');expect(saved).toEqual(operation);recovered++;
      return {outcome:'already_present',reason:'Verified immutable entry',budgetId:'clone'};
    },afterWrite:async()=>{},
  });
  expect(await worker.processNextEvent()).toBe(true);
  expect(recovered).toBe(1);
  expect((await store.getEventForEmail('owner','admitted'))?.operation).toEqual(operation);
  expect((await store.getEventForEmail('owner','admitted'))?.status).toBe('needs_review');
});
it('reassesses only unsubmitted post-epoch reviews on a parser upgrade',async()=>{
  await email('review',{subject:'New bill format',body:'Your bill is online.'});
  const {store,worker}=setup();await worker.processNextDocument();
  await db.execute(`UPDATE ea_financial_documents SET provider_assessment_json=json_set(provider_assessment_json,'$.policyVersion','obsolete')`);
  await store.recoverStaleClaims();
  const refreshed=(await store.getDocumentForEmail('owner','review'))!;
  expect(refreshed.status).toBe('pending');
  expect(refreshed.processedRevision).toBeLessThan(refreshed.revision);
  expect(refreshed.processingPolicy).toBe('provider_v1');
});
