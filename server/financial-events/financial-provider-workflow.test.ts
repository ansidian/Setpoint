import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { initializeFinancialEventTestSchema, authentication, receipt } from './financial-event-service.test-utils.ts';
import { createFinancialEventStore } from './financial-event-store.ts';
import { createFinancialEventWorker } from './financial-event-service.ts';
import { activateFinancialProviderEpoch } from './financial-provider-policy.ts';
import { readFinancialReviewChanges } from './financial-event-review.ts';

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
function setup() {
  const store = createFinancialEventStore(db,()=>now);
  const worker = createFinancialEventWorker({store,now:()=>now,canRun:async()=>false,
    assessDocument:async()=>{throw new Error('Financial AI must not be used');},
    profileReader:async()=>({budgetId:'budget',revision:1,profiles:[]}),
    sourceAcquirer:async(_user,uid)=>{
      const document = (await store.getDocumentForEmail('owner',uid))!;
      return {subject:document.subject,body:document.body,fromAddress:document.fromAddress,fromName:document.fromName,emailDate:document.emailDate,threadId:null,messageId:null,senderAuthentication:document.senderAuthentication,attachments:[]};
    },
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
it('makes unsupported templates reviewable with no invented financial candidate',async()=>{
  await email('unsupported',{subject:'New bill format',body:'Your bill is available online.'});
  const {store,worker}=setup();
  await worker.processNextDocument();
  const document=(await store.getDocumentForEmail('owner','unsupported'))!;
  expect(document).toMatchObject({status:'retry',candidate:null,nextAttemptAt:null,providerAssessment:{status:'review',providerId:'sce'}});
  expect(document.processedRevision).toBe(document.revision);
  expect((await readFinancialReviewChanges('owner',{dbClient:db})).items.map(item=>item.emailUid)).toEqual(['unsupported']);
  expect(await store.getNextWakeAt()).toBeNull();
  expect(await store.dismissCandidate(document,null,{eventId:'dismissed',referenceKey:null})).toBe(true);
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
