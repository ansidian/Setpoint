import { apiFetch } from './apiFetch';
import type { FinanceWorkspace, JournalRange } from '../../shared/types/finances';
export const getFinances = ():Promise<FinanceWorkspace> => apiFetch('/api/briefing/finances');
export const getFinanceJournal = (start:string,end:string,transactionId?:string):Promise<JournalRange> => apiFetch(`/api/briefing/finances/journal?${new URLSearchParams({ start,end,...(transactionId ? { transactionId } : {}) })}`);
