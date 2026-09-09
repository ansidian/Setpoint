import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FinancialActivity, FinancialActivityPage } from '../../../shared/types/financial-activity';
import FinancialWorkspace from './FinancialWorkspace';

const activity: FinancialActivity = {
  id:'receipt', reference:{ owner:'event',id:'receipt' }, occurrences:[], source:'managed',
  contexts:['arrival'], emailUids:[], subject:'Receipt', payee:'Completed merchant',
  amountCents:-3000, currency:'USD', createdAt:1, updatedAt:1, status:'completed', reason:'',
  actions:{ complete:false,retry:false,inspect:true,correct:false }, originalReceipts:[],
  sourceEvidence:[], targetBindings:[], liveState:'not_checked', effectiveResult:null,
  completionPlan:null, importItem:null, runs:[],
};
const page = (items:FinancialActivity[] = []):FinancialActivityPage => ({
  items,total:items.length,attentionTotal:0,offset:0,limit:20,
});
let pending: { query:URLSearchParams; resolve:(response:Response)=>void }[];

function Workspace() {
  const [search,setSearch] = useState('?financial=list&view=needs_attention&offset=0');
  return <FinancialWorkspace search={search} onNavigate={href=>setSearch(href.slice(href.indexOf('?')))}
    onClose={()=>{}} onRepair={()=>{}} onDirty={()=>{}} registerBack={()=>{}} requestDiscard={action=>action()} />;
}

async function respond(view:string, value:FinancialActivityPage, status = 200) {
  await act(async()=>{
    const matching = pending.filter(request=>request.query.get('view') === view);
    pending = pending.filter(request=>!matching.includes(request));
    for (const request of matching) request.resolve(Response.json(status === 200 ? value : { message:'Activity unavailable' },{ status }));
  });
}

beforeEach(()=>{
  pending = [];
  // The HTTP boundary deliberately leaves responses pending, including abandoned requests.
  vi.stubGlobal('fetch',(path:string)=>new Promise<Response>(resolve=>{
    pending.push({ query:new URL(path,'http://localhost').searchParams,resolve });
  }));
});
afterEach(()=>{ cleanup(); vi.unstubAllGlobals(); });

it('never presents another filter’s rows or empty result while a new filter is loading',async()=>{
  render(<Workspace />);
  await respond('needs_attention',page());
  fireEvent.click(screen.getByRole('button',{ name:'Completed' }));
  expect(screen.queryByText('No completed financial activity yet.')).toBeNull();
  expect(screen.getByText('Loading financial activity…')).toBeTruthy();
  await respond('completed',page([activity]));
  expect(screen.getByRole('button',{ name:/Completed merchant/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{ name:'All' }));
  expect(screen.queryByRole('button',{ name:/Completed merchant/ })).toBeNull();
  expect(screen.getByText('Loading financial activity…')).toBeTruthy();
});

it('restores previously loaded filters immediately without depending on another response',async()=>{
  render(<Workspace />);
  await respond('needs_attention',page());
  fireEvent.click(screen.getByRole('button',{ name:'Completed' }));
  await respond('completed',page([activity]));
  fireEvent.click(screen.getByRole('button',{ name:'Needs attention' }));
  expect(screen.getByText('No financial records need your attention.')).toBeTruthy();
  expect(screen.queryByText('Loading financial activity…')).toBeNull();
  fireEvent.click(screen.getByRole('button',{ name:'Completed' }));
  expect(screen.getByRole('button',{ name:/Completed merchant/ })).toBeTruthy();
  expect(screen.queryByText('Loading financial activity…')).toBeNull();
});

it.each(['focus','ea-financial-event-changed'])('invalidates every cached filter on %s and ignores abandoned results',async event=>{
  render(<Workspace />);
  await respond('needs_attention',page());
  fireEvent.click(screen.getByRole('button',{ name:'Completed' }));
  await respond('completed',page([activity]));
  fireEvent.click(screen.getByRole('button',{ name:'All' }));
  fireEvent.click(screen.getByRole('button',{ name:'Needs attention' }));
  await respond('all',page([{ ...activity,payee:'Abandoned result' }]));
  expect(screen.queryByRole('button',{ name:/Abandoned result/ })).toBeNull();
  act(()=>window.dispatchEvent(new Event(event)));
  await respond('needs_attention',page());
  fireEvent.click(screen.getByRole('button',{ name:'Completed' }));
  expect(screen.queryByRole('button',{ name:/Completed merchant/ })).toBeNull();
  expect(screen.getByText('Loading financial activity…')).toBeTruthy();
  await respond('completed',page([{ ...activity,payee:'Updated result' }]));
  expect(screen.getByRole('button',{ name:/Updated result/ })).toBeTruthy();
});

it('shows a failed filter request as an error and retries without claiming it is empty',async()=>{
  render(<Workspace />);
  await respond('needs_attention',page());
  fireEvent.click(screen.getByRole('button',{ name:'Completed' }));
  await respond('completed',page(),503);
  expect(screen.getByRole('alert').textContent).toContain('Activity unavailable');
  expect(screen.queryByText('No completed financial activity yet.')).toBeNull();
  expect(screen.queryByText('Loading financial activity…')).toBeNull();
  fireEvent.click(screen.getByRole('button',{ name:'Try again' }));
  await respond('completed',page([activity]));
  expect(screen.getByRole('button',{ name:/Completed merchant/ })).toBeTruthy();
});
