import type { PaymentOrganization } from '../../shared/types/payment-groups';
import { apiFetch } from './apiFetch';
import type { FinanceWorkspace, JournalRange } from '../../shared/types/finances';
export const getFinances = ():Promise<FinanceWorkspace> => apiFetch('/api/briefing/finances');
export const getFinanceJournal = (start:string,end:string,transactionId?:string):Promise<JournalRange> => apiFetch(`/api/briefing/finances/journal?${new URLSearchParams({ start,end,...(transactionId ? { transactionId } : {}) })}`);
export const savePaymentOrganization = (organization: PaymentOrganization):Promise<PaymentOrganization> => apiFetch('/api/briefing/finances/payment-groups', {method:'PUT',body:JSON.stringify(organization)});
